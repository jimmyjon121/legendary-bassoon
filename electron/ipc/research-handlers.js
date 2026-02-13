const { dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getOrchestrator } = require('../services/inference-orchestrator');
const { ResearchOrchestrator, buildStatsSkeleton, safeParseJson } = require('../services/research/research-orchestrator');
const { DEFAULT_SOURCE_POLICY, mergeSourcePolicy } = require('../services/research/research-source-policy');
const { DEFAULT_STARTER_SCHEMA, normalizeSchema } = require('../services/research/research-schema');

let orchestrator = null;

function nowIso() {
  return new Date().toISOString();
}

function safeStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? {});
  } catch (_error) {
    return fallback;
  }
}

function createDbHelpers(db, saveDatabase) {
  const query = (sql, params = []) => {
    if (!db) return [];
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  };

  const queryOne = (sql, params = []) => {
    const rows = query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  };

  const run = (sql, params = []) => {
    if (!db) return;
    db.run(sql, params);
    if (typeof saveDatabase === 'function') saveDatabase();
  };

  return { query, queryOne, run };
}

function resolveSynthesisModel(store) {
  const current = String(store?.get?.('currentModel') || '').trim();
  if (current) return current;
  const fallback = String(store?.get?.('defaultModel') || '').trim();
  if (fallback) return fallback;
  return 'llama3.2:3b';
}

function extractSynthesisText(response = {}) {
  if (typeof response?.response === 'string' && response.response.trim()) return response.response.trim();
  if (typeof response?.message?.content === 'string' && response.message.content.trim()) return response.message.content.trim();
  return '';
}

async function generateRunSynthesis({ prompt, store }) {
  const model = resolveSynthesisModel(store);
  const orchestrator = getOrchestrator(store);
  if (!orchestrator) {
    throw new Error('inference_orchestrator_unavailable');
  }
  if (!orchestrator.initialized && typeof orchestrator.initialize === 'function') {
    await orchestrator.initialize();
  }

  const response = await orchestrator.generate({
    model,
    prompt: String(prompt || '').trim(),
    lane: 'lane_agent',
    workloadType: 'research_synthesis',
    allowFallback: true,
    priority: 12,
    options: {
      temperature: 0.15,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.07,
      num_predict: 2200,
    },
  });
  const text = extractSynthesisText(response);
  if (!text) {
    throw new Error('empty_synthesis_response');
  }
  return { model, text };
}

async function generateRunExtraction({ prompt, store }) {
  const model = resolveSynthesisModel(store);
  const orchestrator = getOrchestrator(store);
  if (!orchestrator) {
    throw new Error('inference_orchestrator_unavailable');
  }
  if (!orchestrator.initialized && typeof orchestrator.initialize === 'function') {
    await orchestrator.initialize();
  }

  const response = await orchestrator.generate({
    model,
    prompt: String(prompt || '').trim(),
    lane: 'lane_agent',
    workloadType: 'research_extraction',
    allowFallback: true,
    priority: 13,
    options: {
      temperature: 0.05,
      top_p: 0.8,
      top_k: 40,
      repeat_penalty: 1.06,
      num_predict: 1600,
    },
  });
  const text = extractSynthesisText(response);
  if (!text) throw new Error('empty_extraction_response');
  return { model, text };
}

async function generateRunProgressSummary({ prompt, store }) {
  const model = resolveSynthesisModel(store);
  const orchestrator = getOrchestrator(store);
  if (!orchestrator) {
    throw new Error('inference_orchestrator_unavailable');
  }
  if (!orchestrator.initialized && typeof orchestrator.initialize === 'function') {
    await orchestrator.initialize();
  }
  const response = await orchestrator.generate({
    model,
    prompt: String(prompt || '').trim(),
    lane: 'lane_agent',
    workloadType: 'research_progress_summary',
    allowFallback: true,
    priority: 9,
    options: {
      temperature: 0.18,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.05,
      num_predict: 520,
    },
  });
  const text = extractSynthesisText(response);
  if (!text) throw new Error('empty_progress_summary_response');
  return { model, text };
}

