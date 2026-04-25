#!/usr/bin/env node
/* eslint-disable no-console */

const { InferenceOrchestrator } = require('../electron/services/inference-orchestrator');

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function createStore() {
  const data = new Map([
    ['preferredBackend', 'auto'],
    ['performanceProfile', 'balanced'],
  ]);
  return {
    get: (key) => data.get(key),
    set: (key, value) => data.set(key, value),
  };
}

function createMockBackend(id) {
  return {
    id,
    name: id,
    device: 'mock',
    priority: 1,
    estimatePerformance: () => ({ suitable: true, score: 10, tokensPerSecond: 1 }),
    checkHealth: async () => ({ available: true, status: 'ready' }),
  };
}

async function main() {
  const failures = [];
  const orchestrator = new InferenceOrchestrator(createStore());
  orchestrator.initialized = true;
  orchestrator.hardware = { gpus: [], npu: { detected: true }, cpu: {}, recommendations: {} };
  orchestrator.preferredBackendId = 'auto';
  orchestrator.backends.clear();
  orchestrator.backends.set('openvino-npu', createMockBackend('openvino-npu'));
  orchestrator.backends.set('ollama-cuda', createMockBackend('ollama-cuda'));
  orchestrator._safeBackendHealth = async (backend) => backend.checkHealth();

  const forced = await orchestrator._selectBackendForRequest({
    model: 'qwen2.5:1.5b',
    forceBackend: 'openvino-npu',
    workloadType: 'chat',
    lane: 'lane_interactive',
  });
  assert(forced?.backend?.id === 'openvino-npu', 'forceBackend=openvino-npu must select the openvino-npu backend', failures);
  assert(
    forced?.decisionEvidence?.selectionSource === 'forceBackend',
    `forceBackend route must report selectionSource=forceBackend (got ${forced?.decisionEvidence?.selectionSource})`,
    failures,
  );
  assert(
    forced?.decisionEvidence?.selectedBackend === 'openvino-npu',
    `forceBackend route must report selectedBackend=openvino-npu (got ${forced?.decisionEvidence?.selectedBackend})`,
    failures,
  );

  const missing = await orchestrator._selectBackendForRequest({
    model: 'qwen2.5:1.5b',
    forceBackend: 'not-registered',
    workloadType: 'chat',
    lane: 'lane_interactive',
  });
  const rejected = missing?.decisionEvidence?.rejectedCandidates || [];
  assert(missing, 'unregistered forceBackend must return a decision instead of throwing', failures);
  assert(
    rejected.some((row) => row.backendId === 'not-registered' && row.reason === 'force_backend_unavailable'),
    'unregistered forceBackend must appear as force_backend_unavailable in rejectedCandidates',
    failures,
  );

  if (failures.length) {
    console.error('autonomy-orchestrator-route-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('autonomy-orchestrator-route-smoke PASS');
}

main().catch((error) => {
  console.error(`autonomy-orchestrator-route-smoke FAILED: ${error?.message || error}`);
  process.exit(1);
});
