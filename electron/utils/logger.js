/**
 * Lightweight Logger - Reduces console noise in production/lite mode
 * Import this instead of using console.log directly
 */

// Check if we're in lite/production mode
const isLiteMode = process.env.LITE_MODE === 'true' || process.env.NODE_ENV === 'production';

// Throttle repeated messages
const messageCache = new Map();
const THROTTLE_MS = 5000; // Don't repeat same message within 5 seconds

function normalizeLogSymbols(input) {
  return String(input || '')
    .replace(/[\u2705\u2713]/g, '[OK]')
    .replace(/[\u274C\u2717]/g, '[FAIL]')
    .replace(/\u26A0(?:\uFE0F)?/g, '[WARN]')
    .replace(/\u2139(?:\uFE0F)?/g, '[INFO]')
    .replace(/\uD83D\uDD04/g, '[RETRY]')
    .replace(/[\u2013\u2014]/g, '-');
}

function shouldLog(message) {
  if (!isLiteMode) return true;

  const now = Date.now();
  const lastTime = messageCache.get(message);

  if (lastTime && (now - lastTime) < THROTTLE_MS) {
    return false;
  }

  messageCache.set(message, now);

  // Clean old entries periodically
  if (messageCache.size > 100) {
    const cutoff = now - THROTTLE_MS;
    for (const [key, time] of messageCache) {
      if (time < cutoff) messageCache.delete(key);
    }
  }

  return true;
}

const logger = {
  // Always log errors
  error: (...args) => console.error('[ERROR]', ...args.map(normalizeLogSymbols)),

  // Always log warnings
  warn: (...args) => {
    const message = normalizeLogSymbols(args[0]?.toString() || '');
    if (shouldLog(message)) {
      console.warn('[WARN]', ...args.map(normalizeLogSymbols));
    }
  },

  // Info only in non-lite mode or if important
  info: (...args) => {
    const message = normalizeLogSymbols(args[0]?.toString() || '');
    if (!isLiteMode || message.includes('[OK]') || message.includes('[WARN]')) {
      if (shouldLog(message)) {
        console.log('[INFO]', ...args.map(normalizeLogSymbols));
      }
    }
  },

  // Debug only in dev mode
  debug: (...args) => {
    if (!isLiteMode) {
      console.log('[DEBUG]', ...args.map(normalizeLogSymbols));
    }
  },

  // Verbose - almost never logs in lite mode
  verbose: (...args) => {
    if (process.env.VERBOSE === 'true') {
      console.log('[VERBOSE]', ...args.map(normalizeLogSymbols));
    }
  },

  // Check if lite mode is enabled
  isLiteMode: () => isLiteMode,
};

module.exports = logger;
