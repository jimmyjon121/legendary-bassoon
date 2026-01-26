import { create } from 'zustand';

// Normalized representation for key combos, e.g. "Ctrl+Shift+X"
function normalizeCombo(combo) {
  if (!combo) return null;
  return combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join('+');
}

const DEFAULT_SHORTCUTS = {
  'new-chat': {
    id: 'new-chat',
    label: 'New conversation',
    category: 'Navigation',
    description: 'Start a new conversation in the current workspace',
    defaultCombo: 'Ctrl+N',
  },
  'open-model-selector': {
    id: 'open-model-selector',
    label: 'Open model selector',
    category: 'Models',
    description: 'Open the model selection menu',
    defaultCombo: 'Ctrl+M',
  },
  'global-search': {
    id: 'global-search',
    label: 'Global search',
    category: 'Navigation',
    description: 'Search all conversations and messages',
    defaultCombo: 'Ctrl+K',
  },
  'open-settings': {
    id: 'open-settings',
    label: 'Open settings',
    category: 'Navigation',
    description: 'Open the settings modal',
    defaultCombo: 'Ctrl+,',
  },
  'export-conversation': {
    id: 'export-conversation',
    label: 'Export conversation',
    category: 'Conversations',
    description: 'Open export dialog for the current conversation',
    defaultCombo: 'Ctrl+E',
  },
  'panic-mode': {
    id: 'panic-mode',
    label: 'Panic mode',
    category: 'System',
    description: 'Instantly hide DevForge and lock Private workspace',
    defaultCombo: 'Ctrl+Shift+X',
  },
  'workspace-casual': {
    id: 'workspace-casual',
    label: 'Switch to Casual workspace',
    category: 'Navigation',
    description: 'Switch to the Casual workspace',
    defaultCombo: 'Ctrl+1',
  },
  'workspace-work': {
    id: 'workspace-work',
    label: 'Switch to Work workspace',
    category: 'Navigation',
    description: 'Switch to the Work workspace',
    defaultCombo: 'Ctrl+2',
  },
  'workspace-code': {
    id: 'workspace-code',
    label: 'Switch to Code workspace',
    category: 'Navigation',
    description: 'Switch to the Code workspace',
    defaultCombo: 'Ctrl+3',
  },
  'workspace-private': {
    id: 'workspace-private',
    label: 'Switch to Private workspace',
    category: 'Navigation',
    description: 'Switch to the Private workspace',
    defaultCombo: 'Ctrl+4',
  },
  'cancel-or-close': {
    id: 'cancel-or-close',
    label: 'Cancel generation / Close dialog',
    category: 'System',
    description: 'Stop generation or close the active dialog',
    defaultCombo: 'Escape',
  },
  'command-palette': {
    id: 'command-palette',
    label: 'Open command palette',
    category: 'Navigation',
    description: 'Search and run any DevForge action',
    defaultCombo: 'Ctrl+Shift+P',
  },
  'animation-demo': {
    id: 'animation-demo',
    label: 'Animation showcase',
    category: 'System',
    description: 'Open the GSAP animation demo/showcase',
    defaultCombo: 'Ctrl+Shift+A',
  },
  'forge-console': {
    id: 'forge-console',
    label: 'Open Forge Console',
    category: 'Navigation',
    description: 'Open the Forge Console (Replay, Runs, Mindprint, Insights)',
    defaultCombo: 'Ctrl+Shift+F',
  },
};

// Initialize normalized default combos
Object.values(DEFAULT_SHORTCUTS).forEach((item) => {
  item.defaultCombo = normalizeCombo(item.defaultCombo);
});

export const useShortcutsStore = create((set, get) => ({
  shortcuts: DEFAULT_SHORTCUTS,
  initialized: false,

  async initialize() {
    if (get().initialized) return;
    try {
      const saved = await window.electronAPI?.getSettings('shortcuts');
      if (saved && typeof saved === 'object') {
        const merged = { ...DEFAULT_SHORTCUTS };
        for (const [id, value] of Object.entries(saved)) {
          if (merged[id]) {
            merged[id] = {
              ...merged[id],
              ...value,
              combo: normalizeCombo(value.combo || value.defaultCombo || merged[id].defaultCombo),
            };
          }
        }
        set({ shortcuts: merged, initialized: true });
      } else {
        set({ initialized: true });
      }
    } catch (error) {
      console.error('Failed to load shortcuts:', error);
      set({ initialized: true });
    }
  },

  setShortcutCombo(id, combo) {
    const normalized = normalizeCombo(combo);
    if (!normalized) return;

    set((state) => {
      const shortcuts = { ...state.shortcuts };
      if (shortcuts[id]) {
        shortcuts[id] = {
          ...shortcuts[id],
          combo: normalized,
        };
      }
      // Persist asynchronously
      try {
        window.electronAPI?.setSettings(
          'shortcuts',
          Object.fromEntries(
            Object.entries(shortcuts).map(([sid, s]) => [
              sid,
              { id: s.id, combo: s.combo || s.defaultCombo },
            ]),
          ),
        );
      } catch (error) {
        console.error('Failed to save shortcuts:', error);
      }
      return { shortcuts };
    });
  },

  resetShortcut(id) {
    set((state) => {
      const shortcuts = { ...state.shortcuts };
      if (shortcuts[id]) {
        shortcuts[id] = {
          ...shortcuts[id],
          combo: shortcuts[id].defaultCombo,
        };
      }
      try {
        window.electronAPI?.setSettings(
          'shortcuts',
          Object.fromEntries(
            Object.entries(shortcuts).map(([sid, s]) => [
              sid,
              { id: s.id, combo: s.combo || s.defaultCombo },
            ]),
          ),
        );
      } catch (error) {
        console.error('Failed to save shortcuts:', error);
      }
      return { shortcuts };
    });
  },

  resetAll() {
    const reset = {};
    Object.values(DEFAULT_SHORTCUTS).forEach((item) => {
      reset[item.id] = { ...item, combo: item.defaultCombo };
    });
    set({ shortcuts: reset });
    try {
      window.electronAPI?.setSettings(
        'shortcuts',
        Object.fromEntries(
          Object.entries(reset).map(([sid, s]) => [
            sid,
            { id: s.id, combo: s.combo || s.defaultCombo },
          ]),
        ),
      );
    } catch (error) {
      console.error('Failed to save shortcuts:', error);
    }
  },
}));

export function getNormalizedShortcuts() {
  const { shortcuts } = useShortcutsStore.getState();
  const map = {};
  Object.values(shortcuts).forEach((s) => {
    const combo = normalizeCombo(s.combo || s.defaultCombo);
    if (combo) {
      map[s.id] = { ...s, combo };
    }
  });
  return map;
}


