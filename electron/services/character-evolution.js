/**
 * Character Evolution (Succession)
 *
 * Opt-in, reversible tracking of how a character changes over the course
 * of scenes. Every change is saved as a versioned snapshot with a parent
 * pointer, so the user can:
 *   • view the full history as a timeline
 *   • roll back to any previous version
 *   • branch a new version from any point
 *   • export the delta trail as a JSONL dataset for LoRA fine-tuning
 *
 * Design principles:
 *   • Off by default. A character must have `evolution_enabled = 1` before
 *     any snapshot is written.
 *   • Nothing auto-mutates the base character. The user (or the engine
 *     acting on the user's explicit confirmation via the UI) calls
 *     `snapshot()`. Reversion is a no-op for the base state — we preserve
 *     the original in `version = 0`.
 *   • Linear history with parent pointers (no hidden merges). Makes
 *     reverting trivial: just point current_version back.
 *   • Stored in the normal app database so it benefits from the existing
 *     encrypted-backup workflow.
 *
 * Schema:
 *   character_evolution(
 *     id TEXT PK,
 *     character_id TEXT,
 *     version INTEGER,
 *     parent_version INTEGER,
 *     summary TEXT,
 *     deltas TEXT (json: {added:[], removed:[], traitShifts:{}, systemPromptAfter})
 *     trait_state TEXT (json snapshot),
 *     created_at TEXT,
 *     created_by TEXT
 *   )
 *   character_evolution_state(
 *     character_id TEXT PK,
 *     enabled INTEGER,
 *     current_version INTEGER,
 *     updated_at TEXT
 *   )
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS character_evolution (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    parent_version INTEGER,
    summary TEXT,
    deltas TEXT,
    trait_state TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_char_evo_character ON character_evolution(character_id, version);

  CREATE TABLE IF NOT EXISTS character_evolution_state (
    character_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    current_version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

let _schemaReady = false;
function ensureSchema(db) {
  if (_schemaReady) return;
  try {
    db.exec(SCHEMA);
    _schemaReady = true;
  } catch (err) {
    console.warn('[CharEvolution] ensureSchema failed:', err.message);
  }
}

function _query(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function _parseJSON(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function getState({ getDb, characterId }) {
  if (!characterId) return { success: false, error: 'characterId required' };
  const db = getDb();
  ensureSchema(db);
  const rows = _query(db, 'SELECT * FROM character_evolution_state WHERE character_id = ?', [String(characterId)]);
  const state = rows[0] || { character_id: characterId, enabled: 0, current_version: 0 };
  return {
    success: true,
    state: {
      characterId: state.character_id,
      enabled: Boolean(state.enabled),
      currentVersion: Number(state.current_version || 0),
    },
  };
}

function setEnabled({ getDb, saveDatabase, characterId, enabled }) {
  if (!characterId) return { success: false, error: 'characterId required' };
  const db = getDb();
  ensureSchema(db);
  const now = new Date().toISOString();
  const existing = _query(db, 'SELECT character_id FROM character_evolution_state WHERE character_id = ?', [String(characterId)])[0];
  if (existing) {
    db.run(
      'UPDATE character_evolution_state SET enabled = ?, updated_at = ? WHERE character_id = ?',
      [enabled ? 1 : 0, now, String(characterId)],
    );
  } else {
    db.run(
      'INSERT INTO character_evolution_state (character_id, enabled, current_version, updated_at) VALUES (?, ?, ?, ?)',
      [String(characterId), enabled ? 1 : 0, 0, now],
    );
  }
  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'char-evolution:toggle' });
  return { success: true, enabled: Boolean(enabled) };
}

function listHistory({ getDb, characterId, limit = 200 }) {
  if (!characterId) return { success: false, error: 'characterId required', history: [] };
  const db = getDb();
  ensureSchema(db);
  const cap = Math.max(1, Math.min(500, Number(limit) || 200));
  const rows = _query(
    db,
    `SELECT id, character_id, version, parent_version, summary, deltas, trait_state, created_at, created_by
     FROM character_evolution
     WHERE character_id = ?
     ORDER BY version DESC
     LIMIT ${cap}`,
    [String(characterId)],
  );
  return {
    success: true,
    history: rows.map((r) => ({
      id: r.id,
      characterId: r.character_id,
      version: Number(r.version),
      parentVersion: r.parent_version != null ? Number(r.parent_version) : null,
      summary: r.summary || '',
      deltas: _parseJSON(r.deltas, {}),
      traitState: _parseJSON(r.trait_state, {}),
      createdAt: r.created_at,
      createdBy: r.created_by || 'user',
    })),
  };
}

function snapshot({ getDb, saveDatabase, characterId, summary, deltas, traitState, createdBy = 'user' }) {
  if (!characterId) return { success: false, error: 'characterId required' };
  const db = getDb();
  ensureSchema(db);

  const state = getState({ getDb, characterId }).state;
  if (!state.enabled) {
    return { success: false, error: 'Evolution is disabled for this character. Enable it before taking snapshots.' };
  }

  const latest = _query(
    db,
    'SELECT MAX(version) AS v FROM character_evolution WHERE character_id = ?',
    [String(characterId)],
  )[0];
  const nextVersion = (latest?.v != null ? Number(latest.v) : -1) + 1;
  const id = `evo-${characterId}-${nextVersion}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO character_evolution
      (id, character_id, version, parent_version, summary, deltas, trait_state, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(characterId),
      nextVersion,
      state.currentVersion != null ? state.currentVersion : null,
      String(summary || '').slice(0, 2000),
      JSON.stringify(deltas || {}),
      JSON.stringify(traitState || {}),
      now,
      String(createdBy || 'user').slice(0, 32),
    ],
  );

  db.run(
    `INSERT INTO character_evolution_state (character_id, enabled, current_version, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET current_version = excluded.current_version, updated_at = excluded.updated_at`,
    [String(characterId), nextVersion, now],
  );

  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'char-evolution:snapshot' });
  return { success: true, version: nextVersion, id };
}

function revertTo({ getDb, saveDatabase, characterId, version }) {
  if (!characterId) return { success: false, error: 'characterId required' };
  const db = getDb();
  ensureSchema(db);
  const targetVersion = Number(version);
  if (!Number.isFinite(targetVersion) || targetVersion < 0) {
    return { success: false, error: 'Invalid version' };
  }
  const row = _query(db, 'SELECT version FROM character_evolution WHERE character_id = ? AND version = ?', [String(characterId), targetVersion])[0];
  if (!row && targetVersion !== 0) {
    return { success: false, error: 'Version not found' };
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO character_evolution_state (character_id, enabled, current_version, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET current_version = excluded.current_version, updated_at = excluded.updated_at`,
    [String(characterId), targetVersion, now],
  );
  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'char-evolution:revert' });
  return { success: true, currentVersion: targetVersion };
}

function getCurrentTraitState({ getDb, characterId }) {
  if (!characterId) return { success: false, error: 'characterId required' };
  const db = getDb();
  ensureSchema(db);
  const state = getState({ getDb, characterId }).state;
  if (!state.enabled || !state.currentVersion) {
    return { success: true, version: 0, traitState: {}, summary: '' };
  }
  const row = _query(
    db,
    'SELECT version, summary, trait_state FROM character_evolution WHERE character_id = ? AND version = ?',
    [String(characterId), state.currentVersion],
  )[0];
  if (!row) return { success: true, version: 0, traitState: {}, summary: '' };
  return {
    success: true,
    version: Number(row.version),
    summary: row.summary || '',
    traitState: _parseJSON(row.trait_state, {}),
  };
}

function exportJsonl({ getDb, characterId }) {
  if (!characterId) return { success: false, error: 'characterId required' };
  const db = getDb();
  ensureSchema(db);
  const rows = _query(
    db,
    `SELECT version, summary, deltas, trait_state, created_at
     FROM character_evolution
     WHERE character_id = ?
     ORDER BY version ASC`,
    [String(characterId)],
  );
  const lines = rows.map((r) => JSON.stringify({
    version: Number(r.version),
    summary: r.summary || '',
    deltas: _parseJSON(r.deltas, {}),
    traitState: _parseJSON(r.trait_state, {}),
    createdAt: r.created_at,
  }));
  return { success: true, jsonl: lines.join('\n'), lines: lines.length };
}

module.exports = {
  ensureSchema,
  getState,
  setEnabled,
  listHistory,
  snapshot,
  revertTo,
  getCurrentTraitState,
  exportJsonl,
};
