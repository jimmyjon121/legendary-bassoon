import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Chat V2 session UI preferences (survives window reload via localStorage).
 */
const ALLOWED_BACKEND_OVERRIDES = new Set([
  'ollama-cuda',
  'ollama-cpu',
  'llamanode',
  'openvino-npu',
  'openvino-gpu',
  'openvino-hybrid',
  'llamacpp-vulkan',
]);

export const useChatV2SessionStore = create(
  persist(
    (set) => ({
      /** null = Auto (optimizer); positive integer = fixed num_ctx */
      contextLengthTokens: null,
      setContextLengthTokens: (tokens) => set({ contextLengthTokens: tokens }),
      /** null = honor preset/auto; backend id forces orchestrator routing for this chat */
      backendOverride: null,
      setBackendOverride: (id) => {
        const trimmed = typeof id === 'string' ? id.trim() : '';
        const normalized = trimmed && ALLOWED_BACKEND_OVERRIDES.has(trimmed) ? trimmed : null;
        set({ backendOverride: normalized });
      },
    }),
    { name: 'chat-v2-session' },
  ),
);

export const CHAT_V2_BACKEND_OVERRIDES = ALLOWED_BACKEND_OVERRIDES;
