#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Speculative-decoding verifier smoke (Phase 2 gate).
 *
 * Exercises spec-decode-verifier with synthetic logits across a fixed
 * set of scenarios. Conventions:
 *   - prefix is a non-empty list (e.g. [BOS]).
 *   - logits[k] is the verifier's distribution for the token at
 *     position k+1 (i.e. AFTER observing tokens[0..k]).
 *   - For draftTokens of length n following a prefix of length m, the
 *     callback returns m+n logits rows; rows m-1..m+n-2 cover the
 *     draft predictions and row m+n-1 covers the bonus.
 */

const { verifySpecBatch, argmax, softmax } = require('../electron/services/spec-decode-verifier');

const failures = [];

function assert(condition, description) {
  if (!condition) failures.push(description);
}

function fakeLogits(vocabSize, hotIdx, hotMargin = 5) {
  const arr = new Float32Array(vocabSize);
  arr[hotIdx] = hotMargin;
  return Array.from(arr);
}

async function evaluateAll({ logitsByPosition }) {
  return logitsByPosition;
}

async function scenarioGreedyAllAccepted() {
  // prefix=[BOS], draft=[10,20,30,40]; verifier argmax matches all draft tokens.
  const draft = [10, 20, 30, 40];
  const logitsByPosition = [
    fakeLogits(100, 10),  // logits[0] -> predicts d_0 = 10
    fakeLogits(100, 20),  // logits[1] -> predicts d_1 = 20
    fakeLogits(100, 30),  // logits[2] -> predicts d_2 = 30
    fakeLogits(100, 40),  // logits[3] -> predicts d_3 = 40
    fakeLogits(100, 50),  // logits[4] -> bonus argmax = 50
  ];
  const result = await verifySpecBatch({
    prefix: [1],
    draftTokens: draft,
    evaluateLogits: () => evaluateAll({ logitsByPosition }),
    mode: 'greedy',
  });
  assert(result.accepted.length === 4, `Greedy: all-match should accept all 4 (got ${result.accepted.length})`);
  assert(result.rejectedAtIndex === null, 'Greedy: all-match rejectedAtIndex should be null');
  assert(result.bonusToken === 50, `Greedy: tail bonus should be 50 (got ${result.bonusToken})`);
  assert(result.mode === 'greedy', 'Greedy: mode reported correctly');
}

async function scenarioGreedyMidReject() {
  // Only the first 2 draft tokens match the verifier's argmax.
  const draft = [10, 20, 99, 40];
  const logitsByPosition = [
    fakeLogits(100, 10),  // -> d_0 = 10  ACCEPT
    fakeLogits(100, 20),  // -> d_1 = 20  ACCEPT
    fakeLogits(100, 30),  // -> verifier wants 30 but draft says 99  REJECT
    fakeLogits(100, 40),  // unused
    fakeLogits(100, 50),  // unused
  ];
  const result = await verifySpecBatch({
    prefix: [1],
    draftTokens: draft,
    evaluateLogits: () => evaluateAll({ logitsByPosition }),
    mode: 'greedy',
  });
  assert(result.accepted.length === 2, `Greedy: mid-reject should accept 2 (got ${result.accepted.length})`);
  assert(result.rejectedAtIndex === 2, `Greedy: rejectedAtIndex should be 2 (got ${result.rejectedAtIndex})`);
  assert(result.bonusToken === 30, `Greedy: bonus on reject should be 30 (got ${result.bonusToken})`);
}

async function scenarioFirstReject() {
  const draft = [99, 20, 30];
  const logitsByPosition = [
    fakeLogits(100, 7),   // verifier wants 7, draft says 99  REJECT at i=0
    fakeLogits(100, 20),
    fakeLogits(100, 30),
    fakeLogits(100, 40),
  ];
  const result = await verifySpecBatch({
    prefix: [1],
    draftTokens: draft,
    evaluateLogits: () => evaluateAll({ logitsByPosition }),
    mode: 'greedy',
  });
  assert(result.accepted.length === 0, 'Greedy: first-reject should accept 0');
  assert(result.rejectedAtIndex === 0, 'Greedy: rejectedAtIndex should be 0');
  assert(result.bonusToken === 7, `Greedy: first-reject bonus should be 7 (got ${result.bonusToken})`);
}

