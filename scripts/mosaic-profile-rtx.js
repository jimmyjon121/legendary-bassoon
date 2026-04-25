#!/usr/bin/env node
/* eslint-disable no-console */

const {
  assertSafeToRun,
  makeProfile,
  queryNvidiaSmi,
  runOllamaGenerate,
  writeProfile,
} = require('./mosaic-profile-utils');

async function main() {
  const model = process.argv[2] || 'qwen2.5-coder:14b';
  const viaLlamanode = process.argv.includes('--via-llamanode');
  assertSafeToRun({ minFreeRamGB: 4 });
  const gpu = queryNvidiaSmi();
  const samples = [];

  if (viaLlamanode) {
    const LlamaNodeBackend = require('../electron/services/backends/llamanode-backend');
    const backend = new LlamaNodeBackend({ id: 'mosaic-rtx', useGpu: true, device: 'NVIDIA GPU' });
    const health = await backend.checkHealth();
    samples.push({ mode: 'llamanode-health', health });
    const profile = makeProfile({
      device: 'rtx',
      model,
      throughputTokensPerSecond: health?.gpuMode === 'cuda' ? 30 : 1,
      latencyMs: 1000,
      hardware: { ...gpu, gpuMode: health?.gpuMode || null },
      samples,
      source: health?.gpuMode === 'cuda' ? 'live' : 'fallback',
      fallbackReason: health?.gpuMode === 'cuda' ? null : 'llamanode did not resolve CUDA',
    });
    const out = writeProfile('rtx', profile);
    console.log(`wrote ${out}`);
    return;
  }

  for (const numGpu of [0, 8, 16, 24, 32, 40]) {
    const result = await runOllamaGenerate({ model, numGpu, numPredict: 8 });
    samples.push({ numGpu, ...result });
  }

  const successful = samples.filter((s) => s.ok && Number(s.tokensPerSecond) > 0);
  const best = successful.sort((a, b) => b.tokensPerSecond - a.tokensPerSecond)[0] || samples[samples.length - 1] || {};
  const profile = makeProfile({
    device: 'rtx',
    model,
    throughputTokensPerSecond: best.tokensPerSecond || 0.01,
    latencyMs: best.elapsedMs || 0,
    hardware: gpu,
    samples,
    source: best.ok ? 'live' : 'fallback',
    fallbackReason: best.ok ? null : (best.error || 'ollama rtx profile failed'),
    error: best.ok ? null : (best.error || 'no successful rtx sample'),
  });
  const out = writeProfile('rtx', profile);
  console.log(`wrote ${out}`);
}

main().catch((error) => {
  console.error(`mosaic-profile-rtx FAILED: ${error?.message || error}`);
  process.exit(1);
});
