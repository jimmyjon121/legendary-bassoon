/**
 * Model Experience Workbench
 *
 * Local-only profile inspection, eval, history, and winner-save flow for Chat V2.
 * This intentionally uses the current Autopilot resolver and inference
 * orchestrator paths so Workbench results reflect real chat behavior.
 */

const crypto = require('crypto');
const modelExperienceResolver = require('./model-experience-resolver');

const PROFILE_DEFS = [
  { id: 'auto', label: 'Auto', taskIntent: 'auto', description: 'Current Autopilot defaults.' },
  { id: 'code', label: 'Code', taskIntent: 'code', description: 'Precise coding defaults.' },
  { id: 'reasoning', label: 'Reasoning', taskIntent: 'reasoning', description: 'Longer output and steadier reasoning.' },
  { id: 'creative', label: 'Creative', taskIntent: 'creative', description: 'Higher diversity for drafting.' },
  { id: 'research', label: 'Research', taskIntent: 'research', description: 'Lower temperature synthesis.' },
  {
    id: 'fast',
    label: 'Fast',
    taskIntent: 'chat',
    description: 'Lower context and output cap for responsiveness.',
    advancedOverrides: { num_ctx: 4096, num_predict: 512, num_batch: 192, temperature: 0.45 },
  },
  {
    id: 'long-context',
    label: 'Long Context',
    taskIntent: 'reasoning',
    description: 'Larger context budget with conservative batching.',
    advancedOverrides: { num_ctx: 32768, num_predict: 768, num_batch: 96, temperature: 0.45 },
  },
  {
    id: 'low-vram',
    label: 'Low VRAM',
    taskIntent: 'chat',
    description: 'Lower memory pressure for large or tight-fit models.',
    advancedOverrides: { num_ctx: 4096, num_predict: 512, num_batch: 64, kv_cache_type: 'q4_0', temperature: 0.5 },
  },
  { id: 'current-preset', label: 'Current Preset', taskIntent: 'auto', description: 'Stored preset for this model/workspace.' },
];

const PROFILE_IDS = new Set(PROFILE_DEFS.map((profile) => profile.id));
const DEFAULT_TASKS = [
  {
    id: 'chat',
    intent: 'chat',
    label: 'Chat',
    prompt: 'Give a concise, useful answer: what makes a local AI assistant feel reliable?',
  },
  {
    id: 'code',
    intent: 'code',
    label: 'Code',
    prompt: 'Write a JavaScript function that groups an array of objects by a key. Include a tiny example.',
  },
  {
    id: 'reasoning',
    intent: 'reasoning',
    label: 'Reasoning',
    prompt: 'A laptop battery drains 18% in 45 minutes under load. Estimate runtime from 100% and show the calculation.',
  },
  {
    id: 'creative',
    intent: 'creative',
    label: 'Creative',
    prompt: 'Write a vivid but compact paragraph describing a quiet workshop where machines are learning to help.',
  },
  {
    id: 'research',
    intent: 'research',
    label: 'Research',
    prompt: 'Synthesize three practical tradeoffs between speed, quality, and memory when running local LLMs. No web required.',
  },
];

const EVAL_LIMITS = {
  num_ctx: 32768,
  num_predict: 768,
  safeNumCtx: 4096,
  safeNumPredict: 96,
  safeNumBatch: 64,
  safeProfileCount: 1,
  safeTaskCount: 1,
  timeoutMs: 90_000,
  suiteTimeoutMs: 20 * 60_000,
  outputPreviewChars: 900,
};

function makeId(prefix) {
  const suffix = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex');
  return `${prefix}-${suffix}`;
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

function sqlString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function sanitizeModel(value) {
  return sqlString(value).slice(0, 1024);
}

function sanitizeWorkspace(value) {
  return sqlString(value || 'casual').slice(0, 64) || 'casual';
}

function estimateTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}

