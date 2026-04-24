#!/usr/bin/env node
/* eslint-disable no-console */

const PORT = Number.parseInt(process.env.OPENVINO_SERVER_PORT || '8081', 10);
const BASE_URL = process.env.NPU_SERVER_URL || `http://127.0.0.1:${PORT}`;
const MODEL = String(process.env.NPU_SMOKE_MODEL || process.env.SMOKE_MODEL || 'openvino-local').trim() || 'openvino-local';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

async function ensureServerReady() {
  const status = await request('/status');
  if (!status.ok) {
    throw new Error(`/status failed (${status.status}). Keep DevForge app open while running smoke tests.`);
  }
  return status.data || {};
}

async function runChatCompletionProbe() {
  const payload = {
    model: MODEL,
    stream: false,
    max_tokens: 64,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You are a concise assistant.' },
      { role: 'user', content: 'Say hello in one sentence.' },
    ],
  };

  const response = await request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`/v1/chat/completions failed (${response.status})`);
  }
  return response.data || {};
}

async function main() {
  const status = await ensureServerReady();
  const result = await runChatCompletionProbe();
  const engine = String(result?.meta?.engine || '').toLowerCase();
  const latencyMs = Number(result?.meta?.latency_ms);
  const device = result?.meta?.device || status?.device || null;

  const summary = {
    endpoint: BASE_URL,
    model: MODEL,
    engine,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    device,
    status: status?.status || null,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (engine !== 'genai') {
    throw new Error(`Expected meta.engine === "genai" but got "${engine || 'unknown'}"`);
  }
}

main().catch((error) => {
  console.error(`npu-genai-smoke FAILED: ${error?.message || error}`);
  process.exit(1);
});
