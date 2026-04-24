#!/usr/bin/env node
/* eslint-disable no-console */

const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const NPU_ENDPOINT = process.env.NPU_SERVER_URL || `http://127.0.0.1:${process.env.OPENVINO_SERVER_PORT || 8081}`;
const SESSION_MINUTES = Number.parseInt(process.env.BASELINE_DURATION_MIN || '30', 10);
const SAMPLE_INTERVAL_MS = Number.parseInt(process.env.BASELINE_SAMPLE_INTERVAL_MS || '30000', 10);

const PROBES = [
  { id: 'npu-1.5b', kind: 'npu', label: '1.5B NPU', model: process.env.BASELINE_NPU_MODEL || 'openvino-local' },
  { id: 'gpu-7b', kind: 'ollama', label: '7B RTX', model: process.env.BASELINE_7B_MODEL || 'codellama:7b' },
  { id: 'gpu-13b', kind: 'ollama', label: '13B RTX-with-offload', model: process.env.BASELINE_13B_MODEL || 'local-wizard-vicuna-13b-uncensored.q4_0:latest' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

async function measureNpu({ model }) {
  const startedAt = Date.now();
  const response = await fetchJson(`${NPU_ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 120,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Reply in one concise paragraph.' },
        { role: 'user', content: 'Explain why low-latency first token matters for interactive chat.' },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`NPU /v1/chat/completions failed (${response.status})`);
  }
  const latencyMs = Number(response.data?.meta?.latency_ms);
  const content = String(response.data?.choices?.[0]?.message?.content || '');
  const tokens = Math.max(1, Math.round(content.length / 4));
  const totalMs = Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : (Date.now() - startedAt);
  const tokensPerSecond = totalMs > 0
    ? Math.round((tokens / (totalMs / 1000)) * 10) / 10
    : 0;

  return {
    firstTokenMs: null,
    totalMs,
    tokensPerSecond,
    engine: String(response.data?.meta?.engine || ''),
    device: response.data?.meta?.device || null,
    abort: null,
  };
}

async function measureOllama({ model }) {
  const startedAt = Date.now();
  const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'Give one paragraph explaining why predictable token throughput matters for coding copilots.',
      stream: true,
      options: {
        num_predict: 180,
        temperature: 0,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama /api/generate failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('Ollama stream body missing');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstTokenMs = null;
  let evalCount = null;
  let evalDuration = null;
  let content = '';
  let doneSeen = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      const delta = String(event.response || '');
      if (delta) {
        if (firstTokenMs == null) firstTokenMs = Date.now() - startedAt;
        content += delta;
      }
      if (event.done) {
        doneSeen = true;
        evalCount = Number(event.eval_count);
        evalDuration = Number(event.eval_duration);
        break;
      }
    }
    if (doneSeen) break;
  }

  const totalMs = Date.now() - startedAt;
  let tokensPerSecond = 0;
  if (Number.isFinite(evalCount) && evalCount > 0 && Number.isFinite(evalDuration) && evalDuration > 0) {
    tokensPerSecond = Math.round((evalCount / (evalDuration / 1e9)) * 10) / 10;
  } else if (content.length > 0 && totalMs > 0) {
    tokensPerSecond = Math.round((Math.max(1, Math.round(content.length / 4)) / (totalMs / 1000)) * 10) / 10;
  }

  return {
    firstTokenMs,
    totalMs,
    tokensPerSecond,
    engine: 'ollama',
    device: 'GPU',
    abort: null,
  };
}

async function probeNpuStatus() {
  const status = await fetchJson(`${NPU_ENDPOINT}/status`);
  if (!status.ok) {
    return { ok: false, active: false };
  }
  return {
    ok: true,
    active: Boolean(status.data?.genai_active || status.data?.model_loaded),
    device: status.data?.device || null,
  };
}

async function main() {
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const until = startedAtMs + (SESSION_MINUTES * 60 * 1000);
  const results = {};
  const abortCounts = {};
  const warmloopSamples = [];

  for (const probe of PROBES) {
    try {
      const value = probe.kind === 'npu'
        ? await measureNpu(probe)
        : await measureOllama(probe);
      results[probe.id] = {
        ...probe,
        ...value,
      };
    } catch (error) {
      const reason = String(error?.message || error);
      abortCounts.probe_failed = (abortCounts.probe_failed || 0) + 1;
      results[probe.id] = {
        ...probe,
        firstTokenMs: null,
        totalMs: null,
        tokensPerSecond: null,
        engine: null,
        device: null,
        abort: reason,
      };
    }
  }

  while (Date.now() < until) {
    const sample = await probeNpuStatus();
    warmloopSamples.push({
      ts: Date.now(),
      ok: sample.ok,
      active: sample.active,
    });
    await sleep(SAMPLE_INTERVAL_MS);
  }

  const activeSamples = warmloopSamples.filter((sample) => sample.active).length;
  const warmloopPct = warmloopSamples.length > 0
    ? Math.round((activeSamples / warmloopSamples.length) * 1000) / 10
    : 0;

  const summary = {
    startedAt: startedAtIso,
    endedAt: new Date().toISOString(),
    durationMinutes: SESSION_MINUTES,
    probes: results,
    warmloop: {
      sampleCount: warmloopSamples.length,
      activeSamples,
      activePercent: warmloopPct,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
    },
    abortCounts,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`v03-baseline-session FAILED: ${error?.message || error}`);
  process.exit(1);
});
