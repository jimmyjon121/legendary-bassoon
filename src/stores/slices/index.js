// Store slices index - export all slices for the combined appStore

export { createWorkspaceSlice, WORKSPACES } from './workspaceSlice';
export { createModelSlice } from './modelSlice';
export {
  createUiSlice,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_SECTION_ORDER,
  DEFAULT_SIDEBAR_SECTION_VISIBILITY,
  clampSidebarWidth,
  normalizeSidebarSectionOrder,
  normalizeSidebarSectionVisibility,
} from './uiSlice';
export { createGenerationSlice } from './generationSlice';
export { createConversationSlice } from './conversationSlice';
export { createMessageSlice } from './messageSlice';
export { createOrganizationSlice } from './organizationSlice';
export { createProjectSlice, normalizeActiveProjectByWorkspace } from './projectSlice';
export { createDownloadSlice, JobStatus } from './downloadSlice';
export { createInstallerSlice, Engine, ModelType } from './installerSlice';
export { createScannerSlice } from './scannerSlice';
export { createConverterSlice } from './converterSlice';
export { createCollectionsSlice } from './collectionsSlice';
export { createModelCatalogSlice } from './modelCatalogSlice';
