/**
 * Vault Lore Store
 *
 * Stores worldbuilding entries (lorebook entries, factions, places, characters)
 * in a dedicated `vault_lore` table. Entries are opaque JSON blobs so the
 * renderer can encrypt the content locally with the vault password before
 * persisting. Relationships are stored in `vault_lore_links` for graph
 * visualization.
 *
 * This service only deals with persistence. Encryption/decryption happens
 * in the renderer via the existing crypto:encrypt / crypto:decrypt IPC
 * handlers using the unlocked vault password — same pattern as vault
 * conversations.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vault_lore (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content BLOB NOT NULL,
    tags TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_vault_lore_kind ON vault_lore(kind);
  CREATE INDEX IF NOT EXISTS idx_vault_lore_updated_at ON vault_lore(updated_at DESC);

  CREATE TABLE IF NOT EXISTS vault_lore_links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES vault_lore(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES vault_lore(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_vault_lore_links_source ON vault_lore_links(source_id);
  CREATE INDEX IF NOT EXISTS idx_vault_lore_links_target ON vault_lore_links(target_id);
`;

let _schemaReady = false;
function ensureSchema(db) {
  if (_schemaReady) return;
  try {
    db.exec(SCHEMA);
    _schemaReady = true;
  } catch (err) {
    console.warn('[VaultLore] Failed to ensure schema:', err.message);
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

function listEntries({ getDb, kind = null, limit = 500 } = {}) {
  const db = getDb();
  ensureSchema(db);
  const cap = Math.max(1, Math.min(2000, Number(limit) || 500));
  const where = kind ? 'WHERE kind = ?' : '';
  const sql = `SELECT id, kind, title, content, tags, created_at, updated_at FROM vault_lore ${where} ORDER BY updated_at DESC LIMIT ${cap}`;
  const params = kind ? [String(kind)] : [];
  return _query(db, sql, params).map((row) => ({
    ...row,
    content: row.content instanceof Uint8Array ? Buffer.from(row.content).toString('utf-8') : String(row.content || ''),
    tags: row.tags ? String(row.tags).split(',').map((t) => t.trim()).filter(Boolean) : [],
  }));
}

function upsertEntry({ getDb, saveDatabase, entry }) {
  if (!entry || !entry.id || !entry.title) {
    throw new Error('Entry requires id and title');
  }
  const db = getDb();
  ensureSchema(db);
  const now = new Date().toISOString();
  const tags = Array.isArray(entry.tags) ? entry.tags.map(String).filter(Boolean).join(',') : '';
  const content = entry.content == null ? '' : String(entry.content);
  const existing = _query(db, 'SELECT id FROM vault_lore WHERE id = ?', [entry.id])[0];
  if (existing) {
    db.run(
      'UPDATE vault_lore SET kind = ?, title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?',
      [String(entry.kind || 'note'), String(entry.title), content, tags, now, entry.id],
    );
  } else {
    db.run(
      'INSERT INTO vault_lore (id, kind, title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [entry.id, String(entry.kind || 'note'), String(entry.title), content, tags, now, now],
    );
  }
  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'vault-lore:upsert' });
  return { success: true, id: entry.id, updated_at: now };
}

function deleteEntry({ getDb, saveDatabase, id }) {
  if (!id) throw new Error('Missing id');
  const db = getDb();
  ensureSchema(db);
  db.run('DELETE FROM vault_lore_links WHERE source_id = ? OR target_id = ?', [id, id]);
  db.run('DELETE FROM vault_lore WHERE id = ?', [id]);
  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'vault-lore:delete' });
  return { success: true, id };
}

function listLinks({ getDb } = {}) {
  const db = getDb();
  ensureSchema(db);
  return _query(db, 'SELECT id, source_id, target_id, relation, created_at FROM vault_lore_links ORDER BY created_at DESC');
}

function upsertLink({ getDb, saveDatabase, link }) {
  if (!link || !link.id || !link.source_id || !link.target_id) {
    throw new Error('Link requires id, source_id, target_id');
  }
  const db = getDb();
  ensureSchema(db);
  const existing = _query(db, 'SELECT id FROM vault_lore_links WHERE id = ?', [link.id])[0];
  if (existing) {
    db.run(
      'UPDATE vault_lore_links SET source_id = ?, target_id = ?, relation = ? WHERE id = ?',
      [link.source_id, link.target_id, link.relation || null, link.id],
    );
  } else {
    db.run(
      'INSERT INTO vault_lore_links (id, source_id, target_id, relation) VALUES (?, ?, ?, ?)',
      [link.id, link.source_id, link.target_id, link.relation || null],
    );
  }
  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'vault-lore:link' });
  return { success: true };
}

function deleteLink({ getDb, saveDatabase, id }) {
  if (!id) throw new Error('Missing id');
  const db = getDb();
  ensureSchema(db);
  db.run('DELETE FROM vault_lore_links WHERE id = ?', [id]);
  if (typeof saveDatabase === 'function') saveDatabase({ reason: 'vault-lore:link-delete' });
  return { success: true };
}

module.exports = {
  listEntries,
  upsertEntry,
  deleteEntry,
  listLinks,
  upsertLink,
  deleteLink,
};
