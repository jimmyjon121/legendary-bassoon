import { api } from '../../utils/electronAPI';
import { WORKSPACE_IDS } from '../../core/types';

const WORKSPACE_KEYS = [
  WORKSPACE_IDS.CASUAL,
  WORKSPACE_IDS.WORK,
  WORKSPACE_IDS.RESEARCH,
  WORKSPACE_IDS.CODE,
  WORKSPACE_IDS.VAULT,
];

export function normalizeActiveProjectByWorkspace(value) {
  const next = {};
  for (const key of WORKSPACE_KEYS) {
    next[key] = null;
  }

  if (!value || typeof value !== 'object') {
    return next;
  }

  for (const key of WORKSPACE_KEYS) {
    const raw = value[key];
    const normalized = typeof raw === 'string' ? raw.trim() : '';
    next[key] = normalized || null;
  }
  return next;
}

function persistActiveProjectByWorkspace(map) {
  try {
    const pending = window.electronAPI?.setSettings?.('activeProjectByWorkspace', map);
    if (pending && typeof pending.catch === 'function') {
      pending.catch((error) => {
        console.warn('[projectSlice] Failed to persist activeProjectByWorkspace:', error?.message || error);
      });
    }
  } catch (error) {
    console.warn('[projectSlice] Failed to persist activeProjectByWorkspace:', error?.message || error);
  }
}

