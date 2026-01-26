/**
 * FX Overlay - Visual effects layer (OPTIMIZED)
 * 
 * Effects are OFF by default for performance.
 * Users can enable via settings if desired.
 */

import React from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// FX Settings Store - Effects OFF by default for performance
export const useFXStore = create(
  persist(
    (set) => ({
      // Default to OFF for best performance
      quality: 'off',
      scanlines: false,
      noise: false,
      vignette: false,
      
      setQuality: (quality) => set({ quality }),
      toggleScanlines: () => set((s) => ({ scanlines: !s.scanlines })),
      toggleNoise: () => set((s) => ({ noise: !s.noise })),
      toggleVignette: () => set((s) => ({ vignette: !s.vignette })),
      setEffects: (effects) => set(effects),
    }),
    {
      name: 'devforge-fx-settings',
    }
  )
);

/**
 * FX Overlay Component - Lightweight version
 */
export function FXOverlay() {
  const { quality, vignette } = useFXStore();
  
  // Don't render anything if off
  if (quality === 'off') {
    return null;
  }
  
  // Only render vignette if enabled (lightest effect)
  if (vignette && quality !== 'off') {
    return (
      <div 
        className="fixed inset-0 pointer-events-none z-[100]"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 100%)'
        }}
        aria-hidden="true"
      />
    );
  }
  
  return null;
}

/**
 * FX Settings Panel (for Settings modal)
 */
export function FXSettingsPanel() {
  const { quality, vignette, setQuality, toggleVignette } = useFXStore();
  
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">Visual Effects</h3>
      
      <div>
        <label className="block text-xs text-text-muted mb-2">Effects Quality</label>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="w-full"
        >
          <option value="off">Off (Best performance)</option>
          <option value="minimal">Minimal (Vignette only)</option>
        </select>
      </div>
      
      {quality !== 'off' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={vignette}
            onChange={toggleVignette}
          />
          <span className="text-sm text-text-secondary">Vignette</span>
          <span className="text-xs text-text-muted">(Edge darkening)</span>
        </label>
      )}
      
      <p className="text-[11px] text-text-muted">
        Effects are disabled by default for best performance.
      </p>
    </div>
  );
}

export default FXOverlay;
