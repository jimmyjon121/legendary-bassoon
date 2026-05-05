/**
 * Sanitize chat messages for Ollama /api/chat while preserving native tool-calling shapes.
 * Used by ipc-handlers sanitizeInferenceInput — kept in a small module for smoke tests.
 */

const DEFAULT_LIMITS = {
  messagesMax: 120,
  messageContentMaxChars: 64000,
  imagesMax: 8,
  imageStringMaxChars: 8_500_000,
  toolCallsPerMessageMax: 32,
  toolCallIdMaxChars: 128,
  toolFunctionNameMaxChars: 128,
  toolArgumentsMaxChars: 32000,
};

function sliceStr(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

/**
 * @param {unknown[]} rawMessages
 * @param {Partial<typeof DEFAULT_LIMITS>} limits
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizeInferenceMessages(rawMessages, limits = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  if (!Array.isArray(rawMessages)) return [];

  return rawMessages
    .slice(-L.messagesMax)
    .map((msg) => {
      if (!msg || typeof msg !== 'object') return null;

      const roleRaw = String(msg.role || '').toLowerCase();
      if (!['system', 'user', 'assistant', 'tool'].includes(roleRaw)) {
        return null;
      }

      const out = { role: roleRaw };

      if (Array.isArray(msg.images) && msg.images.length > 0) {
        out.images = msg.images
          .filter((image) => typeof image === 'string' && image.length <= L.imageStringMaxChars)
          .slice(0, L.imagesMax);
      }

      if (roleRaw === 'tool') {
        const toolCallId = sliceStr(String(msg.tool_call_id ?? ''), L.toolCallIdMaxChars);
        if (!toolCallId) return null;
        out.tool_call_id = toolCallId;
        if (typeof msg.name === 'string' && msg.name.trim()) {
          out.name = sliceStr(msg.name.trim(), L.toolFunctionNameMaxChars);
        }
        const rawContent = msg.content;
        const contentStr =
          typeof rawContent === 'string'
            ? sliceStr(rawContent, L.messageContentMaxChars).trim()
            : rawContent === null || rawContent === undefined
              ? ''
              : sliceStr(JSON.stringify(rawContent), L.messageContentMaxChars);
        out.content = contentStr;
        return out;
      }

      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      const rawContent = msg.content;
      let content =
        typeof rawContent === 'string'
          ? sliceStr(rawContent, L.messageContentMaxChars).trim()
          : rawContent === null || rawContent === undefined
            ? ''
            : sliceStr(JSON.stringify(rawContent), L.messageContentMaxChars).trim();

      if (!content && !hasToolCalls) return null;

      out.content = content;

      if (hasToolCalls) {
        const tool_calls = msg.tool_calls
          .slice(0, L.toolCallsPerMessageMax)
          .map((tc) => {
            if (!tc || typeof tc !== 'object') return null;
            const id = sliceStr(String(tc.id ?? ''), L.toolCallIdMaxChars);
            const type = typeof tc.type === 'string' ? sliceStr(tc.type, 32) : 'function';
            const fn = tc.function && typeof tc.function === 'object' ? tc.function : null;
            if (!fn) return null;
            const name = sliceStr(String(fn.name ?? ''), L.toolFunctionNameMaxChars);
            if (!name) return null;
            const args =
              typeof fn.arguments === 'string'
                ? sliceStr(fn.arguments, L.toolArgumentsMaxChars)
                : sliceStr(JSON.stringify(fn.arguments ?? {}), L.toolArgumentsMaxChars);
            return { id: id || undefined, type, function: { name, arguments: args } };
          })
          .filter(Boolean);
        if (tool_calls.length > 0) out.tool_calls = tool_calls;
      }

      if (typeof msg.name === 'string' && msg.name.trim() && roleRaw === 'assistant') {
        out.name = sliceStr(msg.name.trim(), L.toolFunctionNameMaxChars);
      }

      return out;
    })
    .filter(Boolean);
}

module.exports = {
  sanitizeInferenceMessages,
  DEFAULT_LIMITS,
};
