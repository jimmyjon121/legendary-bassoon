// DevForge App Store - Combined from focused slices
// This is the main store that combines all feature slices for optimal performance

import { create } from 'zustand';
import { shallow } from 'zustand/shallow';
import { describeSettings } from '../services/modelOptimizer';
import {
  createWorkspaceSlice,
  createModelSlice,
  createUiSlice,
  createGenerationSlice,
  createConversationSlice,
  createMessageSlice,
  createOrganizationSlice,
  createProjectSlice,
  createDownloadSlice,
  createInstallerSlice,
  createScannerSlice,
  createConverterSlice,
  createCollectionsSlice,
  createModelCatalogSlice,
  JobStatus,
  Engine,
  ModelType,
  WORKSPACES,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_SECTION_ORDER,
  DEFAULT_SIDEBAR_SECTION_VISIBILITY,
  clampSidebarWidth,
  normalizeSidebarSectionOrder,
  normalizeSidebarSectionVisibility,
  normalizeActiveProjectByWorkspace,
} from './slices';

// Re-export WORKSPACES, JobStatus, Engine, ModelType for backward compatibility
export { WORKSPACES, JobStatus, Engine, ModelType };

export const useAppStore = create((set, get) => ({
  // === Core App State ===
  initialized: false,
  isLoading: false,
  error: null,
  
  // === Initialize App ===
  initializeApp: async () => {
    try {
      set({ isLoading: true });
      
      // Use batched IPC call for faster startup (single round-trip)
      const settings = await window.electronAPI?.getSettingsBatch?.([
        'lastWorkspace',
        'currentModel',
        'ragInfluence',
        'streamingRenderMode',
        'fastChatMode',
        'sidebarCollapsed',
        'sidebarWidth',
        'sidebarSectionOrder',
        'sidebarSectionVisibility',
        'activeProjectByWorkspace',
        'autoWarmupOnLaunch',
      ]) || {};
      
      // Fallback to individual calls if batch not available
      const savedWorkspace = settings.lastWorkspace ?? await window.electronAPI?.getSettings('lastWorkspace');
      const savedModel = settings.currentModel ?? await window.electronAPI?.getSettings('currentModel');
      const savedRagInfluence = settings.ragInfluence ?? await window.electronAPI?.getSettings('ragInfluence');
      const savedStreamingRenderMode = settings.streamingRenderMode ?? await window.electronAPI?.getSettings('streamingRenderMode');
      const savedFastChatMode = settings.fastChatMode ?? await window.electronAPI?.getSettings('fastChatMode');
      const savedSidebarCollapsed = settings.sidebarCollapsed ?? await window.electronAPI?.getSettings('sidebarCollapsed');
      const savedSidebarWidth = settings.sidebarWidth ?? await window.electronAPI?.getSettings('sidebarWidth');
      const savedSidebarSectionOrder = settings.sidebarSectionOrder ?? await window.electronAPI?.getSettings('sidebarSectionOrder');
      const savedSidebarSectionVisibility = settings.sidebarSectionVisibility ?? await window.electronAPI?.getSettings('sidebarSectionVisibility');
      const savedActiveProjectByWorkspace = settings.activeProjectByWorkspace ?? await window.electronAPI?.getSettings('activeProjectByWorkspace');
      const savedAutoWarmupOnLaunch = settings.autoWarmupOnLaunch ?? await window.electronAPI?.getSettings('autoWarmupOnLaunch');
      const streamingRenderMode = ['hybrid', 'plain_stream', 'full_rich'].includes(savedStreamingRenderMode)
        ? savedStreamingRenderMode
        : 'hybrid';
      const sidebarWidth = savedSidebarWidth == null
        ? DEFAULT_SIDEBAR_WIDTH
        : clampSidebarWidth(savedSidebarWidth);
      const sidebarSectionOrder = savedSidebarSectionOrder == null
        ? [...DEFAULT_SIDEBAR_SECTION_ORDER]
        : normalizeSidebarSectionOrder(savedSidebarSectionOrder);
      const sidebarSectionVisibility = savedSidebarSectionVisibility == null
        ? { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY }
        : normalizeSidebarSectionVisibility(savedSidebarSectionVisibility);
      const activeProjectByWorkspace = normalizeActiveProjectByWorkspace(savedActiveProjectByWorkspace);
      
      // Important: Set workspace FIRST so loadConversations filters correctly
      const workspace = savedWorkspace || 'casual';

      // Try to auto-unlock the Vault if the user opted in to "Remember me" on
      // a previous session. The password is stored only via OS-bound safeStorage
      // (Windows DPAPI / macOS Keychain / Linux libsecret) and only usable by
      // the same OS user account on the same machine.
      let autoUnlocked = false;
      let autoUnlockPassword = null;
      try {
        const remembered = await window.electronAPI?.getRememberedNsfwPassword?.();
        if (remembered?.success && typeof remembered.password === 'string' && remembered.password) {
          const verify = await window.electronAPI?.verifyNsfwPassword?.(remembered.password);
          if (verify?.verified) {
            autoUnlocked = true;
            autoUnlockPassword = remembered.password;
          } else {
            // Stored password no longer matches (user rotated it) — drop the blob.
            try { await window.electronAPI?.forgetNsfwPassword?.(); } catch (_) { /* noop */ }
          }
        }
      } catch (_) { /* non-blocking */ }

      // Only restore the Vault workspace if we successfully auto-unlocked.
      const safeWorkspace = workspace === 'nsfw' && !autoUnlocked ? 'casual' : workspace;
      set({
        currentWorkspace: safeWorkspace,
        activeProjectByWorkspace,
        activeProjectId: activeProjectByWorkspace[safeWorkspace] || null,
        ...(autoUnlocked
          ? { isLocked: false, nsfwPassword: autoUnlockPassword }
          : {}),
      });
      
      // Default: do NOT warm the last-used model on launch. Users opt in
      // explicitly via Settings -> Performance ("Auto-warm last model on launch").
      const shouldAutoWarmup = savedAutoWarmupOnLaunch === true;
      const llmBootstrapTask = get().initializeLlm
        ? get().initializeLlm({
          requestedModel: savedModel ?? undefined,
          warmup: Boolean(savedModel) && shouldAutoWarmup,
          updateError: false,
        }).catch((error) => {
          console.warn('[AppStore] LLM bootstrap degraded:', error?.message || error);
          return null;
        })
        : Promise.resolve(null);

      const [conversations] = await Promise.all([
        get().loadConversations(),
        llmBootstrapTask,
      ]);
      
      set({
        initialized: true,
        isLoading: false,
        conversations,
        ragInfluence: typeof savedRagInfluence === 'number' ? savedRagInfluence : 0.5,
        streamingRenderMode,
        fastChatMode: Boolean(savedFastChatMode),
        sidebarCollapsed: Boolean(savedSidebarCollapsed),
        sidebarWidth,
        sidebarSectionOrder,
        sidebarSectionVisibility,
        activeProjectByWorkspace,
        activeProjectId: activeProjectByWorkspace[safeWorkspace] || null,
      });
      
      // Load folders and tags for current workspace (non-blocking)
      get().loadFolders?.();
      get().loadWorkspaceTags?.();
      get().loadProjects?.(safeWorkspace);
    } catch (error) {
      set({ error: error.message, isLoading: false });
    }
  },

  // Clear error
  clearError: () => set({ error: null }),

  // === Combine All Slices ===
  ...createWorkspaceSlice(set, get),
  ...createModelSlice(set, get),
  ...createUiSlice(set, get),
  ...createGenerationSlice(set, get),
  ...createConversationSlice(set, get),
  ...createMessageSlice(set, get),
  ...createOrganizationSlice(set, get),
  ...createProjectSlice(set, get),
  ...createDownloadSlice(set, get),
  ...createInstallerSlice(set, get),
  ...createScannerSlice(set, get),
  ...createConverterSlice(set, get),
  ...createCollectionsSlice(set, get),
  ...createModelCatalogSlice(set, get),
}));

