#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Spec-decode live smoke.
 *
 * Proves the real app path in small, isolated steps:
 *   - SPEC_SMOKE_STEP=cuda-only checks CUDA llamanode health + a non-spec chat turn.
 *   - SPEC_SMOKE_STEP=npu-only checks one NPU draft request.
 *   - SPEC_SMOKE_STEP=combined checks the full spec-decode route.
 *
 * Main model selection:
 *   - SPEC_SMOKE_MAIN_MODEL can be an Ollama model tag (default:
 *     qwen2.5:1.5b) if the local Ollama manifest exists; the
 *     orchestrator resolves the blob path for llamanode.
 *   - SPEC_SMOKE_MAIN_GGUF can be an explicit GGUF/blob path; this is
 *     wrapped as gguf:<path>.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getOrchestrator } = require('../electron/services/inference-orchestrator');
const { getNpuBridge } = require('../electron/services/npu-bridge');
const { getPowerMode } = require('../electron/services/power-mode');
const LlamaNodeBackend = require('../electron/services/backends/llamanode-backend');

const STEP = String(process.env.SPEC_SMOKE_STEP || 'combined').trim().toLowerCase();

function memorySnapshot() {
  return {
    freeGb: Number((os.freemem() / (1024 ** 3)).toFixed(2)),
    rssGb: Number((process.memoryUsage().rss / (1024 ** 3)).toFixed(2)),
  };
}

function logMemory(label) {
  const snapshot = memorySnapshot();
  console.log(`[spec-smoke] memory ${label}: free=${snapshot.freeGb}GB rss=${snapshot.rssGb}GB`);
  return snapshot;
}

function assertFreeRam() {
  const minFreeGb = Number(process.env.SPEC_SMOKE_MIN_FREE_RAM_GB || 6);
  const { freeGb } = memorySnapshot();
  if (freeGb < minFreeGb) {
    throw new Error(`Refusing to start ${STEP}: free RAM ${freeGb.toFixed(2)}GB < ${minFreeGb}GB`);
  }
}

function startResourceWatchdog() {
  const minFreeGb = Number(
    process.env.SPEC_SMOKE_WATCHDOG_MIN_FREE_RAM_GB
      || 4.5,
  );
  const maxRssGb = Number(process.env.SPEC_SMOKE_MAX_RSS_GB || 8);
  const interval = setInterval(() => {
    const freeGb = os.freemem() / (1024 ** 3);
    const rssGb = process.memoryUsage().rss / (1024 ** 3);
    if (freeGb < minFreeGb) {
      console.error(`spec-decode-live-smoke aborting: free RAM ${freeGb.toFixed(2)}GB < ${minFreeGb}GB`);
      process.exit(2);
    }
    if (rssGb > maxRssGb) {
      console.error(`spec-decode-live-smoke aborting: process RSS ${rssGb.toFixed(2)}GB > ${maxRssGb}GB`);
      process.exit(2);
    }
  }, 1000);
  interval.unref?.();
  return () => clearInterval(interval);
}

function makeStore(overrides = {}) {
  const data = new Map(Object.entries({
    performanceProfile: 'balanced',
    preferredBackend: 'auto',
    llmEndpoint: process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
    openvinoEndpoint: process.env.NPU_SERVER_URL || `http://127.0.0.1:${process.env.OPENVINO_SERVER_PORT || 8081}`,
    ...overrides,
  }));
  return {
    get(key) { return data.get(key); },
    set(key, value) { data.set(key, value); },
  };
}

