import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Chat V2 session UI preferences (survives window reload via localStorage).
 */
export const useChatV2SessionStore = create(
  persist(
    (set) => ({
      /** null = Auto (optimizer); positive integer = fixed num_ctx */
      contextLengthTokens: null,
      setContextLengthTokens: (tokens) => set({ contextLengthTokens: tokens }),
    }),
    { name: 'chat-v2-session' },
  ),
);