// === Selective Subscription Helpers ===
// Use these for optimal re-render performance

// Workspace selectors
export const useCurrentWorkspace = () => useAppStore(s => s.currentWorkspace);
export const useIsLocked = () => useAppStore(s => s.isLocked);

// Model selectors
export const useCurrentModel = () => useAppStore(s => s.currentModel);
export const useAvailableModels = () => useAppStore(s => s.availableModels);
export const useModelStatus = () => useAppStore(s => s.modelStatus);

// Model optimization info
export const getModelOptimizationInfo = async (modelName) => {
  return describeSettings(modelName);
};

// Conversation selectors
export const useConversations = () => useAppStore(s => s.conversations);
export const useCurrentConversationId = () => useAppStore(s => s.currentConversationId);
export const useMessages = () => useAppStore(s => s.messages);
export const useBranches = () => useAppStore(s => s.branches);

// Generation selectors
export const useIsGenerating = () => useAppStore(s => s.isGenerating);
export const useStreamingContent = () => useAppStore(s => s.streamingContent);
export const useGenerationMetadata = () => useAppStore(s => s.generationMetadata);
export const useRagContext = () => useAppStore(s => s.ragContext);

// UI selectors
export const useShowSettings = () => useAppStore(s => s.showSettings);
export const useShowImageGen = () => useAppStore(s => s.showImageGen);
export const useShowModelHub = () => useAppStore(s => s.showModelHub);
export const useShowExportModal = () => useAppStore(s => s.showExportModal);
export const useSidebarCollapsed = () => useAppStore(s => s.sidebarCollapsed);

