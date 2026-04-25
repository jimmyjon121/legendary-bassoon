/**
 * Speculative-Decoding Verifier
 *
 * Pure-logic verifier for Phase 2's NPU-drafted speculative decoding.
 * Takes a prefix + draft tokens, runs the main model once over the
 * combined sequence, and emits an acceptance mask plus a bonus token
 * sampled from the verifier's own distribution after the longest
 * accepted prefix.
 *
 * Two modes:
 *   - 'greedy' (default, also used when temperature == 0): accept a
 *     draft token if-and-only-if it matches the verifier's argmax.
 *     Simple, deterministic, slightly lower acceptance rate than
 *     stochastic sampling but guaranteed to be loss-free vs. running
 *     the verifier alone.
 *   - 'stochastic' (Leviathan et al.): accept draft token d_i with
 *     probability min(1, p_i(d_i) / q_i(d_i)) where p is the verifier
 *     distribution and q is the drafter distribution. On rejection,
 *     sample from max(0, p - q). Requires the drafter to expose its
 *     logprobs; falls back to greedy when q is unavailable.
 *
 * The adapter (live llama.cpp / synthetic test fixture / etc.) is
 * supplied as an `evaluateLogits` callback that takes a list of tokens
 * and returns logits at each position. This lets the smoke tests pump
 * synthetic distributions through the same code path that the real
 * CUDA path will use, without coupling the verifier to llamanode.
 */

function softmax(logits) {
  if (!logits || logits.length === 0) return [];
  let max = -Infinity;
  for (const value of logits) {
    if (value > max) max = value;
  }
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }
  if (sum <= 0) return exps.map(() => 0);
  for (let i = 0; i < exps.length; i += 1) {
    exps[i] /= sum;
  }
  return exps;
}