async function scenarioStochasticFallback() {
  // Stochastic mode without draftLogprobs falls back to greedy.
  const draft = [10, 99];
  const logitsByPosition = [
    fakeLogits(100, 10),  // -> d_0 = 10  ACCEPT
    fakeLogits(100, 20),  // -> verifier 20, draft 99  REJECT
    fakeLogits(100, 30),
  ];
  const result = await verifySpecBatch({
    prefix: [1],
    draftTokens: draft,
    evaluateLogits: () => evaluateAll({ logitsByPosition }),
    mode: 'stochastic',
  });
  assert(result.mode === 'greedy', 'Stochastic without logprobs should report greedy fallback');
  assert(result.accepted.length === 1, 'Stochastic fallback: should accept first token only');
  assert(result.rejectedAtIndex === 1, 'Stochastic fallback: should reject at index 1');
  assert(result.bonusToken === 20, `Stochastic fallback bonus should be 20 (got ${result.bonusToken})`);
}

async function scenarioStochasticAccept() {
  // Stochastic with high p/q ratio should accept everything; bonus is
  // sampled from softmax of tail logits.
  const draft = [10, 20];
  const logitsByPosition = [
    fakeLogits(100, 10, 10),  // very confident at 10
    fakeLogits(100, 20, 10),
    fakeLogits(100, 30, 10),
  ];
  const result = await verifySpecBatch({
    prefix: [1],
    draftTokens: draft,
    evaluateLogits: () => evaluateAll({ logitsByPosition }),
    mode: 'stochastic',
    draftLogprobs: [0.5, 0.5],
    rng: () => 0.001,  // always accept
  });
  assert(result.mode === 'stochastic', 'Stochastic with logprobs should report stochastic mode');
  assert(result.accepted.length === 2, `Stochastic: high p/q should accept all (got ${result.accepted.length})`);
  assert(result.rejectedAtIndex === null, 'Stochastic all-accept rejectedAtIndex should be null');
}

async function scenarioInvalidInput() {
  let threwOnEmptyDraft = false;
  try {
    await verifySpecBatch({ prefix: [1], draftTokens: [], evaluateLogits: async () => [] });
  } catch (err) {
    threwOnEmptyDraft = /non-empty/.test(err?.message || '');
  }
  assert(threwOnEmptyDraft, 'Empty draft must raise an error');

  let threwOnEmptyPrefix = false;
  try {
    await verifySpecBatch({ prefix: [], draftTokens: [1], evaluateLogits: async () => [] });
  } catch (err) {
    threwOnEmptyPrefix = /prefix.*non-empty/.test(err?.message || '');
  }
  assert(threwOnEmptyPrefix, 'Empty prefix must raise an error');

  let threwOnMissingCallback = false;
  try {
    await verifySpecBatch({ prefix: [1], draftTokens: [1, 2] });
  } catch (err) {
    threwOnMissingCallback = /evaluateLogits/.test(err?.message || '');
  }
  assert(threwOnMissingCallback, 'Missing evaluateLogits callback must raise an error');
}

async function scenarioHelperFunctions() {
  assert(argmax([1, 5, 3, 4]) === 1, 'argmax should pick highest-value index');
  assert(argmax([]) === -1, 'argmax of empty should be -1');
  const probs = softmax([1, 1, 1]);
  assert(probs.length === 3 && Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'softmax should sum to 1');
}

async function main() {
  await scenarioGreedyAllAccepted();
  await scenarioGreedyMidReject();
  await scenarioFirstReject();
  await scenarioStochasticFallback();
  await scenarioStochasticAccept();
  await scenarioInvalidInput();
  await scenarioHelperFunctions();

  if (failures.length > 0) {
    console.error('Spec Verifier smoke FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('Spec Verifier smoke PASS');
}

main().catch((err) => {
  console.error('Spec Verifier smoke ERROR:', err?.message || err);
  process.exit(1);
});
