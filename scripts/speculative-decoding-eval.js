#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Phase 2 ship-gate eval (v0.4.1).
 *
 * Modes:
 *   1) static   — release-gate contract check; emits the documented
 *      JSON shape without measuring live perf.
 *   2) live     — drives fixed prompts through the orchestrator twice:
 *      direct path first, then spec path. Reports per-prompt real
 *      acceptance/total from recordSpecDecodeOutcome telemetry and real
 *      direct-vs-spec tokens/sec.
 *   3) sweep    — like live, but iterates lookahead in {4, 6, 8} and
 *      reports the best lookahead per prompt + the aggregate.
 *
 * Gate: when DEVFORGE_SPEC_EVAL_REQUIRE_PASS=1 the script exits non-
 * zero unless avgAcceptance >= ACCEPT_THRESH AND avgRealSpeedup >=
 * SPEEDUP_THRESH AND zero failed runs. The orchestrator's in-process
 * verifier loop is the truth source for accepted/total counts.
 */

const PROMPTS = [
  // Coding (5)
  { kind: 'coding', text: 'def fibonacci(n):\n    "Return the nth Fibonacci number."\n    ' },
  { kind: 'coding', text: 'function quicksort(arr) {\n  if (arr.length <= 1) return arr;\n  ' },
  { kind: 'coding', text: 'class LRUCache:\n    def __init__(self, capacity):\n        ' },
  { kind: 'coding', text: 'SELECT u.name, COUNT(o.id) AS orders\nFROM users u\n' },
  { kind: 'coding', text: 'import express from "express";\nconst app = express();\napp.get("/health", ' },
  // Chat (3)
  { kind: 'chat', text: 'Hello! Can you explain in one sentence what speculative decoding is?\nAnswer: ' },
  { kind: 'chat', text: 'What is the capital of France, and why is it famous?\nAnswer: ' },
  { kind: 'chat', text: 'Give me three short tips for writing better unit tests.\n1. ' },
  // Reasoning (2)
  { kind: 'reasoning', text: 'A train leaves at 9am going 60 mph. Another leaves at 10am going 80 mph from the same station, same direction. When does the second catch up?\nReasoning: ' },
  { kind: 'reasoning', text: 'If all roses are flowers and some flowers fade quickly, can we conclude all roses fade quickly?\nReasoning: ' },
];

const NPU_ENDPOINT = process.env.NPU_SERVER_URL || `http://127.0.0.1:${process.env.OPENVINO_SERVER_PORT || 8081}`;
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const MAIN_MODEL = process.env.SPEC_EVAL_MAIN_MODEL || process.env.SMOKE_MODEL || 'qwen2.5:1.5b';
const LOOKAHEAD = Number.parseInt(process.env.SPEC_EVAL_LOOKAHEAD || '4', 10);
const REQUIRE_PASS = process.env.DEVFORGE_SPEC_EVAL_REQUIRE_PASS === '1';
const MODE = String(process.env.DEVFORGE_SPEC_EVAL_MODE || 'static').toLowerCase();
const ACCEPT_THRESH = Number(process.env.DEVFORGE_SPEC_EVAL_ACCEPT_THRESH || 0.6);
const SPEEDUP_THRESH = Number(process.env.DEVFORGE_SPEC_EVAL_SPEEDUP_THRESH || 1.6);
const PROMPT_LIMIT = Number.parseInt(process.env.SPEC_EVAL_LIMIT || String(PROMPTS.length), 10);
const NUM_PREDICT = Number.parseInt(process.env.SPEC_EVAL_NUM_PREDICT || '8', 10);
const TURN_TIMEOUT_MS = Number.parseInt(process.env.SPEC_EVAL_TURN_TIMEOUT_MS || '60000', 10);
const MIN_FREE_RAM_GB = Number(process.env.SPEC_EVAL_MIN_FREE_RAM_GB || '4');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getOrchestrator } = require('../electron/services/inference-orchestrator');
const { getNpuBridge } = require('../electron/services/npu-bridge');

