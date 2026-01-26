/**
 * Model Experience Service
 * 
 * Frontend service for model-adaptive UI features.
 * Provides state and hooks for adapting the UI based on the loaded model.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Model Experience Store
 */
export const useModelExperience = create(
  subscribeWithSelector((set, get) => ({
    // Current model profile
    profile: null,
    isLoading: false,
    error: null,
    
    // Derived state for easy UI access
    modelFamily: 'chat',
    primaryStrength: 'generalChat',
    capabilities: {
      codeGeneration: 0.6,
      codeFix: 0.5,
      codeExplanation: 0.7,
      generalChat: 1.0,
      creative: 0.7,
      reasoning: 0.8,
      roleplay: 0.6,
    },
    
    // UI adaptation settings
    uiConfig: {
      preferredView: 'stream',
      showCodeActions: false,
      showCreativeActions: true,
      inputPlaceholder: 'Ask me anything...',
      suggestedPrompts: [],
    },
    
    // Actions
    setProfile: (profile) => set({ profile, isLoading: false }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error, isLoading: false }),
    
    // Load profile for a model
    async loadProfile(modelName) {
      if (!modelName) return;
      
      set({ isLoading: true, error: null });
      
      try {
        // Try to get profile from backend
        if (window.electronAPI?.getModelExperience) {
          const profile = await window.electronAPI.getModelExperience(modelName);
          if (profile) {
            set({
              profile,
              modelFamily: profile.family || 'chat',
              primaryStrength: profile.primaryStrength || 'generalChat',
              capabilities: profile.capabilities || get().capabilities,
              isLoading: false,
            });
            return;
          }
        }
        
        // Fallback to default profile
        set({ isLoading: false });
      } catch (err) {
        console.error('Failed to load model profile:', err);
        set({ error: err.message, isLoading: false });
      }
    },
    
    // Reset to defaults
    reset: () => set({
      profile: null,
      modelFamily: 'chat',
      primaryStrength: 'generalChat',
      isLoading: false,
      error: null,
    }),
  }))
);

/**
 * Hook for model-aware UI components
 */
export function useModelAwareness() {
  const { 
    profile, 
    modelFamily, 
    capabilities, 
    isLoading 
  } = useModelExperience();
  
  return {
    isModelLoaded: !!profile,
    modelFamily,
    capabilities,
    isLoading,
    
    // Capability checks
    canDoCode: (capabilities?.codeGeneration || 0) > 0.5,
    canDoCreative: (capabilities?.creative || 0) > 0.5,
    canDoReasoning: (capabilities?.reasoning || 0) > 0.5,
    
    // UI adaptation helpers
    shouldShowCodeActions: modelFamily === 'code' || (capabilities?.codeGeneration || 0) > 0.7,
    
    // Get prompt suggestions based on model capabilities
    getPromptSuggestions: () => {
      if (modelFamily === 'code') {
        return [
          'Explain this code',
          'Find bugs in this function',
          'Optimize this algorithm',
        ];
      }
      return [
        'Tell me about...',
        'Help me understand...',
        'Write a story about...',
      ];
    },
  };
}

export default useModelExperience;
