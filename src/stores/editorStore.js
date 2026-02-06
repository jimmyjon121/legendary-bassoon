import { create } from 'zustand';
import { api } from '../utils/electronAPI';
import { analyzeProjectStructure } from '../services/projectAnalyzer';
import { buildCodeIndex, getCodeIndexSummary } from '../services/codeIndexer';

const MAX_HISTORY = 50;
const MAX_CHECKPOINTS = 20;

export const useEditorStore = create((set, get) => ({
  // ============================================
  // Basic Editor State
  // ============================================
  rootPath: '',
  files: [], // project tree
  activeFilePath: '',
  openFiles: {}, // path -> { content, dirty }
  fileHistory: {}, // path -> { undo: [], redo: [] }
  pendingAgentActions: [],
  projectContext: null,
  codeIndexSummary: null,
  isIndexingCode: false,
  isScanning: false,
  isAnalyzingProject: false,
  error: null,

  // ============================================
  // AI Session State
  // ============================================
  aiSession: {
    sessionId: null,
    startedAt: null,
    filesRead: [],           // Provenance: files AI has seen
    toolCalls: [],           // History of tool calls  
    proposedPatches: [],     // Pending changes from AI
    appliedPatches: [],      // Applied changes
    rejectedPatches: [],     // Rejected changes
    checkpoints: [],         // Rewindable states
    contextBundle: {         // What AI currently sees
      currentFile: null,
      relatedFiles: [],
      searchResults: [],
      recentDiffs: [],
      projectBrain: null
    },
    isProcessing: false,
    currentToolCall: null
  },

  // ============================================
  // AI Session Actions
  // ============================================
  
  startAISession() {
    const sessionId = `session_${Date.now()}`;
    set({
      aiSession: {
        sessionId,
        startedAt: Date.now(),
        filesRead: [],
        toolCalls: [],
        proposedPatches: [],
        appliedPatches: [],
        rejectedPatches: [],
        checkpoints: [],
        contextBundle: {
          currentFile: get().activeFilePath,
          relatedFiles: [],
          searchResults: [],
          recentDiffs: [],
          projectBrain: null
        },
        isProcessing: false,
        currentToolCall: null
      }
    });
    return sessionId;
  },

  recordToolCall(toolCall) {
    set((state) => ({
      aiSession: {
        ...state.aiSession,
        toolCalls: [...state.aiSession.toolCalls, {
          ...toolCall,
          timestamp: Date.now()
        }],
        currentToolCall: toolCall
      }
    }));
  },

  completeToolCall(toolCallId, result) {
    set((state) => ({
      aiSession: {
        ...state.aiSession,
        toolCalls: state.aiSession.toolCalls.map(tc =>
          tc.id === toolCallId ? { ...tc, result, completedAt: Date.now() } : tc
        ),
        currentToolCall: null
      }
    }));
  },

  recordFileRead(path, content) {
    set((state) => {
      // Avoid duplicates
      const existing = state.aiSession.filesRead.find(f => f.path === path);
      if (existing) {
        return {
          aiSession: {
            ...state.aiSession,
            filesRead: state.aiSession.filesRead.map(f =>
              f.path === path ? { ...f, readAt: Date.now(), size: content?.length || 0 } : f
            )
          }
        };
      }
      return {
        aiSession: {
          ...state.aiSession,
          filesRead: [...state.aiSession.filesRead, {
            path,
            readAt: Date.now(),
            size: content?.length || 0
          }]
        }
      };
    });
  },

  addProposedPatch(patch) {
    set((state) => ({
      aiSession: {
        ...state.aiSession,
        proposedPatches: [...state.aiSession.proposedPatches, {
          ...patch,
          id: patch.id || `patch_${Date.now()}`,
          proposedAt: Date.now(),
          status: 'pending'
        }]
      }
    }));
  },

  approvePatch(patchId) {
    set((state) => {
      const patch = state.aiSession.proposedPatches.find(p => p.id === patchId);
      if (!patch) return state;
      
      return {
        aiSession: {
          ...state.aiSession,
          proposedPatches: state.aiSession.proposedPatches.filter(p => p.id !== patchId),
          appliedPatches: [...state.aiSession.appliedPatches, {
            ...patch,
            status: 'applied',
            appliedAt: Date.now()
          }]
        }
      };
    });
  },

  rejectPatch(patchId, reason = '') {
    set((state) => {
      const patch = state.aiSession.proposedPatches.find(p => p.id === patchId);
      if (!patch) return state;
      
      return {
        aiSession: {
          ...state.aiSession,
          proposedPatches: state.aiSession.proposedPatches.filter(p => p.id !== patchId),
          rejectedPatches: [...state.aiSession.rejectedPatches, {
            ...patch,
            status: 'rejected',
            rejectedAt: Date.now(),
            rejectionReason: reason
          }]
        }
      };
    });
  },

  createCheckpoint(label = '') {
    const state = get();
    const checkpoint = {
      id: `checkpoint_${Date.now()}`,
      label: label || `Checkpoint ${state.aiSession.checkpoints.length + 1}`,
      createdAt: Date.now(),
      sessionId: state.aiSession.sessionId,
      filesRead: state.aiSession.filesRead.length,
      toolCalls: state.aiSession.toolCalls.length,
      appliedPatches: state.aiSession.appliedPatches.map(p => p.id),
      openFiles: Object.keys(state.openFiles),
      activeFile: state.activeFilePath,
      // Snapshot of file contents for potential rewind
      fileSnapshots: Object.fromEntries(
        Object.entries(state.openFiles).map(([path, file]) => [path, file.content])
      )
    };
    
    set((s) => ({
      aiSession: {
        ...s.aiSession,
        checkpoints: [...s.aiSession.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS)
      }
    }));
    
    return checkpoint;
  },

  rewindToCheckpoint(checkpointId) {
    const { aiSession } = get();
    const checkpoint = aiSession.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;
    
    // Restore file contents from checkpoint
    set((state) => ({
      openFiles: Object.fromEntries(
        Object.entries(checkpoint.fileSnapshots).map(([path, content]) => [
          path,
          { content, dirty: true }
        ])
      ),
      activeFilePath: checkpoint.activeFile
    }));
    
    return true;
  },

  updateContextBundle(updates) {
    set((state) => ({
      aiSession: {
        ...state.aiSession,
        contextBundle: {
          ...state.aiSession.contextBundle,
          ...updates
        }
      }
    }));
  },

  setAIProcessing(isProcessing) {
    set((state) => ({
      aiSession: {
        ...state.aiSession,
        isProcessing
      }
    }));
  },

  clearAISession() {
    set({
      aiSession: {
        sessionId: null,
        startedAt: null,
        filesRead: [],
        toolCalls: [],
        proposedPatches: [],
        appliedPatches: [],
        rejectedPatches: [],
        checkpoints: [],
        contextBundle: {
          currentFile: null,
          relatedFiles: [],
          searchResults: [],
          recentDiffs: [],
          projectBrain: null
        },
        isProcessing: false,
        currentToolCall: null
      }
    });
  },

  getAISessionStats() {
    const { aiSession } = get();
    return {
      sessionId: aiSession.sessionId,
      duration: aiSession.startedAt ? Date.now() - aiSession.startedAt : 0,
      filesRead: aiSession.filesRead.length,
      toolCalls: aiSession.toolCalls.length,
      pendingPatches: aiSession.proposedPatches.length,
      appliedPatches: aiSession.appliedPatches.length,
      rejectedPatches: aiSession.rejectedPatches.length,
      checkpoints: aiSession.checkpoints.length
    };
  },

  async chooseProjectRoot() {
    try {
      const folder = await api.selectFolder({ title: 'Select project root' });
      if (!folder) return;
      await get().scanProject(folder);
    } catch (error) {
      console.error('Failed to choose project root:', error);
      set({ error: error?.message || 'Failed to choose project root' });
    }
  },

  async scanProject(rootPath) {
    set({ isScanning: true, error: null });
    try {
      const result = await api.scanProject(rootPath, { maxDepth: 6 });
      set({
        rootPath: result?.root || rootPath,
        files: Array.isArray(result?.tree) ? result.tree : [],
        isScanning: false,
      });
    } catch (error) {
      console.error('[EditorStore] Failed to scan project:', error);
      // Even if scan fails, still set the rootPath so user can create files
      set({
        rootPath: rootPath,
        files: [],
        isScanning: false,
        error: error?.message || 'Failed to scan project',
      });
    }
  },

  async createFile(fileName) {
    const { rootPath } = get();
    if (!rootPath || !fileName) return null;
    
    const filePath = `${rootPath}/${fileName}`.replace(/\\/g, '/');
    try {
      await api.writeFile(filePath, '');
      // Rescan to pick up new file
      await get().scanProject(rootPath);
      // Open the new file
      await get().openFile(filePath);
      return filePath;
    } catch (error) {
      console.error('Failed to create file:', error);
      set({ error: error?.message || 'Failed to create file' });
      return null;
    }
  },

  async createFolder(folderName) {
    const { rootPath } = get();
    if (!rootPath || !folderName) return null;
    
    const folderPath = `${rootPath}/${folderName}`.replace(/\\/g, '/');
    try {
      await api.createFolder(folderPath);
      // Rescan to pick up new folder
      await get().scanProject(rootPath);
      return folderPath;
    } catch (error) {
      console.error('Failed to create folder:', error);
      set({ error: error?.message || 'Failed to create folder' });
      return null;
    }
  },

  async openFile(path) {
    const { openFiles } = get();
    if (openFiles[path] && openFiles[path].content != null) {
      set({ activeFilePath: path });
      return;
    }
    try {
      const content = await api.readFile(path);
      set((state) => ({
        activeFilePath: path,
        openFiles: {
          ...state.openFiles,
          [path]: { content: content || '', dirty: false },
        },
      }));
    } catch (error) {
      console.error('[EditorStore] Failed to open file:', error);
      set({ error: error?.message || 'Failed to open file' });
    }
  },

  setActiveFile(path) {
    if (!path) return;
    set({ activeFilePath: path });
  },

  closeFileTab(path) {
    set((state) => {
      if (!state.openFiles[path]) return state;
      const nextFiles = { ...state.openFiles };
      delete nextFiles[path];
      const nextHistory = { ...state.fileHistory };
      delete nextHistory[path];
      let nextActive = state.activeFilePath;
      if (state.activeFilePath === path) {
        const remaining = Object.keys(nextFiles);
        nextActive = remaining[0] || '';
      }
      return {
        openFiles: nextFiles,
        fileHistory: nextHistory,
        activeFilePath: nextActive,
      };
    });
  },

  updateActiveFileContent(value) {
    const { activeFilePath, openFiles, fileHistory } = get();
    if (!activeFilePath) return;
    const currentContent = openFiles[activeFilePath]?.content ?? '';
    const history = fileHistory[activeFilePath] || { undo: [], redo: [] };
    const nextHistory = {
      undo: [currentContent, ...history.undo].slice(0, MAX_HISTORY),
      redo: [],
    };
    set({
      openFiles: {
        ...openFiles,
        [activeFilePath]: { ...(openFiles[activeFilePath] || {}), content: value, dirty: true },
      },
      fileHistory: {
        ...fileHistory,
        [activeFilePath]: nextHistory,
      },
    });
  },

  undoChange(path) {
    const targetPath = path || get().activeFilePath;
    if (!targetPath) return;
    const { fileHistory, openFiles } = get();
    const history = fileHistory[targetPath];
    if (!history?.undo?.length) return;
    const [previous, ...remainingUndo] = history.undo;
    const currentContent = openFiles[targetPath]?.content ?? '';

    set({
      openFiles: {
        ...openFiles,
        [targetPath]: { ...(openFiles[targetPath] || {}), content: previous, dirty: true },
      },
      fileHistory: {
        ...fileHistory,
        [targetPath]: {
          undo: remainingUndo,
          redo: [currentContent, ...(history.redo || [])].slice(0, MAX_HISTORY),
        },
      },
    });
  },

  redoChange(path) {
    const targetPath = path || get().activeFilePath;
    if (!targetPath) return;
    const { fileHistory, openFiles } = get();
    const history = fileHistory[targetPath];
    if (!history?.redo?.length) return;
    const [nextContent, ...remainingRedo] = history.redo;
    const currentContent = openFiles[targetPath]?.content ?? '';

    set({
      openFiles: {
        ...openFiles,
        [targetPath]: { ...(openFiles[targetPath] || {}), content: nextContent, dirty: true },
      },
      fileHistory: {
        ...fileHistory,
        [targetPath]: {
          undo: [currentContent, ...(history.undo || [])].slice(0, MAX_HISTORY),
          redo: remainingRedo,
        },
      },
    });
  },

  applyAgentChange(path, nextContent, metadata = {}) {
    if (!path) return;
    const { openFiles, pendingAgentActions } = get();
    const previous = openFiles[path]?.content ?? '';
    const actionId = metadata.id || `${Date.now()}`;

    set((state) => ({
      openFiles: {
        ...state.openFiles,
        [path]: { ...(state.openFiles[path] || {}), content: nextContent, dirty: true },
      },
      fileHistory: {
        ...state.fileHistory,
        [path]: {
          undo: [previous, ...(state.fileHistory[path]?.undo || [])].slice(0, MAX_HISTORY),
          redo: [],
        },
      },
      pendingAgentActions: [
        ...pendingAgentActions,
        {
          id: actionId,
          summary: metadata.summary || 'Agent change',
          timestamp: Date.now(),
          path,
        },
      ],
    }));
  },

  clearAgentAction(id) {
    if (!id) return;
    set((state) => ({
      pendingAgentActions: state.pendingAgentActions.filter((action) => action.id !== id),
    }));
  },

  async saveActiveFile() {
    const { activeFilePath, openFiles } = get();
    if (!activeFilePath || !openFiles[activeFilePath]) return;
    try {
      await api.writeFile(activeFilePath, openFiles[activeFilePath].content);
      set({
        openFiles: {
          ...openFiles,
          [activeFilePath]: {
            ...openFiles[activeFilePath],
            dirty: false,
          },
        },
      });
    } catch (error) {
      console.error('Failed to save file:', error);
      set({ error: error?.message || 'Failed to save file' });
    }
  },

  async analyzeProject() {
    const { rootPath, files } = get();
    if (!rootPath) return;
    set({ isAnalyzingProject: true, isIndexingCode: true });
    try {
      const [summary] = await Promise.all([
        analyzeProjectStructure(rootPath),
        buildCodeIndex(rootPath, files || []),
      ]);
      set({
        projectContext: summary,
        codeIndexSummary: getCodeIndexSummary(),
        isAnalyzingProject: false,
        isIndexingCode: false,
      });
    } catch (error) {
      console.error('Failed to analyze project:', error);
      set({ isAnalyzingProject: false, isIndexingCode: false });
    }
  },

  setProjectContext(projectContext) {
    set({ projectContext });
  },
}));

export default useEditorStore;


