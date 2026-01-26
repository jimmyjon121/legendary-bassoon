/**
 * Lightweight Logger - Reduces console noise in production/lite mode
 * Import this instead of using console.log directly
 */

// Check if we're in lite/production mode
const isLiteMode = process.env.LITE_MODE === 'true' || process.env.NODE_ENV === 'production';

// Throttle repeated messages
const messageCache = new Map();
const THROTTLE_MS = 5000; // Don't repeat same message within 5 seconds

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
  error: (...args) => console.error('[ERROR]', ...args),
  
  // Always log warnings
  warn: (...args) => {
    if (shouldLog(args[0]?.toString())) {
      console.warn('[WARN]', ...args);
    }
  },
  
  // Info only in non-lite mode or if important
  info: (...args) => {
    if (!isLiteMode || args[0]?.toString().includes('✓')) {
      if (shouldLog(args[0]?.toString())) {
        console.log('[INFO]', ...args);
      }
    }
  },
  
  // Debug only in dev mode
  debug: (...args) => {
    if (!isLiteMode) {
      console.log('[DEBUG]', ...args);
    }
  },
  
  // Verbose - almost never logs in lite mode
  verbose: (...args) => {
    if (process.env.VERBOSE === 'true') {
      console.log('[VERBOSE]', ...args);
    }
  },
  
  // Check if lite mode is enabled
  isLiteMode: () => isLiteMode,
};

module.exports = logger;











