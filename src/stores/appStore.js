// DevForge App Store - Combined from focused slices
// This is the main store that combines all feature slices for optimal performance

import { create } from 'zustand';
import {
  createWorkspaceSlice,
  createModelSlice,
  createUiSlice,
  createGenerationSlice,
  createConversationSlice,
  createMessageSlice,
  createOrganizationSlice,
  createDownloadSlice,
  createInstallerSlice,
  createScannerSlice,
  createConverterSlice,
  createCollectionsSlice,
  JobStatus,
  Engine,
  ModelType,
  WORKSPACES,
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
      const [settings, models] = await Promise.all([
        window.electronAPI?.getSettingsBatch?.(['lastWorkspace', 'currentModel', 'ragInfluence']) || {},
        window.electronAPI?.getModels() || [],
      ]);
      
      // Fallback to individual calls if batch not available
      const savedWorkspace = settings.lastWorkspace ?? await window.electronAPI?.getSettings('lastWorkspace');
      const savedModel = settings.currentModel ?? await window.electronAPI?.getSettings('currentModel');
      const savedRagInfluence = settings.ragInfluence ?? await window.electronAPI?.getSettings('ragInfluence');
      
      // Important: Set workspace FIRST so loadConversations filters correctly
      const workspace = savedWorkspace || 'casual';
      // Don't restore to NSFW - always start in a safe workspace (user must unlock)
      const safeWorkspace = workspace === 'nsfw' ? 'casual' : workspace;
      set({ currentWorkspace: safeWorkspace });
      
      // Now load conversations for the correct workspace
      const conversations = await get().loadConversations();
      
      set({
        initialized: true,
        isLoading: false,
        currentModel: savedModel || null,
        availableModels: models,
        conversations,
        ragInfluence: typeof savedRagInfluence === 'number' ? savedRagInfluence : 0.5,
        modelStatus: models.length > 0 ? 'online' : 'offline'
      });
      
      // Load folders and tags for current workspace (non-blocking)
      get().loadFolders?.();
      get().loadWorkspaceTags?.();
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
  ...createDownloadSlice(set, get),
  ...createInstallerSlice(set, get),
  ...createScannerSlice(set, get),
  ...createConverterSlice(set, get),
  ...createCollectionsSlice(set, get),
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

// Model optimization info (lazy import to avoid circular deps)
export const getModelOptimizationInfo = async (modelName) => {
  const { describeSettings, parseModelName } = await import('../services/modelOptimizer');
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
export const useShowModelFinder = () => useAppStore(s => s.showModelFinder);
export const useShowModelLibrary = () => useAppStore(s => s.showModelLibrary);
export const useShowModelHub = () => useAppStore(s => s.showModelHub);
export const useShowExportModal = () => useAppStore(s => s.showExportModal);
export const useShowDownloadCenter = () => useAppStore(s => s.showDownloadCenter);
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
}));

export const useWorkspaceState = () => useAppStore(s => ({
  currentWorkspace: s.currentWorkspace,
  isLocked: s.isLocked,
  workspaceSettings: s.workspaceSettings,
}));

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
  toggleModelFinder: s.toggleModelFinder,
  toggleModelLibrary: s.toggleModelLibrary,
  toggleModelHub: s.toggleModelHub,
  toggleDownloadCenter: s.toggleDownloadCenter,
}));

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
}));

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
}));

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
}));

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
}));

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
}));

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
}));