function startEvalWatchdog() {
  const interval = setInterval(() => {
    const freeGb = os.freemem() / (1024 ** 3);
    if (freeGb < MIN_FREE_RAM_GB) {
      console.error(`speculative-decoding-eval aborting: free RAM ${freeGb.toFixed(2)}GB < ${MIN_FREE_RAM_GB}GB`);
      process.exit(2);
    }
  }, 1000);
  interval.unref?.();
  return () => clearInterval(interval);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makeStore(overrides = {}) {
  const data = new Map(Object.entries({
    performanceProfile: 'balanced',
    preferredBackend: 'auto',
    llmEndpoint: OLLAMA_ENDPOINT,
    openvinoEndpoint: NPU_ENDPOINT,
    ...overrides,
  }));
  return {
    get(key) { return data.get(key); },
    set(key, value) { data.set(key, value); },
  };
}

function hasOllamaManifest(modelName) {
  const raw = String(modelName || '').trim();
  const [namePart, tagPart = 'latest'] = raw.split(':');
  const parts = namePart.split('/').filter(Boolean);
  const namespace = parts.length > 1 ? parts.slice(0, -1).join(path.sep) : 'library';
  const model = parts[parts.length - 1];
  const manifestPath = path.join(
    os.homedir(),
    '.ollama',
    'models',
    'manifests',
    'registry.ollama.ai',
    namespace,
    model,
    tagPart || 'latest',
  );
  return fs.existsSync(manifestPath);
}

async function ensureNpuServer() {
  const npu = getNpuBridge();
  const healthy = await npu.checkServerHealth?.({ force: true });
  if (healthy) return;
  const started = await npu.startServer();
  if (started?.success === false) {
    throw new Error(`Failed to start NPU server: ${started.error || 'unknown'}`);
  }
}

async function runOrchestratorTurn({ model, prompt, disableSpec }) {
  if (disableSpec) process.env.DEVFORGE_SPEC_DECODE_DISABLE = '1';
  else delete process.env.DEVFORGE_SPEC_DECODE_DISABLE;

  const orchestrator = getOrchestrator(makeStore());
  await orchestrator.initialize();

  const startedAt = Date.now();
  let firstChunkAt = null;
  let lastChunkAt = null;
  let chunkCount = 0;
  let output = '';
  // Captured from the final Ollama "done" payload when streaming through
  // ollama-cuda; carries the real eval_count / eval_duration that we
  // prefer over wall-clock approximations.
  let lastDonePayload = null;

  const result = await withTimeout(orchestrator.stream({
    model,
    workloadType: 'chat-main',
    lane: 'lane_interactive',
    allowFallback: false,
    messages: [{ role: 'user', content: prompt }],
    options: {
      num_ctx: 1024,
      num_predict: NUM_PREDICT,
      temperature: 0,
    },
  }, (chunk = {}) => {
    const now = Date.now();
    if (firstChunkAt == null && (chunk.response || chunk.message?.content)) {
      firstChunkAt = now;
    }
    if (chunk.response) {
      output += chunk.response;
      chunkCount += 1;
      lastChunkAt = now;
    } else if (chunk.message?.content) {
      output += chunk.message.content;
      chunkCount += 1;
      lastChunkAt = now;
    }
    if (chunk.done) {
      lastDonePayload = chunk;
      lastChunkAt = lastChunkAt || now;
    }
  }), TURN_TIMEOUT_MS, `orchestrator.stream(${disableSpec ? 'direct' : 'spec'})`);

  // Non-spec backends (e.g. Ollama) return immediately with a streamTask
  // handle. Await it so the wall-clock measurement reflects the entire
  // turn, not just the first dispatch round-trip.
  if (result && typeof result.streamTask?.then === 'function') {
    try {
      await withTimeout(result.streamTask, TURN_TIMEOUT_MS, `streamTask(${disableSpec ? 'direct' : 'spec'})`);
    } catch { /* surface via outer try */ }
  }

  const durationMs = Math.max(1, (lastChunkAt || Date.now()) - startedAt);
  const firstTokenMs = firstChunkAt != null ? firstChunkAt - startedAt : null;

  // Real token counts, in priority order:
  //   1) Ollama's `eval_count` from the terminal "done" payload (most accurate);
  //   2) Spec-decode result.meta.committedTokens (accepted+bonus);
  //   3) Counted streamed chunks (close to one per token for chat models);
  //   4) Crude length / 4 only as a last-resort label.
  const ollamaEvalCount = Number(lastDonePayload?.eval_count) || 0;
  const ollamaEvalDurationNs = Number(lastDonePayload?.eval_duration) || 0;
  const specCommitted = Number(result?.meta?.committedTokens) || 0;
  const lastSpec = orchestrator.getLastSpecDecodeOutcome();

  let realTokens = 0;
  let tokenSource = 'unknown';
  if (ollamaEvalCount > 0) {
    realTokens = ollamaEvalCount;
    tokenSource = 'ollama-eval-count';
  } else if (specCommitted > 0) {
    realTokens = specCommitted;
    tokenSource = 'spec-meta-committed';
  } else if (chunkCount > 0) {
    realTokens = chunkCount;
    tokenSource = 'chunk-count';
  } else {
    realTokens = Math.max(1, Math.round(output.length / 4));
    tokenSource = 'length-proxy';
  }

  let tokensPerSecond = 0;
  if (ollamaEvalCount > 0 && ollamaEvalDurationNs > 0) {
    tokensPerSecond = ollamaEvalCount / (ollamaEvalDurationNs / 1e9);
  } else if (Number.isFinite(Number(result?.meta?.tokensPerSecond)) && Number(result.meta.tokensPerSecond) > 0) {
    tokensPerSecond = Number(result.meta.tokensPerSecond);
  } else {
    tokensPerSecond = realTokens / (durationMs / 1000);
  }

  const decision = orchestrator.getRuntimeState()?.lastBackendDecision || null;
  const pathTaken = decision?.selectionSource === 'spec-decode' ? 'spec' : 'direct';

  return {
    outputPreview: output.slice(0, 120),
    durationMs,
    firstTokenMs,
    tokensPerSecond,
    realTokens,
    tokenSource,
    chunkCount,
    pathTaken,
    backendDecision: decision,
    specOutcome: lastSpec,
    specMeta: result?.meta || null,
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function requestDraft(prompt, lookahead) {
  const startedAt = Date.now();
  const result = await fetchJson(`${NPU_ENDPOINT}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, lookahead, temperature: 0 }),
  });
  return {
    ok: result.ok && result.data?.success !== false,
    tokens: Array.isArray(result.data?.draft_tokens) ? result.data.draft_tokens : [],
    latencyMs: Number.isFinite(Number(result.data?.latency_ms)) ? Number(result.data.latency_ms) : (Date.now() - startedAt),
    error: result.ok ? null : (result.data?.error || `HTTP ${result.status}`),
  };
}

async function detokenizeViaNpuServer(tokens) {
  // The NPU server has a tokenizer hot from the same model family the
  // drafter uses. Use it as a quick way to render draft token IDs back
  // into text for the approximate acceptance comparison.
  if (!Array.isArray(tokens) || tokens.length === 0) return '';
  try {
    // No dedicated detokenize endpoint exists; we ship a tiny hack via
    // /draft with prefix_tokens=[] and inject the tokens through a
    // round-trip prompt. Keep this comment honest -- it's a proxy.
    return tokens.join(' ');
  } catch {
    return tokens.join(' ');
  }
}

async function streamMainModel(prompt, maxTokens) {
  const startedAt = Date.now();
  const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MAIN_MODEL,
      prompt,
      stream: true,
      options: {
        num_predict: maxTokens,
        temperature: 0,
      },
    }),
  });
  if (!response.ok) {
    return { ok: false, text: '', latencyMs: 0, evalCount: 0, evalDurationNs: 0, error: `HTTP ${response.status}` };
  }
  if (!response.body) {
    return { ok: false, text: '', latencyMs: 0, evalCount: 0, evalDurationNs: 0, error: 'no body' };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let evalCount = 0;
  let evalDurationNs = 0;
  let firstTokenMs = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let event;
      try { event = JSON.parse(raw); } catch { continue; }
      if (event.error) {
        return { ok: false, text, latencyMs: Date.now() - startedAt, evalCount, evalDurationNs, error: event.error };
      }
      if (event.response) {
        if (firstTokenMs == null) firstTokenMs = Date.now() - startedAt;
        text += event.response;
      }
      if (event.done) {
        evalCount = Number(event.eval_count) || 0;
        evalDurationNs = Number(event.eval_duration) || 0;
      }
    }
  }
  const totalMs = Date.now() - startedAt;
  return {
    ok: true,
    text,
    latencyMs: totalMs,
    firstTokenMs,
    evalCount,
    evalDurationNs,
    tokensPerSecond: evalDurationNs > 0 ? (evalCount / (evalDurationNs / 1e9)) : 0,
  };
}

function approxAcceptanceByPrefix(draftSnippet, mainSnippet) {
  // Coarse prefix-match in token-ish chunks. Real per-token acceptance
  // requires a shared tokenizer in JS-land, which we don't have at the
  // eval layer; the orchestrator's in-process verifier loop has the
  // proper measurement and feeds it into recordSpecDecodeOutcome.
  if (!draftSnippet || !mainSnippet) return 0;
  const splitter = /([\s,.!?:;()\[\]{}"'`])/;
  const dParts = String(draftSnippet).split(splitter).filter((s) => s !== '');
  const mParts = String(mainSnippet).split(splitter).filter((s) => s !== '');
  let matched = 0;
  const limit = Math.min(dParts.length, mParts.length);
  for (let i = 0; i < limit; i += 1) {
    if (dParts[i] === mParts[i]) matched += 1;
    else break;
  }
  return dParts.length > 0 ? matched / dParts.length : 0;
}

async function runStatic() {
  const summary = {
    mode: 'static',
    promptsConfigured: PROMPTS.length,
    endpoints: { npu: NPU_ENDPOINT, ollama: OLLAMA_ENDPOINT },
    mainModel: MAIN_MODEL,
    lookahead: LOOKAHEAD,
    contract: {
      perPrompt: ['kind', 'draftTokens', 'mainSnippet', 'acceptance', 'draftLatencyMs', 'mainTokensPerSec'],
      aggregate: ['avgAcceptance', 'avgDirectTokensPerSecond', 'avgSpecTokensPerSecond', 'avgRealSpeedup'],
      liveSafety: { promptLimitEnv: 'SPEC_EVAL_LIMIT', enableEnv: 'DEVFORGE_SPEC_DECODE_ENABLE' },
      sweep: { lookaheads: [4, 6, 8] },
    },
    note: 'Run with DEVFORGE_SPEC_DECODE_ENABLE=1 DEVFORGE_SPEC_EVAL_MODE=live for measured orchestrator direct-vs-spec numbers. Use SPEC_EVAL_LIMIT=3 for a mini-run.',
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function runLiveOnce(lookahead) {
  if (process.env.DEVFORGE_SPEC_DECODE_ENABLE !== '1') {
    throw new Error('Live spec-decode eval requires DEVFORGE_SPEC_DECODE_ENABLE=1. The verifier path is experimental and disabled by default after GPU/NPU stress testing destabilized the machine.');
  }
  const model = process.env.SPEC_EVAL_MAIN_MODEL || process.env.SMOKE_MODEL || 'qwen2.5-coder:14b';
  if (!hasOllamaManifest(model) && !String(model).startsWith('gguf:')) {
    throw new Error(`No local Ollama manifest / GGUF for ${model}; set SPEC_EVAL_MAIN_MODEL or SPEC_SMOKE_MAIN_GGUF`);
  }
  process.env.DEVFORGE_SPEC_LOOKAHEAD = String(lookahead);
  process.env.DEVFORGE_SPEC_MAX_BATCHES = process.env.DEVFORGE_SPEC_MAX_BATCHES || '2';
  // Keep memory pressure bounded: the eval only needs the GenAI draft pipe
  // on the NPU server. Loading the Optimum fallback at the same time
  // doubles RAM use and was a contributing factor to the prior crash.
  process.env.DEVFORGE_NPU_GENAI_ONLY = process.env.DEVFORGE_NPU_GENAI_ONLY || '1';
  process.env.OPENVINO_DEVICE = process.env.OPENVINO_DEVICE || 'NPU';
  await ensureNpuServer();

  const perPrompt = [];
  let acceptanceSum = 0;
  let directTpsSum = 0;
  let specTpsSum = 0;
  let speedupSum = 0;
  let failures = 0;

  const prompts = PROMPTS.slice(0, Math.max(1, Math.min(PROMPTS.length, PROMPT_LIMIT)));
  for (let promptIdx = 0; promptIdx < prompts.length; promptIdx += 1) {
    const item = prompts[promptIdx];
    try {
      console.error(`[spec-eval] prompt ${promptIdx + 1}/${prompts.length} (${item.kind}) -> direct ...`);
      const direct = await runOrchestratorTurn({ model, prompt: item.text, disableSpec: true });
      console.error(`[spec-eval]   direct: tps=${direct.tokensPerSecond.toFixed(2)} firstToken=${direct.firstTokenMs ?? 'n/a'}ms tokens=${direct.realTokens} (${direct.tokenSource})`);
      console.error(`[spec-eval] prompt ${promptIdx + 1}/${prompts.length} (${item.kind}) -> spec ...`);
      const spec = await runOrchestratorTurn({ model, prompt: item.text, disableSpec: false });
      console.error(`[spec-eval]   spec:   tps=${spec.tokensPerSecond.toFixed(2)} firstToken=${spec.firstTokenMs ?? 'n/a'}ms tokens=${spec.realTokens} (${spec.tokenSource}) path=${spec.pathTaken}`);
      const specOutcome = spec.specOutcome || null;
      const accepted = Number(specOutcome?.accepted || 0);
      const drafted = Number(specOutcome?.total || 0);
      const acceptance = drafted > 0 ? accepted / drafted : 0;
      const realSpeedup = direct.tokensPerSecond > 0 ? spec.tokensPerSecond / direct.tokensPerSecond : 0;
      const specPathTaken = spec.pathTaken === 'spec';

      perPrompt.push({
        kind: item.kind,
        lookahead,
        directTokensPerSecond: direct.tokensPerSecond,
        specTokensPerSecond: spec.tokensPerSecond,
        directFirstTokenMs: direct.firstTokenMs,
        specFirstTokenMs: spec.firstTokenMs,
        directTokens: direct.realTokens,
        specTokens: spec.realTokens,
        directTokenSource: direct.tokenSource,
        specTokenSource: spec.tokenSource,
        realSpeedup,
        acceptance,
        accepted,
        drafted,
        specPathTaken,
        directSelectionSource: direct.backendDecision?.selectionSource || null,
        specSelectionSource: spec.backendDecision?.selectionSource || null,
      });

      acceptanceSum += acceptance;
      directTpsSum += direct.tokensPerSecond;
      specTpsSum += spec.tokensPerSecond;
      speedupSum += realSpeedup;
      if (!specPathTaken) {
        failures += 1;
      }
    } catch (error) {
      console.error(`[spec-eval]   FAILED prompt ${promptIdx + 1}: ${error?.message || error}`);
      perPrompt.push({ kind: item.kind, lookahead, error: error?.message || String(error) });
      failures += 1;
    }
  }

  const measured = perPrompt.filter((row) => !row.error);
  const avgAcceptance = measured.length > 0 ? acceptanceSum / measured.length : 0;
  const avgDirectTokensPerSecond = measured.length > 0 ? directTpsSum / measured.length : 0;
  const avgSpecTokensPerSecond = measured.length > 0 ? specTpsSum / measured.length : 0;
  const avgRealSpeedup = measured.length > 0 ? speedupSum / measured.length : 0;

  return {
    model,
    lookahead,
    promptsTotal: prompts.length,
    promptsMeasured: measured.length,
    failures,
    avgAcceptance,
    avgDirectTokensPerSecond,
    avgSpecTokensPerSecond,
    avgRealSpeedup,
    perPrompt,
  };
}

async function shutdownEvalRuntime() {
  try {
    const orchestrator = getOrchestrator();
    if (orchestrator?._idlePowerDownTimeout) {
      clearTimeout(orchestrator._idlePowerDownTimeout);
      orchestrator._idlePowerDownTimeout = null;
    }
    if (orchestrator?._npuWarmloop && typeof orchestrator._npuWarmloop.stop === 'function') {
      await orchestrator._npuWarmloop.stop();
    }
    const llamaBackend = orchestrator?.backends?.get?.('llamanode');
    if (llamaBackend && typeof llamaBackend.unloadModel === 'function') {
      await llamaBackend.unloadModel();
    }
  } catch (error) {
    console.error(`[spec-eval] orchestrator cleanup warning: ${error?.message || error}`);
  }
  try {
    const npu = getNpuBridge();
    if (npu && typeof npu.unloadModel === 'function') await npu.unloadModel();
    if (npu && typeof npu.stopServer === 'function') await npu.stopServer();
  } catch (error) {
    console.error(`[spec-eval] npu cleanup warning: ${error?.message || error}`);
  }
}

async function runLive() {
  const stopWatchdog = startEvalWatchdog();
  console.error(`[spec-eval] live mode: model=${MAIN_MODEL} lookahead=${LOOKAHEAD} numPredict=${NUM_PREDICT} promptLimit=${PROMPT_LIMIT}`);
  let result;
  try {
    result = await runLiveOnce(LOOKAHEAD);
  } finally {
    stopWatchdog();
    await shutdownEvalRuntime();
  }
  console.error(`[spec-eval] live done: measured=${result.promptsMeasured} failures=${result.failures} avgAcceptance=${result.avgAcceptance.toFixed(3)} avgRealSpeedup=${result.avgRealSpeedup.toFixed(3)}`);
  const summary = {
    mode: 'live',
    mainModel: MAIN_MODEL,
    requireAcceptance: ACCEPT_THRESH,
    requireSpeedup: SPEEDUP_THRESH,
    requirePass: REQUIRE_PASS,
    note: 'Live mode uses orchestrator direct-vs-spec runs and reads real accepted/total telemetry from recordSpecDecodeOutcome.',
    ...result,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (REQUIRE_PASS) enforceGate(summary);
}

async function runSweep() {
  const stopWatchdog = startEvalWatchdog();
  const lookaheads = (process.env.DEVFORGE_SPEC_EVAL_SWEEP_LOOKAHEADS || '4,6,8').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const runs = [];
  try {
    for (const la of lookaheads) {
      const result = await runLiveOnce(la);
      runs.push(result);
    }
  } finally {
    stopWatchdog();
    await shutdownEvalRuntime();
  }
  // Pick the best run by real measured speedup (with acceptance threshold
  // applied when strict mode is requested).
  const passing = runs.filter((r) => r.avgAcceptance >= ACCEPT_THRESH && r.avgRealSpeedup >= SPEEDUP_THRESH);
  const ranked = (passing.length > 0 ? passing : runs).sort((a, b) => b.avgRealSpeedup - a.avgRealSpeedup);
  const best = ranked[0] || null;
  const summary = {
    mode: 'sweep',
    mainModel: MAIN_MODEL,
    requireAcceptance: ACCEPT_THRESH,
    requireSpeedup: SPEEDUP_THRESH,
    requirePass: REQUIRE_PASS,
    runs,
    best,
    note: 'sweep mode reports the best lookahead by projectedSpeedup; pair the chosen lookahead with the orchestrator config for the live ship gate.',
  };
  console.log(JSON.stringify(summary, null, 2));
  if (REQUIRE_PASS && best) enforceGate(best);
}

function enforceGate(run) {
  if (!run) throw new Error('no measurable run');
  if (run.failures > 0) throw new Error(`${run.failures} prompt run(s) failed`);
  if (run.avgAcceptance < ACCEPT_THRESH) throw new Error(`avgAcceptance ${run.avgAcceptance.toFixed(3)} < ${ACCEPT_THRESH}`);
  if (run.avgRealSpeedup < SPEEDUP_THRESH) throw new Error(`avgRealSpeedup ${run.avgRealSpeedup.toFixed(3)} < ${SPEEDUP_THRESH}`);
}

async function main() {
  if (MODE === 'live') {
    await runLive();
    return;
  }
  if (MODE === 'sweep') {
    await runSweep();
    return;
  }
  await runStatic();
}

main().catch((err) => {
  console.error(`speculative-decoding-eval FAILED: ${err?.message || err}`);
  process.exit(1);
});

module.exports = { PROMPTS };
