import { create } from 'zustand';
import { api } from '../utils/electronAPI';

export const useTemplatesStore = create((set) => ({
  templates: [],
  isLoading: false,
  error: null,

  async loadTemplates(workspace) {
    set({ isLoading: true, error: null });
    try {
      const list = await api.listTemplates(workspace || null);
      set({ templates: Array.isArray(list) ? list : [], isLoading: false });
    } catch (error) {
      console.error('Failed to load templates:', error);
      set({ error: error?.message || 'Unknown error', isLoading: false, templates: [] });
    }
  },

  async saveTemplate(template) {
    try {
      const payload = {
        id: template.id,
        name: template.name,
        content: template.content,
        variables: template.variables || [],
        workspace: template.workspace || null,
        category: template.category || null,
      };
      const res = await api.saveTemplate(payload);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to save template');
      }
      const id = res.id || template.id;
      const updated = { ...payload, id };

      set((state) => {
        const existingIndex = state.templates.findIndex((t) => t.id === id);
        const templates = [...state.templates];
        if (existingIndex >= 0) {
          templates[existingIndex] = { ...templates[existingIndex], ...updated };
        } else {
          templates.unshift(updated);
        }
        return { templates };
      });
      return updated;
    } catch (error) {
      console.error('Failed to save template:', error);
      set({ error: error?.message || 'Unknown error' });
      return null;
    }
  },

  async deleteTemplate(id) {
    try {
      const res = await api.deleteTemplate(id);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to delete template');
      }
      set((state) => ({
        templates: state.templates.filter((t) => t.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete template:', error);
      set({ error: error?.message || 'Unknown error' });
    }
  },
}));


