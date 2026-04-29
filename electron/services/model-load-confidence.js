/**
 * Model Load Confidence
 *
 * Local-only pre-generation readiness checks for Chat V2. This service is
 * advisory except for true blocked states such as no model, missing GGUF file,
 * or no usable backend.
 */

const fs = require('fs');
const path = require('path');

const CHECK_IDS = new Set([
  'model',
  'file',
  'metadata',
  'backend',
  'context',
  'memory',
  'preset',
  'safe_fit',
  'warmup',
  'last_good',
]);

const TIMELINE_EVENT_TYPES = new Set([
  'model_selected',
  'autopilot_plan',
  'backend_selected',
  'last_good_found',
  'last_good_applied',
  'safe_fit_applied',
  'warmup_started',
  'warmup_succeeded',
  'warmup_failed',
  'model_unloaded',
  'generation_started',
  'generation_succeeded',
  'generation_failed',
  'fallback_selected',
  'backend_unavailable',
  'note',
]);

const TIMELINE_STATUSES = new Set(['info', 'success', 'warning', 'failed', 'blocked']);

function nowIso() {
  return new Date().toISOString();
}

function sqlString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function sanitizeModel(value) {
  return sqlString(value).slice(0, 1024);
}

function sanitizeWorkspace(value) {
  return sqlString(value || 'casual').slice(0, 64) || 'casual';
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isLocalGguf(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  return normalized.startsWith('gguf:') || normalized.includes('.gguf');
}

function ggufPath(model = '') {
  if (!isLocalGguf(model)) return '';
  return String(model || '').replace(/^gguf:/i, '').trim();
}

function inferParamBillions(text = '') {
  const match = String(text || '').match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inferQuantization(text = '') {
  const match = String(text || '').match(/\b(q[2-8]_[a-z0-9_]+|f16|fp16|q8|q6|q5|q4)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizeCheck(id, status, label, detail = '', action = null) {
  const safeId = CHECK_IDS.has(id) ? id : 'metadata';
  return {
    id: safeId,
    status: ['ok', 'check', 'blocked'].includes(status) ? status : 'check',
    label,
    detail,
    ...(action ? { action } : {}),
  };
}

function worstStatus(checks = []) {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked';
  if (checks.some((check) => check.status === 'check')) return 'check';
  return 'ready';
}

function scoreFor(checks = []) {
  let score = 100;
  for (const check of checks) {
    if (check.status === 'blocked') score -= 35;
    if (check.status === 'check') score -= 12;
  }
  return Math.max(0, Math.min(100, score));
}

function isSafeFitActive({ advancedOverrides = {}, contextLengthTokens = null, effectiveOptions = {} } = {}) {
  const ctx = Number(advancedOverrides?.num_ctx || contextLengthTokens || effectiveOptions?.num_ctx || 0);
  const batch = Number(advancedOverrides?.num_batch || effectiveOptions?.num_batch || 0);
  const kv = String(advancedOverrides?.kv_cache_type || effectiveOptions?.kv_cache_type || '').toLowerCase();
  return ctx > 0 && ctx <= 4096 && batch > 0 && batch <= 96 && (kv === 'q4_0' || kv === 'q4_1');
}

function runtimeBackend(runtimeState = {}) {
  return runtimeState?.currentBackend?.id || runtimeState?.currentBackend?.name || runtimeState?.currentBackend || null;
}

function sanitizeBackend(value) {
  return sqlString(value).slice(0, 80) || null;
}

function sanitizeTimelineOptions(options = {}) {
  if (!options || typeof options !== 'object') return {};
  const allowed = {};
  for (const key of ['num_ctx', 'num_batch', 'num_predict', 'kv_cache_type', 'flash_attn', 'softBackendPreference']) {
    if (options[key] === undefined || options[key] === null || options[key] === '') continue;
    if (['num_ctx', 'num_batch', 'num_predict'].includes(key)) {
      const numeric = Number(options[key]);
      if (Number.isFinite(numeric) && numeric >= 0) allowed[key] = Math.round(numeric);
    } else if (key === 'flash_attn') {
      allowed.flash_attn = Boolean(options.flash_attn);
    } else {
      allowed[key] = sqlString(options[key]).slice(0, 80);
    }
  }
  return allowed;
}

function memoryWarning(runtimeState = {}) {
  const gpus = Array.isArray(runtimeState?.deviceUtilization?.gpus) ? runtimeState.deviceUtilization.gpus : [];
  const topVram = Math.max(0, ...gpus.map((gpu) => Number(gpu?.vramPercent || 0)));
  const ram = Number(runtimeState?.deviceUtilization?.memory?.usagePercent || runtimeState?.memory?.usagePercent || 0);
  if (topVram >= 92) return `High VRAM pressure (${Math.round(topVram)}%)`;
  if (ram >= 92) return `High RAM pressure (${Math.round(ram)}%)`;
  return '';
}

function createModelLoadConfidence({ getDb, saveDatabase } = {}) {
  function db() {
    return typeof getDb === 'function' ? getDb() : null;
  }

  function ensureTables() {
    const database = db();
    if (!database) return;
    database.run(`
      CREATE TABLE IF NOT EXISTS model_load_outcomes (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        workspace TEXT,
        outcome TEXT,
        source TEXT,
        backend TEXT,
        context INTEGER,
        batch INTEGER,
        kv_cache_type TEXT,
        num_predict INTEGER,
        first_token_ms INTEGER,
        tokens_per_second REAL,
        error TEXT,
        options_json TEXT,
        created_at TEXT
      )
    `);
    database.run('CREATE INDEX IF NOT EXISTS idx_model_load_outcomes_model ON model_load_outcomes(model, workspace, outcome, created_at)');
    database.run(`
      CREATE TABLE IF NOT EXISTS model_backend_decisions (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        workspace TEXT,
        event_type TEXT,
        backend TEXT,
        status TEXT,
        reason TEXT,
        options_json TEXT,
        created_at TEXT
      )
    `);
    database.run('CREATE INDEX IF NOT EXISTS idx_model_backend_decisions_model ON model_backend_decisions(model, workspace, created_at)');
  }

  function recordLoadOutcome(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    if (!database || !model) return { success: false, error: 'Model is required' };
    const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
    const id = `mlc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const outcome = payload.success === false || payload.outcome === 'failed' ? 'failed' : 'success';
    database.run(
      `INSERT INTO model_load_outcomes
       (id, model, workspace, outcome, source, backend, context, batch, kv_cache_type, num_predict,
        first_token_ms, tokens_per_second, error, options_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        model,
        workspace,
        outcome,
        sqlString(payload.source || 'unknown').slice(0, 64),
        sqlString(payload.backend || payload.backendId || '').slice(0, 80) || null,
        Number.isFinite(Number(payload.context || options.num_ctx)) ? Math.round(Number(payload.context || options.num_ctx)) : null,
        Number.isFinite(Number(payload.batch || options.num_batch)) ? Math.round(Number(payload.batch || options.num_batch)) : null,
        sqlString(payload.kvCacheType || options.kv_cache_type || '').slice(0, 40) || null,
        Number.isFinite(Number(payload.numPredict || options.num_predict)) ? Math.round(Number(payload.numPredict || options.num_predict)) : null,
        Number.isFinite(Number(payload.firstTokenMs)) ? Math.round(Number(payload.firstTokenMs)) : null,
        Number.isFinite(Number(payload.tokensPerSecond)) ? Number(payload.tokensPerSecond) : null,
        outcome === 'failed' ? sqlString(payload.error || 'unknown failure').slice(0, 500) : null,
        JSON.stringify(options || {}),
        nowIso(),
      ],
    );
    saveDatabase?.();
    return { success: true, id, outcome };
  }

  function recordBackendDecision(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    if (!database || !model) return { success: false, error: 'Model is required' };

    const eventType = TIMELINE_EVENT_TYPES.has(payload.eventType) ? payload.eventType : 'note';
    const status = TIMELINE_STATUSES.has(payload.status) ? payload.status : 'info';
    const id = `mbd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    database.run(
      `INSERT INTO model_backend_decisions
       (id, model, workspace, event_type, backend, status, reason, options_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        model,
        workspace,
        eventType,
        sanitizeBackend(payload.backend || payload.backendId),
        status,
        sqlString(payload.reason || '').slice(0, 500),
        JSON.stringify(sanitizeTimelineOptions(payload.options || {})),
        nowIso(),
      ],
    );
    saveDatabase?.();
    return { success: true, id, eventType, status };
  }

  function getBackendDecisionTimeline(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    const limit = Math.max(1, Math.min(50, Number(payload.limit || 12)));
    if (!database || !model) return [];
    const rows = database.exec(
      `SELECT id, model, workspace, event_type, backend, status, reason, options_json, created_at
       FROM model_backend_decisions
       WHERE model = ? AND (workspace IS NULL OR workspace = '' OR workspace = ?)
       ORDER BY created_at DESC LIMIT ${limit}`,
      [model, workspace],
    );
    return (rows?.[0]?.values || []).map((row) => ({
      id: row[0],
      model: row[1],
      workspace: row[2],
      eventType: row[3],
      backend: row[4],
      status: row[5],
      reason: row[6],
      options: parseJson(row[7], {}),
      createdAt: row[8],
    }));
  }

  function getLastKnownGood(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    if (!database || !model) return null;
    const rows = database.exec(
      `SELECT id, model, workspace, source, backend, context, batch, kv_cache_type, num_predict,
              first_token_ms, tokens_per_second, options_json, created_at
       FROM model_load_outcomes
       WHERE model = ? AND (workspace IS NULL OR workspace = '' OR workspace = ?) AND outcome = 'success'
       ORDER BY created_at DESC LIMIT 1`,
      [model, workspace],
    );
    if (!rows.length || !rows[0].values.length) return null;
    const [
      id,
      rowModel,
      rowWorkspace,
      source,
      backend,
      context,
      batch,
      kvCacheType,
      numPredict,
      firstTokenMs,
      tokensPerSecond,
      optionsJson,
      createdAt,
    ] = rows[0].values[0];
    return {
      id,
      model: rowModel,
      workspace: rowWorkspace,
      source,
      backend,
      context,
      batch,
      kvCacheType,
      numPredict,
      firstTokenMs,
      tokensPerSecond,
      options: parseJson(optionsJson, {}),
      createdAt,
    };
  }

  function getBackendFailureMemory(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    const limit = Math.max(1, Math.min(50, Number(payload.limit || 16)));
    if (!database || !model) return [];
    const rows = database.exec(
      `SELECT backend, error, created_at
       FROM model_load_outcomes
       WHERE model = ? AND (workspace IS NULL OR workspace = '' OR workspace = ?) AND outcome = 'failed'
       ORDER BY created_at DESC LIMIT ${limit}`,
      [model, workspace],
    );
    const counts = new Map();
    for (const [backend, error, createdAt] of rows?.[0]?.values || []) {
      const key = sanitizeBackend(backend) || 'unknown';
      const current = counts.get(key) || { backend: key, failureCount: 0, lastFailureAt: null, lastError: '' };
      current.failureCount += 1;
      if (!current.lastFailureAt) current.lastFailureAt = createdAt;
      if (!current.lastError && error) current.lastError = sqlString(error).slice(0, 240);
      counts.set(key, current);
    }
    return Array.from(counts.values()).filter((entry) => entry.failureCount >= 2);
  }

  function getOutcomeSummary(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    const limit = Math.max(1, Math.min(50, Number(payload.limit || 12)));
    if (!database || !model) {
      return {
        successCount: 0,
        failureCount: 0,
        avgTokensPerSecond: null,
        avgFirstTokenMs: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
    }
    const rows = database.exec(
      `SELECT outcome, first_token_ms, tokens_per_second, created_at
       FROM model_load_outcomes
       WHERE model = ? AND (workspace IS NULL OR workspace = '' OR workspace = ?)
       ORDER BY created_at DESC LIMIT ${limit}`,
      [model, workspace],
    );
    const values = rows?.[0]?.values || [];
    let successCount = 0;
    let failureCount = 0;
    let tpsTotal = 0;
    let tpsCount = 0;
    let ttftTotal = 0;
    let ttftCount = 0;
    let lastSuccessAt = null;
    let lastFailureAt = null;
    for (const [outcome, firstTokenMs, tokensPerSecond, createdAt] of values) {
      if (outcome === 'success') {
        successCount += 1;
        if (!lastSuccessAt) lastSuccessAt = createdAt;
      } else {
        failureCount += 1;
        if (!lastFailureAt) lastFailureAt = createdAt;
      }
      if (Number.isFinite(Number(tokensPerSecond))) {
        tpsTotal += Number(tokensPerSecond);
        tpsCount += 1;
      }
      if (Number.isFinite(Number(firstTokenMs))) {
        ttftTotal += Number(firstTokenMs);
        ttftCount += 1;
      }
    }
    return {
      successCount,
      failureCount,
      avgTokensPerSecond: tpsCount > 0 ? tpsTotal / tpsCount : null,
      avgFirstTokenMs: ttftCount > 0 ? ttftTotal / ttftCount : null,
      lastSuccessAt,
      lastFailureAt,
    };
  }

  function resolveLoadConfidence(payload = {}) {
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    const runtimeState = payload.runtimeState && typeof payload.runtimeState === 'object' ? payload.runtimeState : {};
    const modelInfo = payload.modelInfo && typeof payload.modelInfo === 'object' ? payload.modelInfo : {};
    const experiencePlan = payload.experiencePlan && typeof payload.experiencePlan === 'object' ? payload.experiencePlan : {};
    const activePreset = payload.activePreset && typeof payload.activePreset === 'object' ? payload.activePreset : null;
    const advancedOverrides = payload.advancedOverrides && typeof payload.advancedOverrides === 'object' ? payload.advancedOverrides : {};
    const effectiveOptions = payload.effectiveOptions && typeof payload.effectiveOptions === 'object'
      ? payload.effectiveOptions
      : (experiencePlan.effectiveOptions || {});
    const contextLengthTokens = Number.isFinite(Number(payload.contextLengthTokens)) ? Number(payload.contextLengthTokens) : null;
    const warmupResult = payload.warmupResult && typeof payload.warmupResult === 'object' ? payload.warmupResult : null;
    const lastKnownGood = payload.lastKnownGood && typeof payload.lastKnownGood === 'object'
      ? payload.lastKnownGood
      : getLastKnownGood({ model, workspace });
    const timeline = getBackendDecisionTimeline({ model, workspace, limit: 8 });
    const failureMemory = getBackendFailureMemory({ model, workspace, limit: 16 });
    const checks = [];
    const warnings = [];
    const suggestedActions = [];

    if (!model) {
      checks.push(normalizeCheck('model', 'blocked', 'Model', 'No model selected.', 'select_model'));
      return {
        success: true,
        status: 'blocked',
        score: scoreFor(checks),
        checks,
        warnings: ['No model selected.'],
        suggestedActions: ['select_model'],
        localGguf: { isLocalGguf: false },
        lastKnownGood: null,
        timeline: [],
        failureMemory: [],
      };
    }

    checks.push(normalizeCheck('model', 'ok', 'Model', model));

    const localPath = ggufPath(model);
    const localGguf = {
      isLocalGguf: Boolean(localPath),
      path: localPath || null,
      exists: localPath ? fs.existsSync(localPath) : null,
      basename: localPath ? path.basename(localPath) : null,
      paramBillions: inferParamBillions([model, modelInfo.parameterSize, modelInfo.name].filter(Boolean).join(' ')),
      quantization: inferQuantization([model, modelInfo.quantizationLevel, modelInfo.name].filter(Boolean).join(' ')),
    };

    if (localGguf.isLocalGguf) {
      checks.push(normalizeCheck(
        'file',
        localGguf.exists ? 'ok' : 'blocked',
        'GGUF file',
        localGguf.exists ? localGguf.path : 'Local GGUF file was not found.',
        localGguf.exists ? null : 'select_model',
      ));
      if (!localGguf.exists) {
        warnings.push('Local GGUF file is missing.');
        suggestedActions.push('select_model');
      }
    } else {
      checks.push(normalizeCheck('file', 'ok', 'File', 'Managed model or remote-local runtime.'));
    }

    const hasMetadata = Boolean(
      modelInfo.contextLength
      || modelInfo.effectiveContextLength
      || modelInfo.rawContextLength
      || modelInfo.parameterSize
      || localGguf.paramBillions
      || localGguf.quantization,
    );
    checks.push(normalizeCheck(
      'metadata',
      hasMetadata ? 'ok' : 'check',
      'Metadata',
      hasMetadata
        ? [
          localGguf.paramBillions ? `${localGguf.paramBillions}B` : null,
          localGguf.quantization,
          modelInfo.contextLength ? `ctx ${Number(modelInfo.contextLength).toLocaleString()}` : null,
        ].filter(Boolean).join(' / ') || 'Metadata available'
        : 'Metadata unavailable; using estimated defaults.',
    ));
    if (!hasMetadata) warnings.push('Model metadata is estimated.');

    const backend = runtimeBackend(runtimeState);
    checks.push(normalizeCheck(
      'backend',
      backend ? 'ok' : 'blocked',
      'Backend',
      backend ? `${backend} selected` : 'No usable backend is selected.',
      backend ? null : 'refresh_runtime',
    ));
    if (!backend) {
      warnings.push('Backend is not ready.');
      suggestedActions.push('refresh_runtime');
    }

    const contextCap = Number(modelInfo.contextLength || modelInfo.effectiveContextLength || modelInfo.rawContextLength || 0);
    const activeContext = Number(contextLengthTokens || advancedOverrides.num_ctx || effectiveOptions.num_ctx || 0);
    const contextBlocked = contextCap > 0 && activeContext > contextCap;
    checks.push(normalizeCheck(
      'context',
      contextBlocked ? 'check' : 'ok',
      'Context',
      [
        activeContext > 0 ? `active ${activeContext.toLocaleString()}` : 'auto',
        contextCap > 0 ? `cap ${contextCap.toLocaleString()}` : 'cap estimated',
      ].join(' / '),
      contextBlocked ? 'apply_safe_fit' : null,
    ));
    if (contextBlocked) {
      warnings.push('Requested context exceeds model cap and will clamp.');
      suggestedActions.push('apply_safe_fit');
    }

    const mem = memoryWarning(runtimeState);
    checks.push(normalizeCheck('memory', mem ? 'check' : 'ok', 'Memory', mem || 'No high memory pressure detected.', mem ? 'apply_safe_fit' : null));
    if (mem) {
      warnings.push(mem);
      suggestedActions.push('apply_safe_fit');
    }

    const safeFitActive = isSafeFitActive({ advancedOverrides, contextLengthTokens, effectiveOptions });
    const largeGguf = localGguf.isLocalGguf && (
      Number(localGguf.paramBillions || 0) >= 14
      || /(?:24b|30b|32b|33b|34b|70b|72b|104b)/i.test(model)
    );
    const riskyBatch = Number(advancedOverrides.num_batch || effectiveOptions.num_batch || 0) > 96;
    const riskyContext = Number(activeContext || 0) > 4096;
    const shouldSuggestSafeFit = largeGguf && !safeFitActive && (riskyBatch || riskyContext);
    checks.push(normalizeCheck(
      'safe_fit',
      shouldSuggestSafeFit ? 'check' : 'ok',
      'Safe Fit',
      safeFitActive ? 'Safe Fit is active.' : (largeGguf ? 'Large GGUF detected.' : 'Standard fit.'),
      shouldSuggestSafeFit ? 'apply_safe_fit' : null,
    ));
    if (shouldSuggestSafeFit) {
      warnings.push('Large local GGUF may be more stable with Safe Fit tuning.');
      suggestedActions.push('apply_safe_fit');
    }

    checks.push(normalizeCheck(
      'preset',
      'ok',
      'Preset',
      activePreset ? 'Model preset is active.' : 'No saved model preset.',
    ));

    const warmupStatus = warmupResult?.status || (warmupResult?.success ? 'loaded' : null);
    checks.push(normalizeCheck(
      'warmup',
      warmupStatus === 'failed' ? 'check' : 'ok',
      'Warmup',
      warmupStatus ? `Last warmup: ${warmupStatus}` : 'No warmup result yet.',
      warmupStatus === 'failed' ? 'reload' : 'warm',
    ));
    if (warmupStatus === 'failed') {
      warnings.push(warmupResult?.error || 'Last warmup failed.');
      suggestedActions.push('reload');
    }

    if (failureMemory.length > 0) {
      for (const failure of failureMemory.slice(0, 2)) {
        warnings.push(`${failure.backend} has failed ${failure.failureCount} recent times for this model.`);
      }
      suggestedActions.push('apply_safe_fit');
      suggestedActions.push('auto_fallback');
    }

    checks.push(normalizeCheck(
      'last_good',
      lastKnownGood ? 'ok' : 'check',
      'Last Good',
      lastKnownGood
        ? `${lastKnownGood.backend || 'auto'} / ctx ${lastKnownGood.context || 'auto'} / ${lastKnownGood.createdAt || 'recent'}`
        : 'No successful local load profile recorded yet.',
    ));

    const status = worstStatus(checks);
    return {
      success: true,
      status,
      score: scoreFor(checks),
      checks,
      warnings: Array.from(new Set(warnings)),
      suggestedActions: Array.from(new Set(suggestedActions)),
      localGguf,
      lastKnownGood,
      timeline,
      failureMemory,
    };
  }

  return {
    ensureTables,
    resolveLoadConfidence,
    recordLoadOutcome,
    recordBackendDecision,
    getLastKnownGood,
    getOutcomeSummary,
    getBackendDecisionTimeline,
    getBackendFailureMemory,
  };
}

module.exports = {
  createModelLoadConfidence,
  CHECK_IDS,
  TIMELINE_EVENT_TYPES,
};
