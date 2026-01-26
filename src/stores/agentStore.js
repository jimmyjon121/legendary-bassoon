import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import { api } from '../utils/electronAPI';

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

export const useAgentStore = create((set, get) => ({
  // Core task state
  taskDescription: '',
  plan: defaultPlan(),
  currentStep: 0,
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
    set({ isRunning: false, isPaused: false });
  },

  /**
   * Approve a proposed change: applies content to editor store and writes to disk.
   */
  async approveChange(id) {
    const change = get().proposedChanges.find((c) => c.id === id);
    if (!change) return;

    const editorStore = useEditorStore.getState();
    const projectRoot = editorStore.projectRoot || '';
    
    if (change.path && change.content !== undefined) {
      // Resolve path relative to project root
      let filePath = change.path.replace(/\\/g, '/');
      
      // If path is relative and we have a project root, make it absolute
      if (projectRoot && !filePath.startsWith('/') && !filePath.match(/^[A-Za-z]:/)) {
        filePath = `${projectRoot}/${filePath}`.replace(/\/+/g, '/');
      }
      
      // Ensure parent directory exists
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (parentDir) {
        try {
          await api.createFolder(parentDir);
        } catch (error) {
          console.warn('Could not create parent directory:', error);
        }
      }
      
      // Apply the change (this writes to disk)
      await editorStore.applyAgentChange(filePath, change.content, {
        id,
        summary: change.summary || 'Agent change',
      });
      
      get().addLog(`✅ Saved: ${filePath}`);
    }

    set((state) => ({
      proposedChanges: state.proposedChanges.filter((c) => c.id !== id),
    }));
  },

  /**
   * Approve all proposed changes at once
   */
  async approveAllChanges() {
    const changes = get().proposedChanges;
    for (const change of changes) {
      await get().approveChange(change.id);
    }
  },

  rejectChange(id) {
    set((state) => ({
      proposedChanges: state.proposedChanges.filter((c) => c.id !== id),
    }));
  },
}));

export default useAgentStore;
