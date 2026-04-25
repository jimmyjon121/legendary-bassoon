#!/usr/bin/env node
/* eslint-disable no-console */

const os = require('os');
const {
  assertSafeToRun,
  makeProfile,
  runOllamaGenerate,
  writeProfile,
} = require('./mosaic-profile-utils');

async function main() {
  const model = process.argv[2] || 'qwen2.5-coder:14b';
  assertSafeToRun({ minFreeRamGB: 4 });
  const samples = [];
  for (let i = 0; i < 3; i += 1) {
    samples.push(await runOllamaGenerate({ model, numGpu: 0, numPredict: 8 }));
  }
  const successful = samples.filter((s) => s.ok && Number(s.tokensPerSecond) > 0);
  const median = successful.sort((a, b) => a.tokensPerSecond - b.tokensPerSecond)[Math.floor(successful.length / 2)] || samples[0] || {};
  const profile = makeProfile({
    device: 'cpu',
    model,
    throughputTokensPerSecond: median.tokensPerSecond || 0.01,
    latencyMs: median.elapsedMs || 0,
    hardware: {
      name: os.cpus()?.[0]?.model || 'CPU',
      memoryBytes: os.totalmem(),
      cores: os.cpus()?.length || null,
    },
    samples,
    source: median.ok ? 'live' : 'fallback',
    fallbackReason: median.ok ? null : (median.error || 'ollama cpu profile failed'),
    error: median.ok ? null : (median.error || 'no successful cpu sample'),
  });
  const out = writeProfile('cpu', profile);
  console.log(`wrote ${out}`);
}

main().catch((error) => {
  console.error(`mosaic-profile-cpu FAILED: ${error?.message || error}`);
  process.exit(1);
});
