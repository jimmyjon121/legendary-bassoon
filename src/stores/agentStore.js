import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import { safeCall } from '../utils/electronAPI';

/**
 * Agent Store
 * Tracks autonomous agent state: task, plan, proposed changes, files touched, and logs.
 * This store does not talk to the LLM directly; the orchestrator drives it.
 */

const defaultPlan = () => ({
  id: null,
  steps: [], // { id, title, status: 'pending' | 'running' | 'complete' | 'failed', owner }
  createdAt: Date.now(),
});

const defaultRunProgress = () => ({
  pass: 0,
  totalPasses: 0,
  completedPasses: 0,
  label: '',
  mode: 'single', // single | continuous
});

function normalizePatchOperation(operation, hasNewPath = false) {
  const raw = String(operation || '').trim().toLowerCase();
  if (!raw) return hasNewPath ? 'rename' : 'update';

  if (['create', 'new', 'mk', 'touch', 'create_file'].includes(raw)) return 'create';
  if (['update', 'edit', 'modify', 'change', 'replace', 'patch', 'overwrite', 'update_file'].includes(raw)) return 'update';
  if (['delete', 'remove', 'rm', 'del', 'delete_file'].includes(raw)) return 'delete';
  if (['rename', 'move', 'mv', 'rename_file', 'move_file'].includes(raw)) return 'rename';
  if (['add', 'insert', 'append'].includes(raw)) return 'add';

  return hasNewPath ? 'rename' : 'update';
}

