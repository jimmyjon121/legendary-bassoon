/**
 * Collections Slice - Zustand state slice for model collections/bundles
 * 
 * Manages:
 * - Starter packs (curated collections)
 * - User collections
 * - Collection import/export
 * - Installation tracking
 */

export const createCollectionsSlice = (set, get) => ({
  // State
  starterPacks: [],
  userCollections: [],
  selectedCollection: null,
  categories: [],
  collectionsLoading: false,
  installProgress: {},
  
  // Actions
  
  /**
   * Fetch starter packs
   */
  fetchStarterPacks: async () => {
    set({ collectionsLoading: true });
    try {
      const packs = await window.electronAPI?.collectionsGetStarterPacks?.();
      if (packs && !packs.error) {
        set({ starterPacks: packs });
      }
      return packs;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to fetch starter packs:', error);
      return { error: error.message };
    } finally {
      set({ collectionsLoading: false });
    }
  },
  
  /**
   * Fetch user collections
   */
  fetchUserCollections: async () => {
    set({ collectionsLoading: true });
    try {
      const collections = await window.electronAPI?.collectionsGetUserCollections?.();
      if (collections && !collections.error) {
        set({ userCollections: collections });
      }
      return collections;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to fetch user collections:', error);
      return { error: error.message };
    } finally {
      set({ collectionsLoading: false });
    }
  },
  
  /**
   * Fetch all collections
   */
  fetchAllCollections: async () => {
    const [starterPacks, userCollections] = await Promise.all([
      get().fetchStarterPacks(),
      get().fetchUserCollections(),
    ]);
    return { starterPacks, userCollections };
  },
  
  /**
   * Get collection by ID
   */
  getCollection: async (collectionId) => {
    try {
      const collection = await window.electronAPI?.collectionsGetById?.(collectionId);
      if (collection && !collection.error) {
        set({ selectedCollection: collection });
      }
      return collection;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to get collection:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Create a new collection
   */
  createCollection: async (data) => {
    try {
      const collection = await window.electronAPI?.collectionsCreate?.(data);
      if (collection && !collection.error) {
        set((state) => ({
          userCollections: [...state.userCollections, collection],
        }));
      }
      return collection;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to create collection:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Update a collection
   */
  updateCollection: async (collectionId, updates) => {
    try {
      const collection = await window.electronAPI?.collectionsUpdate?.(collectionId, updates);
      if (collection && !collection.error) {
        set((state) => ({
          userCollections: state.userCollections.map((c) =>
            c.id === collectionId ? collection : c
          ),
          selectedCollection: state.selectedCollection?.id === collectionId
            ? collection
            : state.selectedCollection,
        }));
      }
      return collection;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to update collection:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Delete a collection
   */
  deleteCollection: async (collectionId) => {
    try {
      const result = await window.electronAPI?.collectionsDelete?.(collectionId);
      if (result && !result.error) {
        set((state) => ({
          userCollections: state.userCollections.filter((c) => c.id !== collectionId),
          selectedCollection: state.selectedCollection?.id === collectionId
            ? null
            : state.selectedCollection,
        }));
      }
      return result;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to delete collection:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Add model to collection
   */
  addModelToCollection: async (collectionId, modelData) => {
    try {
      const result = await window.electronAPI?.collectionsAddModel?.(collectionId, modelData);
      if (result && !result.error) {
        // Refresh collection
        await get().getCollection(collectionId);
      }
      return result;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to add model:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Remove model from collection
   */
  removeModelFromCollection: async (collectionId, provider, modelId) => {
    try {
      const result = await window.electronAPI?.collectionsRemoveModel?.(collectionId, provider, modelId);
      if (result && !result.error) {
        // Refresh collection
        await get().getCollection(collectionId);
      }
      return result;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to remove model:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Export collection as manifest
   */
  exportCollectionManifest: async (collectionId) => {
    try {
      return await window.electronAPI?.collectionsExportManifest?.(collectionId);
    } catch (error) {
      console.error('[CollectionsSlice] Failed to export manifest:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Import collection from manifest
   */
  importCollectionManifest: async (manifest) => {
    try {
      const collection = await window.electronAPI?.collectionsImportManifest?.(manifest);
      if (collection && !collection.error) {
        set((state) => ({
          userCollections: [...state.userCollections, collection],
        }));
      }
      return collection;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to import manifest:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Generate share code
   */
  generateShareCode: async (collectionId) => {
    try {
      return await window.electronAPI?.collectionsGenerateShareCode?.(collectionId);
    } catch (error) {
      console.error('[CollectionsSlice] Failed to generate share code:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Get collection by share code
   */
  getCollectionByShareCode: async (shareCode) => {
    try {
      return await window.electronAPI?.collectionsGetByShareCode?.(shareCode);
    } catch (error) {
      console.error('[CollectionsSlice] Failed to get collection by share code:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Get installation status
   */
  getInstallationStatus: async (collectionId) => {
    try {
      const status = await window.electronAPI?.collectionsGetInstallStatus?.(collectionId);
      if (status && !status.error) {
        set((state) => ({
          installProgress: {
            ...state.installProgress,
            [collectionId]: status,
          },
        }));
      }
      return status;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to get install status:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Fetch categories
   */
  fetchCategories: async () => {
    try {
      const categories = await window.electronAPI?.collectionsGetCategories?.();
      if (categories && !categories.error) {
        set({ categories });
      }
      return categories;
    } catch (error) {
      console.error('[CollectionsSlice] Failed to fetch categories:', error);
      return { error: error.message };
    }
  },
  
  /**
   * Select a collection
   */
  selectCollection: (collection) => {
    set({ selectedCollection: collection });
  },
  
  /**
   * Clear selected collection
   */
  clearSelectedCollection: () => {
    set({ selectedCollection: null });
  },
  
  /**
   * Handle collection created event
   */
  handleCollectionCreated: (collection) => {
    set((state) => ({
      userCollections: [...state.userCollections, collection],
    }));
  },
  
  /**
   * Handle collection updated event
   */
  handleCollectionUpdated: (data) => {
    set((state) => ({
      userCollections: state.userCollections.map((c) =>
        c.id === data.id ? data.updates : c
      ),
    }));
  },
  
  /**
   * Handle collection deleted event
   */
  handleCollectionDeleted: (data) => {
    set((state) => ({
      userCollections: state.userCollections.filter((c) => c.id !== data.id),
    }));
  },
  
  /**
   * Handle install progress event
   */
  handleInstallProgress: (data) => {
    set((state) => ({
      installProgress: {
        ...state.installProgress,
        [data.collectionId]: {
          status: data.status,
          modelsInstalled: data.modelsInstalled,
          modelsTotal: data.modelsTotal,
        },
      },
    }));
  },
  
  /**
   * Setup collection event listeners
   */
  setupCollectionListeners: () => {
    const state = get();
    const cleanups = [];
    
    if (window.electronAPI?.onCollectionCreated) {
      cleanups.push(window.electronAPI.onCollectionCreated(state.handleCollectionCreated));
    }
    if (window.electronAPI?.onCollectionUpdated) {
      cleanups.push(window.electronAPI.onCollectionUpdated(state.handleCollectionUpdated));
    }
    if (window.electronAPI?.onCollectionDeleted) {
      cleanups.push(window.electronAPI.onCollectionDeleted(state.handleCollectionDeleted));
    }
    if (window.electronAPI?.onCollectionInstallProgress) {
      cleanups.push(window.electronAPI.onCollectionInstallProgress(state.handleInstallProgress));
    }
    
    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  },
});

// Selectors
export const selectStarterPacks = (state) => state.starterPacks;
export const selectUserCollections = (state) => state.userCollections;
export const selectAllCollections = (state) => [...state.starterPacks, ...state.userCollections];
export const selectSelectedCollection = (state) => state.selectedCollection;
export const selectCollectionsLoading = (state) => state.collectionsLoading;
export const selectInstallProgress = (state) => state.installProgress;
export const selectCategories = (state) => state.categories;



