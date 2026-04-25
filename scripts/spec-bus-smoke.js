#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Spec-Decode Bus smoke (Phase 2 gate).
 *
 * Exercises the bus contract against a stub transport so we can assert
 * the orchestration logic (requestDraft -> submitVerification -> metrics)
 * works without requiring a live NPU server. The shmem transport stub
 * is also probed to confirm it surfaces the expected NOT_IMPLEMENTED.
 */

const { createSpecDecodeBus } = require('../electron/services/spec-decode-bus');

const failures = [];

function assert(condition, description) {
  if (!condition) failures.push(description);
}

function fakeNpuBridge() {
  let lastRequest = null;
  return {
    lastRequest: () => lastRequest,
    async draftTokens(payload) {
      lastRequest = payload;
      // Simulate a 5ms NPU round-trip.
      await new Promise((r) => setTimeout(r, 5));
      return {
        success: true,
        request_id: payload.requestId || 'auto-id',
        draft_tokens: [10, 20, 30, 40].slice(0, payload.lookahead),
        draft_logprobs: null,
        latency_ms: 5,
        engine: 'genai',
        device: 'NPU',
      };
    },
    async cancelDraft(requestId) {
      return { success: true, request_id: requestId };
    },
  };
}

function fakeLogits(vocabSize, hotIdx) {
  const arr = new Array(vocabSize).fill(0);
  arr[hotIdx] = 5;
  return arr;
}

async function scenarioRoundTripGreedy() {
  const bus = createSpecDecodeBus({ npuBridge: fakeNpuBridge() });
  assert(bus.transport === 'http', `Default transport should be http (got ${bus.transport})`);

  const draft = await bus.requestDraft({ prompt: 'def hello():', lookahead: 4 });
  assert(draft.success === true, 'Draft request should succeed via stub bridge');
  assert(Array.isArray(draft.draft_tokens) && draft.draft_tokens.length === 4, 'Draft should return 4 tokens');

  const verify = await bus.submitVerification({
    prefix: [1],
    draftTokens: draft.draft_tokens,
    evaluateLogits: async (tokens) => tokens.map((_, i) => fakeLogits(100, draft.draft_tokens[i] ?? 0)),
    mode: 'greedy',
  });
  assert(verify.accepted.length === draft.draft_tokens.length, 'All draft tokens should be accepted with matching logits');

  const metrics = bus.getMetrics();
  assert(metrics.drafts.count === 1, `Bus should record one draft (got ${metrics.drafts.count})`);
  assert(metrics.verifies.count === 1, `Bus should record one verify (got ${metrics.verifies.count})`);
  assert(metrics.drafts.p50LatencyMs >= 0, 'Bus should compute draft p50 latency');

  bus.dispose();
}

async function scenarioCancelDraft() {
  const bus = createSpecDecodeBus({ npuBridge: fakeNpuBridge() });
  const cancelResult = await bus.cancelDraft('arbitrary-id');
  assert(cancelResult.success === true, 'cancelDraft should propagate transport result');
  bus.dispose();
}

async function scenarioSessionLifecycle() {
  // The session API (createSession / extendSession / closeSession) is the
  // A3 lower-overhead path. Bus must round-trip through it.
  const sessionState = { id: null, extends: 0 };
  const bridge = {
    async draftTokens() { return { success: true, draft_tokens: [1, 2, 3, 4] }; },
    async cancelDraft() { return { success: true }; },
    async createDraftSession({ prompt }) {
      sessionState.id = `srv-sess-${Math.random().toString(36).slice(2, 6)}`;
      return { success: true, session_id: sessionState.id, prompt_chars: (prompt || '').length };
    },
    async extendDraftSession({ sessionId, lookahead }) {
      if (sessionId !== sessionState.id) {
        return { success: false, error: 'unknown session' };
      }
      sessionState.extends += 1;
      return {
        success: true,
        session_id: sessionId,
        request_id: `req-${sessionState.extends}`,
        draft_tokens: [10, 20, 30, 40].slice(0, lookahead),
        latency_ms: 5,
        extend_count: sessionState.extends,
      };
    },
    async closeDraftSession(sessionId) {
      if (sessionId !== sessionState.id) {
        return { success: false, error: 'unknown session' };
      }
      sessionState.id = null;
      return { success: true, session_id: sessionId, extend_count: sessionState.extends };
    },
  };
  const bus = createSpecDecodeBus({ npuBridge: bridge });
  const created = await bus.createSession({ prompt: 'def hello():' });
  assert(created.success === true && created.session_id, 'createSession should return a session_id');

  const extended = await bus.extendSession({ sessionId: created.session_id, lookahead: 4 });
  assert(extended.success === true && extended.draft_tokens?.length === 4, 'extendSession should return draft tokens');

  const closed = await bus.closeSession(created.session_id);
  assert(closed.success === true && closed.extend_count === 1, 'closeSession should return final extend_count');

  bus.dispose();
}

async function scenarioMetricsOnFailure() {
  const failingBridge = {
    async draftTokens() { return { success: false, error: 'boom' }; },
    async cancelDraft() { return { success: true }; },
  };
  const bus = createSpecDecodeBus({ npuBridge: failingBridge });
  const result = await bus.requestDraft({ prompt: 'x' });
  assert(result.success === false, 'Failing transport should bubble success=false');
  const metrics = bus.getMetrics();
  assert(metrics.drafts.failures === 1, `Failure count should be 1 (got ${metrics.drafts.failures})`);
  bus.dispose();
}

async function scenarioShmemStub() {
  const bus = createSpecDecodeBus({ npuBridge: fakeNpuBridge(), transport: 'shmem' });
  let raised = false;
  try {
    await bus.requestDraft({ prompt: 'x' });
  } catch (err) {
    raised = err?.code === 'SPEC_BUS_TRANSPORT_UNAVAILABLE';
  }
  assert(raised, 'shmem transport must throw SPEC_BUS_TRANSPORT_UNAVAILABLE');
  bus.dispose();
}

async function scenarioDisposeIsTerminal() {
  const bus = createSpecDecodeBus({ npuBridge: fakeNpuBridge() });
  bus.dispose();
  let raised = false;
  try {
    await bus.requestDraft({ prompt: 'x' });
  } catch (err) {
    raised = /disposed/.test(err?.message || '');
  }
  assert(raised, 'Calling requestDraft after dispose must throw');
}

async function main() {
  await scenarioRoundTripGreedy();
  await scenarioCancelDraft();
  await scenarioSessionLifecycle();
  await scenarioMetricsOnFailure();
  await scenarioShmemStub();
  await scenarioDisposeIsTerminal();

  if (failures.length > 0) {
    console.error('Spec Bus smoke FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('Spec Bus smoke PASS');
}

main().catch((err) => {
  console.error('Spec Bus smoke ERROR:', err?.message || err);
  process.exit(1);
});
