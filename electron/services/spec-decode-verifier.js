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

// ─── Row helpers (logits-array OR sparse Map<token, prob>) ────────────
// The orchestrator's spec loop passes the verifier rows that come either
// from controlledEvaluate (Map<Token, number>, already softmaxed and
// sorted) or from a synthetic test (Float32Array of dense logits).
// Helpers below normalize the access pattern so the algorithm stays
// agnostic about which representation it got.

function rowIsMap(row) {
  return row && typeof row.entries === 'function' && typeof row.get === 'function';
}

function rowArgmax(row) {
  if (!row) return -1;
  if (rowIsMap(row)) {
    // controlledEvaluate returns the Map sorted by probability, so the
    // first entry is the argmax.
    const next = row.entries().next();
    if (next.done || !Array.isArray(next.value)) return -1;
    return next.value[0];
  }
  return argmax(row);
}

function rowProbability(row, token) {
  if (!row) return 0;
  if (rowIsMap(row)) {
    return Number(row.get(token)) || 0;
  }
  // Float32Array is raw logits -- softmax-on-demand. Cache the softmax
  // on the array itself so repeat lookups don't re-exponentiate.
  if (!row.__softmaxCache) {
    Object.defineProperty(row, '__softmaxCache', {
      value: softmax(row),
      enumerable: false,
      writable: false,
    });
  }
  return row.__softmaxCache[token] ?? 0;
}

function rowSample(row, rng = Math.random) {
  if (!row) return -1;
  if (rowIsMap(row)) {
    const r = rng();
    let cum = 0;
    for (const [token, prob] of row.entries()) {
      cum += prob;
      if (r <= cum) return token;
    }
    // Fall through to last entry on rounding error.
    let last = -1;
    for (const [token] of row.entries()) last = token;
    return last;
  }
  if (!row.__softmaxCache) {
    Object.defineProperty(row, '__softmaxCache', {
      value: softmax(row),
      enumerable: false,
      writable: false,
    });
  }
  return sampleFromDistribution(row.__softmaxCache, rng);
}

