/**
 * Unified Ledger Database
 * 
 * Tamper-evident, append-only event and execution ledger.
 * Powers: Receipts-Only, Session Replay, Intent→Actions, Counterfactuals, Friction signals.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db = null;
let dbPath = null;
let SQL = null;

/**
 * Compute SHA-256 hash of content
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compute hash for a ledger row (for chain integrity)
 */
function computeRowHash(row, prevHash) {
  const content = JSON.stringify({
    id: row.id,
    type: row.type,
    workspace: row.workspace,
    session_id: row.session_id,
    ts: row.ts,
    payload: row.payload_json,
    prev_hash: prevHash
  });
  return sha256(content);
}

/**
 * Initialize the ledger database
 */
async function initLedgerDb(userDataPath) {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  
  dbPath = path.join(userDataPath, 'ledger.db');
  
  // Load existing or create new
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('[Ledger] Loaded existing ledger database from', dbPath);
    } else {
      db = new SQL.Database();
      console.log('[Ledger] Created new ledger database');
    }
  } catch (error) {
    console.error('[Ledger] Error loading database, creating new:', error);
    db = new SQL.Database();
  }
  
  // Create tables
  createTables();
  
  // Initial save
  saveLedgerDb();
  
  return db;
}

/**
 * Create all ledger tables
 */
function createTables() {
  // Main event log with hash chain
  db.run(`
    CREATE TABLE IF NOT EXISTS ledger_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      workspace TEXT,
      session_id TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      payload_json TEXT,
      prev_hash TEXT,
      hash TEXT NOT NULL
    )
  `);
  
  // Evidence items (citations, file refs, tool outputs)
  db.run(`
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      kind TEXT NOT NULL,
      ref_json TEXT,
      content_hash TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES ledger_events(id)
    )
  `);
  
  // Action runs (intent → plan → execution)
  db.run(`
    CREATE TABLE IF NOT EXISTS action_runs (
      id TEXT PRIMARY KEY,
      intent TEXT NOT NULL,
      plan_ir_json TEXT,
      started_ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_ts DATETIME,
      status TEXT DEFAULT 'pending',
      summary TEXT
    )
  `);
  
  // Individual steps within an action run
  db.run(`
    CREATE TABLE IF NOT EXISTS action_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      evidence_id TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES action_runs(id),
      FOREIGN KEY (evidence_id) REFERENCES evidence_items(id)
    )
  `);
  
  // Decision forks (counterfactual alternatives)
  db.run(`
    CREATE TABLE IF NOT EXISTS decision_forks (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      event_id TEXT,
      fork_point TEXT,
      alternatives_json TEXT,
      chosen_id TEXT,
      predicted_json TEXT,
      actual_json TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (run_id) REFERENCES action_runs(id),
      FOREIGN KEY (event_id) REFERENCES ledger_events(id)
    )
  `);
  
  // Friction signals (edits, regens, abandons)
  db.run(`
    CREATE TABLE IF NOT EXISTS friction_signals (
      id TEXT PRIMARY KEY,
      related_event_id TEXT,
      kind TEXT NOT NULL,
      severity REAL DEFAULT 0.5,
      payload_json TEXT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (related_event_id) REFERENCES ledger_events(id)
    )
  `);
  
  // Sessions tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_ts DATETIME,
      workspace TEXT,
      event_count INTEGER DEFAULT 0
    )
  `);
  
  // Indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_session ON ledger_events(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON ledger_events(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_ts ON ledger_events(ts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_evidence_event ON evidence_items(event_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_steps_run ON action_steps(run_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_friction_event ON friction_signals(related_event_id)`);
}

/**
 * Save database to disk
 */
function saveLedgerDb() {
  if (db && dbPath) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (error) {
      console.error('[Ledger] Failed to save database:', error);
    }
  }
}

/**
 * Get the last hash in the chain
 */
function getLastHash() {
  const result = db.exec('SELECT hash FROM ledger_events ORDER BY ts DESC LIMIT 1');
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return 'GENESIS';
}

/**
 * Record an event to the ledger
 */
