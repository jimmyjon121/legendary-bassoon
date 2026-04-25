#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * NPU Draft smoke (Phase 2 gate).
 *
 * Static-analysis check that the speculative-decoding draft path is
 * wired end-to-end:
 *   - start-npu-server.py exposes POST /draft and DELETE /draft/{id}
 *     with the documented request/response shape.
 *   - DraftRequest pydantic model defines the expected fields.
 *   - npu-bridge.js exports draftTokens() and cancelDraft() that
 *     hit those routes with a JSON body and parse the response.
 *
 * Live verification (actually generating draft tokens against a loaded
 * NPU model) is covered by eval:live-smoke once Phase 2 ships; this
 * gate stays static so release-gate remains fast.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

function main() {
  const failures = [];

  const npuServer = read('scripts/start-npu-server.py');
  const npuBridge = read('electron/services/npu-bridge.js');

  // ─── Server-side: routes + request model ───────────────────────
  assert(
    /class DraftRequest\(BaseModel\)/.test(npuServer),
    'start-npu-server.py must declare DraftRequest pydantic model',
    failures
  );
  assert(
    /prompt: str \| None = None/.test(npuServer)
      && /prefix_tokens: list\[int\] \| None = None/.test(npuServer)
      && /lookahead: int = 4/.test(npuServer),
    'DraftRequest must include prompt/prefix_tokens/lookahead fields',
    failures
  );
  assert(
    /@app\.post\('\/draft'\)/.test(npuServer),
    'start-npu-server.py must expose POST /draft',
    failures
  );
  assert(
    /@app\.delete\('\/draft\/\{request_id\}'\)/.test(npuServer),
    'start-npu-server.py must expose DELETE /draft/{request_id}',
    failures
  );
  assert(
    /_draft_requests_lock/.test(npuServer) && /_draft_requests:.*Dict\[str, Dict/.test(npuServer),
    'start-npu-server.py must maintain a thread-safe _draft_requests registry',
    failures
  );
  assert(
    /'draft_tokens'/.test(npuServer)
      && /'draft_logprobs'/.test(npuServer)
      && /'request_id'/.test(npuServer)
      && /'latency_ms'/.test(npuServer),
    'POST /draft response must include draft_tokens / draft_logprobs / request_id / latency_ms',
    failures
  );
  assert(
    /'engine': 'genai'/.test(npuServer),
    'POST /draft must report engine="genai" so the verifier can confirm pair compatibility',
    failures
  );

  // ─── Bridge: client methods ────────────────────────────────────
  assert(
    /async draftTokens\(\{[^}]*lookahead/.test(npuBridge)
      && /\$\{this\.serverEndpoint\}\/draft/.test(npuBridge),
    'npu-bridge must expose draftTokens() that POSTs to /draft',
    failures
  );
  assert(
    /async cancelDraft\(requestId\)/.test(npuBridge)
      && /method: 'DELETE'/.test(npuBridge),
    'npu-bridge must expose cancelDraft(requestId) that DELETEs /draft/{id}',
    failures
  );

  // ─── Phase 2 A4: tree-spec secondary branch ───────────────────
  assert(
    /branch: str \| None = None/.test(npuServer),
    'DraftRequest must include `branch` for primary/secondary routing',
    failures
  );
  assert(
    /_ensure_secondary_pipe\(/.test(npuServer)
      && /state\.genai_pipe_secondary/.test(npuServer),
    'start-npu-server.py must lazy-load a secondary GenAI pipeline for tree-spec',
    failures
  );

  // ─── Phase 2 A3: DraftSession contract ────────────────────────
  assert(
    /class DraftSessionInitRequest\(BaseModel\)/.test(npuServer)
      && /class DraftSessionExtendRequest\(BaseModel\)/.test(npuServer),
    'start-npu-server.py must declare DraftSessionInitRequest + DraftSessionExtendRequest',
    failures
  );
  assert(
    /@app\.post\('\/draft\/session'\)/.test(npuServer),
    'start-npu-server.py must expose POST /draft/session',
    failures
  );
  assert(
    /@app\.post\('\/draft\/session\/\{session_id\}\/extend'\)/.test(npuServer),
    'start-npu-server.py must expose POST /draft/session/{session_id}/extend',
    failures
  );
  assert(
    /@app\.delete\('\/draft\/session\/\{session_id\}'\)/.test(npuServer),
    'start-npu-server.py must expose DELETE /draft/session/{session_id}',
    failures
  );
  assert(
    /async createDraftSession\(/.test(npuBridge)
      && /async extendDraftSession\(/.test(npuBridge)
      && /async closeDraftSession\(/.test(npuBridge),
    'npu-bridge must expose createDraftSession / extendDraftSession / closeDraftSession',
    failures
  );

  if (failures.length > 0) {
    console.error('NPU Draft smoke FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('NPU Draft smoke PASS');
}

main();