function resolveMainModel() {
  const explicitGguf = String(process.env.SPEC_SMOKE_MAIN_GGUF || '').trim();
  if (explicitGguf) {
    const resolved = path.resolve(explicitGguf);
    if (!fs.existsSync(resolved)) {
      throw new Error(`SPEC_SMOKE_MAIN_GGUF not found: ${resolved}`);
    }
    return `gguf:${resolved}`;
  }

  const model = String(process.env.SPEC_SMOKE_MAIN_MODEL || 'qwen2.5:1.5b').trim();
  const [namePart, tagPart = 'latest'] = model.split(':');
  const parts = namePart.split('/').filter(Boolean);
  const namespace = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : 'library';
  const name = parts[parts.length - 1];
  const manifestPath = path.join(
    os.homedir(),
    '.ollama',
    'models',
    'manifests',
    'registry.ollama.ai',
    namespace,
    name,
    tagPart || 'latest',
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No local Ollama manifest for ${model}. Pull a small compatible model first (recommended: ollama pull qwen2.5:1.5b), or set SPEC_SMOKE_MAIN_GGUF to a small Qwen2.5-family GGUF.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const modelLayer = (Array.isArray(manifest?.layers) ? manifest.layers : [])
    .find((layer) => String(layer?.mediaType || '').includes('application/vnd.ollama.image.model'));
  const sizeGb = Number(modelLayer?.size || 0) / (1024 ** 3);
  if (sizeGb > 4 && process.env.SPEC_SMOKE_ALLOW_LARGE !== '1') {
    throw new Error(`Refusing to run live spec smoke on ${model} (${sizeGb.toFixed(1)} GB). Use a <=4GB model such as qwen2.5:1.5b, or set SPEC_SMOKE_ALLOW_LARGE=1 if you understand the crash risk.`);
  }
  return model;
}

async function ensureNpuServer() {
  const npu = getNpuBridge();
  const status = await npu.getServerStatus?.();
  if (status?.running || status?.healthy) return npu;
  const started = await npu.startServer();
  if (started?.success === false) {
    throw new Error(`Failed to start NPU server: ${started.error || 'unknown'}`);
  }
  return npu;
}

async function cleanup({ orchestrator = null, npu = null, probe = null } = {}) {
  const warnings = [];
  try {
    if (orchestrator?._idlePowerDownTimeout) {
      clearTimeout(orchestrator._idlePowerDownTimeout);
      orchestrator._idlePowerDownTimeout = null;
    }
    if (orchestrator?._npuWarmloop && typeof orchestrator._npuWarmloop.stop === 'function') {
      await orchestrator._npuWarmloop.stop();
    }
  } catch (error) {
    warnings.push(`orchestrator timer cleanup: ${error?.message || error}`);
  }

  try {
    if (probe && typeof probe.unloadModel === 'function') {
      await probe.unloadModel();
    }
  } catch (error) {
    warnings.push(`probe unload: ${error?.message || error}`);
  }

  try {
    const llamaBackend = orchestrator?.backends?.get?.('llamanode')
      || (orchestrator?.currentBackend?.id === 'llamanode' ? orchestrator.currentBackend : null);
    if (llamaBackend && typeof llamaBackend.unloadModel === 'function') {
      await llamaBackend.unloadModel();
    }
  } catch (error) {
    warnings.push(`orchestrator llamanode unload: ${error?.message || error}`);
  }

  try {
    if (npu && typeof npu.unloadModel === 'function') {
      await npu.unloadModel();
    }
    if (npu && typeof npu.stopServer === 'function') {
      await npu.stopServer();
    }
  } catch (error) {
    warnings.push(`npu cleanup: ${error?.message || error}`);
  }

  for (const warning of warnings) {
    console.warn(`[spec-smoke] cleanup warning: ${warning}`);
  }
}

async function runCudaOnly() {
  delete process.env.DEVFORGE_SPEC_DECODE_ENABLE;
  process.env.DEVFORGE_SPEC_DECODE_DISABLE = '1';
  assertFreeRam();
  const stopWatchdog = startResourceWatchdog();
  let probe = null;
  let orchestrator = null;
  const powerMode = getPowerMode();
  const previousPowerEnabled = powerMode.enabled;
  try {
    logMemory('cuda-only:start');
    const model = resolveMainModel();
    probe = new LlamaNodeBackend({ useGpu: true });
    const health = await probe.checkHealth();
    console.log('[spec-smoke] llamanode health:', JSON.stringify(health));
    if (!health.available || health.gpu !== 'cuda') {
      throw new Error(`LlamaNode CUDA unavailable: ${JSON.stringify(health)}`);
    }

    // Keep this isolated: profile=laptop avoids the warm-loop and marking
    // power mode enabled skips PowerMode's NPU startup side effect.
    powerMode.enabled = true;
    orchestrator = getOrchestrator(makeStore({
      performanceProfile: 'laptop',
      preferredBackend: 'ollama-cuda',
    }));
    await orchestrator.initialize();
    let output = '';
    const result = await orchestrator.stream({
      model,
      workloadType: 'chat-main',
      lane: 'lane_interactive',
      allowFallback: true,
      messages: [
        { role: 'user', content: 'Reply with one word: ready' },
      ],
      options: {
        num_ctx: 512,
        num_predict: 1,
        temperature: 0,
      },
    }, (chunk = {}) => {
      if (chunk.response) output += chunk.response;
    });
    if (result?.streamTask && typeof result.streamTask.then === 'function') {
      await result.streamTask;
    }

    const selected = orchestrator.getRuntimeState()?.lastBackendDecision || null;
    if (selected?.selectionSource === 'spec-decode') {
      throw new Error('cuda-only step unexpectedly selected spec-decode');
    }
    if (!output && !result?.response) {
      throw new Error('cuda-only step expected at least one token or response chunk');
    }

    logMemory('cuda-only:end');
    console.log(JSON.stringify({
      step: 'cuda-only',
      model,
      health,
      selected,
      outputPreview: (output || result?.response || '').slice(0, 120),
    }, null, 2));
  } finally {
    powerMode.enabled = previousPowerEnabled;
    stopWatchdog();
    await cleanup({ orchestrator, probe });
  }
}

async function runNpuOnly() {
  delete process.env.DEVFORGE_SPEC_DECODE_ENABLE;
  process.env.DEVFORGE_SPEC_DECODE_DISABLE = '1';
  process.env.DEVFORGE_NPU_GENAI_ONLY = '1';
  process.env.OPENVINO_DEVICE = process.env.OPENVINO_DEVICE || 'NPU';
  assertFreeRam();
  const stopWatchdog = startResourceWatchdog();
  let npu = null;
  try {
    logMemory('npu-only:start');
    npu = await ensureNpuServer();
    const draft = await npu.draftTokens({
      prompt: 'def square(x):\n    ',
      lookahead: 1,
      sampling: { temperature: 0 },
    });
    const tokens = Array.isArray(draft?.draft_tokens) ? draft.draft_tokens : [];
    if (draft?.success === false || tokens.length !== 1) {
      throw new Error(`npu-only expected one draft token, got ${JSON.stringify(draft)}`);
    }
    logMemory('npu-only:end');
    console.log(JSON.stringify({
      step: 'npu-only',
      success: true,
      engine: draft.engine,
      device: draft.device,
      latencyMs: draft.latency_ms,
      draftTokens: tokens,
    }, null, 2));
  } finally {
    stopWatchdog();
    await cleanup({ npu });
  }
}

async function runCombined() {
  if (process.env.DEVFORGE_SPEC_DECODE_ENABLE !== '1') {
    throw new Error('Refusing to run live spec-decode smoke unless DEVFORGE_SPEC_DECODE_ENABLE=1 is set. This test loads a large GGUF into CUDA and can destabilize the machine while the verifier path is still experimental.');
  }
  process.env.DEVFORGE_NPU_GENAI_ONLY = '1';
  process.env.OPENVINO_DEVICE = process.env.OPENVINO_DEVICE || 'NPU';
  assertFreeRam();
  const stopWatchdog = startResourceWatchdog();
  process.env.DEVFORGE_SPEC_DECODE_DISABLE = '0';
  process.env.DEVFORGE_SPEC_LOOKAHEAD = process.env.DEVFORGE_SPEC_LOOKAHEAD || '1';
  process.env.DEVFORGE_SPEC_MAX_BATCHES = process.env.DEVFORGE_SPEC_MAX_BATCHES || '1';

  let npu = null;
  let probe = null;
  let orchestrator = null;
  const powerMode = getPowerMode();
  const previousPowerEnabled = powerMode.enabled;
  try {
    logMemory('combined:start');
    const model = resolveMainModel();
    probe = new LlamaNodeBackend({ useGpu: true });
    const health = await probe.checkHealth();
    console.log('[spec-smoke] llamanode health:', JSON.stringify(health));
    if (!health.available || health.gpu !== 'cuda') {
      throw new Error(`LlamaNode CUDA verifier unavailable: ${JSON.stringify(health)}`);
    }

    npu = await ensureNpuServer();

    // The combined step already starts the NPU drafter explicitly. Keep
    // orchestrator side effects from launching the warm-loop on top of it.
    powerMode.enabled = true;
    orchestrator = getOrchestrator(makeStore({
      performanceProfile: 'laptop',
      preferredBackend: 'auto',
    }));
    await orchestrator.initialize();

    let output = '';
    const result = await orchestrator.stream({
      model,
      workloadType: 'chat-main',
      lane: 'lane_interactive',
      allowFallback: false,
      messages: [
        { role: 'user', content: 'Write one short JavaScript function that returns the square of a number.' },
      ],
      options: {
        num_ctx: 512,
        num_predict: 1,
        temperature: 0,
      },
    }, (chunk = {}) => {
      if (chunk.response) output += chunk.response;
    });

    const stats = orchestrator.getSpecDecodeStats({ windowSize: 20 });
    const device = orchestrator.getDeviceUtilization(60_000);
    const specPairs = Array.isArray(stats?.pairs) ? stats.pairs : [];
    const total = specPairs.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const selected = orchestrator.getRuntimeState()?.lastBackendDecision || null;

    logMemory('combined:end');
    console.log(JSON.stringify({
      step: 'combined',
      model,
      result: {
        success: result?.success !== false,
        outputPreview: output.slice(0, 160),
      },
      selected,
      stats,
      deviceSpecDecode: device?.streams?.specDecode || null,
    }, null, 2));

    if (!selected || selected.selectionSource !== 'spec-decode') {
      throw new Error(`Expected selectionSource=spec-decode, got ${selected?.selectionSource || 'none'}`);
    }
    if (total <= 0) {
      throw new Error('Expected spec-decode telemetry with total > 0');
    }
  } finally {
    powerMode.enabled = previousPowerEnabled;
    stopWatchdog();
    await cleanup({ orchestrator, npu, probe });
  }
}

async function main() {
  if (STEP === 'cuda-only') {
    await runCudaOnly();
    return;
  }
  if (STEP === 'npu-only') {
    await runNpuOnly();
    return;
  }
  if (STEP === 'combined') {
    await runCombined();
    return;
  }
  throw new Error(`Unknown SPEC_SMOKE_STEP "${STEP}". Use cuda-only, npu-only, or combined.`);
}

main().catch((error) => {
  console.error(`spec-decode-live-smoke FAILED: ${error?.message || error}`);
  process.exit(1);
});