function inferParamBillionsFromModel(model = '') {
  const text = String(model || '');
  const match = text.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isLocalGgufModel(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  return normalized.startsWith('gguf:') || normalized.includes('.gguf');
}

function isLargeLocalModel(model = '') {
  if (!isLocalGgufModel(model)) return false;
  const billions = inferParamBillionsFromModel(model);
  if (billions && billions >= 14) return true;
  return /(?:24b|30b|32b|33b|34b|70b|72b|104b)/i.test(String(model || ''));
}

function buildEvalPolicy({ model, fullSuite = false, riskAccepted = false, selectedIds = [], promptOverride = '' } = {}) {
  const largeLocalModel = isLargeLocalModel(model);
  const safeMode = largeLocalModel && !riskAccepted;
  const blockReason = largeLocalModel
    ? 'Large local GGUF live Workbench eval is blocked in-app until isolated runner containment is available.'
    : '';
  const warnings = [];
  if (largeLocalModel) {
    warnings.push('large-local-gguf-detected');
    warnings.push('in-process-live-eval-blocked');
  }
  if (safeMode) {
    warnings.push('preflight-only: plan/profile inspection is available without generation');
  }
  if (blockReason) {
    warnings.push(blockReason);
  }

  const preferredSafeProfile = selectedIds.includes('low-vram') ? 'low-vram' : (selectedIds[0] || 'low-vram');
  return {
    largeLocalModel,
    safeMode,
    blocked: Boolean(blockReason),
    blockReason,
    isolationRequired: largeLocalModel,
    fullSuite: Boolean(fullSuite),
    riskAccepted: Boolean(riskAccepted),
    profileIds: safeMode ? [preferredSafeProfile] : selectedIds,
    taskLimit: safeMode && !promptOverride ? EVAL_LIMITS.safeTaskCount : DEFAULT_TASKS.length,
    warnings,
  };
}

function clampEvalOptions(options = {}, policy = {}) {
  const sanitized = modelExperienceResolver.sanitizeAdvancedOptions(options);
  const next = { ...options, ...sanitized };
  const maxPredict = policy.safeMode ? EVAL_LIMITS.safeNumPredict : EVAL_LIMITS.num_predict;
  const maxContext = policy.safeMode ? EVAL_LIMITS.safeNumCtx : EVAL_LIMITS.num_ctx;
  const maxBatch = policy.safeMode ? EVAL_LIMITS.safeNumBatch : 512;
  next.num_predict = Math.min(maxPredict, Math.max(16, Number(next.num_predict) || 512));
  next.num_ctx = Math.min(maxContext, Math.max(512, Number(next.num_ctx) || 4096));
  if (Number.isFinite(Number(next.num_batch))) {
    next.num_batch = Math.min(maxBatch, Math.max(16, Number(next.num_batch)));
  } else if (policy.safeMode) {
    next.num_batch = EVAL_LIMITS.safeNumBatch;
  }
  delete next.forceBackend;
  delete next.experiencePlan;
  delete next.softBackendPreference;
  return next;
}

function scoreQuality(task, text) {
  const raw = String(text || '').trim();
  if (!raw) return { score: 0, label: 'empty', reasons: ['empty-output'] };
  const lower = raw.toLowerCase();
  const reasons = ['non-empty'];
  let score = 0.35;
  if (raw.length >= 160) { score += 0.15; reasons.push('substantive'); }
  if (raw.length <= 3000) { score += 0.1; reasons.push('bounded'); }
  if (task.id === 'code' && /\b(function|const|let|def|return)\b/.test(lower)) { score += 0.2; reasons.push('code-shape'); }
  if (task.id === 'reasoning' && /\d/.test(raw) && /\b(estimate|runtime|calculation|because|therefore|=)\b/i.test(raw)) { score += 0.2; reasons.push('reasoning-shape'); }
  if (task.id === 'research' && /\b(tradeoff|speed|quality|memory)\b/i.test(raw)) { score += 0.2; reasons.push('synthesis-shape'); }
  if (task.id === 'creative' && raw.split(/\s+/).length >= 35) { score += 0.15; reasons.push('creative-depth'); }
  if (task.id === 'chat' && raw.split(/\s+/).length <= 180) { score += 0.1; reasons.push('concise'); }
  const normalized = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  return {
    score: normalized,
    label: normalized >= 0.75 ? 'strong' : (normalized >= 0.5 ? 'usable' : 'weak'),
    reasons,
  };
}

function memoryWarningFromRuntime(runtimeState = null) {
  const memoryPct = Number(runtimeState?.deviceUtilization?.memory?.usagePercent ?? runtimeState?.memory?.usagePercent ?? 0);
  const gpus = Array.isArray(runtimeState?.deviceUtilization?.gpus) ? runtimeState.deviceUtilization.gpus : [];
  const topVram = Math.max(0, ...gpus.map((gpu) => Number(gpu?.vramPercent || 0)));
  if (topVram >= 92) return `High VRAM pressure (${Math.round(topVram)}%)`;
  if (memoryPct >= 92) return `High RAM pressure (${Math.round(memoryPct)}%)`;
  return '';
}

function summarizeResults(results = []) {
  const byProfile = new Map();
  for (const row of results) {
    const bucket = byProfile.get(row.profileId) || [];
    bucket.push(row);
    byProfile.set(row.profileId, bucket);
  }
  const profiles = Array.from(byProfile.entries()).map(([profileId, rows]) => {
    const successes = rows.filter((row) => row.success);
    const avg = (key) => successes.length
      ? successes.reduce((sum, row) => sum + (Number(row.metrics?.[key]) || 0), 0) / successes.length
      : 0;
    const avgQuality = successes.length
      ? successes.reduce((sum, row) => sum + (Number(row.quality?.score) || 0), 0) / successes.length
      : 0;
    return {
      profileId,
      total: rows.length,
      successCount: successes.length,
      failureCount: rows.length - successes.length,
      successRate: rows.length ? successes.length / rows.length : 0,
      avgTokensPerSecond: Number(avg('tokensPerSecond').toFixed(2)),
      avgFirstTokenMs: Math.round(avg('firstTokenMs')),
      avgQuality: Number(avgQuality.toFixed(3)),
    };
  });

  const recommendation = profiles
    .filter((row) => row.successCount > 0)
    .sort((a, b) => {
      const scoreA = (a.successRate * 1000) + (a.avgQuality * 120) + (a.avgTokensPerSecond * 2) - ((a.avgFirstTokenMs || 0) / 250);
      const scoreB = (b.successRate * 1000) + (b.avgQuality * 120) + (b.avgTokensPerSecond * 2) - ((b.avgFirstTokenMs || 0) / 250);
      return scoreB - scoreA;
    })[0] || null;

  return {
    profiles,
    recommendation: recommendation
      ? {
        profileId: recommendation.profileId,
        reason: 'Best balanced local result by success rate, quality, speed, and first-token latency.',
        metrics: recommendation,
      }
      : null,
  };
}

function createModelExperienceWorkbench({
  getDb,
  saveDatabase,
  getOrchestrator,
  getActivePreset,
  savePreset,
  emitProgress,
} = {}) {
  const activeRuns = new Map();
  const runCache = new Map();

  function db() {
    return typeof getDb === 'function' ? getDb() : null;
  }

  function ensureTables() {
    const database = db();
    if (!database) return;
    database.run(`
      CREATE TABLE IF NOT EXISTS model_workbench_runs (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        workspace TEXT,
        status TEXT,
        profile_ids TEXT,
        summary TEXT,
        recommendation TEXT,
        warnings TEXT,
        created_at TEXT,
        completed_at TEXT
      )
    `);
    database.run(`
      CREATE TABLE IF NOT EXISTS model_workbench_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        model TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        task_intent TEXT,
        backend TEXT,
        backend_source TEXT,
        options_json TEXT,
        prompt_id TEXT,
        ttft_ms INTEGER,
        tokens_per_second REAL,
        elapsed_ms INTEGER,
        success INTEGER,
        fallback_used INTEGER,
        memory_warning TEXT,
        quality_score REAL,
        quality_label TEXT,
        error TEXT,
        output_preview TEXT,
        created_at TEXT
      )
    `);
    database.run('CREATE INDEX IF NOT EXISTS idx_workbench_runs_model ON model_workbench_runs(model, created_at)');
    database.run('CREATE INDEX IF NOT EXISTS idx_workbench_results_run ON model_workbench_results(run_id)');
  }

  function getRuntimeState() {
    try {
      return getOrchestrator?.()?.getRuntimeState?.() || null;
    } catch {
      return null;
    }
  }

  function buildPlan({ model, workspace, profileDef, prompt = '', modelInfo = null, controls = {} }) {
    const runtimeState = getRuntimeState();
    const preset = profileDef.id === 'current-preset'
      ? getActivePreset?.(model, workspace)
      : null;
    const session = {
      tuningMode: profileDef.id === 'auto' ? 'auto' : 'advanced',
      taskIntent: profileDef.taskIntent || 'auto',
      advancedOverrides: modelExperienceResolver.sanitizeAdvancedOptions(profileDef.advancedOverrides || {}),
      backendOverride: null,
      contextLengthTokens: null,
    };
    const resolved = modelExperienceResolver.resolveModelExperiencePlan({
      model,
      workspace,
      prompt,
      modelInfo,
      preset,
      runtimeState,
      performanceProfile: runtimeState?.profile || 'balanced',
      session,
      controls,
    });
    const plan = resolved?.plan || null;
    return {
      id: profileDef.id,
      label: profileDef.label,
      description: profileDef.description,
      selected: ['auto', 'fast', 'low-vram'].includes(profileDef.id),
      plan,
      warnings: resolved?.warnings || [],
      reasons: resolved?.reasons || [],
      savedEligible: Boolean(plan?.effectiveOptions),
    };
  }

  function buildProfiles(payload = {}) {
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    if (!model) return { success: false, error: 'Model is required', profiles: [] };
    const prompt = sqlString(payload.prompt || '');
    const controls = payload.controls && typeof payload.controls === 'object' ? payload.controls : {};
    const profiles = PROFILE_DEFS.map((profileDef) => buildPlan({
      model,
      workspace,
      profileDef,
      prompt,
      modelInfo: payload.modelInfo || null,
      controls,
    }));
    const inferredIntent = profiles.find((profile) => profile.id === 'auto')?.plan?.taskIntent || 'chat';
    const inferred = profiles.find((profile) => profile.id === inferredIntent);
    if (inferred) inferred.selected = true;
    return { success: true, model, workspace, profiles };
  }

  function getHistory(payload = {}) {
    ensureTables();
    const database = db();
    const model = sanitizeModel(payload.model);
    const limit = Math.max(1, Math.min(50, Number(payload.limit) || 10));
    if (!database || !model) return [];
    const rows = database.exec(
      `SELECT id, model, workspace, status, summary, recommendation, warnings, created_at, completed_at
       FROM model_workbench_runs WHERE model = ? ORDER BY created_at DESC LIMIT ?`,
      [model, limit],
    );
    if (!rows.length) return [];
    return rows[0].values.map(([id, rowModel, workspace, status, summary, recommendation, warnings, createdAt, completedAt]) => ({
      id,
      model: rowModel,
      workspace,
      status,
      summary: parseJson(summary, {}),
      recommendation: parseJson(recommendation, null),
      warnings: parseJson(warnings, []),
      createdAt,
      completedAt,
    }));
  }

  function getSnapshot(payload = {}) {
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    const profilesResult = buildProfiles(payload);
    const history = getHistory({ model, limit: 10 });
    const latestRecommendation = history.find((row) => row.recommendation)?.recommendation || null;
    return {
      success: Boolean(model),
      model,
      workspace,
      runtimeState: getRuntimeState(),
      profiles: profilesResult.profiles || [],
      history,
      recommendation: latestRecommendation,
      warnings: profilesResult.success ? [] : [profilesResult.error || 'Workbench unavailable'],
    };
  }

  function insertRun(run) {
    const database = db();
    if (!database) return;
    database.run(
      `INSERT INTO model_workbench_runs (id, model, workspace, status, profile_ids, summary, recommendation, warnings, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.runId,
        run.model,
        run.workspace,
        run.status,
        JSON.stringify(run.profileIds || []),
        JSON.stringify(run.summary || {}),
        JSON.stringify(run.recommendation || null),
        JSON.stringify(run.warnings || []),
        run.createdAt,
        run.completedAt || null,
      ],
    );
    saveDatabase?.();
  }

  function updateRun(run) {
    const database = db();
    if (!database) return;
    database.run(
      `UPDATE model_workbench_runs SET status = ?, summary = ?, recommendation = ?, warnings = ?, completed_at = ? WHERE id = ?`,
      [
        run.status,
        JSON.stringify(run.summary || {}),
        JSON.stringify(run.recommendation || null),
        JSON.stringify(run.warnings || []),
        run.completedAt || null,
        run.runId,
      ],
    );
    saveDatabase?.();
  }

  function insertResult(run, result) {
    const database = db();
    if (!database) return;
    database.run(
      `INSERT INTO model_workbench_results
       (id, run_id, model, profile_id, task_intent, backend, backend_source, options_json, prompt_id, ttft_ms,
        tokens_per_second, elapsed_ms, success, fallback_used, memory_warning, quality_score, quality_label, error, output_preview, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        makeId('wbr'),
        run.runId,
        run.model,
        result.profileId,
        result.plan?.taskIntent || result.taskIntent || null,
        result.backendTrace?.backend || null,
        result.backendTrace?.source || null,
        JSON.stringify(result.plan?.effectiveOptions || {}),
        result.task?.id || null,
        result.metrics?.firstTokenMs || null,
        result.metrics?.tokensPerSecond || null,
        result.metrics?.elapsedMs || null,
        result.success ? 1 : 0,
        result.backendTrace?.fallbackUsed ? 1 : 0,
        result.memoryWarning || '',
        result.quality?.score ?? null,
        result.quality?.label || null,
        result.error || null,
        result.outputPreview || '',
        result.createdAt,
      ],
    );
    saveDatabase?.();
  }

  function emit(runId, payload) {
    try {
      emitProgress?.({ runId, ...payload });
    } catch {
      // non-blocking
    }
  }

  async function runOne({ run, profile, task, policy = {} }) {
    const orchestrator = getOrchestrator?.();
    if (!orchestrator?.generate) throw new Error('Orchestrator unavailable');
    const plan = profile.plan || {};
    const options = clampEvalOptions(plan.effectiveOptions || {}, policy);
    const runtimeBefore = getRuntimeState();
    const started = Date.now();
    const request = {
      model: run.model,
      prompt: task.prompt,
      system: plan.systemPrompt || '',
      options,
      lane: 'lane_maintenance',
      workloadType: 'model-workbench-eval',
      allowFallback: true,
      preferNativeChat: true,
      priority: 5,
      ...(plan.explicitBackendPin ? { forceBackend: plan.explicitBackendPin } : {}),
      ...(plan.softBackendPreference ? { softBackendPreference: plan.softBackendPreference } : {}),
      experiencePlan: {
        ...plan,
        effectiveOptions: options,
        source: 'model-experience-workbench',
        evalPolicy: {
          safeMode: Boolean(policy.safeMode),
          largeLocalModel: Boolean(policy.largeLocalModel),
        },
      },
    };

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Workbench eval turn timed out')), EVAL_LIMITS.timeoutMs);
    });
    const response = await Promise.race([orchestrator.generate(request), timeout]);
    const elapsedMs = Date.now() - started;
    const runtimeAfter = getRuntimeState();
    const text = String(response?.response || response?.message?.content || response?.content || '').trim();
    const providerStats = response?.meta?.providerStats || response?.providerStats || null;
    const evalCount = Number(providerStats?.eval_count);
    const evalDuration = Number(providerStats?.eval_duration);
    const tokens = Number.isFinite(evalCount) && evalCount > 0 ? evalCount : estimateTokens(text);
    const tokensPerSecond = Number.isFinite(evalDuration) && evalDuration > 0
      ? Number((evalCount / (evalDuration / 1e9)).toFixed(2))
      : Number((tokens / Math.max(0.001, elapsedMs / 1000)).toFixed(2));
    const firstTokenMs = Number(response?.meta?.firstTokenMs || response?.firstTokenMs || elapsedMs);
    const activeBackend = runtimeAfter?.currentBackend?.id || runtimeBefore?.currentBackend?.id || null;
    return {
      profileId: profile.id,
      task,
      plan,
      success: Boolean(text),
      metrics: { firstTokenMs: Math.round(firstTokenMs), tokensPerSecond, elapsedMs, outputTokens: tokens },
      quality: scoreQuality(task, text),
      failures: text ? [] : ['empty-output'],
      backendTrace: {
        backend: activeBackend,
        source: runtimeAfter?.backendDecisionSource || runtimeAfter?.lastBackendDecision?.selectionSource || 'auto',
        fallbackUsed: Boolean(runtimeAfter?.lastExecutionMode === 'fallback_model' || response?.meta?.fallbackUsed),
      },
      memoryWarning: memoryWarningFromRuntime(runtimeAfter),
      outputPreview: text.slice(0, EVAL_LIMITS.outputPreviewChars),
      savedEligible: true,
      createdAt: new Date().toISOString(),
    };
  }

  async function runEval(payload = {}) {
    ensureTables();
    const model = sanitizeModel(payload.model);
    const workspace = sanitizeWorkspace(payload.workspace);
    if (!model) return { success: false, error: 'Model is required' };
    const fullSuite = payload.fullSuite === true;
    const riskAccepted = payload.riskAccepted === true;
    const profileIds = Array.isArray(payload.profileIds)
      ? payload.profileIds.filter((id) => PROFILE_IDS.has(id)).slice(0, PROFILE_DEFS.length)
      : [];
    const selectedIds = profileIds.length ? profileIds : ['auto', 'fast', 'low-vram'];
    const promptOverride = sqlString(payload.promptOverride || '');
    const policy = buildEvalPolicy({ model, fullSuite, riskAccepted, selectedIds, promptOverride });
    if (policy.blocked) {
      return {
        success: false,
        status: 'blocked',
        blocked: true,
        error: policy.blockReason,
        warnings: policy.warnings,
        policy,
      };
    }
    const profiles = buildProfiles({ ...payload, model, workspace }).profiles
      .filter((profile) => policy.profileIds.includes(profile.id) && profile.plan?.effectiveOptions)
      .slice(0, policy.safeMode ? EVAL_LIMITS.safeProfileCount : PROFILE_DEFS.length);
    const baseTasks = promptOverride
      ? [{ id: 'custom', intent: 'chat', label: 'Custom', prompt: promptOverride.slice(0, 4000) }]
      : DEFAULT_TASKS;
    const tasks = policy.safeMode ? baseTasks.slice(0, policy.taskLimit) : baseTasks;
    const run = {
      runId: makeId('mwb'),
      status: 'running',
      model,
      workspace,
      profileIds: profiles.map((profile) => profile.id),
      profiles,
      tasks,
      results: [],
      summary: {},
      recommendation: null,
      warnings: [...policy.warnings],
      policy,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    activeRuns.set(run.runId, { cancelled: false, cleanupIntent: 'unload-or-refresh-after-eval' });
    runCache.set(run.runId, run);
    insertRun(run);
    emit(run.runId, {
      status: 'started',
      total: profiles.length * tasks.length,
      safeMode: Boolean(policy.safeMode),
      largeLocalModel: Boolean(policy.largeLocalModel),
    });

    const suiteStarted = Date.now();
    try {
      for (const profile of profiles) {
        for (const task of tasks) {
          const active = activeRuns.get(run.runId);
          if (active?.cancelled) throw new Error('Workbench eval cancelled');
          if (Date.now() - suiteStarted > EVAL_LIMITS.suiteTimeoutMs) throw new Error('Workbench eval suite timed out');
          emit(run.runId, { status: 'running', profileId: profile.id, taskId: task.id, completed: run.results.length });
          try {
            const result = await runOne({ run, profile, task, policy });
            run.results.push(result);
            insertResult(run, result);
          } catch (error) {
            const failed = {
              profileId: profile.id,
              task,
              plan: profile.plan,
              success: false,
              metrics: { firstTokenMs: null, tokensPerSecond: null, elapsedMs: 0, outputTokens: 0 },
              quality: { score: null, label: 'unscored', reasons: ['generation-failed'] },
              failures: [error?.message || 'generation failed'],
              backendTrace: { backend: getRuntimeState()?.currentBackend?.id || null, source: 'error', fallbackUsed: false },
              memoryWarning: memoryWarningFromRuntime(getRuntimeState()),
              error: error?.message || String(error),
              outputPreview: '',
              savedEligible: false,
              createdAt: new Date().toISOString(),
            };
            run.results.push(failed);
            insertResult(run, failed);
          }
        }
      }
      const summary = summarizeResults(run.results);
      run.summary = {
        profiles: summary.profiles,
        taskCount: tasks.length,
        profileCount: profiles.length,
        safeMode: Boolean(policy.safeMode),
        largeLocalModel: Boolean(policy.largeLocalModel),
      };
      run.recommendation = summary.recommendation;
      run.status = 'completed';
    } catch (error) {
      run.status = /cancelled/i.test(String(error?.message || '')) ? 'cancelled' : 'failed';
      run.warnings.push(error?.message || String(error));
      const summary = summarizeResults(run.results);
      run.summary = {
        profiles: summary.profiles,
        taskCount: tasks.length,
        profileCount: profiles.length,
        safeMode: Boolean(policy.safeMode),
        largeLocalModel: Boolean(policy.largeLocalModel),
      };
      run.recommendation = summary.recommendation;
    } finally {
      const active = activeRuns.get(run.runId);
      if (active?.cleanupIntent) run.warnings.push(`cleanup:${active.cleanupIntent}`);
      activeRuns.delete(run.runId);
      run.completedAt = new Date().toISOString();
      updateRun(run);
      emit(run.runId, { status: run.status, completed: run.results.length, recommendation: run.recommendation });
    }

    return { success: run.status === 'completed', ...run };
  }

  function cancelEval(payload = {}) {
    const runId = sqlString(payload.runId);
    const active = activeRuns.get(runId);
    if (!active) return { success: false, error: 'Run is not active' };
    active.cancelled = true;
    active.cleanupIntent = 'cancel-requested-cleanup';
    emit(runId, { status: 'cancel_requested' });
    return { success: true, runId };
  }

  function findProfileFromRun(runId, profileId) {
    const cached = runCache.get(runId);
    if (cached?.profiles) return cached.profiles.find((profile) => profile.id === profileId) || null;
    return null;
  }

  function saveWinner(payload = {}) {
    const runId = sqlString(payload.runId);
    const profileId = sqlString(payload.profileId);
    const target = payload.target === 'session' ? 'session' : 'preset';
    const profile = findProfileFromRun(runId, profileId);
    if (!profile?.plan) return { success: false, error: 'Profile result not found' };
    const plan = profile.plan;
    const options = modelExperienceResolver.sanitizeAdvancedOptions(plan.effectiveOptions || {});
    const session = {
      taskIntent: plan.taskIntent || 'auto',
      advancedOverrides: options,
      contextLengthTokens: Number.isFinite(Number(options.num_ctx)) ? Number(options.num_ctx) : null,
      backendOverride: null,
    };
    if (target === 'session') {
      return { success: true, target, profileId, session };
    }
    const presetPayload = {
      model_name: plan.model,
      workspace: plan.workspace,
      is_default: true,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 0.9,
      top_k: options.top_k ?? 40,
      context_length: options.num_ctx ?? null,
      system_prompt: plan.systemPrompt || '',
      task_intent: plan.taskIntent || 'auto',
      advanced_options: options,
      device_pin: plan.explicitBackendPin || null,
    };
    const saved = savePreset?.(presetPayload) || { success: false, error: 'Preset save unavailable' };
    return { ...saved, target, profileId, preset: presetPayload };
  }

  return {
    ensureTables,
    getSnapshot,
    buildProfiles,
    runEval,
    cancelEval,
    getHistory,
    saveWinner,
    PROFILE_DEFS,
    DEFAULT_TASKS,
  };
}

module.exports = {
  createModelExperienceWorkbench,
  PROFILE_DEFS,
  DEFAULT_TASKS,
};