export const createProjectSlice = (set, get) => ({
  projects: [],
  projectsLoading: false,
  activeProjectByWorkspace: normalizeActiveProjectByWorkspace(null),
  activeProjectId: null,
  activeProject: null,
  activeProjectConversationIds: [],
  activeProjectDocumentIds: [],

  hydrateActiveProjectByWorkspace: (value) => {
    const workspace = String(get().currentWorkspace || 'casual').toLowerCase();
    const map = normalizeActiveProjectByWorkspace(value);
    set({
      activeProjectByWorkspace: map,
      activeProjectId: map[workspace] || null,
    });
  },

  loadProjects: async (workspaceOverride = null) => {
    const workspace = String(workspaceOverride || get().currentWorkspace || 'casual').toLowerCase();
    const isCurrentWorkspace = workspace === String(get().currentWorkspace || 'casual').toLowerCase();

    if (isCurrentWorkspace) {
      set({ projectsLoading: true });
    }

    try {
      const list = await api.research.listProjects(workspace);
      const projects = Array.isArray(list) ? list : [];
      const map = normalizeActiveProjectByWorkspace(get().activeProjectByWorkspace);
      let activeProjectId = map[workspace] || null;

      if (activeProjectId && !projects.some((item) => item.id === activeProjectId)) {
        activeProjectId = null;
        map[workspace] = null;
        persistActiveProjectByWorkspace(map);
      }

      if (isCurrentWorkspace) {
        const activeProject = activeProjectId
          ? projects.find((item) => item.id === activeProjectId) || null
          : null;
        set({
          projects,
          projectsLoading: false,
          activeProjectByWorkspace: map,
          activeProjectId,
          activeProject,
        });

        if (activeProjectId) {
          await get().refreshActiveProjectLinks(activeProjectId, workspace);
        } else {
          set({ activeProjectConversationIds: [], activeProjectDocumentIds: [] });
        }
      }

      return projects;
    } catch (error) {
      console.error('[projectSlice] Failed to load projects:', error);
      if (isCurrentWorkspace) {
        set({ projectsLoading: false });
      }
      return [];
    }
  },

  syncActiveProjectForWorkspace: async (workspaceOverride = null) => {
    const workspace = String(workspaceOverride || get().currentWorkspace || 'casual').toLowerCase();
    const map = normalizeActiveProjectByWorkspace(get().activeProjectByWorkspace);
    let projects = get().projects;

    if (!Array.isArray(projects) || projects.length === 0) {
      projects = await get().loadProjects(workspace);
    }

    let activeProjectId = map[workspace] || null;
    if (activeProjectId && !projects.some((item) => item.id === activeProjectId)) {
      activeProjectId = null;
      map[workspace] = null;
      persistActiveProjectByWorkspace(map);
    }

    const activeProject = activeProjectId
      ? projects.find((item) => item.id === activeProjectId) || null
      : null;

    set({
      activeProjectByWorkspace: map,
      activeProjectId,
      activeProject,
    });

    if (activeProjectId) {
      await get().refreshActiveProjectLinks(activeProjectId, workspace);
    } else {
      set({ activeProjectConversationIds: [], activeProjectDocumentIds: [] });
    }

    return activeProject;
  },

  setActiveProject: async (projectId, options = {}) => {
    const workspace = String(get().currentWorkspace || 'casual').toLowerCase();
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : '';
    const nextProjectId = normalizedProjectId || null;
    const map = normalizeActiveProjectByWorkspace(get().activeProjectByWorkspace);
    const projects = Array.isArray(get().projects) ? get().projects : [];
    const activeProject = nextProjectId
      ? projects.find((item) => item.id === nextProjectId) || null
      : null;

    map[workspace] = nextProjectId;
    set({
      activeProjectByWorkspace: map,
      activeProjectId: nextProjectId,
      activeProject,
    });

    if (options.persist !== false) {
      persistActiveProjectByWorkspace(map);
    }

    if (nextProjectId) {
      await get().refreshActiveProjectLinks(nextProjectId, workspace);
    } else {
      set({ activeProjectConversationIds: [], activeProjectDocumentIds: [] });
    }

    const shouldLinkCurrent = options.linkCurrentConversation !== false;
    if (nextProjectId && shouldLinkCurrent && get().currentConversationId) {
      await get().linkConversationToActiveProject(get().currentConversationId, {
        projectId: nextProjectId,
      });
    }

    return { success: true, projectId: nextProjectId };
  },

  createProject: async ({ name, description = '', instructions = '' } = {}) => {
    const workspace = String(get().currentWorkspace || 'casual').toLowerCase();
    const projectName = String(name || '').trim();
    if (!projectName) {
      return { success: false, error: 'Project name is required' };
    }

    try {
      const result = await api.research.createProject({
        workspace,
        name: projectName,
        description: String(description || '').trim(),
        permanent_instructions: String(instructions || '').trim(),
      });

      if (!result?.success || !result?.id) {
        return { success: false, error: result?.error || 'Failed to create project' };
      }

      await get().loadProjects(workspace);
      await get().setActiveProject(result.id, {
        persist: true,
        linkCurrentConversation: true,
      });
      return { success: true, id: result.id };
    } catch (error) {
      console.error('[projectSlice] Failed to create project:', error);
      return { success: false, error: error?.message || 'Failed to create project' };
    }
  },

  refreshActiveProjectLinks: async (projectIdOverride = null, workspaceOverride = null) => {
    const workspace = String(workspaceOverride || get().currentWorkspace || 'casual').toLowerCase();
    const projectId = String(projectIdOverride || get().activeProjectId || '').trim();
    if (!projectId) {
      set({ activeProjectConversationIds: [], activeProjectDocumentIds: [] });
      return { linkedConversations: [], linkedDocuments: [] };
    }

    try {
      const [conversationLinks, documentLinks] = await Promise.all([
        api.research.listConversations(projectId, workspace),
        api.research.listDocuments(projectId, workspace),
      ]);

      const linkedConversationIds = Array.isArray(conversationLinks?.linked)
        ? conversationLinks.linked.map((item) => String(item?.id || '').trim()).filter(Boolean)
        : [];
      const linkedDocumentIds = Array.isArray(documentLinks?.linked)
        ? documentLinks.linked.map((item) => String(item?.id || '').trim()).filter(Boolean)
        : [];

      set({
        activeProjectConversationIds: linkedConversationIds,
        activeProjectDocumentIds: linkedDocumentIds,
      });

      return {
        linkedConversations: linkedConversationIds,
        linkedDocuments: linkedDocumentIds,
      };
    } catch (error) {
      console.warn('[projectSlice] Failed to refresh project links:', error?.message || error);
      set({
        activeProjectConversationIds: [],
        activeProjectDocumentIds: [],
      });
      return { linkedConversations: [], linkedDocuments: [] };
    }
  },

  linkConversationToActiveProject: async (conversationId, options = {}) => {
    const projectId = String(options.projectId || get().activeProjectId || '').trim();
    const targetConversationId = String(conversationId || '').trim();
    if (!projectId || !targetConversationId) {
      return { success: false, skipped: true };
    }

    try {
      const result = await api.research.linkConversation(projectId, targetConversationId);
      if (result?.success && options.refresh !== false) {
        await get().refreshActiveProjectLinks(projectId);
      }
      return result || { success: false };
    } catch (error) {
      console.warn('[projectSlice] Failed to link conversation:', error?.message || error);
      return { success: false, error: error?.message || 'Failed to link conversation' };
    }
  },
});