function recordEvent(event) {
  const id = event.id || crypto.randomUUID();
  const prevHash = getLastHash();
  
  const row = {
    id,
    type: event.type,
    workspace: event.workspace || null,
    session_id: event.sessionId || null,
    ts: event.ts || new Date().toISOString(),
    payload_json: JSON.stringify(event.payload || {}),
    prev_hash: prevHash
  };
  
  row.hash = computeRowHash(row, prevHash);
  
  db.run(`
    INSERT INTO ledger_events (id, type, workspace, session_id, ts, payload_json, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [row.id, row.type, row.workspace, row.session_id, row.ts, row.payload_json, row.prev_hash, row.hash]);
  
  saveLedgerDb();
  
  return { id: row.id, hash: row.hash };
}

/**
 * List events with filters
 */
function listEvents(filters = {}) {
  let sql = 'SELECT * FROM ledger_events WHERE 1=1';
  const params = [];
  
  if (filters.sessionId) {
    sql += ' AND session_id = ?';
    params.push(filters.sessionId);
  }
  
  if (filters.types && filters.types.length > 0) {
    sql += ` AND type IN (${filters.types.map(() => '?').join(',')})`;
    params.push(...filters.types);
  }
  
  if (filters.workspace) {
    sql += ' AND workspace = ?';
    params.push(filters.workspace);
  }
  
  if (filters.since) {
    sql += ' AND ts >= ?';
    params.push(filters.since);
  }
  
  if (filters.until) {
    sql += ' AND ts <= ?';
    params.push(filters.until);
  }
  
  sql += ' ORDER BY ts ' + (filters.order === 'asc' ? 'ASC' : 'DESC');
  
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  const stmt = db.prepare(sql);
  stmt.bind(params);
  
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.payload = JSON.parse(row.payload_json || '{}');
    delete row.payload_json;
    results.push(row);
  }
  stmt.free();
  
  return results;
}

/**
 * Add evidence item
 */
function addEvidence(evidence) {
  const id = evidence.id || crypto.randomUUID();
  
  db.run(`
    INSERT INTO evidence_items (id, event_id, kind, ref_json, content_hash, ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    id,
    evidence.eventId || null,
    evidence.kind,
    JSON.stringify(evidence.ref || {}),
    evidence.contentHash || null,
    evidence.ts || new Date().toISOString()
  ]);
  
  saveLedgerDb();
  return { id };
}

/**
 * Get evidence for an event
 */
function getEvidence(eventId) {
  const stmt = db.prepare('SELECT * FROM evidence_items WHERE event_id = ?');
  stmt.bind([eventId]);
  
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.ref = JSON.parse(row.ref_json || '{}');
    delete row.ref_json;
    results.push(row);
  }
  stmt.free();
  
  return results;
}

/**
 * Create an action run
 */
function createRun(run) {
  const id = run.id || crypto.randomUUID();
  
  db.run(`
    INSERT INTO action_runs (id, intent, plan_ir_json, status)
    VALUES (?, ?, ?, ?)
  `, [
    id,
    run.intent,
    JSON.stringify(run.planIR || {}),
    'pending'
  ]);
  
  saveLedgerDb();
  return { id };
}

/**
 * Update an action run
 */
function updateRun(runId, updates) {
  const sets = [];
  const params = [];
  
  if (updates.status) {
    sets.push('status = ?');
    params.push(updates.status);
  }
  
  if (updates.summary) {
    sets.push('summary = ?');
    params.push(updates.summary);
  }
  
  if (updates.status === 'completed' || updates.status === 'failed') {
    sets.push('finished_ts = ?');
    params.push(new Date().toISOString());
  }
  
  if (sets.length > 0) {
    params.push(runId);
    db.run(`UPDATE action_runs SET ${sets.join(', ')} WHERE id = ?`, params);
    saveLedgerDb();
  }
  
  return { success: true };
}

/**
 * Add a step to a run
 */
function addRunStep(step) {
  const id = step.id || crypto.randomUUID();
  
  db.run(`
    INSERT INTO action_steps (id, run_id, idx, step_type, input_json, output_json, evidence_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    step.runId,
    step.idx,
    step.stepType,
    JSON.stringify(step.input || {}),
    JSON.stringify(step.output || {}),
    step.evidenceId || null
  ]);
  
  saveLedgerDb();
  return { id };
}

/**
 * Get steps for a run
 */
function getRunSteps(runId) {
  const stmt = db.prepare('SELECT * FROM action_steps WHERE run_id = ? ORDER BY idx ASC');
  stmt.bind([runId]);
  
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.input = JSON.parse(row.input_json || '{}');
    row.output = JSON.parse(row.output_json || '{}');
    delete row.input_json;
    delete row.output_json;
    results.push(row);
  }
  stmt.free();
  
  return results;
}

/**
 * Create a decision fork
 */
function createDecisionFork(fork) {
  const id = fork.id || crypto.randomUUID();
  
  db.run(`
    INSERT INTO decision_forks (id, run_id, event_id, fork_point, alternatives_json, chosen_id, predicted_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    fork.runId || null,
    fork.eventId || null,
    fork.forkPoint || null,
    JSON.stringify(fork.alternatives || []),
    fork.chosenId || null,
    JSON.stringify(fork.predicted || {})
  ]);
  
  saveLedgerDb();
  return { id };
}

/**
 * Record a friction signal
 */
