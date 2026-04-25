#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Live CUDA verifier probe.
 *
 * This is intentionally not part of release-gate: it loads the native
 * node-llama-cpp CUDA backend and may load the local qwen2.5:1.5b GGUF
 * verifier through the orchestrator. It writes an auditable markdown artifact
 * so the tracker can distinguish "CUDA unavailable" from "CUDA verified".
 */

const fs = require('fs');
const path = require('path');
const { InferenceOrchestrator } = require('../electron/services/inference-orchestrator');

const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs/perf/cuda-verifier-live.md');
const MODEL = process.env.SPEC_EVAL_MAIN_MODEL || process.env.SMOKE_MODEL || 'qwen2.5:1.5b';
const CONTEXT_SIZE = Number(process.env.CUDA_VERIFIER_PROBE_CTX || 1024);

function createStore() {
  const data = new Map([
    ['preferredBackend', 'auto'],
    ['performanceProfile', 'balanced'],
    ['llmEndpoint', process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434'],
    ['openvinoEndpoint', process.env.NPU_SERVER_URL || 'http://127.0.0.1:8081'],
  ]);
  return {
    get: (key) => data.get(key),
    set: (key, value) => data.set(key, value),
  };
}

function markdownFor(result) {
  const lines = [
    '# CUDA Verifier Live Probe',
    '',
    'This artifact verifies whether the in-process llama.cpp verifier path resolves CUDA on the target machine and whether `prewarmSpecDecodeVerifier()` can load the local GGUF verifier.',
    '',
    '## Summary',
    '',
    `- **Date:** ${result.date}`,
    `- **Model:** ${result.model}`,
    `- **Context size:** ${result.contextSize}`,
    `- **Backend health:** ${JSON.stringify(result.health)}`,
    `- **Active GPU mode:** ${result.gpuMode || 'unknown'}`,
    `- **Prewarm result:** ${JSON.stringify(result.prewarm)}`,
    `- **Outcome:** ${result.ok ? 'verified CUDA verifier prewarm' : 'not verified'}`,
    result.reason ? `- **Reason:** ${result.reason}` : null,
    '',
    '## Raw JSON',
    '',
    '```json',
    JSON.stringify(result, null, 2),
    '```',
    '',
  ];
  return lines.filter((line) => line !== null && line !== undefined).join('\n');
}

async function main() {
  process.env.DEVFORGE_SPEC_DECODE_ENABLE = '1';
  const orchestrator = new InferenceOrchestrator(createStore());
  orchestrator.hardware = {
    gpus: [{ type: 'nvidia', name: 'NVIDIA GPU' }],
    npu: { detected: true },
    cpu: {},
    recommendations: {},
  };

  await orchestrator.initializeBackends();
  const backend = orchestrator.backends.get('llamanode');
  const health = backend ? await backend.checkHealth() : { available: false, error: 'llamanode backend missing' };
  const gpuMode = backend && typeof backend.getActiveGpuMode === 'function'
    ? await backend.getActiveGpuMode()
    : 'unavailable';
  const prewarm = await orchestrator.prewarmSpecDecodeVerifier(MODEL, { contextSize: CONTEXT_SIZE });

  const result = {
    date: new Date().toISOString(),
    model: MODEL,
    contextSize: CONTEXT_SIZE,
    health,
    gpuMode,
    prewarm,
    ok: health.available === true && gpuMode === 'cuda' && prewarm?.warmed === true,
    reason: null,
  };

  if (!result.ok) {
    result.reason = prewarm?.skipped || health?.error || `gpuMode=${gpuMode}`;
  }

  fs.writeFileSync(OUT_PATH, markdownFor(result), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  const result = {
    date: new Date().toISOString(),
    model: MODEL,
    contextSize: CONTEXT_SIZE,
    health: null,
    gpuMode: 'unavailable',
    prewarm: null,
    ok: false,
    reason: error?.message || String(error),
  };
  fs.writeFileSync(OUT_PATH, markdownFor(result), 'utf8');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
});