export const useAgentStore = create((set, get) => ({
  // Core task state
  taskDescription: '',
  plan: defaultPlan(),
  currentStep: 0,
  runProgress: defaultRunProgress(),
  pendingClarification: null, // { id, title, questions, defaults, requestedAt }
  clarificationResponse: null, // { requestId, answers, source, ts }
  filesTouched: [], // [{ path, action: 'read' | 'write' | 'command', summary }]
  proposedChanges: [], // [{ id, path, summary, content, diff? }]
  log: [], // [{ id, ts, level, message }]
  isRunning: false,
  isPaused: false,

  // Actions
  reset() {
    set({
      taskDescription: '',
      plan: defaultPlan(),
      currentStep: 0,
      runProgress: defaultRunProgress(),
      pendingClarification: null,
      clarificationResponse: null,
      filesTouched: [],
      proposedChanges: [],
      log: [],
      isRunning: false,
      isPaused: false,
    });
  },

  setTask(task) {
    set({ taskDescription: task });
  },

  setPlan(plan) {
    set({ plan: plan || defaultPlan(), currentStep: 0 });
  },

  updateStepStatus(stepId, status) {
    set((state) => ({
      plan: {
        ...state.plan,
        steps: state.plan.steps.map((s) =>
          s.id === stepId ? { ...s, status } : s
        ),
      },
    }));
  },

  setCurrentStep(index) {
    set({ currentStep: index });
  },

  setRunProgress(patch = {}) {
    set((state) => ({
      runProgress: {
        ...state.runProgress,
        ...(patch || {}),
      },
    }));
  },

  startPass(pass, totalPasses = 0, label = '') {
    set((state) => ({
      runProgress: {
        ...state.runProgress,
        pass: Math.max(0, Number(pass) || 0),
        totalPasses: Math.max(0, Number(totalPasses) || state.runProgress.totalPasses || 0),
        label: label || state.runProgress.label || '',
      },
    }));
  },

  completePass(pass, label = '') {
    set((state) => ({
      runProgress: {
        ...state.runProgress,
        pass: Math.max(state.runProgress.pass || 0, Number(pass) || 0),
        completedPasses: Math.max(state.runProgress.completedPasses || 0, Number(pass) || 0),
        label: label || state.runProgress.label || '',
      },
    }));
  },

  requestClarification(payload = {}) {
    const requestId = payload.id || `clarify-${Date.now()}`;
    set({
      pendingClarification: {
        id: requestId,
        title: payload.title || 'Quick clarification needed',
        questions: Array.isArray(payload.questions) ? payload.questions : [],
        defaults: payload.defaults || {},
        requestedAt: Date.now(),
      },
      clarificationResponse: null,
      isPaused: true,
    });
  },

  submitClarification(answers = {}, source = 'user') {
    const requestId = get().pendingClarification?.id;
    if (!requestId) return;
    set({
      clarificationResponse: {
        requestId,
        answers: answers || {},
        source,
        ts: Date.now(),
      },
      pendingClarification: null,
      isPaused: false,
    });
  },

  takeClarificationResponse(requestId) {
    const response = get().clarificationResponse;
    if (!response) return null;
    if (requestId && response.requestId !== requestId) return null;
    set({ clarificationResponse: null });
    return response;
  },

  clearClarification() {
    set({
      pendingClarification: null,
      clarificationResponse: null,
      isPaused: false,
    });
  },

  addLog(message, level = 'info') {
    const entry = { id: `${Date.now()}-${Math.random()}`, ts: Date.now(), level, message };
    set((state) => ({ log: [...state.log, entry] }));
  },

  addFilesTouched(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    set((state) => ({
      filesTouched: [...state.filesTouched, ...entries],
    }));
  },

  addProposedChange(change) {
    if (!change?.id) return;
    set((state) => ({
      proposedChanges: [...state.proposedChanges, change],
    }));
  },

  replaceProposedChanges(changes = []) {
    set({ proposedChanges: changes });
  },

  removeProposedChange(id) {
    set((state) => ({
      proposedChanges: state.proposedChanges.filter((c) => c.id !== id),
    }));
  },

  startTask(task, plan) {
    set({
      taskDescription: task,
      plan: plan || defaultPlan(),
      currentStep: 0,
      runProgress: defaultRunProgress(),
      pendingClarification: null,
      clarificationResponse: null,
      isRunning: true,
      isPaused: false,
      log: [],
      filesTouched: [],
      proposedChanges: [],
    });
  },

  pauseAgent() {
    set({ isPaused: true });
  },

  resumeAgent() {
    set({ isPaused: false });
  },

  stopAgent() {
    set({
      isRunning: false,
      isPaused: false,
      pendingClarification: null,
      clarificationResponse: null,
    });
  },

  /**
   * Approve a proposed change: apply via code-tools patch IPC and sync editor buffers.
   */
  async approveChange(id) {
    const change = get().proposedChanges.find((c) => c.id === id);
    if (!change) return false;

    const editorStore = useEditorStore.getState();
    const projectRoot = editorStore.rootPath || '';

    if (!change.path || !projectRoot) {
      get().addLog('Cannot apply change: missing project root or file path.', 'error');
      return false;
    }

    const normalizedPath = String(change.path).replace(/\\/g, '/');
    const rootRegex = new RegExp(`^${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}[\\\\/]?`);
    const relativePath = normalizedPath.replace(rootRegex, '');
    const operation = normalizePatchOperation(
      change.operation || (change.newPath ? 'rename' : 'update'),
      Boolean(change.newPath)
    );
    let absolutePath = normalizedPath;
    if (!absolutePath.startsWith('/') && !absolutePath.match(/^[A-Za-z]:/)) {
      absolutePath = `${projectRoot}/${absolutePath}`.replace(/\/+/g, '/');
    }

    const hasLineRange = Number.isInteger(change.startLine) && change.startLine > 0;
    const hasOldContent =
      typeof change.oldContent === 'string'
        ? change.oldContent.trim().length > 0
        : typeof change.before === 'string'
          ? change.before.trim().length > 0
          : false;
    const canDirectWriteUpdate =
      operation === 'update' &&
      change.content !== undefined &&
      !hasLineRange &&
      !hasOldContent &&
      !change.newPath;

    if ((operation === 'create' && change.content !== undefined) || canDirectWriteUpdate) {
      const writeOk = await safeCall('writeFile', [absolutePath, change.content], false);
      if (!writeOk) {
        get().addLog(`Failed to write file ${change.path}`, 'error');
        return false;
      }

      await editorStore.applyAgentChange(absolutePath, change.content, {
        id,
        summary: change.summary || 'Agent change',
        persisted: true,
      });
    } else {
      const patch = {
        path: relativePath,
        operation,
        startLine: change.startLine,
        endLine: change.endLine,
        oldContent: change.oldContent || change.before,
        newContent: change.content,
        newPath: change.newPath || undefined,
      };

      const applyResult = await safeCall(
        'toolApplyPatch',
        [projectRoot, patch],
        { success: false, error: 'Tool not available' }
      );

      if (applyResult?.error || applyResult?.success === false) {
        get().addLog(
          `Failed to apply change ${change.path}: ${applyResult?.error || 'unknown error'}`,
          'error'
        );
        return false;
      }
    }

    await editorStore.scanProject(projectRoot);
    get().addLog(`Saved: ${change.path}`);

    set((state) => ({
      proposedChanges: state.proposedChanges.filter((c) => c.id !== id),
    }));
    return true;
  },

  /**
   * Approve all proposed changes at once
   */
  async approveAllChanges() {
    const changes = get().proposedChanges;
    const results = [];
    for (const change of changes) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await get().approveChange(change.id);
      results.push({ id: change.id, success: Boolean(ok) });
    }
    return results;
  },

  rejectChange(id) {
    set((state) => ({
      proposedChanges: state.proposedChanges.filter((c) => c.id !== id),
    }));
  },
}));

export default useAgentStore;
