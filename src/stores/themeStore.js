import { create } from 'zustand';
import { api, isElectron } from '../utils/electronAPI';

// Apply theme settings to the document element
function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme?.mode || 'dark';
  root.dataset.accent = theme?.accent || 'casual';
  root.style.setProperty('--df-font-size', `${theme?.fontSize || 14}px`);
}

export const useThemeStore = create((set, get) => ({
  mode: 'dark', // 'dark' | 'light' | 'system'
  accent: 'casual',
  fontSize: 14,
  density: 'comfortable',
  initialized: false,

  async initialize() {
    if (get().initialized) {
      applyThemeToDocument(get());
      return;
    }
    
    if (!isElectron()) {
      set({ initialized: true });
      applyThemeToDocument(get());
      return;
    }
    
    try {
      const stored = await api.getSettings('theme');
      if (stored && typeof stored === 'object') {
        set({ ...stored, initialized: true });
        applyThemeToDocument({ ...get(), ...stored });
      } else {
        set({ initialized: true });
        applyThemeToDocument(get());
      }
    } catch (error) {
      console.error('Failed to load theme settings:', error);
      set({ initialized: true });
      applyThemeToDocument(get());
    }
  },

  setTheme(partial) {
    set((state) => {
      const next = { ...state, ...partial };
      applyThemeToDocument(next);
      // Save asynchronously, don't block
      api.setSettings('theme', {
        mode: next.mode,
        accent: next.accent,
        fontSize: next.fontSize,
        density: next.density,
      }).catch((error) => {
        console.error('Failed to save theme settings:', error);
      });
      return next;
    });
  },
}));

// Non-hook helper to initialize theme before React mounts
export async function initializeTheme() {
  try {
    await useThemeStore.getState().initialize();
  } catch (error) {
    console.error('Theme initialization failed:', error);
  }
}


