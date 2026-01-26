/**
 * Model Experience Provider
 * 
 * Context provider that loads and manages model experience profiles.
 * Wraps the app to provide model-adaptive UI capabilities.
 */

import React, { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useModelExperience } from '../services/modelExperience';

export function ModelExperienceProvider({ children }) {
  const currentModel = useAppStore((state) => state.currentModel);
  const loadProfile = useModelExperience((state) => state.loadProfile);
  const isLoading = useModelExperience((state) => state.isLoading);
  const modelFamily = useModelExperience((state) => state.modelFamily);

  // Load profile when model changes
  useEffect(() => {
    if (currentModel) {
      loadProfile(currentModel);
    }
  }, [currentModel, loadProfile]);

  // Listen for profile updates from main process
  useEffect(() => {
    if (!window.electronAPI?.onModelExperienceUpdate) return;

    const unsubscribe = window.electronAPI.onModelExperienceUpdate((profile) => {
      useModelExperience.getState().setProfile(profile);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  return (
    <>
      {children}
      
      {/* Optional: Loading indicator for model experience */}
      {isLoading && (
        <div className="fixed bottom-4 right-4 px-3 py-2 bg-forge-surface border border-forge-border rounded-lg shadow-lg z-50">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <div className="w-3 h-3 rounded-full bg-workspace-casual animate-pulse" />
            <span>Optimizing for model...</span>
          </div>
        </div>
      )}
    </>
  );
}

export default ModelExperienceProvider;
