import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { api, isElectron } from '../utils/electronAPI';

export const useCharacterStore = create((set, get) => ({
  characters: [],
  loading: false,
  error: null,

  async loadCharacters() {
    if (!isElectron()) {
      set({ characters: [], loading: false, error: 'Characters are only available in the desktop app.' });
      return;
    }
    set({ loading: true, error: null });
    try {
      const rows = await window.electronAPI?.listCharacters();
      set({ characters: rows || [], loading: false });
    } catch (error) {
      console.error('Failed to load characters:', error);
      set({ error: error.message, loading: false });
    }
  },

  async saveCharacter(character) {
    if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
    try {
      const payload = {
        id: character.id || uuidv4(),
        name: character.name,
        display_name: character.display_name || null,
        species: character.species || null,
        gender: character.gender || null,
        pronouns: character.pronouns || null,
        age_appearance: character.age_appearance || null,
        description: character.description || null,
        system_prompt: character.system_prompt || null,
        appearance: character.appearance || null,
        workspace: 'nsfw',
        avatar_path: character.avatar_path || null,
        tags: character.tags || null,
        nsfw_tags: character.nsfw_tags || null,
        voice_profile: character.voice_profile || null,
        image_gen_prompt: character.image_gen_prompt || null,
        image_gen_negative: character.image_gen_negative || null,
      };
      const res = await window.electronAPI?.saveCharacter(payload);
      if (res?.success) {
        await get().loadCharacters();
      }
      return res;
    } catch (error) {
      console.error('Failed to save character:', error);
      return { success: false, error: error.message };
    }
  },

  async deleteCharacter(id) {
    if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
    try {
      const res = await window.electronAPI?.deleteCharacter(id);
      if (res?.success) {
        set((state) => ({
          characters: (state.characters || []).filter((c) => c.id !== id),
        }));
      }
      return res;
    } catch (error) {
      console.error('Failed to delete character:', error);
      return { success: false, error: error.message };
    }
  },
}));

