function ensureOrchestrator({ db, saveDatabase, mainWindow, store }) {
  if (!orchestrator) {
    orchestrator = new ResearchOrchestrator({
      db,
      saveDatabase,
      synthesisGenerator: async ({ prompt }) => generateRunSynthesis({ prompt, store }),
      extractionGenerator: async ({ prompt }) => generateRunExtraction({ prompt, store }),
      progressSummaryGenerator: async ({ prompt }) => generateRunProgressSummary({ prompt, store }),
      progressSink: (payload) => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('research:runProgress', payload);
          }
        } catch (_error) {
          // Ignore emit failures
        }
      },
    });
  }
  return orchestrator;
}

function normalizeProjectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspace: row.workspace,
    name: row.name,
    description: row.description || '',
    permanent_instructions: row.permanent_instructions || '',
    schema: normalizeSchema(safeParseJson(row.schema_json, DEFAULT_STARTER_SCHEMA)),
    source_policy: mergeSourcePolicy(DEFAULT_SOURCE_POLICY, safeParseJson(row.source_policy_json, DEFAULT_SOURCE_POLICY)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildCsv(rows, columns) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const header = columns.map((col) => escape(col)).join(',');
  const body = rows
    .map((row) => columns.map((col) => escape(row[col])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

function normalizeBoolLike(value) {
  if (value === true || value === 'true') return 'Yes';
  if (value === false || value === 'false') return 'No';
  const text = String(value ?? '').trim();
  if (!text) return 'Unknown';
  if (/^(yes|no|unknown)$/i.test(text)) return text[0].toUpperCase() + text.slice(1).toLowerCase();
  return text;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter((item) => String(item || '').trim().length > 0);
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/[,;|]\s*/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function formatMdValue(value) {
  if (value === null || value === undefined || value === '') return 'Not stated on official site';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'Not stated on official site';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function escapeMd(value = '') {
  return String(value || '').replace(/\|/g, '\\|');
}

function buildAutoNarrativeOverview(record = {}) {
  const name = String(record.name || 'This record').trim();
  const category = String(record.category || '').trim();
  const status = String(record.status || '').trim();
  const summary = String(record.summary || record.description || '').trim();
  const qualifiers = [category, status].filter(Boolean).join(', ');
  if (summary) {
    return qualifiers
      ? `${name} (${qualifiers}) - ${summary}`
      : `${name} - ${summary}`;
  }
  return qualifiers
    ? `${name} is categorized as ${qualifiers}.`
    : `${name} has no summary provided in extracted fields.`;
}

function buildNarrativeWriteupMarkdown(record = {}) {
  const city = String(record.city || '').trim();
  const state = String(record.state || '').trim();
  const fallbackTitleSuffix = [city, state].filter(Boolean).join(', ');
  const title = String(record.title || '').trim()
    || String(record.family_title || '').trim()
    || [String(record.name || '').trim(), fallbackTitleSuffix].filter(Boolean).join(' - ')
    || String(record.name || 'Record').trim();
  const overview = String(record.overview || '').trim()
    || String(record.family_overview || '').trim()
    || buildAutoNarrativeOverview(record);

  const bulletRows = [
    ['Category', formatMdValue(record.category)],
    ['Status', formatMdValue(record.status)],
    ['Region', formatMdValue(record.region || [city, state].filter(Boolean).join(', '))],
    ['Key Facts', formatMdValue(record.key_facts)],
    ['Notes', formatMdValue(record.notes)],
  ].filter(([, value]) => String(value || '').trim().length > 0);

  const sourceLines = [
    `Primary URL: ${formatMdValue(record.official_url || record.website || record.source_url)}`,
    `Contact / Reference: ${formatMdValue(record.contact_or_reference || record.phone || record.email)}`,
    `Location: ${formatMdValue([record.address, record.city, record.state, record.zip].filter(Boolean).join(', '))}`,
  ].filter((line) => !line.endsWith('Not stated on official site'));

  const lines = [];
  lines.push(`**${title}**`);
  lines.push('');
  lines.push(overview);
  lines.push('');
  for (const [label, value] of bulletRows) {
    lines.push(`- **${label}:** ${value}`);
  }
  if (sourceLines.length > 0) {
    lines.push('');
    for (const line of sourceLines) lines.push(line);
  }
  return lines.join('\n');
}

function buildDossierMarkdown(record = {}, schema = []) {
  const lines = [];
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  for (const field of schema) {
    const key = String(field?.key || '').trim();
    if (!key) continue;
    const label = String(field?.label || key).trim();
    lines.push(`| ${escapeMd(label)} | ${escapeMd(formatMdValue(record[key]))} |`);
  }
  return lines.join('\n');
}

function buildEvidenceMarkdown(evidence = []) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return 'No evidence rows available.';
  }
  const lines = ['| Field | Claim | Source | Official |', '| --- | --- | --- | --- |'];
  for (const item of evidence) {
    const source = String(item.source_url || '').trim() || 'Not provided';
    lines.push(
      `| ${escapeMd(item.field_key)} | ${escapeMd(formatMdValue(item.claim_text))} | ${escapeMd(source)} | ${item.is_official ? 'Yes' : 'No'} |`
    );
  }
  return lines.join('\n');
}

function buildMarkdownExport({
  project,
  records = [],
  evidenceRows = [],
  runSummary = [],
  runTotals = { discovered: 0, verified: 0, rejected: 0, blocked: 0, irrelevant: 0 },
}) {
  const schema = normalizeSchema(project.schema || DEFAULT_STARTER_SCHEMA);
  const lines = [];
  lines.push(`# ${project.name} - Research Export`);
  lines.push('');
  lines.push(`Generated: ${nowIso()}`);
  lines.push(`Workspace: ${project.workspace}`);
  lines.push('');
  lines.push('## Run Summary');
  lines.push('');
  lines.push(`- Discovered candidates: ${runTotals.discovered}`);
  lines.push(`- Verified records: ${runTotals.verified}`);
  lines.push(`- Rejected (non-official): ${runTotals.rejected}`);
  lines.push(`- Rejected (irrelevant): ${runTotals.irrelevant || 0}`);
  lines.push(`- Blocked (validation/evidence): ${runTotals.blocked}`);
  lines.push(`- Runs included: ${runSummary.length}`);
  lines.push('');
  lines.push('## Verified Records');
  lines.push('');

  for (const row of records) {
    const record = safeParseJson(row.record_json, {});
    const recordEvidence = evidenceRows.filter((item) => item.record_id === row.id);
    const heading = String(record.name || row.canonical_key || row.id);
    lines.push(`### ${heading}`);
    lines.push('');
    lines.push(`- Canonical key: \`${row.canonical_key}\``);
    lines.push(`- Verified URL: ${formatMdValue(row.verified_official_url)}`);
    lines.push(`- Last verified: ${formatMdValue(row.verified_at)}`);
    lines.push('');
    lines.push('#### Structured Record');
    lines.push('');
    lines.push(buildDossierMarkdown(record, schema));
    lines.push('');
    lines.push('#### Narrative Summary');
    lines.push('');
    lines.push(buildNarrativeWriteupMarkdown(record));
    lines.push('');
    lines.push('#### Evidence');
    lines.push('');
    lines.push(buildEvidenceMarkdown(recordEvidence));
    lines.push('');
  }

  return lines.join('\n');
}

function summarizeConversationMessages(messages = [], maxChars = 1800) {
  const parts = [];
  let total = 0;
  for (const msg of messages) {
    const line = `[${msg.role}] ${String(msg.content || '').replace(/\s+/g, ' ').trim()}`;
    if (!line) continue;
    if (total + line.length > maxChars) break;
    parts.push(line);
    total += line.length;
  }
  return parts.join('\n');
}

function buildProjectContext(helpers, project, limitConversations = 20) {
  const linkedConversations = helpers.query(
    `SELECT c.id, c.title, c.preview, c.updated_at
     FROM research_project_conversations rpc
     JOIN conversations c ON c.id = rpc.conversation_id
     WHERE rpc.project_id = ?
     ORDER BY c.updated_at DESC
     LIMIT ?`,
    [project.id, limitConversations]
  );

  const conversationDigestChunks = [];
  for (const convo of linkedConversations) {
    const messages = helpers.query(
      `SELECT role, content, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [convo.id]
    ).reverse();
    conversationDigestChunks.push(
      `Conversation: ${convo.title || convo.id}\n${summarizeConversationMessages(messages)}`
    );
  }

  const linkedDocuments = helpers.query(
    `SELECT d.id, d.filename, d.created_at
     FROM research_project_documents rpd
     JOIN documents d ON d.id = rpd.document_id
     WHERE rpd.project_id = ?
     ORDER BY d.created_at DESC`,
    [project.id]
  );

  const documentDigestChunks = [];
  for (const doc of linkedDocuments) {
    const chunks = helpers.query(
      `SELECT content
       FROM document_chunks
       WHERE document_id = ?
       ORDER BY chunk_index ASC
       LIMIT 2`,
      [doc.id]
    );
    const sample = chunks.map((item) => String(item.content || '').replace(/\s+/g, ' ').trim()).join(' ');
    if (sample) {
      documentDigestChunks.push(`${doc.filename}: ${sample.slice(0, 500)}`);
    }
  }

  return {
    linkedConversations: linkedConversations.map((item) => item.id),
    linkedDocuments: linkedDocuments.map((item) => item.id),
    conversationDigest: conversationDigestChunks.join('\n\n'),
    documentDigest: documentDigestChunks.join('\n\n'),
  };
}

function setupResearchHandlers(ipcMain, mainWindow, { db, saveDatabase, store }) {
  const helpers = createDbHelpers(db, saveDatabase);
  const engine = ensureOrchestrator({ db, saveDatabase, mainWindow, store });

  ipcMain.handle('research:project:list', async (_, { workspace } = {}) => {
    const rows = workspace
      ? helpers.query(`SELECT * FROM research_projects WHERE workspace = ? ORDER BY updated_at DESC`, [workspace])
      : helpers.query(`SELECT * FROM research_projects ORDER BY updated_at DESC`);
    return rows.map((row) => normalizeProjectRow(row));
  });

  ipcMain.handle('research:project:get', async (_, { id } = {}) => {
    if (!id) return null;
    const row = helpers.queryOne(`SELECT * FROM research_projects WHERE id = ?`, [id]);
    return normalizeProjectRow(row);
  });

  ipcMain.handle('research:project:create', async (_, payload = {}) => {
    const id = payload.id || uuidv4();
    const workspace = String(payload.workspace || '').trim() || 'work';
    const name = String(payload.name || '').trim() || 'Research Project';
    const description = String(payload.description || '').trim();
    const permanentInstructions = String(payload.permanent_instructions || '').trim();
    const schema = normalizeSchema(payload.schema || DEFAULT_STARTER_SCHEMA);
    const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, payload.source_policy || {});
    helpers.run(
      `INSERT INTO research_projects
        (id, workspace, name, description, permanent_instructions, schema_json, source_policy_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspace,
        name,
        description,
        permanentInstructions,
        safeStringify(schema, '[]'),
        safeStringify(sourcePolicy),
        nowIso(),
        nowIso(),
      ]
    );
    return { success: true, id };
  });

  ipcMain.handle('research:project:update', async (_, payload = {}) => {
    const id = String(payload.id || '').trim();
    if (!id) return { success: false, error: 'Missing project id' };
    const existing = helpers.queryOne(`SELECT * FROM research_projects WHERE id = ?`, [id]);
    if (!existing) return { success: false, error: 'Project not found' };
    const next = normalizeProjectRow(existing);
    if (payload.name !== undefined) next.name = String(payload.name || '').trim() || next.name;
    if (payload.description !== undefined) next.description = String(payload.description || '').trim();
    if (payload.permanent_instructions !== undefined) {
      next.permanent_instructions = String(payload.permanent_instructions || '').trim();
    }
    if (payload.schema !== undefined) next.schema = normalizeSchema(payload.schema || DEFAULT_STARTER_SCHEMA);
    if (payload.source_policy !== undefined) next.source_policy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, payload.source_policy || {});
    helpers.run(
      `UPDATE research_projects
       SET name = ?, description = ?, permanent_instructions = ?, schema_json = ?, source_policy_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.name,
        next.description,
        next.permanent_instructions,
        safeStringify(next.schema, '[]'),
        safeStringify(next.source_policy),
        nowIso(),
        id,
      ]
    );
    return { success: true };
  });

  ipcMain.handle('research:project:delete', async (_, { id } = {}) => {
    if (!id) return { success: false, error: 'Missing project id' };
    const runRows = helpers.query(`SELECT id FROM research_runs WHERE project_id = ?`, [id]);
    const runIds = runRows.map((row) => row.id);
    for (const runId of runIds) {
      helpers.run(`DELETE FROM research_tasks WHERE run_id = ?`, [runId]);
      helpers.run(`DELETE FROM research_checkpoints WHERE run_id = ?`, [runId]);
    }
    const recordRows = helpers.query(`SELECT id FROM research_records WHERE project_id = ?`, [id]);
    for (const row of recordRows) {
      helpers.run(`DELETE FROM research_evidence WHERE record_id = ?`, [row.id]);
    }
    helpers.run(`DELETE FROM research_records WHERE project_id = ?`, [id]);
    helpers.run(`DELETE FROM research_runs WHERE project_id = ?`, [id]);
    helpers.run(`DELETE FROM research_project_conversations WHERE project_id = ?`, [id]);
    helpers.run(`DELETE FROM research_project_documents WHERE project_id = ?`, [id]);
    helpers.run(`DELETE FROM research_projects WHERE id = ?`, [id]);
    return { success: true };
  });

  ipcMain.handle('research:project:linkConversation', async (_, { projectId, conversationId } = {}) => {
    if (!projectId || !conversationId) return { success: false, error: 'Missing identifiers' };
    helpers.run(
      `INSERT OR IGNORE INTO research_project_conversations (project_id, conversation_id, linked_at)
       VALUES (?, ?, ?)`,
      [projectId, conversationId, nowIso()]
    );
    return { success: true };
  });

  ipcMain.handle('research:project:unlinkConversation', async (_, { projectId, conversationId } = {}) => {
    if (!projectId || !conversationId) return { success: false, error: 'Missing identifiers' };
    helpers.run(
      `DELETE FROM research_project_conversations WHERE project_id = ? AND conversation_id = ?`,
      [projectId, conversationId]
    );
    return { success: true };
  });

  ipcMain.handle('research:project:listConversations', async (_, { projectId, workspace } = {}) => {
    if (!projectId) return { linked: [], available: [] };
    const linkedRows = helpers.query(
      `SELECT c.*
       FROM research_project_conversations rpc
       JOIN conversations c ON c.id = rpc.conversation_id
       WHERE rpc.project_id = ?
       ORDER BY c.updated_at DESC`,
      [projectId]
    );
    const linkedSet = new Set(linkedRows.map((row) => row.id));
    const availableRows = workspace
      ? helpers.query(`SELECT * FROM conversations WHERE workspace = ? ORDER BY updated_at DESC LIMIT 500`, [workspace])
      : helpers.query(`SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 500`);
    return {
      linked: linkedRows,
      available: availableRows.map((row) => ({ ...row, linked: linkedSet.has(row.id) })),
    };
  });

  ipcMain.handle('research:project:linkDocument', async (_, { projectId, documentId } = {}) => {
    if (!projectId || !documentId) return { success: false, error: 'Missing identifiers' };
    helpers.run(
      `INSERT OR IGNORE INTO research_project_documents (project_id, document_id, linked_at)
       VALUES (?, ?, ?)`,
      [projectId, documentId, nowIso()]
    );
    return { success: true };
  });

  ipcMain.handle('research:project:unlinkDocument', async (_, { projectId, documentId } = {}) => {
    if (!projectId || !documentId) return { success: false, error: 'Missing identifiers' };
    helpers.run(
      `DELETE FROM research_project_documents WHERE project_id = ? AND document_id = ?`,
      [projectId, documentId]
    );
    return { success: true };
  });

  ipcMain.handle('research:project:listDocuments', async (_, { projectId, workspace } = {}) => {
    if (!projectId) return { linked: [], available: [] };
    const linkedRows = helpers.query(
      `SELECT d.*
       FROM research_project_documents rpd
       JOIN documents d ON d.id = rpd.document_id
       WHERE rpd.project_id = ?
       ORDER BY d.created_at DESC`,
      [projectId]
    );
    const linkedSet = new Set(linkedRows.map((row) => row.id));
    const availableRows = workspace
      ? helpers.query(`SELECT * FROM documents WHERE workspace = ? ORDER BY created_at DESC`, [workspace])
      : helpers.query(`SELECT * FROM documents ORDER BY created_at DESC`);
    return {
      linked: linkedRows,
      available: availableRows.map((row) => ({ ...row, linked: linkedSet.has(row.id) })),
    };
  });

  ipcMain.handle('research:run:start', async (_, payload = {}) => {
    const projectId = String(payload.projectId || '').trim();
    const objective = String(payload.objective || '').trim();
    if (!projectId || !objective) return { success: false, error: 'Missing project or objective' };
    const projectRow = helpers.queryOne(`SELECT * FROM research_projects WHERE id = ?`, [projectId]);
    if (!projectRow) return { success: false, error: 'Project not found' };
    const project = normalizeProjectRow(projectRow);
    const runId = uuidv4();
    const workerCount = Math.max(1, Number(payload.workerCount || 4));
    const runInstructions = String(payload.runInstructions || '').trim();
    const researchSettings = payload?.researchSettings && typeof payload.researchSettings === 'object'
      ? payload.researchSettings
      : {};
    const context = buildProjectContext(helpers, project);
    const promptSnapshot = {
      objective,
      permanentInstructions: project.permanent_instructions || '',
      runInstructions,
      researchSettings,
      schema: project.schema,
      sourcePolicy: project.source_policy,
      conversationDigest: context.conversationDigest,
      documentDigest: context.documentDigest,
      linkedConversations: context.linkedConversations,
      linkedDocuments: context.linkedDocuments,
      createdAt: nowIso(),
    };

    helpers.run(
      `INSERT INTO research_runs
        (id, project_id, status, objective, run_instructions, worker_count, stats_json, convergence_count, prompt_snapshot_json, created_at, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        projectId,
        'running',
        objective,
        runInstructions,
        workerCount,
        safeStringify(buildStatsSkeleton()),
        0,
        safeStringify(promptSnapshot),
        nowIso(),
        nowIso(),
        nowIso(),
      ]
    );

    const snapshot = await engine.startRun({
      projectId,
      objective,
      runInstructions,
      workerCount,
      schema: project.schema,
      sourcePolicy: project.source_policy,
      researchSettings,
      promptSnapshot,
      existingRunId: runId,
    });
    return { success: true, run: snapshot };
  });

  ipcMain.handle('research:run:pause', async (_, { runId } = {}) => {
    if (!runId) return { success: false, error: 'Missing run id' };
    const snapshot = engine.pauseRun(runId);
    if (snapshot) {
      helpers.run(`UPDATE research_runs SET status = ?, updated_at = ? WHERE id = ?`, ['paused', nowIso(), runId]);
      return { success: true, run: snapshot };
    }
    helpers.run(`UPDATE research_runs SET status = ?, updated_at = ? WHERE id = ?`, ['paused', nowIso(), runId]);
    return { success: true, run: engine.getRun(runId) };
  });

  ipcMain.handle('research:run:resume', async (_, { runId } = {}) => {
    if (!runId) return { success: false, error: 'Missing run id' };
    const runRow = helpers.queryOne(`SELECT * FROM research_runs WHERE id = ?`, [runId]);
    if (!runRow) return { success: false, error: 'Run not found' };
    const projectRow = helpers.queryOne(`SELECT * FROM research_projects WHERE id = ?`, [runRow.project_id]);
    if (!projectRow) return { success: false, error: 'Project not found' };
    const project = normalizeProjectRow(projectRow);
    const promptSnapshot = safeParseJson(runRow.prompt_snapshot_json, {});
    const context = buildProjectContext(helpers, project);
    const mergedSnapshot = {
      ...promptSnapshot,
      conversationDigest: promptSnapshot.conversationDigest || context.conversationDigest,
      documentDigest: promptSnapshot.documentDigest || context.documentDigest,
      linkedConversations: promptSnapshot.linkedConversations || context.linkedConversations,
      linkedDocuments: promptSnapshot.linkedDocuments || context.linkedDocuments,
      researchSettings: promptSnapshot.researchSettings || {},
    };
    const snapshot = await engine.resumeRun({
      runId,
      projectId: runRow.project_id,
      objective: runRow.objective,
      runInstructions: runRow.run_instructions || '',
      workerCount: Number(runRow.worker_count || 4),
      schema: project.schema,
      sourcePolicy: project.source_policy,
      researchSettings: mergedSnapshot.researchSettings || {},
      promptSnapshot: mergedSnapshot,
    });
    return { success: true, run: snapshot };
  });

  ipcMain.handle('research:run:cancel', async (_, { runId } = {}) => {
    if (!runId) return { success: false, error: 'Missing run id' };
    const snapshot = await engine.cancelRun(runId);
    if (!snapshot) {
      helpers.run(`UPDATE research_runs SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?`, ['cancelled', nowIso(), nowIso(), runId]);
    }
    return { success: true, run: snapshot || engine.getRun(runId) };
  });

  ipcMain.handle('research:run:steer', async (_, { runId, instruction } = {}) => {
    if (!runId) return { success: false, error: 'Missing run id' };
    const steeringText = String(instruction || '').trim();
    if (!steeringText) return { success: false, error: 'Missing steering instruction' };
    const result = engine.steerRun(runId, steeringText);
    if (!result?.success) return { success: false, error: result?.error || 'Failed to steer run' };
    return {
      success: true,
      run: result.run,
      queuedQueries: Number(result.queuedQueries || 0),
    };
  });

  ipcMain.handle('research:run:get', async (_, { runId } = {}) => {
    if (!runId) return null;
    return engine.getRun(runId);
  });

  ipcMain.handle('research:run:list', async (_, { projectId, limit } = {}) => {
    return engine.listRuns(projectId, limit || 100);
  });

  ipcMain.handle('research:records:list', async (_, { projectId, runId, limit } = {}) => {
    if (!projectId) return [];
    const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500)));
    const rows = runId
      ? helpers.query(
        `SELECT r.*,
                (SELECT COUNT(*) FROM research_evidence e WHERE e.record_id = r.id) AS evidence_count
         FROM research_records r
         WHERE r.project_id = ? AND r.run_id = ?
         ORDER BY r.verified_at DESC, r.created_at DESC
         LIMIT ?`,
        [projectId, runId, safeLimit]
      )
      : helpers.query(
        `SELECT r.*,
                (SELECT COUNT(*) FROM research_evidence e WHERE e.record_id = r.id) AS evidence_count
         FROM research_records r
         WHERE r.project_id = ?
         ORDER BY r.verified_at DESC, r.created_at DESC
         LIMIT ?`,
        [projectId, safeLimit]
      );
    return rows.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      run_id: row.run_id,
      canonical_key: row.canonical_key,
      record: safeParseJson(row.record_json, {}),
      verified_official_url: row.verified_official_url,
      verified_at: row.verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      evidence_count: Number(row.evidence_count || 0),
    }));
  });

  ipcMain.handle('research:records:get', async (_, { recordId } = {}) => {
    if (!recordId) return null;
    const row = helpers.queryOne(`SELECT * FROM research_records WHERE id = ?`, [recordId]);
    if (!row) return null;
    const evidence = helpers.query(
      `SELECT * FROM research_evidence WHERE record_id = ? ORDER BY fetched_at DESC`,
      [recordId]
    ).map((item) => ({
      ...item,
      is_official: Number(item.is_official || 0) === 1,
    }));
    return {
      id: row.id,
      project_id: row.project_id,
      run_id: row.run_id,
      canonical_key: row.canonical_key,
      record: safeParseJson(row.record_json, {}),
      verified_official_url: row.verified_official_url,
      verified_at: row.verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      evidence,
    };
  });

  ipcMain.handle('research:records:export', async (_, { projectId, format = 'json', targetPath } = {}) => {
    if (!projectId) return { success: false, error: 'Missing project id' };
    const projectRow = helpers.queryOne(`SELECT * FROM research_projects WHERE id = ?`, [projectId]);
    if (!projectRow) return { success: false, error: 'Project not found' };
    const project = normalizeProjectRow(projectRow);
    const records = helpers.query(
      `SELECT * FROM research_records WHERE project_id = ? ORDER BY verified_at DESC, created_at DESC`,
      [projectId]
    );
    const evidenceRows = helpers.query(
      `SELECT e.*, r.canonical_key
       FROM research_evidence e
       JOIN research_records r ON r.id = e.record_id
       WHERE r.project_id = ?
       ORDER BY e.fetched_at DESC`,
      [projectId]
    ).map((item) => ({ ...item, is_official: Number(item.is_official || 0) === 1 }));
    const runRows = helpers.query(
      `SELECT id, status, objective, stats_json, created_at, ended_at
       FROM research_runs
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [projectId]
    );
    const runSummary = runRows.map((row) => ({
      id: row.id,
      status: row.status,
      objective: row.objective,
      created_at: row.created_at,
      ended_at: row.ended_at,
      stats: safeParseJson(row.stats_json, {}),
    }));
    const runTotals = runSummary.reduce((acc, run) => {
      const stats = run.stats || {};
      acc.discovered += Number(stats.discoveredCandidates || 0);
      acc.verified += Number(stats.verifiedSaved || 0);
      acc.rejected += Number(stats.rejectedNonOfficial || 0);
      acc.blocked += Number(stats.rejectedBlocked || 0);
      acc.irrelevant += Number(stats.rejectedIrrelevant || 0);
      return acc;
    }, { discovered: 0, verified: 0, rejected: 0, blocked: 0, irrelevant: 0 });

    let finalPath = targetPath;
    const rawFormat = String(format || 'json').toLowerCase();
    const normalizedFormat = rawFormat === 'csv' ? 'csv' : rawFormat === 'md' ? 'md' : 'json';
    if (!finalPath) {
      const defaultName = `${project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'research_records'}_${Date.now()}.${normalizedFormat}`;
      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Research Records',
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: normalizedFormat === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : normalizedFormat === 'md'
            ? [{ name: 'Markdown', extensions: ['md'] }]
            : [{ name: 'JSON', extensions: ['json'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }
      finalPath = saveResult.filePath;
    }

    if (normalizedFormat === 'json') {
      const payload = {
        project,
        schema: project.schema,
        exported_at: nowIso(),
        summary: {
          records: records.length,
          evidence: evidenceRows.length,
        },
        run_summary: {
          totals: runTotals,
          runs: runSummary,
        },
        records: records.map((row) => ({
          id: row.id,
          run_id: row.run_id,
          canonical_key: row.canonical_key,
          record: safeParseJson(row.record_json, {}),
          verified_official_url: row.verified_official_url,
          verified_at: row.verified_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          evidence: evidenceRows.filter((item) => item.record_id === row.id),
        })),
      };
      fs.writeFileSync(finalPath, JSON.stringify(payload, null, 2), 'utf8');
      return { success: true, filePath: finalPath, count: records.length, format: 'json' };
    }

    if (normalizedFormat === 'md') {
      const markdown = buildMarkdownExport({
        project,
        records,
        evidenceRows,
        runSummary,
        runTotals,
      });
      fs.writeFileSync(finalPath, markdown, 'utf8');
      return { success: true, filePath: finalPath, count: records.length, format: 'md' };
    }

    const schemaKeys = normalizeSchema(project.schema).map((field) => field.key);
    const recordRows = records.map((row) => {
      const record = safeParseJson(row.record_json, {});
      const base = {
        record_id: row.id,
        run_id: row.run_id,
        canonical_key: row.canonical_key,
        verified_official_url: row.verified_official_url,
        verified_at: row.verified_at,
      };
      for (const key of schemaKeys) {
        const value = record[key];
        base[key] = Array.isArray(value) ? value.join('; ') : value ?? '';
      }
      return base;
    });
    const recordColumns = ['record_id', 'run_id', 'canonical_key', 'verified_official_url', 'verified_at', ...schemaKeys];
    const evidenceColumns = ['record_id', 'field_key', 'claim_text', 'source_url', 'source_domain', 'source_title', 'is_official', 'fetched_at'];
    const evidenceTable = evidenceRows.map((item) => ({
      record_id: item.record_id,
      field_key: item.field_key,
      claim_text: item.claim_text,
      source_url: item.source_url,
      source_domain: item.source_domain,
      source_title: item.source_title,
      is_official: item.is_official ? 'true' : 'false',
      fetched_at: item.fetched_at,
    }));
    const csv = [
      '# Run Summary',
      buildCsv([
        { metric: 'discovered', value: runTotals.discovered },
        { metric: 'verified', value: runTotals.verified },
        { metric: 'rejected_non_official', value: runTotals.rejected },
        { metric: 'blocked', value: runTotals.blocked },
      ], ['metric', 'value']),
      '',
      '# Records',
      buildCsv(recordRows, recordColumns),
      '',
      '# Evidence',
      buildCsv(evidenceTable, evidenceColumns),
    ].join('\n');
    fs.writeFileSync(finalPath, csv, 'utf8');
    return { success: true, filePath: finalPath, count: records.length, format: 'csv' };
  });
}

module.exports = {
  setupResearchHandlers,
};
