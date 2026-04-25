#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * v0.4 baseline-session capture.
 *
 * Same shape as v0.3 baseline plus Phase 2 spec-decode probes:
 *   - per-probe first-token latency + tokens/sec (1.5B NPU, 7B GPU,
 *     13B GPU-with-offload, all unchanged from v0.3 to keep the doc
 *     comparable across versions)
 *   - DraftSession round-trip latency for cold + warm extends
 *   - approximate spec-decode acceptance via the eval's prefix match
 *   - warm-loop active percent over the rolling sampling window
 *
 * Set BASELINE_DURATION_MIN=30 to capture a real ship-quality run; the
 * default is 5 minutes so the script is iterable. The plan calls for a
 * 30-minute capture for the v0.4.1 ship doc.
 */

const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const NPU_ENDPOINT = process.env.NPU_SERVER_URL || `http://127.0.0.1:${process.env.OPENVINO_SERVER_PORT || 8081}`;
// Warm-loop "active percent" only changes when profile / battery / RAM
// pressure change, which doesn't happen mid-script. Default to 5
// samples spaced 1s apart -- enough to confirm steady-state without
// burning 30 minutes on idle polling. Override with
// BASELINE_DURATION_MIN + BASELINE_SAMPLES if you really want a
// long-window capture (e.g. for a real-user 30-min session evidence).
const SESSION_MINUTES = Number.parseInt(process.env.BASELINE_DURATION_MIN || '0', 10);
const SAMPLE_INTERVAL_MS = Number.parseInt(process.env.BASELINE_SAMPLE_INTERVAL_MS || '1000', 10);
const SAMPLE_COUNT = Number.parseInt(process.env.BASELINE_SAMPLES || '5', 10);
const SPEC_DECODE_PROBE_LOOKAHEAD = Number.parseInt(process.env.BASELINE_SPEC_LOOKAHEAD || '4', 10);

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
  if (!response.ok) throw new Error(`NPU /v1/chat/completions failed (${response.status})`);
  const latencyMs = Number(response.data?.meta?.latency_ms);
  const content = String(response.data?.choices?.[0]?.message?.content || '');
  const tokens = Math.max(1, Math.round(content.length / 4));
  const totalMs = Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : (Date.now() - startedAt);
  const tokensPerSecond = totalMs > 0 ? Math.round((tokens / (totalMs / 1000)) * 10) / 10 : 0;
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
      options: { num_predict: 180, temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama /api/generate failed (${response.status})`);
  if (!response.body) throw new Error('Ollama stream body missing');

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
  return { firstTokenMs, totalMs, tokensPerSecond, engine: 'ollama', device: 'GPU', abort: null };
}

async function measureSpecDecodeProbe() {
  // Cold path: stateless /draft request rebuilds the prefix each time.
  const cold = await fetchJson(`${NPU_ENDPOINT}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'def fibonacci(n):', lookahead: SPEC_DECODE_PROBE_LOOKAHEAD, temperature: 0 }),
  });
  // Warm path: session-anchored /draft/session/extend reuses server-side state.
  const created = await fetchJson(`${NPU_ENDPOINT}/draft/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'def fibonacci(n):' }),
  });
  let warmExtend = null;
  if (created.ok && created.data?.session_id) {
    warmExtend = await fetchJson(`${NPU_ENDPOINT}/draft/session/${created.data.session_id}/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookahead: SPEC_DECODE_PROBE_LOOKAHEAD, temperature: 0 }),
    });
    await fetchJson(`${NPU_ENDPOINT}/draft/session/${created.data.session_id}`, { method: 'DELETE' });
  }
  return {
    coldDraft: cold.ok ? {
      ok: cold.data?.success === true,
      latencyMs: Number(cold.data?.latency_ms) || null,
      tokens: Array.isArray(cold.data?.draft_tokens) ? cold.data.draft_tokens.length : 0,
      device: cold.data?.device || null,
    } : { ok: false, error: `HTTP ${cold.status}` },
    warmExtend: warmExtend ? {
      ok: warmExtend.data?.success === true,
      latencyMs: Number(warmExtend.data?.latency_ms) || null,
      tokens: Array.isArray(warmExtend.data?.draft_tokens) ? warmExtend.data.draft_tokens.length : 0,
      device: warmExtend.data?.device || null,
    } : null,
  };
}

async function probeNpuStatus() {
  const status = await fetchJson(`${NPU_ENDPOINT}/status`);
  if (!status.ok) return { ok: false, active: false };
  return {
    ok: true,
    active: Boolean(status.data?.genai_active || status.data?.model_loaded),
    device: status.data?.device || null,
  };
}

async function main() {
  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  const results = {};
  const abortCounts = {};
  const warmloopSamples = [];

  for (const probe of PROBES) {
    try {
      const value = probe.kind === 'npu' ? await measureNpu(probe) : await measureOllama(probe);
      results[probe.id] = { ...probe, ...value };
    } catch (error) {
      const reason = String(error?.message || error);
      abortCounts.probe_failed = (abortCounts.probe_failed || 0) + 1;
      results[probe.id] = { ...probe, firstTokenMs: null, totalMs: null, tokensPerSecond: null, engine: null, device: null, abort: reason };
    }
  }

  let specDecode = null;
  try {
    specDecode = await measureSpecDecodeProbe();
  } catch (error) {
    abortCounts.spec_decode_probe_failed = (abortCounts.spec_decode_probe_failed || 0) + 1;
    specDecode = { error: String(error?.message || error) };
  }

  // Warm-loop sampling. Default mode (`SESSION_MINUTES=0`) takes a
  // small batch of samples to confirm steady state, then exits. Long-
  // window mode (`BASELINE_DURATION_MIN=N`) keeps polling for N
  // minutes -- use that only when you actually need the rolling
  // active-% over a long human session.
  if (SESSION_MINUTES > 0) {
    const until = startedAtMs + (SESSION_MINUTES * 60 * 1000);
    while (Date.now() < until) {
      const sample = await probeNpuStatus();
      warmloopSamples.push({ ts: Date.now(), ok: sample.ok, active: sample.active });
      await sleep(SAMPLE_INTERVAL_MS);
    }
  } else {
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const sample = await probeNpuStatus();
      warmloopSamples.push({ ts: Date.now(), ok: sample.ok, active: sample.active });
      if (i < SAMPLE_COUNT - 1) await sleep(SAMPLE_INTERVAL_MS);
    }
  }

  const activeSamples = warmloopSamples.filter((s) => s.active).length;
  const warmloopPct = warmloopSamples.length > 0 ? Math.round((activeSamples / warmloopSamples.length) * 1000) / 10 : 0;

  const summary = {
    startedAt: startedAtIso,
    endedAt: new Date().toISOString(),
    durationMinutes: SESSION_MINUTES > 0 ? SESSION_MINUTES : ((Date.now() - startedAtMs) / 60000),
    mode: SESSION_MINUTES > 0 ? 'long-window' : 'steady-state',
    probes: results,
    specDecode,
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
  console.error(`v04-baseline-session FAILED: ${error?.message || error}`);
  process.exit(1);
});
