// UI state management slice
// Handles modal visibility, sidebar, and UI toggles

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const MIN_SIDEBAR_WIDTH = 280;
export const MAX_SIDEBAR_WIDTH = 460;
export const SIDEBAR_SECTION_IDS = [
  'workspaces',
  'projects',
  'compose',
  'filters',
  'folders',
  'conversations',
  'system',
  'actions',
];
export const DEFAULT_SIDEBAR_SECTION_ORDER = [...SIDEBAR_SECTION_IDS];
export const DEFAULT_SIDEBAR_SECTION_VISIBILITY = SIDEBAR_SECTION_IDS.reduce((acc, id) => {
  acc[id] = true;
  return acc;
}, {});

export function clampSidebarWidth(width) {
  const numeric = Number(width);
  if (!Number.isFinite(numeric)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(numeric)));
}

export function normalizeSidebarSectionOrder(value) {
  const incoming = Array.isArray(value) ? value : [];
  const next = incoming.filter((id, index) => (
    typeof id === 'string' &&
    SIDEBAR_SECTION_IDS.includes(id) &&
    incoming.indexOf(id) === index
  ));
  for (const id of SIDEBAR_SECTION_IDS) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function normalizeSidebarSectionVisibility(value) {
  const next = { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY };
  if (!value || typeof value !== 'object') return next;
  for (const id of SIDEBAR_SECTION_IDS) {
    if (Object.prototype.hasOwnProperty.call(value, id)) {
      next[id] = Boolean(value[id]);
    }
  }
  return next;
}

function persistUiSetting(key, value) {
  try {
    const pending = window.electronAPI?.setSettings?.(key, value);
    if (pending && typeof pending.catch === 'function') {
      pending.catch((error) => {
        console.warn(`[uiSlice] Failed to persist ${key}:`, error?.message || error);
      });
    }
  } catch (error) {
    console.warn(`[uiSlice] Failed to persist ${key}:`, error?.message || error);
  }
}

function reorderSections(currentOrder, draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) {
    return normalizeSidebarSectionOrder(currentOrder);
  }

  const base = normalizeSidebarSectionOrder(currentOrder);
  const fromIndex = base.indexOf(draggedId);
  const toIndex = base.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) return base;

  const next = [...base];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export const createUiSlice = (set, get) => ({
  // State
  showSettings: false,
  showImageGen: false,
  showModelSelector: false,
  showModelHub: false,
  showDownloadCenter: false,
  showExportModal: false,
  sidebarCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCustomizing: false,
  sidebarSectionOrder: [...DEFAULT_SIDEBAR_SECTION_ORDER],
  sidebarSectionVisibility: { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY },

  // Actions
  toggleSettings: () => set((state) => ({ showSettings: !state.showSettings })),
  toggleImageGen: () => set((state) => ({ showImageGen: !state.showImageGen })),
  toggleModelSelector: () => set((state) => ({ showModelSelector: !state.showModelSelector })),
  toggleModelHub: () => {
    set((state) => {
      const next = !state.showModelHub;
      console.log(`[AppStore] toggleModelHub: ${state.showModelHub} -> ${next}`, new Error().stack);
      return { showModelHub: next };
    });
  },
  toggleDownloadCenter: () => set((state) => ({ showDownloadCenter: !state.showDownloadCenter })),
  openExportModal: () => set({ showExportModal: true }),
  closeExportModal: () => set({ showExportModal: false }),

  setSidebarCollapsed: (collapsed, options = {}) => {
    const next = Boolean(collapsed);
    set({ sidebarCollapsed: next });
    if (options.persist !== false) {
      persistUiSetting('sidebarCollapsed', next);
    }
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    persistUiSetting('sidebarCollapsed', next);
  },
  setSidebarWidth: (width, options = {}) => {
    const next = clampSidebarWidth(width);
    set({ sidebarWidth: next, ...(options.expand ? { sidebarCollapsed: false } : {}) });
    if (options.persist !== false) {
      persistUiSetting('sidebarWidth', next);
      if (options.expand) {
        persistUiSetting('sidebarCollapsed', false);
      }
    }
  },
  setSidebarCustomizing: (value) => set({ sidebarCustomizing: Boolean(value) }),
  toggleSidebarCustomizing: () => set((state) => ({ sidebarCustomizing: !state.sidebarCustomizing })),

  setSidebarSectionVisibility: (sectionId, visible, options = {}) => {
    if (!SIDEBAR_SECTION_IDS.includes(sectionId)) return;
    const nextVisibility = normalizeSidebarSectionVisibility({
      ...get().sidebarSectionVisibility,
      [sectionId]: Boolean(visible),
    });
    set({ sidebarSectionVisibility: nextVisibility });
    if (options.persist !== false) {
      persistUiSetting('sidebarSectionVisibility', nextVisibility);
    }
  },
  toggleSidebarSectionVisibility: (sectionId) => {
    if (!SIDEBAR_SECTION_IDS.includes(sectionId)) return;
    const nextValue = !get().sidebarSectionVisibility?.[sectionId];
    get().setSidebarSectionVisibility(sectionId, nextValue);
  },
  reorderSidebarSection: (draggedId, targetId, options = {}) => {
    const nextOrder = reorderSections(get().sidebarSectionOrder, draggedId, targetId);
    set({ sidebarSectionOrder: nextOrder });
    if (options.persist !== false) {
      persistUiSetting('sidebarSectionOrder', nextOrder);
    }
  },
  resetSidebarCustomization: () => {
    const nextOrder = [...DEFAULT_SIDEBAR_SECTION_ORDER];
    const nextVisibility = { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY };
    set({
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarCustomizing: false,
      sidebarSectionOrder: nextOrder,
      sidebarSectionVisibility: nextVisibility,
      sidebarCollapsed: false,
    });
    persistUiSetting('sidebarWidth', DEFAULT_SIDEBAR_WIDTH);
    persistUiSetting('sidebarCollapsed', false);
    persistUiSetting('sidebarSectionOrder', nextOrder);
    persistUiSetting('sidebarSectionVisibility', nextVisibility);
  },
});
