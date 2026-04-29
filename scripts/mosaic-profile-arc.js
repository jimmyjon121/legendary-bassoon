#!/usr/bin/env node
/* eslint-disable no-console */

const {
  assertSafeToRun,
  makeProfile,
  resolveOllamaBlobPath,
  runLlamaCliGenerate,
  runOpenVinoGenerate,
  writeProfile,
} = require('./mosaic-profile-utils');

async function main() {
  const model = process.argv[2] || 'qwen2.5-coder:14b';
  assertSafeToRun({ minFreeRamGB: 4 });
  const samples = [];
  const resolved = resolveOllamaBlobPath(model);
  if (resolved.success) {
    const result = runLlamaCliGenerate({
      modelPath: resolved.modelPath,
      device: process.env.MOSAIC_ARC_DEVICE || 'Vulkan1',
      numPredict: Number(process.env.MOSAIC_PROFILE_NUM_PREDICT) || 8,
      prompt: 'Reply with one short sentence.',
    });
    samples.push({ attempted: 'llama-cli-vulkan-arc', device: process.env.MOSAIC_ARC_DEVICE || 'Vulkan1', ...result });
    if (result.ok && Number(result.tokensPerSecond) > 0) {
      const profile = makeProfile({
        device: 'arc',
        model,
        throughputTokensPerSecond: result.tokensPerSecond,
        latencyMs: result.elapsedMs || 0,
        hardware: {
          name: 'Intel Arc 140T iGPU',
          memoryBytes: 16 * 1024 ** 3,
          llamaDevice: process.env.MOSAIC_ARC_DEVICE || 'Vulkan1',
          runner: result.runner,
        },
        samples,
        source: 'live',
        fallbackReason: null,
        error: null,
      });
      const out = writeProfile('arc', profile);
      console.log(`wrote ${out}`);
      return;
    }
  } else {
    samples.push({ attempted: 'resolve-ollama-blob', result: resolved });
  }

  // The current OpenVINO server is configured for NPU in this branch. Gate 1
  // records Arc as a measured/fallback profile rather than pretending a true
  // HETERO layer split happened when the endpoint cannot expose it.
  const result = await runOpenVinoGenerate({ prompt: 'Reply with one short sentence.', maxTokens: 8 });
  samples.push({ attempted: 'openvino-gpu-or-hetero', result });
  const ok = Boolean(result?.ok && /gpu/i.test(String(result?.data?.device || result?.data?.meta?.device || '')));
  const latency = Number(result?.data?.meta?.latency_ms || result?.data?.latency_ms || result?.elapsedMs || 0);
  const profile = makeProfile({
    device: 'arc',
    model,
    throughputTokensPerSecond: ok ? 8 / Math.max(0.001, latency / 1000) : 6,
    latencyMs: latency || 1500,
    hardware: {
      name: 'Intel Arc 140T iGPU',
      memoryBytes: 10 * 1024 ** 3,
    },
    samples,
    source: ok ? 'live' : 'fallback',
    fallbackReason: ok ? null : 'OpenVINO endpoint did not expose an Arc/HETERO GPU split; using conservative projection',
    error: null,
  });
  const out = writeProfile('arc', profile);
  console.log(`wrote ${out}`);
}

main().catch((error) => {
  console.error(`mosaic-profile-arc FAILED: ${error?.message || error}`);
  process.exit(1);
});