function argmax(logits) {
  if (!logits || logits.length === 0) return -1;
  let bestIdx = 0;
  let bestVal = logits[0];
  for (let i = 1; i < logits.length; i += 1) {
    if (logits[i] > bestVal) {
      bestVal = logits[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

function sampleFromDistribution(probs, rng = Math.random) {
  const r = rng();
  let cum = 0;
  for (let i = 0; i < probs.length; i += 1) {
    cum += probs[i];
    if (r <= cum) return i;
  }
  return probs.length - 1;
}

function residualSample(verifierProbs, draftProbs, rng = Math.random) {
  // Sample from max(0, p - q), normalized. Used when stochastic mode
  // rejects a draft token; the bonus replacement is drawn from this
  // residual distribution to preserve the verifier's marginal.
  const residual = new Array(verifierProbs.length);
  let sum = 0;
  for (let i = 0; i < verifierProbs.length; i += 1) {
    const r = Math.max(0, verifierProbs[i] - (draftProbs?.[i] ?? 0));
    residual[i] = r;
    sum += r;
  }
  if (sum <= 0) {
    // Fall back to verifier sample when residual is degenerate.
    return sampleFromDistribution(verifierProbs, rng);
  }
  for (let i = 0; i < residual.length; i += 1) residual[i] /= sum;
  return sampleFromDistribution(residual, rng);
}

/**
 * Run the speculative-decoding verifier over a single draft batch.
 *
 * Contract:
 *   - `prefix`: tokens already accepted into the conversation (the
 *     verifier KV cache anchor).
 *   - `draftTokens`: candidate next tokens emitted by the NPU drafter.
 *   - `evaluateLogits(tokens)`: async function. Returns
 *     `Float32Array[]` of length `tokens.length`, where logits[i] is
 *     the verifier's next-token distribution after observing
 *     `tokens[0..i]`. The verifier runs ONE forward pass over the
 *     combined `prefix + draftTokens` input; this callback is the
 *     adapter that surfaces the per-position logits.
 *   - `mode`: 'greedy' (default) or 'stochastic'.
 *   - `draftLogprobs`: optional drafter probabilities per draft token,
 *     required for stochastic mode. Falls back to greedy when absent.
 *   - `rng`: seedable RNG for stochastic mode (defaults to Math.random).
 *
 * Returns:
 *   {
 *     accepted: int[],            // accepted tokens (subset of draftTokens)
 *     rejectedAtIndex: number|null, // first index that was rejected
 *     bonusToken: number,         // token to commit after the accepted run
 *     acceptanceLogprobs: number[], // per-step acceptance logprob (for stats)
 *     durationMs: number,
 *     mode: 'greedy' | 'stochastic',
 *   }
 */
async function verifySpecBatch({
  prefix = [],
  draftTokens,
  evaluateLogits,
  mode = 'greedy',
  draftLogprobs = null,
  rng = Math.random,
} = {}) {
  if (typeof evaluateLogits !== 'function') {
    throw new Error('verifySpecBatch: evaluateLogits callback is required');
  }
  if (!Array.isArray(draftTokens) || draftTokens.length === 0) {
    throw new Error('verifySpecBatch: draftTokens must be a non-empty array');
  }

  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw new Error('verifySpecBatch: prefix must be non-empty (BOS or anchor token required)');
  }

  const startedAt = Date.now();
  const combined = [...prefix, ...draftTokens];
  const logits = await evaluateLogits(combined);
  if (!Array.isArray(logits) || logits.length !== combined.length) {
    throw new Error(`verifySpecBatch: evaluateLogits returned ${logits?.length} entries, expected ${combined.length}`);
  }

  const draftStart = prefix.length;
  const accepted = [];
  const acceptanceLogprobs = [];
  let rejectedAtIndex = null;
  let bonusToken = null;

  const useStochastic = mode === 'stochastic'
    && Array.isArray(draftLogprobs)
    && draftLogprobs.length === draftTokens.length;
  const effectiveMode = useStochastic ? 'stochastic' : 'greedy';

  for (let i = 0; i < draftTokens.length; i += 1) {
    // logits[k] is the verifier's distribution for what comes AFTER
    // observing tokens[0..k] -- i.e., the prediction for position k+1.
    // For draft token d_i at combined position draftStart+i, we need
    // logits at index draftStart+i-1.
    const logitsRow = logits[draftStart + i - 1];
    if (!logitsRow) {
      rejectedAtIndex = i;
      break;
    }
    const draftToken = draftTokens[i];

    if (effectiveMode === 'greedy') {
      const verifierArgmax = argmax(logitsRow);
      if (verifierArgmax === draftToken) {
        accepted.push(draftToken);
        acceptanceLogprobs.push(0);
        continue;
      }
      rejectedAtIndex = i;
      bonusToken = verifierArgmax;
      break;
    }

    // Stochastic acceptance: min(1, p(d_i) / q(d_i))
    const verifierProbs = softmax(logitsRow);
    const p = verifierProbs[draftToken] ?? 0;
    const q = Math.max(1e-9, draftLogprobs[i] || 1e-9);
    const acceptProb = Math.min(1, p / q);
    if (rng() <= acceptProb) {
      accepted.push(draftToken);
      acceptanceLogprobs.push(Math.log(Math.max(1e-12, p)));
    } else {
      rejectedAtIndex = i;
      bonusToken = residualSample(verifierProbs, null, rng);
      break;
    }
  }

  if (bonusToken === null) {
    // All draft tokens accepted: amortize the forward pass by sampling
    // one bonus token from the verifier distribution that follows the
    // last accepted draft token.
    const tailLogits = logits[logits.length - 1];
    if (tailLogits) {
      bonusToken = effectiveMode === 'greedy'
        ? argmax(tailLogits)
        : sampleFromDistribution(softmax(tailLogits), rng);
    }
  }

  return {
    accepted,
    rejectedAtIndex,
    bonusToken,
    acceptanceLogprobs,
    durationMs: Date.now() - startedAt,
    mode: effectiveMode,
  };
}

module.exports = {
  verifySpecBatch,
  softmax,
  argmax,
};
