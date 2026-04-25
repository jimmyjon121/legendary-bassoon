#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * CUDA verifier guard smoke (v0.4.5 hardening).
 *
 * Static-only: verifies that spec-decode verifier prewarm does not silently
 * load a CPU-only llamanode verifier on the target machine.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function main() {
  const failures = [];
  const backend = read('electron/services/backends/llamanode-backend.js');
  const orchestrator = read('electron/services/inference-orchestrator.js');
  const tracker = read('docs/unified-runtime-tracker.md');

  assert(
    backend.includes('function normalizeLlamaGpuMode(gpu, useGpu = true)'),
    'llamanode-backend must normalize the node-llama-cpp gpu descriptor',
    failures,
  );
  assert(
    /async getActiveGpuMode\(\)\s*\{/.test(backend),
    'llamanode-backend must expose async getActiveGpuMode()',
    failures,
  );
  assert(
    backend.includes("this._activeGpuMode = normalizeLlamaGpuMode(llama?.gpu, this.useGpu);"),
    'llamanode-backend must cache active GPU mode when getLlama() resolves',
    failures,
  );
  assert(
    orchestrator.includes("const gpuMode = typeof backend.getActiveGpuMode === 'function'"),
    'prewarmSpecDecodeVerifier must query backend.getActiveGpuMode() before loading',
    failures,
  );
  assert(
    orchestrator.includes("return { warmed: false, skipped: 'verifier_cpu_only', gpuMode };"),
    'prewarmSpecDecodeVerifier must return verifier_cpu_only without loading when GPU mode is cpu/unavailable',
    failures,
  );
  assert(
    orchestrator.includes("return { warmed: false, skipped: 'verifier_not_cuda', gpuMode };"),
    'prewarmSpecDecodeVerifier must return verifier_not_cuda for non-CUDA GPU modes',
    failures,
  );
  assert(
    /const result = await backend\.loadModel\(verifierModel,\s*\{\s*contextSize\s*\}\);/.test(orchestrator),
    'prewarmSpecDecodeVerifier must still load the verifier after the CUDA guard passes',
    failures,
  );
  assert(
    tracker.includes('Microsoft.VisualStudio.Workload.NativeDesktop'),
    'tracker must document the VS2022 C++ workload that unblocks CUDA verifier prebuilds',
    failures,
  );
  assert(
    tracker.includes('prewarmSpecDecodeVerifier self-disables'),
    'tracker must state prewarmSpecDecodeVerifier self-disables until CUDA is available',
    failures,
  );

  if (failures.length) {
    console.error('cuda-verifier-guard-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('cuda-verifier-guard-smoke PASS');
}

main();
