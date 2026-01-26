/**
 * Rate Limiter - Security utility for IPC operations
 * Prevents abuse and DoS attacks on IPC handlers
 */

/**
 * Token bucket rate limiter implementation
 */
class TokenBucket {
  constructor(capacity, refillRate, refillInterval = 1000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.lastRefill = Date.now();
  }

  consume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillInterval) * this.refillRate;
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  getTokens() {
    this.refill();
    return this.tokens;
  }
}

/**
 * Sliding window rate limiter
 */
class SlidingWindowLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = [];
  }

  isAllowed() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove expired requests
    this.requests = this.requests.filter(time => time > windowStart);
    
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    return false;
  }

  getRemaining() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    this.requests = this.requests.filter(time => time > windowStart);
    return Math.max(0, this.maxRequests - this.requests.length);
  }

  getResetTime() {
    if (this.requests.length === 0) return 0;
    return Math.max(0, this.requests[0] + this.windowMs - Date.now());
  }
}

/**
 * Rate limiter manager for IPC handlers
 */
class RateLimiterManager {
  constructor() {
    // Different rate limits for different operation types
    this.limits = {
      // High frequency operations (chat, streaming)
      high: { windowMs: 1000, maxRequests: 100 },
      // Normal operations (settings, file reads)
      normal: { windowMs: 1000, maxRequests: 30 },
      // Sensitive operations (file writes, deletions)
      sensitive: { windowMs: 1000, maxRequests: 10 },
      // Critical operations (database operations)
      critical: { windowMs: 1000, maxRequests: 5 },
      // Burst protection (prevent spike attacks)
      burst: { windowMs: 100, maxRequests: 20 },
    };

    // Limiter instances per channel
    this.limiters = new Map();
    
    // Global limiter for overall protection
    this.globalLimiter = new SlidingWindowLimiter(1000, 500);
    
    // Blocked clients (for repeated violations)
    this.blockedClients = new Map();
    
    // Violation tracking
    this.violations = new Map();
  }

  /**
   * Get or create a limiter for a specific channel and type
   */
  getLimiter(channel, type = 'normal') {
    const key = `${channel}:${type}`;
    
    if (!this.limiters.has(key)) {
      const config = this.limits[type] || this.limits.normal;
      this.limiters.set(key, new SlidingWindowLimiter(config.windowMs, config.maxRequests));
    }
    
    return this.limiters.get(key);
  }

  /**
   * Check if a request is allowed
   * @param {string} channel - IPC channel name
   * @param {string} clientId - Client identifier (webContents id)
   * @param {string} type - Rate limit type
   * @returns {{ allowed: boolean, reason?: string, retryAfter?: number }}
   */
  checkLimit(channel, clientId = 'default', type = 'normal') {
    // Check if client is blocked
    const blockExpiry = this.blockedClients.get(clientId);
    if (blockExpiry && Date.now() < blockExpiry) {
      return {
        allowed: false,
        reason: 'Client temporarily blocked due to rate limit violations',
        retryAfter: Math.ceil((blockExpiry - Date.now()) / 1000)
      };
    } else if (blockExpiry) {
      this.blockedClients.delete(clientId);
    }

    // Check global limit
    if (!this.globalLimiter.isAllowed()) {
      return {
        allowed: false,
        reason: 'Global rate limit exceeded',
        retryAfter: Math.ceil(this.globalLimiter.getResetTime() / 1000)
      };
    }

    // Check channel-specific limit
    const limiter = this.getLimiter(channel, type);
    if (!limiter.isAllowed()) {
      this.recordViolation(clientId);
      return {
        allowed: false,
        reason: `Rate limit exceeded for ${channel}`,
        retryAfter: Math.ceil(limiter.getResetTime() / 1000)
      };
    }

    return { allowed: true };
  }

  /**
   * Record a rate limit violation
   */
  recordViolation(clientId) {
    const violations = (this.violations.get(clientId) || 0) + 1;
    this.violations.set(clientId, violations);

    // Block client after repeated violations
    if (violations >= 10) {
      const blockDuration = Math.min(300000, violations * 10000); // Max 5 minutes
      this.blockedClients.set(clientId, Date.now() + blockDuration);
      console.warn(`[RateLimiter] Client ${clientId} blocked for ${blockDuration / 1000}s`);
    }

    // Reset violations after 1 minute of good behavior
    setTimeout(() => {
      const current = this.violations.get(clientId) || 0;
      if (current > 0) {
        this.violations.set(clientId, current - 1);
      }
    }, 60000);
  }

  /**
   * Create rate-limited IPC handler wrapper
   */
  wrap(channel, handler, type = 'normal') {
    return async (event, ...args) => {
      const clientId = event.sender?.id || 'unknown';
      const result = this.checkLimit(channel, clientId, type);

      if (!result.allowed) {
        const error = new Error(result.reason);
        error.code = 'RATE_LIMITED';
        error.retryAfter = result.retryAfter;
        throw error;
      }

      return handler(event, ...args);
    };
  }

  /**
   * Get rate limit info for a channel
   */
  getInfo(channel, type = 'normal') {
    const limiter = this.getLimiter(channel, type);
    return {
      remaining: limiter.getRemaining(),
      resetIn: Math.ceil(limiter.getResetTime() / 1000),
      limit: this.limits[type]?.maxRequests || this.limits.normal.maxRequests
    };
  }

  /**
   * Clear all limiters (for testing)
   */
  reset() {
    this.limiters.clear();
    this.blockedClients.clear();
    this.violations.clear();
    this.globalLimiter = new SlidingWindowLimiter(1000, 500);
  }
}

// Singleton instance
const rateLimiter = new RateLimiterManager();

// Handler type mappings
const HANDLER_TYPES = {
  // High frequency
  'llm:chat': 'high',
  'llm:stream': 'high',
  'app:getState': 'high',
  
  // Normal
  'fs:readFile': 'normal',
  'db:query': 'normal',
  'settings:get': 'normal',
  
  // Sensitive
  'fs:writeFile': 'sensitive',
  'fs:deleteFile': 'sensitive',
  'settings:set': 'sensitive',
  
  // Critical
  'db:execute': 'critical',
  'app:restart': 'critical',
  'security:decrypt': 'critical',
};

/**
 * Get the rate limit type for a handler
 */
function getHandlerType(channel) {
  return HANDLER_TYPES[channel] || 'normal';
}

module.exports = {
  rateLimiter,
  RateLimiterManager,
  TokenBucket,
  SlidingWindowLimiter,
  getHandlerType,
  HANDLER_TYPES,
};






