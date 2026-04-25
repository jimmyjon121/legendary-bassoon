#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { getNpuBridge } = require('../electron/services/npu-bridge');

const ROOT = path.resolve(__dirname, '..');
const ENDPOINT = process.env.NPU_SERVER_URL || `http://127.0.0.1:${process.env.OPENVINO_SERVER_PORT || 8081}`;
const OUT_PATH = path.join(ROOT, 'docs/perf/phase2-unblock-live.md');
const MEASUREMENT_PATH = path.join(ROOT, 'docs/perf/phase2-spec-decode-measurement.md');
const NOW = new Date();

function requestJson(method, url, body = null, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(url, {
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: data ? JSON.parse(data) : {},
          });
        } catch (error) {
          resolve({ ok: false, status: res.statusCode, error: error?.message || data });
        }
      });
    });
    req.on('error', (error) => resolve({ ok: false, error: error.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function ensureServer() {
  const status = await requestJson('GET', `${ENDPOINT}/status`, null, 2000);
  if (status.ok) return { started: false, status: status.data };

  try {
    const npu = getNpuBridge();
    const result = await npu.startServer();
    if (result?.success === false) {
      return {
        started: false,
        skipped: true,
        reason: `startServer returned failure: ${result.error || 'unknown'}`,
        statusError: status.error || `HTTP ${status.status || 'n/a'}`,
      };
    }
    const retry = await requestJson('GET', `${ENDPOINT}/status`, null, 10000);
    if (retry.ok) return { started: true, status: retry.data };
    return {
      started: Boolean(result?.success),
      skipped: true,
      reason: `server did not answer /status after start: ${retry.error || `HTTP ${retry.status || 'n/a'}`}`,
      statusError: status.error || `HTTP ${status.status || 'n/a'}`,
    };
  } catch (error) {
    return {
      started: false,
      skipped: true,
      reason: `startServer threw: ${error?.message || error}`,
      statusError: status.error || `HTTP ${status.status || 'n/a'}`,
    };
  }
}

function markdownFor(result) {
  const date = NOW.toISOString();
  const rows = [
    ['Date', date],
    ['Endpoint', ENDPOINT],
    ['Outcome', result.skipped ? 'skipped / could not verify' : 'verified request path'],
    ['Server started by script', String(Boolean(result.started))],
    ['Status', result.status ? JSON.stringify(result.status) : (result.statusError || 'n/a')],
    ['Session id', result.session?.session_id || 'n/a'],
    ['chat_mode_active', String(Boolean(result.session?.chat_mode_active))],
    ['chat_mode_skip_reason', result.session?.chat_mode_skip_reason || 'n/a'],
    ['First extend mode', result.extend1?.generate_mode || 'n/a'],
    ['Second extend mode', result.extend2?.generate_mode || 'n/a'],
    ['First extend latency', result.extend1?.latency_ms != null ? `${result.extend1.latency_ms} ms` : 'n/a'],
    ['Second extend latency', result.extend2?.latency_ms != null ? `${result.extend2.latency_ms} ms` : 'n/a'],
    ['Close success', result.close ? String(result.close.success !== false) : 'n/a'],
    ['Skip / failure reason', result.reason || 'n/a'],
  ];

  return [
    '# Phase 2 Unblock Live Verification (v0.4.5)',
    '',
    'This artifact verifies the v0.4.4 NPU draft-session unblock against the live OpenVINO server when available. If the server cannot be started, this file records the skipped state rather than pretending the path was tested.',
    '',
    '## Summary',
    '',
    ...rows.map(([k, v]) => `- **${k}:** ${v}`),
    '',
    '## Raw JSON',
    '',
    '```json',
    JSON.stringify(result, null, 2),
    '```',
    '',
  ].join('\n');
}

function appendMeasurementSummary(result) {
  const marker = '## 2026-04-25 — v0.4.5 hardening live verification';
  let existing = '';
  try {
    existing = fs.readFileSync(MEASUREMENT_PATH, 'utf8');
  } catch {
    return;
  }
  if (existing.includes(marker)) return;
  const summary = result.skipped
    ? `Live verification could not complete: ${result.reason || 'unknown reason'}. See [phase2-unblock-live.md](phase2-unblock-live.md).`
    : `Live verification reached /draft/session and two /extend calls. chat_mode_active=${Boolean(result.session?.chat_mode_active)}, second generate_mode=${result.extend2?.generate_mode || 'n/a'}. See [phase2-unblock-live.md](phase2-unblock-live.md).`;
  fs.writeFileSync(
    MEASUREMENT_PATH,
    `${existing.trimEnd()}\n\n${marker}\n\n${summary}\n`,
    'utf8',
  );
}

async function main() {
  const result = {
    date: NOW.toISOString(),
    endpoint: ENDPOINT,
    started: false,
    skipped: false,
    status: null,
    session: null,
    extend1: null,
    extend2: null,
    close: null,
    reason: null,
  };

  const server = await ensureServer();
  Object.assign(result, server);
  if (server.skipped) {
    result.skipped = true;
    fs.writeFileSync(OUT_PATH, markdownFor(result), 'utf8');
    appendMeasurementSummary(result);
    console.log(`phase2-unblock-live-verify SKIPPED: ${result.reason}`);
    return;
  }

  const session = await requestJson('POST', `${ENDPOINT}/draft/session`, {
    prompt: 'User: Hello\n\nAssistant:',
  }, 60000);
  if (!session.ok || session.data?.success === false || !session.data?.session_id) {
    result.skipped = true;
    result.reason = `draft session failed: ${session.error || session.data?.error || `HTTP ${session.status || 'n/a'}`}`;
    fs.writeFileSync(OUT_PATH, markdownFor(result), 'utf8');
    appendMeasurementSummary(result);
    console.log(`phase2-unblock-live-verify SKIPPED: ${result.reason}`);
    return;
  }
  result.session = session.data;
  const sessionId = session.data.session_id;

  const extend1 = await requestJson('POST', `${ENDPOINT}/draft/session/${encodeURIComponent(sessionId)}/extend`, {
    lookahead: 4,
    accepted_text: '',
    temperature: 0,
  }, 60000);
  result.extend1 = extend1.data || { success: false, error: extend1.error || `HTTP ${extend1.status || 'n/a'}` };

  const acceptedText = Array.isArray(result.extend1?.draft_tokens) && result.extend1.draft_tokens.length > 0
    ? ' '
    : '';
  const extend2 = await requestJson('POST', `${ENDPOINT}/draft/session/${encodeURIComponent(sessionId)}/extend`, {
    lookahead: 4,
    accepted_text: acceptedText,
    temperature: 0,
  }, 60000);
  result.extend2 = extend2.data || { success: false, error: extend2.error || `HTTP ${extend2.status || 'n/a'}` };

  const close = await requestJson('DELETE', `${ENDPOINT}/draft/session/${encodeURIComponent(sessionId)}`, null, 15000);
  result.close = close.data || { success: false, error: close.error || `HTTP ${close.status || 'n/a'}` };

  if (result.session?.chat_mode_active && result.extend2?.generate_mode !== 'delta') {
    result.reason = `chat mode active but second extend generate_mode=${result.extend2?.generate_mode || 'n/a'}`;
  }
  if (!result.session?.chat_mode_active && !result.session?.chat_mode_skip_reason) {
    result.reason = result.reason || 'chat mode inactive without a skip reason';
  }

  fs.writeFileSync(OUT_PATH, markdownFor(result), 'utf8');
  appendMeasurementSummary(result);
  if (result.reason) {
    console.log(`phase2-unblock-live-verify completed with warning: ${result.reason}`);
  } else {
    console.log('phase2-unblock-live-verify PASS');
  }
}

main().catch((error) => {
  const result = {
    date: NOW.toISOString(),
    endpoint: ENDPOINT,
    skipped: true,
    reason: error?.message || String(error),
  };
  fs.writeFileSync(OUT_PATH, markdownFor(result), 'utf8');
  appendMeasurementSummary(result);
  console.log(`phase2-unblock-live-verify SKIPPED: ${result.reason}`);
});
