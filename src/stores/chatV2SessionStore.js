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

const ALLOWED_TASK_INTENTS = new Set(['auto', 'chat', 'code', 'reasoning', 'creative', 'research']);
const ALLOWED_ADVANCED_KEYS = new Set([
  'temperature',
  'top_p',
  'top_k',
  'repeat_penalty',
  'num_predict',
  'num_ctx',
  'num_batch',
  'num_gpu',
  'num_thread',
  'kv_cache_type',
  'flash_attn',
  'softBackendPreference',
]);

function clampNumber(value, min, max, fallback, integer = false) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(max, Math.max(min, numeric));
  return integer ? Math.round(clamped) : Number(clamped.toFixed(4));
}

function sanitizeAdvancedOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
  const next = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!ALLOWED_ADVANCED_KEYS.has(key) || value === undefined || value === null || value === '') continue;
    if (key === 'temperature') next.temperature = clampNumber(value, 0, 2, 0.6);
    else if (key === 'top_p') next.top_p = clampNumber(value, 0, 1, 0.9);
    else if (key === 'top_k') next.top_k = clampNumber(value, 1, 2000, 40, true);
    else if (key === 'repeat_penalty') next.repeat_penalty = clampNumber(value, 0.8, 2, 1.08);
    else if (key === 'num_predict') next.num_predict = clampNumber(value, 16, 8192, 1024, true);
    else if (key === 'num_ctx') next.num_ctx = clampNumber(value, 256, 262144, 8192, true);
    else if (key === 'num_batch') next.num_batch = clampNumber(value, 16, 2048, 128, true);
    else if (key === 'num_gpu') next.num_gpu = clampNumber(value, -1, 999, -1, true);
    else if (key === 'num_thread') next.num_thread = clampNumber(value, 1, 256, 8, true);
    else if (key === 'flash_attn') next.flash_attn = Boolean(value);
    else if (key === 'kv_cache_type') {
      const kv = String(value || '').trim().toLowerCase();
      if (['q8_0', 'q4_0', 'q4_1', 'f16', 'fp16', 'q5_0', 'q5_1'].includes(kv)) next.kv_cache_type = kv;
    } else if (key === 'softBackendPreference') {
      const backend = String(value || '').trim();
      if (ALLOWED_BACKEND_OVERRIDES.has(backend)) next.softBackendPreference = backend;
    }
  }
  return next;
}

export const useChatV2SessionStore = create(
  persist(
    (set) => ({
      /** null = Auto (optimizer); positive integer = fixed num_ctx */
      contextLengthTokens: null,
      setContextLengthTokens: (tokens) => {
        const numeric = Number(tokens);
        set({
          contextLengthTokens: Number.isFinite(numeric) && numeric > 0
            ? Math.round(numeric)
            : null,
        });
      },
      /** null = honor preset/auto; backend id forces orchestrator routing for this chat */
      backendOverride: null,
      setBackendOverride: (id) => {
        const trimmed = typeof id === 'string' ? id.trim() : '';
        const normalized = trimmed && ALLOWED_BACKEND_OVERRIDES.has(trimmed) ? trimmed : null;
        set({ backendOverride: normalized });
      },
      tuningMode: 'auto',
      setTuningMode: (mode) => {
        set({ tuningMode: mode === 'advanced' ? 'advanced' : 'auto' });
      },
      taskIntent: 'auto',
      setTaskIntent: (intent) => {
        const normalized = String(intent || 'auto').trim().toLowerCase();
        set({ taskIntent: ALLOWED_TASK_INTENTS.has(normalized) ? normalized : 'auto' });
      },
      advancedOverrides: {},
      setAdvancedOverride: (key, value) => {
        if (!ALLOWED_ADVANCED_KEYS.has(key)) return;
        set((state) => {
          const next = { ...(state.advancedOverrides || {}) };
          if (value === undefined || value === null || value === '') delete next[key];
          else next[key] = value;
          return { advancedOverrides: sanitizeAdvancedOverrides(next) };
        });
      },
      setAdvancedOverrides: (overrides) => set({ advancedOverrides: sanitizeAdvancedOverrides(overrides) }),
      resetAdvancedOverrides: () => set({ tuningMode: 'auto', taskIntent: 'auto', advancedOverrides: {} }),
    }),
    { name: 'chat-v2-session' },
  ),
);

export const CHAT_V2_BACKEND_OVERRIDES = ALLOWED_BACKEND_OVERRIDES;
export const CHAT_V2_TASK_INTENTS = ALLOWED_TASK_INTENTS;
export const CHAT_V2_ADVANCED_KEYS = ALLOWED_ADVANCED_KEYS;
