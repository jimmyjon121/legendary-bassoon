// Organization state management slice
// Handles folders, tags, pinning, starring, and search (workspace-scoped)

import { v4 as uuidv4 } from 'uuid';

export const createOrganizationSlice = (set, get) => ({
  // State
  folders: [],
  activeFolderId: null,
  activeFilter: 'all', // 'all' | 'today' | 'week' | 'starred' | 'pinned'
  searchQuery: '',
  searchResults: null,
  isSearching: false,
  workspaceTags: [], // All unique tags for current workspace

  // ===================
  // FOLDER ACTIONS
  // ===================
  
  loadFolders: async () => {
    const workspace = get().currentWorkspace;
    try {
      const folders = await window.electronAPI?.listFolders(workspace) || [];
      set({ folders });
      return folders;
    } catch (error) {
      console.error('Failed to load folders:', error);
      return [];
    }
  },

  createFolder: async (name, color = '#6366f1', icon = 'Folder') => {
    const workspace = get().currentWorkspace;
    const id = uuidv4();
    
    try {
      // For NSFW workspace, encrypt folder name
      let storedName = name;
      if (workspace === 'nsfw' && get().nsfwPassword) {
        try {
          const encrypted = await window.electronAPI?.encrypt(name, get().nsfwPassword);
          storedName = JSON.stringify(encrypted);
        } catch (e) {
          console.error('Failed to encrypt folder name:', e);
        }
      }
      
      const result = await window.electronAPI?.createConversationFolder({
        id,
        name: storedName,
        color,
        icon,
        workspace,
        parentId: null
      });
      
      if (result?.success) {
        await get().loadFolders();
        return { success: true, id };
      }
      return { success: false, error: result?.error };
    } catch (error) {
      console.error('Failed to create folder:', error);
      return { success: false, error: error.message };
    }
  },

  updateFolder: async (folderId, updates) => {
    try {
      const result = await window.electronAPI?.updateFolder({ id: folderId, ...updates });
      if (result?.success) {
        await get().loadFolders();
      }
      return result;
    } catch (error) {
      console.error('Failed to update folder:', error);
      return { success: false, error: error.message };
    }
  },

  deleteFolder: async (folderId) => {
    try {
      const result = await window.electronAPI?.deleteFolder(folderId);
      if (result?.success) {
        // If this was the active folder, clear it
        if (get().activeFolderId === folderId) {
          set({ activeFolderId: null });
        }
        await get().loadFolders();
      }
      return result;
    } catch (error) {
      console.error('Failed to delete folder:', error);
      return { success: false, error: error.message };
    }
  },

  setActiveFolder: (folderId) => {
    set({ activeFolderId: folderId, activeFilter: 'all' });
  },

  // ===================
  // CONVERSATION ORGANIZATION
  // ===================

  moveToFolder: async (conversationId, folderId) => {
    try {
      const result = await window.electronAPI?.moveToFolder(conversationId, folderId);
      if (result?.success) {
        // Update local conversations state
        set(state => ({
          conversations: state.conversations.map(c => 
            c.id === conversationId ? { ...c, folder_id: folderId } : c
          )
        }));
      }
      return result;
    } catch (error) {
      console.error('Failed to move to folder:', error);
      return { success: false, error: error.message };
    }
  },

  toggleStar: async (conversationId) => {
    try {
      const result = await window.electronAPI?.toggleStar(conversationId);
      if (result?.success) {
        // Update local conversations state
        set(state => ({
          conversations: state.conversations.map(c => 
            c.id === conversationId ? { ...c, starred: result.starred ? 1 : 0 } : c
          )
        }));
      }
      return result;
    } catch (error) {
      console.error('Failed to toggle star:', error);
      return { success: false, error: error.message };
    }
  },

  togglePin: async (conversationId) => {
    try {
      const result = await window.electronAPI?.togglePin(conversationId);
      if (result?.success) {
        // Update local conversations state
        set(state => ({
          conversations: state.conversations.map(c => 
            c.id === conversationId ? { ...c, pinned: result.pinned ? 1 : 0 } : c
          )
        }));
      }
      return result;
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      return { success: false, error: error.message };
    }
  },

  setTags: async (conversationId, tags) => {
    const workspace = get().currentWorkspace;
    
    try {
      // For NSFW workspace, encrypt tags
      let storedTags = tags;
      if (workspace === 'nsfw' && get().nsfwPassword) {
        try {
          const encrypted = await window.electronAPI?.encrypt(JSON.stringify(tags), get().nsfwPassword);
          storedTags = [JSON.stringify(encrypted)]; // Store as single encrypted string
        } catch (e) {
          console.error('Failed to encrypt tags:', e);
        }
      }
      
      const result = await window.electronAPI?.setConversationTags(conversationId, storedTags);
      if (result?.success) {
        // Update local conversations state
        set(state => ({
          conversations: state.conversations.map(c => 
            c.id === conversationId ? { ...c, tags: JSON.stringify(tags) } : c
          )
        }));
        // Refresh workspace tags
        await get().loadWorkspaceTags();
      }
      return result;
    } catch (error) {
      console.error('Failed to set tags:', error);
      return { success: false, error: error.message };
    }
  },

  // ===================
  // FILTERING
  // ===================

  setActiveFilter: (filter) => {
    set({ activeFilter: filter, activeFolderId: null });
  },

  getFilteredConversations: () => {
    const { conversations, activeFolderId, activeFilter, searchQuery } = get();
    let filtered = conversations || [];

    // Apply folder filter
    if (activeFolderId) {
      filtered = filtered.filter(c => c.folder_id === activeFolderId);
    }

    // Apply quick filters
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    switch (activeFilter) {
      case 'today':
        filtered = filtered.filter(c => new Date(c.updated_at) >= startOfToday);
        break;
      case 'week':
        filtered = filtered.filter(c => new Date(c.updated_at) >= startOfWeek);
        break;
      case 'starred':
        filtered = filtered.filter(c => c.starred === 1);
        break;
      case 'pinned':
        filtered = filtered.filter(c => c.pinned === 1);
        break;
      default:
        // 'all' - no additional filtering
        break;
    }

    // Apply search query (local title search)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.title?.toLowerCase().includes(query) ||
        c.preview?.toLowerCase().includes(query)
      );
    }

    // Sort: pinned first, then by updated_at
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return (b.pinned || 0) - (a.pinned || 0);
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  },

  // ===================
  // SEARCH
  // ===================

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  search: async (query) => {
    if (!query || query.trim().length < 2) {
      set({ searchResults: null, isSearching: false });
      return null;
    }

    const workspace = get().currentWorkspace;
    set({ isSearching: true });

    try {
      const results = await window.electronAPI?.searchAll(query, {
        filters: { workspace },
        limit: 50
      });
      
      set({ searchResults: results, isSearching: false });
      return results;
    } catch (error) {
      console.error('Search failed:', error);
      set({ searchResults: null, isSearching: false });
      return null;
    }
  },

  clearSearch: () => {
    set({ searchQuery: '', searchResults: null, isSearching: false });
  },

  // ===================
  // TAGS
  // ===================

  loadWorkspaceTags: async () => {
    const workspace = get().currentWorkspace;
    try {
      const tags = await window.electronAPI?.listTagsForWorkspace(workspace) || [];
      
      // Decrypt tags if NSFW workspace
      let decryptedTags = tags;
      if (workspace === 'nsfw' && get().nsfwPassword) {
        decryptedTags = await Promise.all(
          tags.map(async (tag) => {
            try {
              if (tag.startsWith('{') && tag.includes('"encrypted"')) {
                const encrypted = JSON.parse(tag);
                const decrypted = await window.electronAPI?.decrypt(encrypted, get().nsfwPassword);
                return JSON.parse(decrypted);
              }
            } catch { /* ignore */ }
            return tag;
          })
        );
        // Flatten arrays
        decryptedTags = decryptedTags.flat();
      }
      
      set({ workspaceTags: decryptedTags });
      return decryptedTags;
    } catch (error) {
      console.error('Failed to load workspace tags:', error);
      return [];
    }
  },

  // ===================
  // CONVERSATION META
  // ===================

  updateConversationMeta: async (conversationId, preview, messageCount) => {
    try {
      const workspace = get().currentWorkspace;
      let storedPreview = preview;
      
      // Encrypt preview for NSFW
      if (workspace === 'nsfw' && get().nsfwPassword && preview) {
        try {
          const encrypted = await window.electronAPI?.encrypt(preview, get().nsfwPassword);
          storedPreview = JSON.stringify(encrypted);
        } catch { /* ignore */ }
      }
      
      await window.electronAPI?.updateConversationMeta(conversationId, storedPreview, messageCount);
      
      // Update local state
      set(state => ({
        conversations: state.conversations.map(c => 
          c.id === conversationId 
            ? { ...c, preview: preview, message_count: messageCount } 
            : c
        )
      }));
    } catch (error) {
      console.error('Failed to update conversation meta:', error);
    }
  },
});

