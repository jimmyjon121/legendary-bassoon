import { create } from 'zustand';
import { api } from '../utils/electronAPI';
import { analyzeProjectStructure } from '../services/projectAnalyzer';
import { buildCodeIndex, getCodeIndexSummary } from '../services/codeIndexer';

const MAX_HISTORY = 50;

export const useEditorStore = create((set, get) => ({
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
      console.error('Failed to scan project:', error);
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
      console.error('Failed to open file:', error);
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


