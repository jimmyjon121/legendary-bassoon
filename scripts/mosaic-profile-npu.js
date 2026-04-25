#!/usr/bin/env node
/* eslint-disable no-console */

const {
  assertSafeToRun,
  makeProfile,
  requestJson,
  runOpenVinoGenerate,
  writeProfile,
  OPENVINO_ENDPOINT,
} = require('./mosaic-profile-utils');

async function main() {
  const model = process.argv[2] || 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov';
  assertSafeToRun({ minFreeRamGB: 3 });
  const status = await requestJson('GET', `${OPENVINO_ENDPOINT}/status`, null, 5000);
  const samples = [];
  let result = null;
  if (status.ok) {
    result = await runOpenVinoGenerate({ prompt: 'Reply with one short sentence.', maxTokens: 8 });
    samples.push({ status: status.data, result });
  }
  const ok = Boolean(status.ok && result?.ok && result?.data?.engine);
  const latency = Number(result?.data?.meta?.latency_ms || result?.data?.latency_ms || 0);
  const completionTokens = Number(result?.data?.usage?.completion_tokens || 8);
  const tps = latency > 0 ? completionTokens / (latency / 1000) : 0.01;
  const profile = makeProfile({
    device: 'npu',
    model,
    throughputTokensPerSecond: ok ? tps : 0.5,
    latencyMs: latency || 1000,
    hardware: {
      name: 'Intel NPU 3',
      memoryBytes: 1.5 * 1024 ** 3,
      endpoint: OPENVINO_ENDPOINT,
      status: status.data || null,
    },
    samples,
    source: ok ? 'live' : 'fallback',
    fallbackReason: ok ? null : (status.error || result?.error || 'NPU OpenVINO profile unavailable'),
    error: ok ? null : (status.error || result?.error || 'NPU OpenVINO profile unavailable'),
  });
  const out = writeProfile('npu', profile);
  console.log(`wrote ${out}`);
}

main().catch((error) => {
  console.error(`mosaic-profile-npu FAILED: ${error?.message || error}`);
  process.exit(1);
});