// Organization selectors
export const useFolders = () => useAppStore(s => s.folders);
export const useActiveFolderId = () => useAppStore(s => s.activeFolderId);
export const useActiveFilter = () => useAppStore(s => s.activeFilter);
export const useSearchQuery = () => useAppStore(s => s.searchQuery);
export const useSearchResults = () => useAppStore(s => s.searchResults);
export const useIsSearching = () => useAppStore(s => s.isSearching);
export const useWorkspaceTags = () => useAppStore(s => s.workspaceTags);
export const useFilteredConversations = () => useAppStore(s => s.getFilteredConversations());

// Combined selectors for common patterns
export const useChatState = () => useAppStore(s => ({
  messages: s.messages,
  isGenerating: s.isGenerating,
  streamingContent: s.streamingContent,
  currentModel: s.currentModel,
}), shallow);

export const useWorkspaceState = () => useAppStore(s => ({
  currentWorkspace: s.currentWorkspace,
  isLocked: s.isLocked,
  workspaceSettings: s.workspaceSettings,
}), shallow);

// Action selectors (these never cause re-renders)
export const useAppActions = () => useAppStore(s => ({
  sendMessage: s.sendMessage,
  stopGeneration: s.stopGeneration,
  createConversation: s.createConversation,
  selectConversation: s.selectConversation,
  deleteConversation: s.deleteConversation,
  setModel: s.setModel,
  setWorkspace: s.setWorkspace,
  toggleSettings: s.toggleSettings,
  toggleImageGen: s.toggleImageGen,
  toggleModelHub: s.toggleModelHub,
}), shallow);

// Organization action selectors
export const useOrganizationActions = () => useAppStore(s => ({
  loadFolders: s.loadFolders,
  createFolder: s.createFolder,
  updateFolder: s.updateFolder,
  deleteFolder: s.deleteFolder,
  setActiveFolder: s.setActiveFolder,
  moveToFolder: s.moveToFolder,
  toggleStar: s.toggleStar,
  togglePin: s.togglePin,
  setTags: s.setTags,
  setActiveFilter: s.setActiveFilter,
  setSearchQuery: s.setSearchQuery,
  search: s.search,
  clearSearch: s.clearSearch,
  loadWorkspaceTags: s.loadWorkspaceTags,
  getFilteredConversations: s.getFilteredConversations,
}), shallow);

// Download selectors
export const useDownloads = () => useAppStore(s => s.downloads);
export const useDownloadsLoading = () => useAppStore(s => s.downloadsLoading);
export const useDownloadStats = () => useAppStore(s => s.getDownloadStats?.() || { total: 0, active: 0, paused: 0, completed: 0, failed: 0, queued: 0, totalSpeed: 0 });

// Download action selectors
export const useDownloadActions = () => useAppStore(s => ({
  initializeDownloads: s.initializeDownloads,
  createDownload: s.createDownload,
  pauseDownload: s.pauseDownload,
  resumeDownload: s.resumeDownload,
  retryDownload: s.retryDownload,
  cancelDownload: s.cancelDownload,
  deleteDownload: s.deleteDownload,
  setDownloadPriority: s.setDownloadPriority,
  scheduleDownload: s.scheduleDownload,
  clearCompletedDownloads: s.clearCompletedDownloads,
  getActiveDownloads: s.getActiveDownloads,
  getPausedDownloads: s.getPausedDownloads,
  getCompletedDownloads: s.getCompletedDownloads,
  getFailedDownloads: s.getFailedDownloads,
  getDownloadById: s.getDownloadById,
}), shallow);

// Installer selectors
export const useAvailableEngines = () => useAppStore(s => s.availableEngines);
export const useActiveInstallations = () => useAppStore(s => s.activeInstallations);
export const usePendingDependencies = () => useAppStore(s => s.pendingDependencies);
export const useEnginesLoading = () => useAppStore(s => s.enginesLoading);