function recordFriction(friction) {
  const id = friction.id || crypto.randomUUID();
  
  db.run(`
    INSERT INTO friction_signals (id, related_event_id, kind, severity, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `, [
    id,
    friction.relatedEventId || null,
    friction.kind,
    friction.severity || 0.5,
    JSON.stringify(friction.payload || {})
  ]);
  
  saveLedgerDb();
  return { id };
}

/**
 * Get friction signals (for LMA training)
 */
function getFrictionSignals(filters = {}) {
  let sql = 'SELECT * FROM friction_signals WHERE 1=1';
  const params = [];
  
  if (filters.kinds && filters.kinds.length > 0) {
    sql += ` AND kind IN (${filters.kinds.map(() => '?').join(',')})`;
    params.push(...filters.kinds);
  }
  
  if (filters.minSeverity) {
    sql += ' AND severity >= ?';
    params.push(filters.minSeverity);
  }
  
  if (filters.since) {
    sql += ' AND ts >= ?';
    params.push(filters.since);
  }
  
  sql += ' ORDER BY ts DESC';
  
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  const stmt = db.prepare(sql);
  stmt.bind(params);
  
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    row.payload = JSON.parse(row.payload_json || '{}');
    delete row.payload_json;
    results.push(row);
  }
  stmt.free();
  
  return results;
}

/**
 * Verify chain integrity
 */
function verifyChain(limit = 1000) {
  const events = listEvents({ limit, order: 'asc' });
  let prevHash = 'GENESIS';
  let valid = true;
  let invalidAt = null;
  
  for (const event of events) {
    const row = {
      id: event.id,
      type: event.type,
      workspace: event.workspace,
      session_id: event.session_id,
      ts: event.ts,
      payload_json: JSON.stringify(event.payload),
      prev_hash: event.prev_hash
    };
    
    const expectedHash = computeRowHash(row, prevHash);
    
    if (event.hash !== expectedHash || event.prev_hash !== prevHash) {
      valid = false;
      invalidAt = event.id;
      break;
    }
    
    prevHash = event.hash;
  }
  
  return { valid, invalidAt, checkedCount: events.length };
}

/**
 * Get session info
 */
function getOrCreateSession(sessionId) {
  const existing = db.exec('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  
  if (existing.length > 0 && existing[0].values.length > 0) {
    return { id: sessionId, existing: true };
  }
  
  db.run('INSERT INTO sessions (id) VALUES (?)', [sessionId]);
  saveLedgerDb();
  
  return { id: sessionId, existing: false };
}

/**
 * Get statistics
 */
function getStats() {
  const eventCount = db.exec('SELECT COUNT(*) as count FROM ledger_events')[0]?.values[0]?.[0] || 0;
  const runCount = db.exec('SELECT COUNT(*) as count FROM action_runs')[0]?.values[0]?.[0] || 0;
  const frictionCount = db.exec('SELECT COUNT(*) as count FROM friction_signals')[0]?.values[0]?.[0] || 0;
  const evidenceCount = db.exec('SELECT COUNT(*) as count FROM evidence_items')[0]?.values[0]?.[0] || 0;
  const sessionCount = db.exec('SELECT COUNT(*) as count FROM sessions')[0]?.values[0]?.[0] || 0;
  const forkCount = db.exec('SELECT COUNT(*) as count FROM decision_forks')[0]?.values[0]?.[0] || 0;
  
  return {
    events: eventCount,
    runs: runCount,
    friction: frictionCount,
    evidence: evidenceCount,
    sessions: sessionCount,
    forks: forkCount
  };
}

/**
 * Clear all events from ledger
 */
function clearEvents() {
  db.run('DELETE FROM ledger_events');
  db.run('DELETE FROM evidence_items');
  saveLedgerDb();
  console.log('[Ledger] Cleared all events');
}

/**
 * Clear all friction signals
 */
function clearFrictionSignals() {
  db.run('DELETE FROM friction_signals');
  saveLedgerDb();
  console.log('[Ledger] Cleared all friction signals');
}

/**
 * Clear all data (factory reset)
 */
function clearAll() {
  db.run('DELETE FROM ledger_events');
  db.run('DELETE FROM evidence_items');
  db.run('DELETE FROM action_runs');
  db.run('DELETE FROM run_steps');
  db.run('DELETE FROM decision_forks');
  db.run('DELETE FROM friction_signals');
  db.run('DELETE FROM sessions');
  saveLedgerDb();
  console.log('[Ledger] Cleared all ledger data');
}

module.exports = {
  initLedgerDb,
  saveLedgerDb,
  recordEvent,
  listEvents,
  addEvidence,
  getEvidence,
  createRun,
  updateRun,
  addRunStep,
  getRunSteps,
  createDecisionFork,
  recordFriction,
  getFrictionSignals,
  verifyChain,
  getOrCreateSession,
  getStats,
  clearEvents,
  clearFrictionSignals,
  clearAll,
  sha256
};

