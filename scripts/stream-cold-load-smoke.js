#!/usr/bin/env node
/* eslint-disable no-console */

const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const FIRST_TOKEN_MAX_MS = Number.parseInt(process.env.STREAM_SMOKE_FIRST_TOKEN_MAX_MS || '180000', 10);
const TOTAL_TIMEOUT_MS = Number.parseInt(process.env.STREAM_SMOKE_TIMEOUT_MS || '240000', 10);
const PROMPT = String(process.env.STREAM_SMOKE_PROMPT || 'hello').trim() || 'hello';

function nowMs() {
  return Date.now();
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

async function pickModel(endpoint) {
  const explicit = String(process.env.STREAM_SMOKE_MODEL || process.env.SMOKE_MODEL || '').trim();
  if (explicit) return explicit;
  const tags = await fetchJson(`${endpoint}/api/tags`);
  if (!tags.ok) {
    throw new Error(`Failed to query /api/tags (${tags.status})`);
  }
  const models = Array.isArray(tags.data?.models) ? tags.data.models : [];
  const preferred = models.find((entry) => {
    const name = String(entry?.name || '').toLowerCase();
    return name
      && !name.includes('vl')
      && !name.includes('vision')
      && !name.includes('llava');
  })?.name;
  const first = preferred || models[0]?.name || '';
  if (!first) {
    throw new Error('No Ollama models available. Set STREAM_SMOKE_MODEL.');
  }
  return first;
}

async function coldUnload(endpoint, model) {
  try {
    await fetchJson(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: '',
        stream: false,
        keep_alive: 0,
      }),
    });
  } catch {
    // Non-blocking: this is best-effort cold-load prep.
  }
}

async function streamOnce(endpoint, model) {
  const controller = new AbortController();
  const startedAt = nowMs();
  const timeoutId = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  let firstTokenMs = null;
  let abort = null;
  let doneSeen = false;
  let tokens = 0;

  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: PROMPT,
        stream: true,
        options: {
          num_predict: 64,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        firstTokenMs: null,
        totalMs: nowMs() - startedAt,
        abort: {
          code: 'http_error',
          reason: `HTTP ${response.status}`,
        },
        tokens,
        doneSeen: false,
      };
    }
    if (!response.body) {
      return {
        firstTokenMs: null,
        totalMs: nowMs() - startedAt,
        abort: {
          code: 'no_stream_body',
          reason: 'Streaming body missing',
        },
        tokens,
        doneSeen: false,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          abort = { code: 'json_parse_error', reason: `Invalid JSON line: ${line.slice(0, 80)}` };
          break;
        }
        if (event?.error) {
          abort = { code: 'backend_error', reason: String(event.error) };
          break;
        }
        const delta = String(event?.response || event?.message?.content || '');
        if (delta) {
          if (firstTokenMs == null) firstTokenMs = nowMs() - startedAt;
          tokens += Math.max(1, Math.round(delta.length / 4));
        }
        if (event?.done) {
          doneSeen = true;
          break;
        }
      }

      if (abort || doneSeen) break;
    }
  } catch (error) {
    abort = {
      code: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed',
      reason: String(error?.message || error),
    };
  } finally {
    clearTimeout(timeoutId);
  }

  return {
    firstTokenMs,
    totalMs: nowMs() - startedAt,
    abort,
    tokens,
    doneSeen,
  };
}

async function main() {
  const model = await pickModel(DEFAULT_ENDPOINT);
  await coldUnload(DEFAULT_ENDPOINT, model);
  const result = await streamOnce(DEFAULT_ENDPOINT, model);

  const summary = {
    endpoint: DEFAULT_ENDPOINT,
    model,
    prompt: PROMPT,
    firstTokenMs: result.firstTokenMs,
    totalMs: result.totalMs,
    estimatedTokens: result.tokens,
    abort: result.abort,
    doneSeen: result.doneSeen,
    thresholds: {
      firstTokenMaxMs: FIRST_TOKEN_MAX_MS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (result.abort) {
    throw new Error(`Abort fired (${result.abort.code}): ${result.abort.reason}`);
  }
  if (result.firstTokenMs == null) {
    throw new Error('No first token observed');
  }
  if (result.firstTokenMs > FIRST_TOKEN_MAX_MS) {
    throw new Error(`firstTokenMs ${result.firstTokenMs} exceeded threshold ${FIRST_TOKEN_MAX_MS}`);
  }
}

main().catch((error) => {
  console.error(`stream-cold-load-smoke FAILED: ${error?.message || error}`);
  process.exit(1);
});