// Installer action selectors
export const useInstallerActions = () => useAppStore(s => ({
  initializeInstaller: s.initializeInstaller,
  refreshEngines: s.refreshEngines,
  getEnginesForType: s.getEnginesForType,
  getRecommendedEngine: s.getRecommendedEngine,
  installModel: s.installModel,
  validateModel: s.validateModel,
  checkModelReadiness: s.checkModelReadiness,
  uninstallModel: s.uninstallModel,
  setEnginePath: s.setEnginePath,
  clearPendingDependencies: s.clearPendingDependencies,
  clearCompletedInstallations: s.clearCompletedInstallations,
  getEngineById: s.getEngineById,
  getActiveInstallationsCount: s.getActiveInstallationsCount,
}), shallow);

// Scanner selectors
export const useScannerSources = () => useAppStore(s => s.scannerSources);
export const useDiscoveredModels = () => useAppStore(s => s.discoveredModels);
export const useScannerLoading = () => useAppStore(s => s.scannerLoading);
export const useScanResults = () => useAppStore(s => s.scanResults);
export const useCurrentScanSource = () => useAppStore(s => s.currentScanSource);

// Scanner action selectors
export const useScannerActions = () => useAppStore(s => ({
  initializeScanner: s.initializeScanner,
  refreshSources: s.refreshSources,
  scanAll: s.scanAll,
  loadDiscoveredModels: s.loadDiscoveredModels,
  getModelsBySource: s.getModelsBySource,
  getModelsByType: s.getModelsByType,
  addCustomPath: s.addCustomPath,
  removeCustomPath: s.removeCustomPath,
  importModel: s.importModel,
  linkModel: s.linkModel,
  moveModel: s.moveModel,
  startWatching: s.startWatching,
  stopWatching: s.stopWatching,
  clearScanner: s.clearScanner,
  getDetectedSources: s.getDetectedSources,
  getModelsBySourceLocal: s.getModelsBySourceLocal,
  getModelsByTypeLocal: s.getModelsByTypeLocal,
  getScanStats: s.getScanStats,
}), shallow);

// Converter selectors
export const useConversionJobs = () => useAppStore(s => s.conversionJobs);
export const useQuantTypes = () => useAppStore(s => s.quantTypes);
export const useSupportedConversions = () => useAppStore(s => s.supportedConversions);
export const useIsLoadingConversions = () => useAppStore(s => s.isLoadingConversions);

// Converter action selectors
export const useConverterActions = () => useAppStore(s => ({
  fetchConversionJobs: s.fetchConversionJobs,
  getSupportedConversions: s.getSupportedConversions,
  createConversionJob: s.createConversionJob,
  cancelConversionJob: s.cancelConversionJob,
  clearCompletedJobs: s.clearCompletedJobs,
  fetchQuantTypes: s.fetchQuantTypes,
  estimateConversionTime: s.estimateConversionTime,
  setupConverterListeners: s.setupConverterListeners,
}), shallow);

// Collections selectors
export const useStarterPacks = () => useAppStore(s => s.starterPacks);
export const useUserCollections = () => useAppStore(s => s.userCollections);
export const useSelectedCollection = () => useAppStore(s => s.selectedCollection);
export const useCollectionsLoading = () => useAppStore(s => s.collectionsLoading);
export const useCollectionInstallProgress = () => useAppStore(s => s.installProgress);
export const useCollectionCategories = () => useAppStore(s => s.categories);

// Collections action selectors
export const useCollectionsActions = () => useAppStore(s => ({
  fetchStarterPacks: s.fetchStarterPacks,
  fetchUserCollections: s.fetchUserCollections,
  fetchAllCollections: s.fetchAllCollections,
  getCollection: s.getCollection,
  createCollection: s.createCollection,
  updateCollection: s.updateCollection,
  deleteCollection: s.deleteCollection,
  addModelToCollection: s.addModelToCollection,
  removeModelFromCollection: s.removeModelFromCollection,
  exportCollectionManifest: s.exportCollectionManifest,
  importCollectionManifest: s.importCollectionManifest,
  generateShareCode: s.generateShareCode,
  getCollectionByShareCode: s.getCollectionByShareCode,
  getInstallationStatus: s.getInstallationStatus,
  fetchCategories: s.fetchCategories,
  selectCollection: s.selectCollection,
  clearSelectedCollection: s.clearSelectedCollection,
  setupCollectionListeners: s.setupCollectionListeners,
}), shallow);
