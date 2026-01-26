/**
 * HuggingFace Store
 * 
 * Manages state for browsing and downloading models from HuggingFace.
 */

import { create } from 'zustand';

export const useHuggingfaceStore = create((set, get) => ({
  // Model collections
  collections: {
    recommended: [],
    code: [],
    chat: [],
    creative: [],
    small: [],
    uncensored: [],
  },
  
  // Current state
  isLoading: false,
  error: null,
  selectedCollection: 'recommended',
  searchQuery: '',
  searchResults: [],
  
  // Download state
  downloads: {}, // modelId -> { progress, status, error }
  
  // Actions
  setCollection: (collection) => set({ selectedCollection: collection }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  async loadCollection(collectionName) {
    set({ isLoading: true, error: null });
    
    try {
      if (window.electronAPI?.browseHuggingFaceModels) {
        const models = await window.electronAPI.browseHuggingFaceModels(collectionName);
        set((state) => ({
          collections: {
            ...state.collections,
            [collectionName]: models || [],
          },
          isLoading: false,
        }));
      } else {
        set({ isLoading: false });
      }
    } catch (err) {
      console.error('Failed to load HF collection:', err);
      set({ error: err.message, isLoading: false });
    }
  },
  
  async searchModels(query) {
    if (!query?.trim()) {
      set({ searchResults: [] });
      return;
    }
    
    set({ isLoading: true, error: null });
    
    try {
      if (window.electronAPI?.searchHuggingFaceModels) {
        const results = await window.electronAPI.searchHuggingFaceModels(query);
        set({ searchResults: results || [], isLoading: false });
      } else {
        set({ searchResults: [], isLoading: false });
      }
    } catch (err) {
      console.error('HF search failed:', err);
      set({ error: err.message, isLoading: false });
    }
  },
  
  async downloadModel(modelId, options = {}) {
    set((state) => ({
      downloads: {
        ...state.downloads,
        [modelId]: { progress: 0, status: 'starting', error: null },
      },
    }));
    
    try {
      if (window.electronAPI?.downloadHuggingFaceModel) {
        await window.electronAPI.downloadHuggingFaceModel(modelId, options);
        set((state) => ({
          downloads: {
            ...state.downloads,
            [modelId]: { progress: 100, status: 'complete', error: null },
          },
        }));
      }
    } catch (err) {
      set((state) => ({
        downloads: {
          ...state.downloads,
          [modelId]: { progress: 0, status: 'error', error: err.message },
        },
      }));
    }
  },
  
  updateDownloadProgress(modelId, progress) {
    set((state) => ({
      downloads: {
        ...state.downloads,
        [modelId]: { ...state.downloads[modelId], progress, status: 'downloading' },
      },
    }));
  },
  
  clearError: () => set({ error: null }),
}));

export default useHuggingfaceStore;
