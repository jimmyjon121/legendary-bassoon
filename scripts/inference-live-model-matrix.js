#!/usr/bin/env node
/* eslint-disable no-console */

const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const LARGE_MODEL_RE = /\b(30b|32b|34b|70b|72b|90b|120b|405b)\b/i;

function jsonOut(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function ollamaJson(path, body = null, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DEFAULT_ENDPOINT.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function modelName(entry) {
  return String(entry?.name || entry?.model || '').trim();
}

function chooseModel(tags = [], ps = []) {
  const explicit = String(process.env.LIVE_MODEL || '').trim();
  if (explicit) return { model: explicit, reason: 'LIVE_MODEL' };

  const loaded = ps.map(modelName).filter(Boolean);
  const loadedSmall = loaded.find((name) => !LARGE_MODEL_RE.test(name));
  if (loadedSmall) return { model: loadedSmall, reason: 'already_loaded_small' };

  const installedSmall = tags.map(modelName).filter(Boolean).find((name) => !LARGE_MODEL_RE.test(name));
  if (installedSmall) return { model: installedSmall, reason: 'installed_small' };

  return { model: null, reason: 'no_small_model_available' };
}

async function runChat(model) {
  return ollamaJson('/api/chat', {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    stream: false,
    options: { num_predict: 16, temperature: 0 },
  });
}

async function runToolCall(model) {
  return ollamaJson('/api/chat', {
    model,
    messages: [{ role: 'user', content: 'Call the list_directory tool with path ".". Do not answer in plain text.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'List files in a directory.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      },
    ],
    stream: false,
    options: { num_predict: 96, temperature: 0 },
  });
}

async function runToolContinuation(model, toolCallResponse) {
  const toolCall = toolCallResponse?.data?.message?.tool_calls?.[0];
  if (!toolCall) {
    return { skipped: true, reason: 'no_tool_call_returned' };
  }
  return ollamaJson('/api/chat', {
    model,
    messages: [
      { role: 'user', content: 'Call the list_directory tool with path ".". Do not answer in plain text.' },
      { role: 'assistant', content: '', tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: toolCall.id || 'call_probe', content: JSON.stringify({ success: true, entries: ['package.json'] }) },
    ],
    stream: false,
    options: { num_predict: 96, temperature: 0 },
  });
}

async function runBadModel() {
  return ollamaJson('/api/chat', {
    model: `devforge-missing-model-${Date.now()}`,
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    options: { num_predict: 8 },
  }, 30000);
}

async function main() {
  if (process.env.OLLAMA_LIVE !== '1') {
    jsonOut({
      ok: true,
      skipped: true,
      reason: 'OLLAMA_LIVE not set',
      probe_kind: 'probe_only',
    });
    return;
  }

  const tagsRes = await ollamaJson('/api/tags', null, 30000);
  const psRes = await ollamaJson('/api/ps', null, 30000);
  const tags = Array.isArray(tagsRes.data?.models) ? tagsRes.data.models : [];
  const loaded = Array.isArray(psRes.data?.models) ? psRes.data.models : [];
  const choice = chooseModel(tags, loaded);

  if (!choice.model) {
    jsonOut({
      ok: false,
      probe_kind: 'probe_only',
      endpoint: DEFAULT_ENDPOINT,
      selected: choice,
      tagsOk: tagsRes.ok,
      psOk: psRes.ok,
      error: 'No small loaded/installed model found. Set LIVE_MODEL=... to probe a specific model.',
    });
    return;
  }

  if (!process.env.LIVE_MODEL && LARGE_MODEL_RE.test(choice.model)) {
    jsonOut({
      ok: false,
      probe_kind: 'probe_only',
      endpoint: DEFAULT_ENDPOINT,
      selected: choice,
      error: 'Selected model looks large; set LIVE_MODEL explicitly to allow probing.',
    });
    return;
  }

  const plainChat = await runChat(choice.model);
  const toolCall = await runToolCall(choice.model);
  const toolContinuation = await runToolContinuation(choice.model, toolCall);
  const badModel = await runBadModel();

  jsonOut({
    ok: true,
    probe_kind: 'probe_only',
    endpoint: DEFAULT_ENDPOINT,
    selected: choice,
    loadedModels: loaded.map(modelName).filter(Boolean),
    installedCount: tags.length,
    results: {
      plainChat: {
        ok: plainChat.ok,
        status: plainChat.status,
        responseType: plainChat.data?.message ? 'chat_message' : typeof plainChat.data,
        contentPreview: String(plainChat.data?.message?.content || plainChat.data?.response || '').slice(0, 120),
      },
      nativeToolCall: {
        ok: toolCall.ok,
        status: toolCall.status,
        toolCallCount: Array.isArray(toolCall.data?.message?.tool_calls) ? toolCall.data.message.tool_calls.length : 0,
        error: toolCall.data?.error || null,
      },
      toolResultContinuation: {
        ok: toolContinuation.ok !== false && !toolContinuation.skipped,
        skipped: Boolean(toolContinuation.skipped),
        reason: toolContinuation.reason || null,
        status: toolContinuation.status || null,
        contentPreview: String(toolContinuation.data?.message?.content || toolContinuation.data?.response || '').slice(0, 120),
      },
      badModel: {
        ok: badModel.ok === false,
        status: badModel.status,
        structuredFailure: Boolean(badModel.data?.error || badModel.status >= 400),
      },
    },
  });
}

if (require.main === module) {
  main().catch((error) => {
    jsonOut({
      ok: false,
      probe_kind: 'probe_only',
      endpoint: DEFAULT_ENDPOINT,
      error: error?.message || String(error),
    });
    process.exit(1);
  });
}
