import { safetyProtocol } from './safetyProtocol';
import { useAppStore } from '../../stores/appStore';
import { useAgentStore } from '../../stores/agentStore';
import { useEditorStore } from '../../stores/editorStore';
import agentService from '../agentService';
import { getCodeIndexSummary } from '../codeIndexer';
import { createToolEnabledLLM } from '../toolEnabledLLM';
import { safeCall } from '../../utils/electronAPI';

/**
 * AgentOrchestrator - The "Manager" of the Autonomous Team
 * 
 * Coordinates the multi-agent loop:
 * 1. Product Owner (defines requirements)
 * 2. Architect (plans structure)
 * 3. Engineer (writes code)
 * 4. QA (tests and reviews)
 */

const AGENT_PERSONAS = {
  PRODUCT_OWNER: {
    id: 'po',
    name: 'Product Owner',
    role: 'Requirements & Scope',
    color: 'text-blue-400',
    systemPrompt: "You are a strict Product Owner. Your job is to define clear, testable requirements. Reject ambiguity.",
  },
  ARCHITECT: {
    id: 'architect',
    name: 'System Architect',
    role: 'Structure & Design',
    color: 'text-purple-400',
    systemPrompt: "You are a Senior Architect. Plan the file structure and data flow. Focus on scalability and patterns.",
  },
  ENGINEER: {
    id: 'engineer',
    name: 'Senior Engineer',
    role: 'Implementation',
    color: 'text-green-400',
    systemPrompt: "You are a Senior Engineer. Write clean, efficient code. Follow the Architect's plan exactly.",
  },
  QA: {
    id: 'qa',
    name: 'QA Lead',
    role: 'Testing & Review',
    color: 'text-red-400',
    systemPrompt: "You are a QA Lead. Find bugs, security flaws, and logic errors. Be critical.",
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizePath(input = '') {
  return String(input || '').replace(/\\/g, '/');
}

function truncateText(input = '', maxLen = 1200) {
  const text = String(input || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function isSyntheticModelSelection(model = '') {
  return String(model || '').trim().toLowerCase().startsWith('npu:');
}

function unwrapToolPayload(result, fallbackError = 'Tool not available') {
  if (!result) {
    return { ok: false, error: fallbackError };
  }
  if (result.ok === false || result.success === false) {
    return {
      ok: false,
      error: result.error || fallbackError,
      details: result.details || null,
      code: result.code || null,
    };
  }
  if (result.ok === true && result.data && typeof result.data === 'object') {
    return { ok: true, ...result.data };
  }
  return { ok: true, ...result };
}

function isBroadBuildTask(task = '') {
  const t = String(task || '').toLowerCase();
  if (!t) return false;
  return (
    /build|create|make|ship|launch|develop/.test(t) &&
    /app|platform|tool|studio|assistant|ide/.test(t)
  ) || /like .* but better|clone|vibe coding/.test(t);
}

function extractReferenceProducts(task = '') {
  const text = String(task || '');
  const refs = new Set();

  const likeMatches = text.matchAll(/\blike\s+([a-z0-9][a-z0-9 .:_-]{1,60})/gi);
  for (const match of likeMatches) {
    const value = String(match?.[1] || '').trim().replace(/[.,;!?]+$/, '');
    if (value && value.length >= 2) refs.add(value);
  }

  return Array.from(refs).slice(0, 3);
}

function toModelName(model) {
  if (!model) return '';
  if (typeof model === 'string') return model;
  if (typeof model?.name === 'string') return model.name;
  if (typeof model?.id === 'string') return model.id;
  return String(model);
}

function normalizePatchOperation(operation, patch = {}) {
  const raw = String(operation || '').trim().toLowerCase();
  if (!raw) {
    return patch?.newPath ? 'rename' : 'update';
  }

  if (['create', 'new', 'mk', 'touch', 'create_file'].includes(raw)) {
    return 'create';
  }
  if (['update', 'edit', 'modify', 'change', 'replace', 'patch', 'overwrite', 'update_file'].includes(raw)) {
    return 'update';
  }
  if (['delete', 'remove', 'rm', 'del', 'delete_file'].includes(raw)) {
    return 'delete';
  }
  if (['rename', 'move', 'mv', 'rename_file', 'move_file'].includes(raw)) {
    return 'rename';
  }
  if (['add', 'insert', 'append'].includes(raw)) {
    return 'add';
  }

  return patch?.newPath ? 'rename' : 'update';
}

class AgentOrchestrator {
  constructor() {
    this.isActive = false;
    this.task = null;
    this.discussion = []; // The chat log of the agents
    this.currentPhase = 'idle'; // idle, planning, implementing, reviewing
    this.subscribers = new Set();
    this.loopInterval = null;
    this.activeLLM = null;
    this.currentRunId = null;
    this._lastProgressPushAt = 0;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    this.subscribers.forEach(callback => callback({
      isActive: this.isActive,
      task: this.task,
      discussion: [...this.discussion],
      phase: this.currentPhase,
      activeAgent: this.getActiveAgentForPhase(),
    }));
  }

  _buildRunProgressSnapshot(extra = {}) {
    const agentStore = useAgentStore.getState();
    const run = agentStore?.runProgress || {};
    const plan = agentStore?.plan?.steps || [];
    const progressPct = run.totalPasses > 0
      ? Math.min(100, Math.round(((run.completedPasses || 0) / run.totalPasses) * 100))
      : 0;

    return {
      runId: this.currentRunId,
      status: this.isActive ? (agentStore.isPaused ? 'paused' : 'running') : 'idle',
      phase: this.currentPhase,
      task: this.task || '',
      progressPct,
      pass: Number(run.pass || 0),
      totalPasses: Number(run.totalPasses || 0),
      completedPasses: Number(run.completedPasses || 0),
      label: run.label || '',
      mode: run.mode || 'single',
      currentStep: Number(agentStore.currentStep || 0),
      planSteps: plan.map((step) => ({
        id: step.id,
        title: step.title,
        owner: step.owner || null,
        status: step.status || 'pending',
      })),
      pendingReviewChanges: Array.isArray(agentStore.proposedChanges)
        ? agentStore.proposedChanges.length
        : 0,
      filesTouchedCount: Array.isArray(agentStore.filesTouched)
        ? agentStore.filesTouched.length
        : 0,
      logCount: Array.isArray(agentStore.log) ? agentStore.log.length : 0,
      updatedAt: Date.now(),
      ...extra,
    };
  }

  async pushRunProgress(extra = {}, force = false) {
    const now = Date.now();
    if (!force && (now - this._lastProgressPushAt) < 150) {
      return;
    }
    this._lastProgressPushAt = now;
    const snapshot = this._buildRunProgressSnapshot(extra);
    await safeCall('agentUpdateRunProgress', [snapshot], null);
  }

  getActiveAgentForPhase() {
    switch (this.currentPhase) {
      case 'planning': return AGENT_PERSONAS.ARCHITECT;
      case 'implementing': return AGENT_PERSONAS.ENGINEER;
      case 'reviewing': return AGENT_PERSONAS.QA;
      case 'defining': return AGENT_PERSONAS.PRODUCT_OWNER;
      default: return null;
    }
  }

  async resolveOllamaEndpoint() {
    const configured = await safeCall('getSettings', ['llmEndpoint'], 'http://127.0.0.1:11434');
    return configured || 'http://127.0.0.1:11434';
  }

  async fetchInstalledModels() {
    const endpoint = await this.resolveOllamaEndpoint();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
      if (!response.ok) return [];
      const data = await response.json();
      const names = Array.isArray(data?.models)
        ? data.models.map((item) => String(item?.name || '').trim()).filter(Boolean)
        : [];
      return [...new Set(names)];
    } catch (_error) {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  resolveModelAlias(inputModel, installedModels = []) {
    const requested = String(inputModel || '').trim();
    if (!requested) return '';
    if (!installedModels.length) return requested;

    const lower = requested.toLowerCase();
    const exact = installedModels.find((name) => name.toLowerCase() === lower);
    if (exact) return exact;

    const prefixed = installedModels.find((name) => name.toLowerCase().startsWith(`${lower}:`));
    if (prefixed) return prefixed;

    return requested;
  }

  async probeToolSupport(modelName) {
    return this.probeToolSupportWithTimeout(modelName, 30000);
  }

  async probeToolSupportWithTimeout(modelName, timeoutMs = 30000) {
    const endpoint = await this.resolveOllamaEndpoint();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const probePayload = {
      model: modelName,
      messages: [
        {
          role: 'user',
          content:
            'Tool support check. You MUST call the list_directory tool with path ".". Do not answer in plain text.',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'list_directory',
            description: 'List files in a directory',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' }
              }
            }
          }
        }
      ],
      stream: false,
      options: {
        num_predict: 80,
        temperature: 0
      }
    };

    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(probePayload),
        signal: controller.signal
      });

      if (response.ok) {
        let parsed = null;
        try {
          parsed = await response.json();
        } catch {
          parsed = null;
        }

        const toolCalls = Array.isArray(parsed?.message?.tool_calls)
          ? parsed.message.tool_calls
          : [];

        if (toolCalls.length > 0) {
          return { supported: true, reason: 'ok' };
        }

        const contentPreview = String(parsed?.message?.content || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 120);
        return {
          supported: false,
          reason: contentPreview
            ? `probe_no_tool_calls (${contentPreview})`
            : 'probe_no_tool_calls'
        };
      }

      let details = '';
      try {
        const parsed = await response.json();
        details = parsed?.error || JSON.stringify(parsed);
      } catch {
        details = await response.text();
      }
      return {
        supported: false,
        reason: details || `${response.status} ${response.statusText}`
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { supported: false, reason: 'probe_timeout' };
      }
      return { supported: false, reason: error?.message || 'probe_failed' };
    } finally {
      clearTimeout(timeout);
    }
  }

  isProbeInconclusive(reason = '') {
    const text = String(reason || '').toLowerCase();
    return (
      text.includes('probe_timeout') ||
      text.includes('probe_failed') ||
      text.includes('network') ||
      text.includes('econn') ||
      text.includes('timed out')
    );
  }

  isHardToolRejection(reason = '') {
    const text = String(reason || '').toLowerCase();
    return (
      text.includes('does not support tools') ||
      text.includes('unsupported tools') ||
      text.includes('tool is not supported') ||
      text.includes('tool_calls') && text.includes('invalid')
    );
  }

  async warmupModelForProbe(modelName) {
    try {
      await safeCall('warmupModel', [modelName], null);
      return true;
    } catch {
      return false;
    }
  }

  rankToolCandidateModels(installedModels = [], requestedModel = '') {
    if (!installedModels.length) return [];
    const requestedLower = String(requestedModel || '').toLowerCase();

    const preferredPatterns = [
      /^llama3\.2:3b$/i,
      /^llama3\.2:1b$/i,
      /^llama3\.1/i,
      /^qwen2\.5/i,
      /^qwen/i,
      /^mistral/i,
      /^phi3/i,
      /^codellama/i
    ];

    const excludedPatterns = [/deepseek-coder/i, /gpt-oss/i];
    const unique = [...new Set(installedModels)].filter(Boolean);
    const bucket = [];
    const seen = new Set();

    const push = (model) => {
      const key = String(model || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      bucket.push(model);
    };

    for (const pattern of preferredPatterns) {
      const hit = unique.find((model) => pattern.test(model));
      if (hit) push(hit);
    }

    for (const model of unique) {
      const lower = model.toLowerCase();
      if (lower === requestedLower) continue;
      if (excludedPatterns.some((pattern) => pattern.test(model))) continue;
      push(model);
    }

    return bucket;
  }

  createExecutionLLM(modelName, projectRoot, agentStore, options = {}) {
    return createToolEnabledLLM({
      model: modelName,
      projectRoot,
      maxIterations: 12,
      maxToolSteps: 32,
      networkPolicy: 'offline',
      autoRollbackOnFailure: true,
      defaultTextToolMode: Boolean(options.forceTextToolMode),
      onToolCall: (toolCall) => {
        const name = toolCall?.function?.name || 'tool';
        agentStore.addLog(`Tool call: ${name}`);
      },
      onToolResult: (toolCall, result) => {
        this.handleToolResult(toolCall, result);
      },
      onThinking: (status) => {
        agentStore.addLog(`Thinking: ${status}`);
      },
    });
  }

  async resolveToolExecutionModel(requestedModel) {
    const agentStore = useAgentStore.getState();
    if (isSyntheticModelSelection(requestedModel)) {
      agentStore.addLog(
        `Model "${requestedModel}" uses the OpenVINO/NPU path. Skipping Ollama native-tool probing and forcing text-tool mode.`,
        'info'
      );
      return {
        model: requestedModel,
        forceTextToolMode: true,
        reason: 'synthetic_text_mode'
      };
    }

    const installed = await this.fetchInstalledModels();
    const resolvedRequested = this.resolveModelAlias(requestedModel, installed);

    if (resolvedRequested !== requestedModel) {
      agentStore.addLog(`Resolved model alias: ${requestedModel} -> ${resolvedRequested}`);
    }

    // 1) Probe requested model first.
    let requestedProbe = await this.probeToolSupportWithTimeout(resolvedRequested, 20000);

    if (requestedProbe.supported) {
      agentStore.addLog(`Model "${resolvedRequested}" supports native tool calling.`);
      return {
        model: resolvedRequested,
        forceTextToolMode: false,
        reason: 'requested_native'
      };
    }

    // Retry requested model once if probe is inconclusive.
    if (this.isProbeInconclusive(requestedProbe.reason)) {
      agentStore.addLog(
        `Probe inconclusive for "${resolvedRequested}". Warming up and retrying...`,
        'warn'
      );
      await this.warmupModelForProbe(resolvedRequested);
      requestedProbe = await this.probeToolSupportWithTimeout(resolvedRequested, 45000);

      if (requestedProbe.supported) {
        return {
          model: resolvedRequested,
          forceTextToolMode: false,
          reason: 'requested_native_after_warmup'
        };
      }
    }

    // If selected model rejects native tools, keep it and use text-tool mode.
    if (this.isHardToolRejection(requestedProbe.reason)) {
      agentStore.addLog(
        `Model "${resolvedRequested}" rejects native tools. Keeping selected model and forcing text-tool mode.`,
        'info'
      );
      return {
        model: resolvedRequested,
        forceTextToolMode: true,
        reason: 'requested_text_mode'
      };
    }

    // 2) Probe fallback candidates only for inconclusive scenarios.
    const candidates = this.rankToolCandidateModels(installed, resolvedRequested).slice(0, 6);
    let bestInconclusiveCandidate = null;

    for (const candidate of candidates) {
      agentStore.addLog(`Probing fallback model "${candidate}"...`);
      let probe = await this.probeToolSupportWithTimeout(candidate, 20000);

      if (probe.supported) {
        agentStore.addLog(`Using fallback model "${candidate}" (native tool support).`, 'info');
        return {
          model: candidate,
          forceTextToolMode: false,
          reason: 'fallback_native'
        };
      }

      if (this.isProbeInconclusive(probe.reason)) {
        await this.warmupModelForProbe(candidate);
        probe = await this.probeToolSupportWithTimeout(candidate, 60000);
        if (probe.supported) {
          agentStore.addLog(
            `Using warmed fallback model "${candidate}" (native tool support).`,
            'info'
          );
          return {
            model: candidate,
            forceTextToolMode: false,
            reason: 'fallback_native_after_warmup'
          };
        }
      }

      if (this.isProbeInconclusive(probe.reason) && !bestInconclusiveCandidate) {
        bestInconclusiveCandidate = candidate;
      }
    }

    // 3) Last resort: keep requested model and force text mode.
    if (bestInconclusiveCandidate) {
      agentStore.addLog(
        `No confirmed native-tool model found (best attempt: "${bestInconclusiveCandidate}"). Keeping requested model with text-tool mode for better coding quality.`,
        'warn'
      );
    } else {
      agentStore.addLog(
        `Model "${resolvedRequested}" probe: ${requestedProbe.reason || 'unknown'}. Using text-tool mode.`,
        'info'
      );
    }

    return {
      model: resolvedRequested,
      forceTextToolMode: true,
      reason: 'requested_text_mode_last_resort'
    };
  }

  async captureProjectSnapshot(projectRoot) {
    const rootList = await safeCall(
      'toolListDirectory',
      [projectRoot, '', false, 2],
      { entries: [], count: 0, error: 'Tool not available' }
    );

    const entries = Array.isArray(rootList?.entries) ? rootList.entries : [];
    const fileEntries = entries.filter((e) => e?.type === 'file');
    const dirEntries = entries.filter((e) => e?.type === 'directory');
    const names = entries.map((e) => String(e?.name || '').toLowerCase());

    const hasPackageJson = names.includes('package.json');
    const hasReadme = names.some((n) => n === 'readme.md' || n === 'readme');
    const hasSrcDir = names.includes('src');
    const hasPython = fileEntries.some((e) => String(e?.name || '').toLowerCase().endsWith('.py'));
    const hasJsTs = fileEntries.some((e) => /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(String(e?.name || '')));
    const sparse = entries.length <= 8;

    return {
      rootCount: entries.length,
      fileCount: fileEntries.length,
      dirCount: dirEntries.length,
      hasPackageJson,
      hasReadme,
      hasSrcDir,
      hasPython,
      hasJsTs,
      sparse,
      topLevelSample: entries.slice(0, 20).map((e) => `${e.type === 'directory' ? 'dir' : 'file'}:${e.path}`)
    };
  }

  async autoResearchReferences(task, options = {}) {
    const networkPolicy = String(options.networkPolicy || 'offline').toLowerCase();
    if (networkPolicy !== 'research_web_only') {
      return [];
    }

    const references = extractReferenceProducts(task);
    const findings = [];

    for (const ref of references) {
      const query = `${ref} features architecture desktop app`;
      const result = await safeCall(
        'webSearch',
        [query, { maxResults: 5 }],
        { results: [], query, error: 'Tool not available' }
      );

      if (result?.error) continue;

      const rows = Array.isArray(result?.results) ? result.results.slice(0, 3) : [];
      for (const row of rows) {
        findings.push({
          ref,
          title: row?.title || '',
          url: row?.url || row?.link || '',
          snippet: truncateText(row?.snippet || row?.description || '', 180)
        });
      }
    }

    return findings.slice(0, 8);
  }

  buildVibeExecutionDirectives(task, snapshot, researchFindings = []) {
    const directives = [];
    const broad = isBroadBuildTask(task);

    if (broad) {
      directives.push('Treat this as a product-build request, not Q&A. Produce concrete patches.');
      directives.push('Aim for at least 3 actionable propose_edit calls in this run.');
    }

    if (snapshot?.sparse) {
      directives.push('Project appears sparse. Scaffold a minimal runnable foundation first before refinements.');
    }

    if (!snapshot?.hasPackageJson) {
      directives.push('No package.json found: propose creating one if this is a JS/TS app.');
    }

    if (!snapshot?.hasReadme) {
      directives.push('No README found: propose a short README with run/build instructions.');
    }

    if (researchFindings.length > 0) {
      directives.push('Reference the research context below for feature parity decisions.');
    } else if (extractReferenceProducts(task).length > 0) {
      directives.push('Benchmark references are unavailable in offline mode. Infer architecture from local requirements only.');
    }

    directives.push('Do not stop after listing advice. Keep using tools until concrete edits are proposed.');
    directives.push('Network policy is offline. Do not use web tools during coding runs.');
    return directives;
  }

  taskHasStackHint(task = '') {
    const t = String(task || '').toLowerCase();
    return /(react|next\.?js|vue|svelte|electron|tauri|express|node|typescript|javascript|python|fastapi|flask|django|rust|go)/.test(t);
  }

  buildClarificationRequest(task, snapshot) {
    if (!isBroadBuildTask(task)) return null;
    if (this.taskHasStackHint(task)) return null;
    if (!snapshot?.sparse && (snapshot?.hasPackageJson || snapshot?.hasSrcDir || snapshot?.hasPython)) {
      return null;
    }

    return {
      id: `clarify-${Date.now()}`,
      title: 'Quick setup choices before autonomous build',
      defaults: {
        target: 'desktop_electron',
        frontend: 'react_vite',
        runtime: 'node',
      },
      questions: [
        {
          id: 'target',
          question: 'Primary target for this app?',
          options: [
            {
              id: 'desktop_electron',
              label: 'Desktop (Electron) - Recommended',
              description: 'Best match for LM Studio-style local desktop experience.',
            },
            {
              id: 'web_app',
              label: 'Web app',
              description: 'Browser-first app with local/dev server workflow.',
            },
            {
              id: 'api_service',
              label: 'API/service',
              description: 'Backend-first project without a full UI scaffold.',
            },
          ],
        },
        {
          id: 'frontend',
          question: 'UI stack preference?',
          options: [
            {
              id: 'react_vite',
              label: 'React + Vite - Recommended',
              description: 'Fast iteration with a mature ecosystem.',
            },
            {
              id: 'nextjs',
              label: 'Next.js',
              description: 'Full-stack React with routing and server features.',
            },
            {
              id: 'plain_js',
              label: 'Plain JavaScript',
              description: 'Minimal setup with fewer dependencies.',
            },
          ],
        },
        {
          id: 'runtime',
          question: 'Backend/runtime preference?',
          options: [
            {
              id: 'node',
              label: 'Node.js - Recommended',
              description: 'Matches most JavaScript desktop/web scaffolds.',
            },
            {
              id: 'python',
              label: 'Python',
              description: 'Prefer Python services/utilities for core logic.',
            },
            {
              id: 'none',
              label: 'No backend yet',
              description: 'UI-first scaffold with mocked data.',
            },
          ],
        },
      ],
    };
  }

  async waitForClarification(request, timeoutMs = 90000) {
    const startedAt = Date.now();
    const requestId = request?.id;
    const defaults = request?.defaults || {};

    while (this.isActive) {
      const store = useAgentStore.getState();
      const response = store.takeClarificationResponse?.(requestId);
      if (response?.answers) {
        return response.answers;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        store.addLog('Clarification timeout reached. Using smart defaults.', 'warn');
        store.submitClarification?.(defaults, 'timeout-default');
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(200);
    }

    throw new Error('Agent run stopped by user before clarification was resolved.');
  }

  formatClarificationContext(request, answers = {}) {
    if (!request?.questions?.length) return '';
    const lines = ['User clarifications:'];
    for (const question of request.questions) {
      const selectedId = answers[question.id] || request.defaults?.[question.id];
      const selected = question.options?.find((opt) => opt.id === selectedId);
      if (!selected) continue;
      lines.push(`- ${question.question}: ${selected.label}`);
    }
    return lines.join('\n');
  }

  buildExecutionPasses(task, snapshot) {
    if (!isBroadBuildTask(task)) {
      return [
        {
          id: 'single-pass',
          title: 'Implementation pass',
          objective: 'Inspect the project, implement requested changes, and prepare verification.',
          minChanges: 1,
        },
      ];
    }

    const passes = [
      {
        id: 'foundation',
        title: 'Foundation',
        objective: 'Scaffold core structure and create runnable project baseline files.',
        minChanges: snapshot?.sparse ? 3 : 2,
      },
      {
        id: 'core',
        title: 'Core Features',
        objective: 'Implement the main value flow and integrate key app capabilities.',
        minChanges: 2,
      },
      {
        id: 'polish',
        title: 'Polish',
        objective: 'Improve UX, docs, scripts, and tighten reliability.',
        minChanges: 1,
      },
    ];

    // Give sparse projects one extra pass to avoid stopping after shallow scaffolds.
    if (snapshot?.sparse) {
      passes.push({
        id: 'expansion',
        title: 'Expansion',
        objective: 'Add missing modules and strengthen architecture depth.',
        minChanges: 1,
      });
    }

    return passes;
  }

  async assessAutonomousCompletion(projectRoot, task, doneCriteria = 'baseline') {
    if (!isBroadBuildTask(task)) {
      return { done: true, missing: [], fileCount: 0, reason: 'non-broad-task' };
    }

    const listing = await safeCall(
      'toolListDirectory',
      [projectRoot, '', true, 3],
      { entries: [], count: 0, error: 'Tool not available' }
    );

    const entries = Array.isArray(listing?.entries) ? listing.entries : [];
    const fileEntries = entries.filter((entry) => entry?.type === 'file');
    const filePaths = new Set(fileEntries.map((entry) => normalizePath(entry?.path || '')));
    const lowerNames = new Set(entries.map((entry) => String(entry?.name || '').toLowerCase()));
    const missing = [];
    const criteria = typeof doneCriteria === 'object' && doneCriteria
      ? doneCriteria
      : {};

    const hasPackageJson = lowerNames.has('package.json');
    const hasSrcDir = entries.some((entry) => entry?.type === 'directory' && String(entry?.name || '').toLowerCase() === 'src');
    const hasReadme = lowerNames.has('readme.md') || lowerNames.has('readme');
    const hasJsEntry =
      filePaths.has('src/main.js') ||
      filePaths.has('src/main.ts') ||
      filePaths.has('src/main.jsx') ||
      filePaths.has('src/main.tsx') ||
      filePaths.has('src/index.js') ||
      filePaths.has('src/index.ts') ||
      filePaths.has('src/App.jsx') ||
      filePaths.has('src/App.tsx');
    const hasPyEntry = filePaths.has('main.py') || filePaths.has('app.py') || filePaths.has('src/main.py');
    const hasPythonProject = lowerNames.has('pyproject.toml') || lowerNames.has('requirements.txt');
    const taskRequestsPython = /python|fastapi|flask|django/.test(String(task || '').toLowerCase());
    const fileCount = fileEntries.length;
    const minimumFileDepth = Number.isFinite(criteria.minFiles)
      ? Math.max(1, Number(criteria.minFiles))
      : null;

    if (taskRequestsPython) {
      if (!hasPythonProject) missing.push('pyproject.toml/requirements.txt');
      if (!hasPyEntry) missing.push('python-entry-file');
      if (!hasReadme) missing.push('README.md');
      if (fileCount < (minimumFileDepth || 5)) missing.push('project-depth');
    } else {
      if (!hasPackageJson) missing.push('package.json');
      if (!hasSrcDir) missing.push('src/');
      if (!hasJsEntry && !hasPyEntry) missing.push('app-entry-file');
      if (!hasReadme) missing.push('README.md');
      if (fileCount < (minimumFileDepth || 6)) missing.push('project-depth');
    }

    return {
      done: missing.length === 0,
      missing,
      fileCount,
      reason: missing.length ? `missing: ${missing.join(', ')}` : 'baseline-complete',
    };
  }

  async applyChangesAutomatically(changes = []) {
    const store = useAgentStore.getState();
    if (!Array.isArray(changes) || changes.length === 0) {
      return { applied: 0, failed: 0 };
    }

    store.replaceProposedChanges(changes);
    const results = await store.approveAllChanges();
    const applied = Array.isArray(results) ? results.filter((item) => item.success).length : 0;
    const failed = Array.isArray(results) ? results.filter((item) => !item.success).length : changes.length;

    if (failed > 0) {
      store.addLog(`Auto-apply completed with ${failed} failed patch(es). Remaining diffs kept for review.`, 'warn');
    } else {
      store.addLog(`Auto-applied ${applied} change(s) for this pass.`, 'info');
    }

    return { applied, failed };
  }

  /**
   * Start the "Night Shift" - Autonomous Mode
   */
  async startNightShift(taskDescription, runOptions = {}) {
    const agentStore = useAgentStore.getState();
    if (this.isActive) {
      agentStore.addLog('Agent is already running.', 'warn');
      return;
    }

    try {
      const task = String(taskDescription || '').trim();
      const appStore = useAppStore.getState();
      const editorStore = useEditorStore.getState();
      const projectRoot = editorStore?.rootPath || '';
      const activeFilePath = editorStore?.activeFilePath || '';
      const currentModel = toModelName(appStore?.currentModel);

      if (!task) {
        throw new Error('Cannot start agent: task description is empty.');
      }

      if (!currentModel) {
        throw new Error('Cannot start agent: no model selected.');
      }

      if (!projectRoot) {
        throw new Error('Cannot start agent: no project loaded. Open a folder in Project first.');
      }

      const normalizedRunOptions = {
        autopilotMode: runOptions?.autopilotMode || 'continuous',
        performanceMode: runOptions?.performanceMode || 'speed',
        doneCriteria: runOptions?.doneCriteria || 'baseline',
        clarifyPolicy: runOptions?.clarifyPolicy || 'auto',
        maxRounds: Number.isFinite(runOptions?.maxRounds)
          ? Math.max(1, Math.min(Number(runOptions.maxRounds), 24))
          : 8,
        qualityGatePolicy: runOptions?.qualityGatePolicy || 'build+test+lint',
      };

      const toolsHealth = await safeCall(
        'toolHealth',
        [],
        { ok: false, handlersReady: false, error: 'Tool handlers unavailable' }
      );
      if (!toolsHealth?.ok || toolsHealth?.handlersReady === false) {
        throw new Error(
          `Code tools are not ready (${toolsHealth?.error || 'registration missing'}). Restart DevForge to re-register tool IPC handlers.`
        );
      }

      this.isActive = true;
      this.task = task;
      this.currentRunId = `night-shift/${task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}-${Date.now()}`;
      this.discussion = [];
      this.currentPhase = 'defining';
      this.notify();

      const plan = agentService.generateAutonomousPlan(task, {
        filePath: activeFilePath,
        projectRoot,
        mode: 'autonomous',
      });
      agentStore.startTask(task, plan);
      await this.pushRunProgress({
        status: 'running',
        phase: this.currentPhase,
        projectRoot,
        model: currentModel,
        policy: normalizedRunOptions,
      }, true);
      agentStore.addLog(`Agent run initialized (model=${currentModel}).`);
      agentStore.addLog(`Project root: ${projectRoot}`);
      agentStore.addLog(
        `Run policy: mode=${normalizedRunOptions.autopilotMode}, perf=${normalizedRunOptions.performanceMode}, maxRounds=${normalizedRunOptions.maxRounds}, qualityGate=${normalizedRunOptions.qualityGatePolicy}`
      );

      if (normalizedRunOptions.performanceMode) {
        const profileSet = await safeCall('setPerformanceProfile', [normalizedRunOptions.performanceMode], null);
        if (profileSet?.success) {
          agentStore.addLog(`Performance profile forced to "${normalizedRunOptions.performanceMode}" for this run.`);
        }
      }

      const safetyResult = await safetyProtocol.engageSafetyProtocol(taskDescription);
      if (!safetyResult.success) {
        this.addSystemMessage('Failed to engage Safety Protocol. Aborting.', 'error');
        agentStore.addLog(
          `Safety protocol failed: ${safetyResult.error || 'unknown error'}`,
          'error'
        );
        this.isActive = false;
        this.currentRunId = null;
        agentStore.stopAgent();
        await this.pushRunProgress({
          status: 'failed',
          phase: 'idle',
          error: safetyResult.error || 'safety-protocol-failed',
        }, true);
        this.notify();
        return;
      }

      const modeLabel = safetyResult.degraded ? 'degraded' : 'isolated';
      this.addSystemMessage(
        `Safety protocol active (${modeLabel}): ${safetyResult.session.sandboxBranch}`,
        'system'
      );
      agentStore.addLog(
        `Safety protocol ${modeLabel} mode in ${safetyResult.session.sandboxBranch}`
      );

      agentStore.addLog(`Probing tool support for model "${currentModel}"...`);
      const execution = await this.resolveToolExecutionModel(currentModel);
      const toolModel = execution?.model || currentModel;
      const forceTextToolMode = Boolean(execution?.forceTextToolMode);
      if (toolModel !== currentModel) {
        this.addSystemMessage(
          `Selected model does not support tools. Switching autonomous execution to ${toolModel}.`,
          'warn'
        );
      }
      if (forceTextToolMode) {
        this.addSystemMessage(
          `Autonomous execution will use text-based tool mode with ${toolModel}.`,
          'system'
        );
      }

      this.runLoop({
        projectRoot,
        currentModel: toolModel,
        requestedModel: currentModel,
        forceTextToolMode,
        runOptions: normalizedRunOptions,
      });
    } catch (error) {
      const message = `Failed to start Night Shift: ${error?.message || 'unknown error'}`;
      this.addSystemMessage(message, 'error');
      agentStore.addLog(`Start error: ${error?.message || 'unknown error'}`, 'error');
      this.isActive = false;
      this.currentRunId = null;
      agentStore.stopAgent();
      await this.pushRunProgress({
        status: 'failed',
        phase: 'idle',
        error: error?.message || 'start-failed',
      }, true);
      this.notify();
      throw error;
    }
  }

  getPlanStepByOwner(owners = [], fallbackIndex = 0) {
    const list = Array.isArray(owners) ? owners : [owners];
    const steps = useAgentStore.getState().plan?.steps || [];
    const matched = steps.find((step) => {
      const owner = String(step?.owner || '').toLowerCase();
      return list.some((token) => owner.includes(String(token).toLowerCase()));
    });
    return matched || steps[fallbackIndex] || null;
  }

  updateStepStatus(step, status) {
    if (step?.id) {
      const store = useAgentStore.getState();
      store.updateStepStatus(step.id, status);
      if (status === 'running' || status === 'in_progress') {
        const steps = store.plan?.steps || [];
        const index = steps.findIndex((item) => item.id === step.id);
        if (index >= 0) {
          store.setCurrentStep(index);
        }
      }
    }
  }

  markInFlightStepsFailed() {
    const store = useAgentStore.getState();
    const steps = store.plan?.steps || [];
    for (const step of steps) {
      if (['running', 'in_progress'].includes(step.status) && step.id) {
        store.updateStepStatus(step.id, 'failed');
      }
    }
  }

  ensureActive() {
    const state = useAgentStore.getState();
    if (!this.isActive || !state.isRunning) {
      throw new Error('Agent run stopped by user.');
    }
  }

  async waitIfPaused() {
    while (this.isActive && useAgentStore.getState().isPaused) {
      await sleep(150);
    }
    this.ensureActive();
  }

  addTouchedFile(path, action, summary = '') {
    if (!path) return;
    useAgentStore.getState().addFilesTouched([
      {
        path: normalizePath(path),
        action,
        summary,
      },
    ]);
  }

  handleToolResult(toolCall, result) {
    const agentStore = useAgentStore.getState();
    const toolName = toolCall?.function?.name || 'tool';

    if (!result || result.success === false) {
      const errorMessage = result?.error ? `: ${result.error}` : '';
      agentStore.addLog(`Tool failed (${toolName})${errorMessage}`, 'warn');
      return;
    }

    switch (result.type) {
      case 'file_read':
        this.addTouchedFile(
          result.path,
          'read',
          `Read ${result.totalLines || '?'} lines`
        );
        break;
      case 'search': {
        const seen = new Set();
        const results = Array.isArray(result.results) ? result.results : [];
        for (const entry of results.slice(0, 10)) {
          const filePath = normalizePath(entry?.path || '');
          if (!filePath || seen.has(filePath)) continue;
          seen.add(filePath);
          this.addTouchedFile(filePath, 'read', `Search hit: ${result.pattern}`);
        }
        break;
      }
      case 'directory_list':
        this.addTouchedFile(result.path || '.', 'read', `Listed ${result.count || 0} entries`);
        break;
      case 'proposed_edit':
        this.addTouchedFile(
          result.patch?.path,
          'write',
          result.patch?.rationale || 'Proposed edit'
        );
        break;
      case 'command':
      case 'lint':
      case 'test':
      case 'typecheck':
        this.addTouchedFile(
          result.command || result.type,
          'command',
          result.success ? 'Command succeeded' : 'Command failed'
        );
        break;
      case 'web_search':
        this.addTouchedFile(
          `web:${result.query || 'search'}`,
          'read',
          `Research results: ${result.count || 0}`
        );
        break;
      case 'web_page':
        this.addTouchedFile(
          `web:${result.url || 'page'}`,
          'read',
          'Fetched page content'
        );
        break;
      default:
        break;
    }
  }

  stringifyDiff(diffObj) {
    if (!Array.isArray(diffObj?.hunks)) return '';
    return diffObj.hunks
      .map((line) => {
        const prefix =
          line?.type === 'added' ? '+' : line?.type === 'removed' ? '-' : ' ';
        return `${prefix}${line?.content || ''}`;
      })
      .join('\n');
  }

  async normalizeProposedChanges(proposed = []) {
    const changes = [];
    const now = Date.now();

    for (let idx = 0; idx < proposed.length; idx += 1) {
      const patch = proposed[idx] || {};
      const path = normalizePath(patch.path || patch.newPath || '');
      if (!path) continue;

      const operation = normalizePatchOperation(patch.operation, patch);
      const newContent =
        typeof patch.newContent === 'string' ? patch.newContent : '';
      const oldContent =
        typeof patch.oldContent === 'string' ? patch.oldContent : '';

      let diffText = '';
      if (oldContent || newContent) {
        const diff = await safeCall(
          'toolGenerateDiff',
          [oldContent, newContent, path],
          null
        );
        diffText = this.stringifyDiff(diff);
      }

      changes.push({
        id: patch.id || `agent-change-${now}-${idx + 1}`,
        path,
        operation,
        newPath: patch.newPath || null,
        startLine: patch.startLine,
        endLine: patch.endLine,
        oldContent,
        before: oldContent,
        content: newContent,
        summary: patch.rationale || `${operation} ${path}`,
        diff: diffText || undefined,
      });
    }

    return changes;
  }

  async runVerification(projectRoot, policy = 'build+test+lint') {
    const runCommandCheck = async (label, command, timeoutMs = 120000) => {
      const raw = await safeCall(
        'toolRunCommand',
        [projectRoot, command, null, timeoutMs],
        { ok: false, error: 'Tool not available' }
      );
      const normalized = unwrapToolPayload(raw);
      const details = raw?.details || raw || {};
      const stdout = normalized.stdout || details.stdout || '';
      const stderr = normalized.stderr || details.stderr || normalized.error || '';
      const exitCode = normalized.exitCode ?? details.exitCode ?? (normalized.ok ? 0 : 1);
      const missingScript = /missing script|not recognized|not found|enoent/i.test(`${stderr}\n${normalized.error || ''}`);
      const toolUnavailable = /tool not available/i.test(`${stderr}\n${normalized.error || ''}`);

      return {
        label,
        command,
        success: Boolean(normalized.ok),
        skipped: false,
        missingScript,
        toolUnavailable,
        stdout,
        stderr,
        exitCode,
      };
    };

    const qualityGate = {
      policy: policy || 'build+test+lint',
      checks: [],
    };

    const packageJsonRead = unwrapToolPayload(await safeCall(
      'toolReadFile',
      [projectRoot, 'package.json'],
      { ok: false, error: 'Tool not available' }
    ));

    let scripts = {};
    if (packageJsonRead.ok && packageJsonRead.content) {
      try {
        const parsed = JSON.parse(packageJsonRead.content);
        scripts = parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
      } catch {
        scripts = {};
      }
    }

    const checksToRun = [
      { label: 'build', command: 'npm run build', timeoutMs: 180000, enabled: Boolean(scripts.build) },
      { label: 'test', command: 'npm test -- --watch=false', timeoutMs: 180000, enabled: Boolean(scripts.test) },
      { label: 'lint', command: 'npm run lint', timeoutMs: 120000, enabled: Boolean(scripts.lint) },
    ];

    for (const check of checksToRun) {
      if (!check.enabled) {
        qualityGate.checks.push({
          label: check.label,
          command: check.command,
          success: true,
          skipped: true,
          reason: 'script-missing',
          stdout: '',
          stderr: '',
        });
        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await runCommandCheck(check.label, check.command, check.timeoutMs);
      if (!result.success && (result.missingScript || result.toolUnavailable)) {
        qualityGate.checks.push({
          ...result,
          success: true,
          skipped: true,
          reason: result.toolUnavailable ? 'tool-unavailable' : 'script-missing',
        });
      } else {
        qualityGate.checks.push(result);
      }
    }

    const actionableChecks = qualityGate.checks.filter((check) => !check.skipped);
    const failedCheck = actionableChecks.find((check) => !check.success);

    if (failedCheck) {
      return {
        ran: true,
        success: false,
        command: failedCheck.command,
        stdout: failedCheck.stdout || '',
        stderr: failedCheck.stderr || `${failedCheck.label} failed`,
        checks: qualityGate.checks,
        note: `Quality gate policy ${qualityGate.policy} failed at ${failedCheck.label}.`,
      };
    }

    if (actionableChecks.length > 0) {
      return {
        ran: true,
        success: true,
        command: 'quality-gate',
        stdout: actionableChecks
          .map((check) => `${check.label}: ok`)
          .join('\n'),
        stderr: '',
        checks: qualityGate.checks,
        note: `Quality gate policy ${qualityGate.policy} passed.`,
      };
    }

    // No scripts available -> fallback to a lightweight workspace sanity check.
    const gitStatusResult = await runCommandCheck('git-status', 'git status --short', 30000);
    const gitErrorBlob = `${gitStatusResult.stderr || ''}\n${gitStatusResult.error || ''}`;
    const notGitRepo = /not a git repository/i.test(gitErrorBlob);

    if (!gitStatusResult.success && notGitRepo) {
      return {
        ran: true,
        success: true,
        skipped: true,
        command: 'quality-gate:fallback',
        stdout: '',
        stderr: '',
        checks: qualityGate.checks,
        note: 'Build/test/lint scripts unavailable and workspace is not a git repository. Verification skipped with warning.',
      };
    }

    return {
      ran: true,
      success: Boolean(gitStatusResult.success),
      command: 'git status --short',
      stdout: gitStatusResult.stdout || '',
      stderr: gitStatusResult.stderr || '',
      checks: qualityGate.checks,
      note: 'Build/test/lint scripts unavailable, fallback verification used.',
    };
  }

  async runLoop({
    projectRoot,
    currentModel,
    requestedModel,
    forceTextToolMode = false,
    runOptions = {},
  }) {
    try {
      const agentStore = useAgentStore.getState();
      const scopeStep = this.getPlanStepByOwner(['architect', 'scope'], 0);
      const implementStep = this.getPlanStepByOwner(['coder', 'engineer', 'implement'], 1);
      const reviewStep = this.getPlanStepByOwner(['review', 'qa', 'test'], 2);
      const indexSummary = getCodeIndexSummary();

      this.ensureActive();
      await this.agentSpeak(
        AGENT_PERSONAS.PRODUCT_OWNER,
        `I received the task: "${this.task}". I am validating scope and constraints.`
      );
      this.updateStepStatus(scopeStep, 'running');
      await this.waitIfPaused();

      this.currentPhase = 'planning';
      this.notify();
      await this.pushRunProgress({ phase: this.currentPhase });
      if (indexSummary?.files?.length) {
        agentStore.addLog(`Indexed ${indexSummary.files.length} files for planning context.`);
      }
      await this.agentSpeak(
        AGENT_PERSONAS.ARCHITECT,
        `Project root confirmed: ${projectRoot}${indexSummary?.files?.length ? `\nIndexed files: ${indexSummary.files.length}` : ''}\nProceeding with direct code analysis and patch proposals.`
      );
      this.updateStepStatus(scopeStep, 'complete');

      this.currentPhase = 'implementing';
      this.notify();
      await this.pushRunProgress({ phase: this.currentPhase });
      this.updateStepStatus(implementStep, 'running');
      await this.waitIfPaused();
      await this.agentSpeak(AGENT_PERSONAS.ENGINEER, `Starting autonomous implementation (model: ${currentModel}).`);

      if (requestedModel && requestedModel !== currentModel) {
        await this.agentSpeak(
          AGENT_PERSONAS.ENGINEER,
          `Execution model switched from ${requestedModel} to ${currentModel} because the selected model does not support tools.`
        );
      }

      await safetyProtocol.createCheckpoint('Start tool-driven implementation');

      this.activeLLM = this.createExecutionLLM(
        currentModel,
        projectRoot,
        agentStore,
        { forceTextToolMode }
      );

      const projectSnapshot = await this.captureProjectSnapshot(projectRoot);
      const clarificationRequest = this.buildClarificationRequest(this.task, projectSnapshot);
      let clarificationContext = '';
      const clarifyPolicy = String(runOptions?.clarifyPolicy || 'auto').toLowerCase();

      if (clarificationRequest && clarifyPolicy !== 'smart-defaults-only') {
        this.currentPhase = 'planning';
        this.notify();
        agentStore.requestClarification(clarificationRequest);
        agentStore.addLog('Clarification required before full autonomous execution.');
        await this.agentSpeak(
          AGENT_PERSONAS.PRODUCT_OWNER,
          'I need a few setup defaults before I can continue at full speed. Please answer the clarification card, or use smart defaults.'
        );
        const clarificationAnswers = await this.waitForClarification(clarificationRequest, 90000);
        clarificationContext = this.formatClarificationContext(clarificationRequest, clarificationAnswers);
        agentStore.addLog(`Clarification resolved: ${JSON.stringify(clarificationAnswers)}`);
        this.currentPhase = 'implementing';
        this.notify();
      } else if (clarificationRequest) {
        clarificationContext = this.formatClarificationContext(
          clarificationRequest,
          clarificationRequest.defaults || {}
        );
        agentStore.addLog('Clarification prompts skipped by policy. Using smart defaults.');
      }

      const researchFindings = await this.autoResearchReferences(this.task, { networkPolicy: 'offline' });
      const directives = this.buildVibeExecutionDirectives(
        this.task,
        projectSnapshot,
        researchFindings
      );
      const executionPasses = this.buildExecutionPasses(this.task, projectSnapshot);
      const configuredMaxRounds = Number.isFinite(runOptions?.maxRounds)
        ? Math.max(1, Math.min(Number(runOptions.maxRounds), 24))
        : 8;
      const totalPlannedPasses = Math.max(
        executionPasses.length,
        runOptions?.autopilotMode === 'continuous' ? configuredMaxRounds : executionPasses.length
      );
      const passMode = totalPlannedPasses > 1 ? 'continuous' : 'single';

      agentStore.setRunProgress({
        pass: 0,
        totalPasses: totalPlannedPasses,
        completedPasses: 0,
        label: 'Preparing run...',
        mode: passMode,
      });
      await this.pushRunProgress({
        phase: this.currentPhase,
        totalPasses: totalPlannedPasses,
        mode: passMode,
        status: 'running',
      }, true);

      agentStore.addLog(
        `Project snapshot: ${projectSnapshot.fileCount} files, ${projectSnapshot.dirCount} dirs, sparse=${projectSnapshot.sparse ? 'yes' : 'no'}.`
      );
      if (researchFindings.length > 0) {
        agentStore.addLog(`Auto research gathered ${researchFindings.length} reference snippets.`);
      }

      const researchContext = researchFindings.length
        ? researchFindings
            .map((item, idx) =>
              `${idx + 1}. [${item.ref}] ${item.title}\n   ${item.snippet}\n   ${item.url}`
            )
            .join('\n')
        : 'No external references preloaded.';

      let totalToolCallCount = 0;
      let totalProposedChanges = 0;
      let totalAppliedChanges = 0;
      let lastImplementationSummary = '';
      let lastImplementationResult = null;
      let completionState = await this.assessAutonomousCompletion(
        projectRoot,
        this.task,
        runOptions?.doneCriteria || 'baseline'
      );
      await this.pushRunProgress({
        phase: this.currentPhase,
        status: 'running',
        completionState,
      }, true);
      let consecutiveNoChangePasses = 0;
      for (let passIndex = 0; passIndex < totalPlannedPasses; passIndex += 1) {
        this.ensureActive();
        // eslint-disable-next-line no-await-in-loop
        await this.waitIfPaused();

        const predefinedPass = executionPasses[passIndex] || null;
        const pass = predefinedPass || {
          id: `continuation-${passIndex + 1}`,
          title: `Continuation ${passIndex + 1}`,
          objective: completionState?.done
            ? 'Finalize remaining polish and verification artifacts.'
            : `Close remaining gaps: ${completionState?.missing?.join(', ') || 'app-depth'}.`,
          minChanges: completionState?.done ? 0 : 1,
        };
        const passNumber = passIndex + 1;
        const remainingMissing = completionState?.missing?.length
          ? completionState.missing.join(', ')
          : 'none';

        agentStore.startPass(passNumber, totalPlannedPasses, `${pass.title} in progress`);
        await this.pushRunProgress({
          phase: this.currentPhase,
          currentPassTitle: pass.title,
          status: 'running',
        });
        await this.agentSpeak(
          AGENT_PERSONAS.ENGINEER,
          `Pass ${passNumber}/${totalPlannedPasses} - ${pass.title}: ${pass.objective}`
        );

        const implementationPrompt = [
          'You are operating in autonomous coding mode.',
          `Task: ${this.task}`,
          `Pass ${passNumber}/${totalPlannedPasses}: ${pass.title}`,
          `Pass objective: ${pass.objective}`,
          `Minimum expected edit count this pass: ${pass.minChanges}`,
          '',
          'Execution requirements:',
          '1. Use list_directory/search_code/read_file to inspect the project.',
          '2. Propose concrete edits with propose_edit (no placeholders).',
          '3. Keep building momentum: do not stop after one small scaffold.',
          '4. If this pass cannot safely change code, explain the exact blocker and attempt a fallback edit.',
          '5. End with a concise summary of inspected files and applied plan updates.',
          '6. If this is a continuation pass, expand existing scaffold depth; do not stop at placeholders.',
          '',
          'Current completion status:',
          `- done: ${completionState?.done ? 'yes' : 'no'}`,
          `- missing: ${remainingMissing}`,
          '',
          clarificationContext ? `${clarificationContext}\n` : '',
          'Project snapshot:',
          JSON.stringify(projectSnapshot, null, 2),
          '',
          'Autonomy directives:',
          ...directives.map((d, idx) => `${idx + 1}. ${d}`),
          '',
          'Preloaded research context:',
          researchContext,
          '',
          lastImplementationSummary
            ? `Previous pass summary:\n${lastImplementationSummary}`
            : 'No previous pass summary yet.',
        ].join('\n');

        let implementationResult;
        try {
          // eslint-disable-next-line no-await-in-loop
          implementationResult = await this.activeLLM.chat(implementationPrompt, []);
        } catch (error) {
          const message = String(error?.message || '');
          if (/does not support tools/i.test(message) && requestedModel && requestedModel !== currentModel) {
            agentStore.addLog(
              `Execution model "${currentModel}" rejected tools unexpectedly. Retrying with requested model "${requestedModel}" in text mode.`,
              'warn'
            );
            this.activeLLM = this.createExecutionLLM(
              requestedModel,
              projectRoot,
              agentStore,
              { forceTextToolMode: true }
            );
            // eslint-disable-next-line no-await-in-loop
            implementationResult = await this.activeLLM.chat(implementationPrompt, []);
          } else {
            throw error;
          }
        }
        this.ensureActive();

        let toolCallCount = Array.isArray(implementationResult?.toolCalls)
          ? implementationResult.toolCalls.length
          : 0;
        let proposedChanges = await this.normalizeProposedChanges(
          implementationResult?.proposedChanges || []
        );
        let finalImplementationResult = implementationResult;

        if (proposedChanges.length === 0) {
          agentStore.addLog(
            `Pass ${passNumber}: no actionable patches from first attempt. Running structured recovery.`,
            'warn'
          );
          const recoveryPrompt = [
            `Recovery pass for ${pass.title}.`,
            `Task: ${this.task}`,
            '',
            'Hard requirements:',
            '1. Use list_directory/search_code/read_file before editing.',
            '2. Call propose_edit with valid fields: path, operation, rationale, and content/lines as needed.',
            '3. If project is sparse, scaffold or expand actual files (not advice-only output).',
            '4. Produce at least one safe, reviewable change.',
          ].join('\n');

          const recoveryHistory = [];
          const priorSummary = truncateText(implementationResult?.content || '', 1200);
          if (priorSummary) {
            recoveryHistory.push({
              role: 'assistant',
              content: `Previous pass summary:\n${priorSummary}`
            });
          }

          try {
            // eslint-disable-next-line no-await-in-loop
            const recoveryResult = await this.activeLLM.chat(recoveryPrompt, recoveryHistory);
            this.ensureActive();
            const recoveredChanges = await this.normalizeProposedChanges(
              recoveryResult?.proposedChanges || []
            );
            const recoveryToolCalls = Array.isArray(recoveryResult?.toolCalls)
              ? recoveryResult.toolCalls.length
              : 0;

            if (recoveredChanges.length > 0) {
              proposedChanges = recoveredChanges;
              finalImplementationResult = recoveryResult;
              toolCallCount = Math.max(toolCallCount, recoveryToolCalls);
              agentStore.addLog(
                `Pass ${passNumber}: recovery produced ${recoveredChanges.length} change(s).`,
                'info'
              );
            } else {
              agentStore.addLog(
                `Pass ${passNumber}: recovery returned no changes (${recoveryToolCalls} tool calls).`,
                'warn'
              );
            }
          } catch (recoveryError) {
            agentStore.addLog(
              `Pass ${passNumber}: structured recovery failed: ${recoveryError?.message || 'unknown error'}`,
              'warn'
            );
          }
        }

        const executionReliability = finalImplementationResult?.reliabilityMetrics || implementationResult?.reliabilityMetrics || null;
        const executionFailureReason = finalImplementationResult?.failureReasonCode || implementationResult?.failureReasonCode || null;
        if (executionFailureReason) {
          agentStore.addLog(
            `Pass ${passNumber} reliability reason: ${executionFailureReason}`,
            executionFailureReason.includes('max_') || executionFailureReason.includes('consecutive_') ? 'warn' : 'info'
          );
        }
        if (executionReliability) {
          const failureCount = Number(executionReliability.toolFailures || 0);
          const blockedCount = Number(executionReliability.blockedCommands || 0);
          const rollbackAttempts = Number(executionReliability.rollbackAttempts || 0);
          const rollbackSucceeded = Number(executionReliability.rollbackSucceeded || 0);
          const nativeFallbacks = Number(executionReliability.nativeToolFallbacks || 0);
          if (failureCount > 0 || blockedCount > 0 || nativeFallbacks > 0) {
            agentStore.addLog(
              `Pass ${passNumber} reliability metrics: failures=${failureCount}, blocked=${blockedCount}, rollback=${rollbackSucceeded}/${rollbackAttempts}, nativeFallbacks=${nativeFallbacks}.`,
              failureCount > 0 || blockedCount > 0 ? 'warn' : 'info'
            );
          }
        }

        totalToolCallCount += toolCallCount;
        totalProposedChanges += proposedChanges.length;
        let passApplied = 0;
        let passFailed = 0;

        if (proposedChanges.length > 0) {
          // eslint-disable-next-line no-await-in-loop
          const applyOutcome = await this.applyChangesAutomatically(proposedChanges);
          passApplied = applyOutcome.applied;
          passFailed = applyOutcome.failed;
          totalAppliedChanges += passApplied;

          await this.agentSpeak(
            AGENT_PERSONAS.ENGINEER,
            `Pass ${passNumber} complete: proposed ${proposedChanges.length} change(s), auto-applied ${passApplied}, failed ${passFailed}.`
          );
          consecutiveNoChangePasses = 0;
        } else {
          await this.agentSpeak(
            AGENT_PERSONAS.ENGINEER,
            `Pass ${passNumber} complete with no actionable patch output. Continuing if more passes remain.`
          );
          consecutiveNoChangePasses += 1;
        }

        const assistantSummary = truncateText(finalImplementationResult?.content || '', 1600);
        if (assistantSummary) {
          lastImplementationSummary = assistantSummary;
          await this.agentSpeak(AGENT_PERSONAS.ENGINEER, assistantSummary);
        }
        lastImplementationResult = finalImplementationResult;
        agentStore.completePass(passNumber, `${pass.title}: ${passApplied}/${proposedChanges.length || 0} applied`);
        await this.pushRunProgress({
          phase: this.currentPhase,
          currentPassTitle: pass.title,
          lastPassApplied: passApplied,
          lastPassProposed: proposedChanges.length || 0,
          completionState,
          status: 'running',
        });

        // eslint-disable-next-line no-await-in-loop
        completionState = await this.assessAutonomousCompletion(
          projectRoot,
          this.task,
          runOptions?.doneCriteria || 'baseline'
        );
        agentStore.addLog(
          `Pass ${passNumber} completion check: ${completionState.done ? 'done' : completionState.reason}`,
          completionState.done ? 'info' : 'warn'
        );

        const shouldStopEarly =
          completionState.done &&
          (passNumber >= 2 || totalPlannedPasses === 1);

        if (shouldStopEarly) {
          agentStore.addLog(`Definition of done reached at pass ${passNumber}. Ending run early.`);
          if (passNumber < totalPlannedPasses) {
            await this.agentSpeak(
              AGENT_PERSONAS.PRODUCT_OWNER,
              `Baseline app requirements are now met. Stopping early after pass ${passNumber}.`
            );
          }
          await this.pushRunProgress({
            phase: this.currentPhase,
            status: 'running',
            completionReason: 'definition-of-done',
            completionState,
          }, true);
          break;
        }

        const hardBlocked = consecutiveNoChangePasses >= 3 && !completionState.done;
        if (hardBlocked) {
          agentStore.addLog(
            `Detected hard blocker after ${consecutiveNoChangePasses} consecutive no-change passes.`,
            'warn'
          );
          await this.agentSpeak(
            AGENT_PERSONAS.PRODUCT_OWNER,
            'Autopilot encountered repeated no-change passes. Please refine constraints or switch to a stronger model.'
          );
          await this.pushRunProgress({
            phase: this.currentPhase,
            status: 'blocked',
            blocker: 'repeated-no-change-passes',
            completionState,
          }, true);
          break;
        }

        if (passNumber < totalPlannedPasses) {
          await this.agentSpeak(
            AGENT_PERSONAS.PRODUCT_OWNER,
            `Continuing automatically to pass ${passNumber + 1}/${totalPlannedPasses}.`
          );
        }
      }

      if (totalToolCallCount === 0 && totalProposedChanges === 0) {
        const reason = 'Execution model did not produce actionable tool usage for this task.';
        agentStore.addLog(reason, 'warn');
        this.updateStepStatus(implementStep, 'failed');
        this.updateStepStatus(reviewStep, 'failed');
        await this.agentSpeak(
          AGENT_PERSONAS.ENGINEER,
          `${reason}\nTry selecting a stronger coding model or provide tighter constraints.`
        );
        this.addSystemMessage('Agent run completed without code changes.', 'warn');
        this.activeLLM = null;
        this.isActive = false;
        this.currentPhase = 'idle';
        agentStore.stopAgent();
        this.currentRunId = null;
        await this.pushRunProgress({
          status: 'failed',
          phase: 'idle',
          error: reason,
        }, true);
        this.notify();
        return;
      }

      agentStore.addLog(
        `Tool loop completed (${totalToolCallCount} calls, ${lastImplementationResult?.textToolMode ? 'text mode' : 'native'}).`
      );
      if (totalAppliedChanges > 0 || totalProposedChanges > 0) {
        this.updateStepStatus(implementStep, 'complete');
      } else {
        this.updateStepStatus(implementStep, 'failed');
      }

      this.currentPhase = 'reviewing';
      this.notify();
      await this.pushRunProgress({ phase: this.currentPhase, status: 'running' });
      this.updateStepStatus(reviewStep, 'running');
      await this.waitIfPaused();
      await this.agentSpeak(AGENT_PERSONAS.QA, 'Running verification pass...');

      const verification = await this.runVerification(
        projectRoot,
        runOptions?.qualityGatePolicy || 'build+test+lint'
      );
      const verificationNote = verification?.note ? `\nNote: ${verification.note}` : '';
      const commandOutput = truncateText(
        verification?.stderr || verification?.stdout || '',
        500
      );

      if (verification?.success) {
        this.updateStepStatus(reviewStep, 'complete');
        if (verification?.skipped) {
          await this.agentSpeak(
            AGENT_PERSONAS.QA,
            `Verification skipped (${verification.command}).${verificationNote}${commandOutput ? `\nOutput: ${commandOutput}` : ''}`
          );
        } else {
          await this.agentSpeak(
            AGENT_PERSONAS.QA,
            `Verification succeeded (${verification.command}).${verificationNote}${commandOutput ? `\nOutput: ${commandOutput}` : ''}`
          );
        }
      } else {
        this.updateStepStatus(reviewStep, 'failed');
        await this.agentSpeak(
          AGENT_PERSONAS.QA,
          `Verification failed (${verification?.command || 'unknown command'}).${verificationNote}${commandOutput ? `\nOutput: ${commandOutput}` : ''}`
        );
      }

      const pendingReviewChanges = (useAgentStore.getState().proposedChanges || []).length;
      if (pendingReviewChanges > 0) {
        this.addSystemMessage(
          `Autonomous run complete. ${pendingReviewChanges} change(s) need manual review.`,
          'success'
        );
        agentStore.addLog('Autonomous run completed with reviewable proposed changes.');
      } else if (totalAppliedChanges > 0) {
        this.addSystemMessage(
          `Autonomous run complete. Auto-applied ${totalAppliedChanges} change(s).`,
          'success'
        );
        agentStore.addLog('Autonomous run completed and auto-applied changes.');
      } else {
        this.addSystemMessage(
          'Autonomous run completed without actionable edits. Try a more specific task or a stronger tool-calling model.',
          'warn'
        );
        agentStore.addLog('Autonomous run ended without proposed changes.', 'warn');
      }

      await this.agentSpeak(
        AGENT_PERSONAS.PRODUCT_OWNER,
        'Run complete. Results are ready for your review.'
      );
      agentStore.stopAgent();

      this.activeLLM = null;
      this.isActive = false;
      this.currentPhase = 'idle';
      await this.pushRunProgress({
        status: 'completed',
        phase: 'idle',
        totalToolCallCount,
        totalProposedChanges,
        totalAppliedChanges,
        completionState,
      }, true);
      this.currentRunId = null;
      this.notify();
    } catch (error) {
      const message = error?.message || 'Unknown error';
      const stoppedByUser = /stopped by user/i.test(message);
      console.error('Night Shift Error:', error);
      this.markInFlightStepsFailed();
      this.addSystemMessage(
        stoppedByUser ? 'Agent stopped by user.' : `Critical Error: ${message}`,
        stoppedByUser ? 'warn' : 'error'
      );
      useAgentStore
        .getState()
        .addLog(stoppedByUser ? 'Agent stopped by user.' : `Night shift error: ${message}`, stoppedByUser ? 'warn' : 'error');
      this.activeLLM = null;
      this.isActive = false;
      useAgentStore.getState().stopAgent();
      this.currentPhase = 'idle';
      await this.pushRunProgress({
        status: stoppedByUser ? 'stopped' : 'failed',
        phase: 'idle',
        error: message,
      }, true);
      this.currentRunId = null;
      this.notify();
    }
  }

  async agentSpeak(persona, message) {
    this.discussion.push({
      id: Date.now(),
      sender: persona,
      content: message,
      timestamp: Date.now(),
      type: 'message'
    });
    this.notify();

    // Push to agent store log for UI
    const agentStore = useAgentStore.getState();
    agentStore.addLog(`${persona.name}: ${message}`);
  }

  addSystemMessage(content, type = 'info') {
    this.discussion.push({
      id: Date.now(),
      sender: { name: 'System', id: 'system', color: 'text-gray-400' },
      content,
      timestamp: Date.now(),
      type
    });
    this.notify();
  }

  pause() {
    if (!this.isActive) return;
    useAgentStore.getState().pauseAgent();
    this.addSystemMessage('Agent paused.', 'system');
    void this.pushRunProgress({ status: 'paused', phase: this.currentPhase }, true);
    this.notify();
  }

  resume() {
    if (!this.isActive) return;
    useAgentStore.getState().resumeAgent();
    this.addSystemMessage('Agent resumed.', 'system');
    void this.pushRunProgress({ status: 'running', phase: this.currentPhase }, true);
    this.notify();
  }

  stop() {
    const agentStore = useAgentStore.getState();
    const wasActive = this.isActive;
    this.activeLLM = null;
    this.isActive = false;
    this.currentPhase = 'idle';
    agentStore.stopAgent();
    void this.pushRunProgress({ status: 'stopped', phase: 'idle' }, true);
    this.currentRunId = null;
    if (wasActive) {
      this.addSystemMessage('Agent stopped by user.', 'warn');
      agentStore.addLog('Agent stopped by user.', 'warn');
    }
    this.notify();
  }
}

export const agentOrchestrator = new AgentOrchestrator();
export default agentOrchestrator;