function rowResidualSample(row, draftProb, draftToken, rng = Math.random) {
  // Stochastic-mode bonus: sample from max(0, p_verifier - p_draft) where
  // we approximate the drafter's distribution by placing all of its mass
  // on draftToken with weight `draftProb`. This isn't the full drafter
  // distribution (which we don't have for the NPU drafter today), but it
  // preserves the spec-sampling property that the rejected-draft bonus
  // is drawn from a distribution whose marginal matches the verifier.
  if (!row) return -1;
  if (rowIsMap(row)) {
    const residual = new Map();
    let sum = 0;
    for (const [token, prob] of row.entries()) {
      const r = token === draftToken ? Math.max(0, prob - (Number(draftProb) || 0)) : prob;
      if (r > 0) {
        residual.set(token, r);
        sum += r;
      }
    }
    if (sum <= 0) return rowSample(row, rng);
    const draw = rng() * sum;
    let cum = 0;
    for (const [token, weight] of residual.entries()) {
      cum += weight;
      if (draw <= cum) return token;
    }
    let last = -1;
    for (const [token] of residual.entries()) last = token;
    return last;
  }
  if (!row.__softmaxCache) {
    Object.defineProperty(row, '__softmaxCache', {
      value: softmax(row),
      enumerable: false,
      writable: false,
    });
  }
  const probs = row.__softmaxCache;
  const residual = new Array(probs.length);
  let sum = 0;
  for (let i = 0; i < probs.length; i += 1) {
    const r = i === draftToken ? Math.max(0, probs[i] - (Number(draftProb) || 0)) : probs[i];
    residual[i] = r;
    sum += r;
  }
  if (sum <= 0) return sampleFromDistribution(probs, rng);
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
      const verifierArgmax = rowArgmax(logitsRow);
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
    const p = rowProbability(logitsRow, draftToken);
    const q = Math.max(1e-9, draftLogprobs[i] || 1e-9);
    const acceptProb = Math.min(1, p / q);
    if (rng() <= acceptProb) {
      accepted.push(draftToken);
      acceptanceLogprobs.push(Math.log(Math.max(1e-12, p)));
    } else {
      rejectedAtIndex = i;
      bonusToken = rowResidualSample(logitsRow, q, draftToken, rng);
      break;
    }
  }

  if (bonusToken === null) {
    // All draft tokens accepted: amortize the forward pass by sampling
    // one bonus token from the verifier distribution that follows the
    // last accepted draft token.
    const tailRow = logits[logits.length - 1];
    if (tailRow) {
      bonusToken = effectiveMode === 'greedy' ? rowArgmax(tailRow) : rowSample(tailRow, rng);
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

/**
 * Tree speculation: run the verifier over each branch independently and
 * commit the longest-matching one plus its bonus token. Calls the
 * single-branch verifier in parallel; the caller is responsible for
 * picking branch sequences whose prefixes overlap (so tokens shared
 * across branches are still useful as commit material).
 *
 * Returns the same shape as verifySpecBatch plus:
 *   - winnerBranch: number index of the chosen branch (0-based)
 *   - perBranch: array of per-branch result objects
 *   - marginalGainTokens: extra accepted tokens vs. the second-best branch
 */
async function verifyTreeBatch({
  prefix = [],
  branches,
  evaluateLogits,
  mode = 'greedy',
  rng = Math.random,
} = {}) {
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new Error('verifyTreeBatch: branches must be a non-empty array');
  }
  const startedAt = Date.now();

  const perBranch = await Promise.all(branches.map(async (branchSpec) => {
    const draftTokens = Array.isArray(branchSpec?.draftTokens) ? branchSpec.draftTokens : [];
    if (draftTokens.length === 0) {
      return {
        branchId: branchSpec?.branchId ?? null,
        accepted: [],
        rejectedAtIndex: 0,
        bonusToken: null,
        durationMs: 0,
        empty: true,
      };
    }
    try {
      const result = await verifySpecBatch({
        prefix,
        draftTokens,
        evaluateLogits,
        mode,
        draftLogprobs: branchSpec?.draftLogprobs ?? null,
        rng,
      });
      return { ...result, branchId: branchSpec?.branchId ?? null };
    } catch (err) {
      return {
        branchId: branchSpec?.branchId ?? null,
        accepted: [],
        rejectedAtIndex: 0,
        bonusToken: null,
        durationMs: 0,
        error: err?.message || String(err),
      };
    }
  }));

  // Pick the branch with the longest accepted prefix; tie-break on
  // verifier-assigned acceptance logprob sum (higher confidence wins).
  let winnerIdx = 0;
  for (let i = 1; i < perBranch.length; i += 1) {
    const a = perBranch[winnerIdx];
    const b = perBranch[i];
    if (b.accepted.length > a.accepted.length) {
      winnerIdx = i;
      continue;
    }
    if (b.accepted.length === a.accepted.length) {
      const aSum = (a.acceptanceLogprobs || []).reduce((s, x) => s + x, 0);
      const bSum = (b.acceptanceLogprobs || []).reduce((s, x) => s + x, 0);
      if (bSum > aSum) winnerIdx = i;
    }
  }

  const winner = perBranch[winnerIdx];
  const sorted = [...perBranch].sort((a, b) => b.accepted.length - a.accepted.length);
  const marginalGainTokens = sorted.length > 1
    ? Math.max(0, sorted[0].accepted.length - sorted[1].accepted.length)
    : winner.accepted.length;

  return {
    accepted: winner.accepted,
    rejectedAtIndex: winner.rejectedAtIndex,
    bonusToken: winner.bonusToken,
    acceptanceLogprobs: winner.acceptanceLogprobs || [],
    durationMs: Date.now() - startedAt,
    mode: winner.mode || mode,
    winnerBranch: winnerIdx,
    winnerBranchId: winner.branchId ?? null,
    perBranch,
    marginalGainTokens,
  };
}

module.exports = {
  verifySpecBatch,
  verifyTreeBatch,
  softmax,
  argmax,
  rowArgmax,
  rowProbability,
  rowSample,
  rowResidualSample,
};
