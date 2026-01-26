// UI state management slice
// Handles modal visibility, sidebar, and UI toggles

export const createUiSlice = (set) => ({
  // State
  showSettings: false,
  showImageGen: false,
  showModelSelector: false,
  showModelFinder: false,
  showModelLibrary: false,
  showModelHub: false,
  showExportModal: false,
  showDownloadCenter: false,
  sidebarCollapsed: false,
  
  // Actions
  toggleSettings: () => set(state => ({ showSettings: !state.showSettings })),
  toggleImageGen: () => set(state => ({ showImageGen: !state.showImageGen })),
  toggleModelSelector: () => set(state => ({ showModelSelector: !state.showModelSelector })),
  toggleModelFinder: () => set(state => ({ showModelFinder: !state.showModelFinder })),
  toggleModelLibrary: () => set(state => ({ showModelLibrary: !state.showModelLibrary })),
  toggleModelHub: () => set(state => ({ showModelHub: !state.showModelHub })),
  toggleDownloadCenter: () => set(state => ({ showDownloadCenter: !state.showDownloadCenter })),
  openExportModal: () => set({ showExportModal: true }),
  closeExportModal: () => set({ showExportModal: false }),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
});

