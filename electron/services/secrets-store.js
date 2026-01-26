/**
 * SecretsStore - Secure credential management
 * 
 * Features:
 * - OS keychain integration (Windows DPAPI, macOS Keychain, Linux Secret Service)
 * - Encrypted token storage
 * - Redacted logging
 * - Token validation and rotation
 * - Rate limit handling
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

// Provider configuration
const PROVIDER_CONFIG = {
  huggingface: {
    name: 'Hugging Face',
    tokenPrefix: 'hf_',
    validateUrl: 'https://huggingface.co/api/whoami',
    rateLimit: 100, // requests per minute
  },
  civitai: {
    name: 'CivitAI',
    tokenPrefix: '',
    validateUrl: 'https://civitai.com/api/v1/models',
    rateLimit: 60,
  },
  openai: {
    name: 'OpenAI',
    tokenPrefix: 'sk-',
    validateUrl: 'https://api.openai.com/v1/models',
    rateLimit: 60,
  },
  anthropic: {
    name: 'Anthropic',
    tokenPrefix: 'sk-ant-',
    validateUrl: 'https://api.anthropic.com/v1/messages',
    rateLimit: 60,
  },
};

/**
 * SecretsStore class
 */
class SecretsStore extends EventEmitter {
  constructor() {
    super();
    this.encryptionKey = null;
    this.secretsPath = null;
    this.secrets = {};
    this.rateLimiters = new Map();
    this.isInitialized = false;
    this.keytar = null;
  }

  /**
   * Initialize the secrets store
   */
  async initialize(userDataPath) {
    if (this.isInitialized) return;
    
    this.secretsPath = path.join(userDataPath, 'secrets.enc');
    
    // Try to use OS keychain via keytar
    try {
      this.keytar = require('keytar');
      console.log('[SecretsStore] Using OS keychain via keytar');
    } catch (e) {
      console.log('[SecretsStore] Keytar not available, using encrypted file storage');
      this.keytar = null;
    }
    
    // Get or create encryption key
    await this._initializeEncryptionKey();
    
    // Load existing secrets
    await this._loadSecrets();
    
    // Initialize rate limiters
    this._initializeRateLimiters();
    
    this.isInitialized = true;
    console.log('[SecretsStore] Initialized');
  }

  /**
   * Initialize encryption key
   */
  async _initializeEncryptionKey() {
    const keyName = 'devforge-secrets-key';
    
    if (this.keytar) {
      // Try to get key from OS keychain
      let key = await this.keytar.getPassword('DevForge', keyName);
      
      if (!key) {
        // Generate new key
        key = crypto.randomBytes(32).toString('hex');
        await this.keytar.setPassword('DevForge', keyName, key);
      }
      
      this.encryptionKey = Buffer.from(key, 'hex');
    } else {
      // Fall back to derived key from machine-specific data
      const machineId = this._getMachineId();
      this.encryptionKey = crypto.scryptSync(machineId, 'devforge-salt', 32);
    }
  }

  /**
   * Get machine-specific ID for encryption
   */
  _getMachineId() {
    const os = require('os');
    const components = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown',
    ];
    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
  }

  /**
   * Encrypt data
   */
  _encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted,
    };
  }

  /**
   * Decrypt data
   */
  _decrypt(encryptedData) {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(encryptedData.iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (e) {
      console.error('[SecretsStore] Decryption failed:', e.message);
      return {};
    }
  }

  /**
   * Load secrets from storage
   */
  async _loadSecrets() {
    if (this.keytar) {
      // Load from OS keychain
      const services = Object.keys(PROVIDER_CONFIG);
      
      for (const service of services) {
        try {
          const token = await this.keytar.getPassword('DevForge', `token-${service}`);
          if (token) {
            this.secrets[service] = { token, addedAt: null };
          }
        } catch (e) {
          // Ignore errors
        }
      }
    } else {
      // Load from encrypted file
      try {
        if (fs.existsSync(this.secretsPath)) {
          const fileContent = await fsPromises.readFile(this.secretsPath, 'utf8');
          const encryptedData = JSON.parse(fileContent);
          this.secrets = this._decrypt(encryptedData);
        }
      } catch (e) {
        console.error('[SecretsStore] Failed to load secrets:', e.message);
        this.secrets = {};
      }
    }
  }

  /**
   * Save secrets to storage
   */
  async _saveSecrets() {
    if (this.keytar) {
      // Save to OS keychain
      for (const [provider, data] of Object.entries(this.secrets)) {
        if (data.token) {
          await this.keytar.setPassword('DevForge', `token-${provider}`, data.token);
        }
      }
    } else {
      // Save to encrypted file
      const encryptedData = this._encrypt(this.secrets);
      await fsPromises.writeFile(this.secretsPath, JSON.stringify(encryptedData), 'utf8');
    }
  }

  /**
   * Initialize rate limiters
   */
  _initializeRateLimiters() {
    for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
      this.rateLimiters.set(provider, {
        tokens: config.rateLimit,
        lastRefill: Date.now(),
        rateLimit: config.rateLimit,
      });
    }
  }

  /**
   * Check rate limit
   */
  checkRateLimit(provider) {
    const limiter = this.rateLimiters.get(provider);
    if (!limiter) return { allowed: true, retryAfter: 0 };
    
    // Refill tokens
    const now = Date.now();
    const elapsed = (now - limiter.lastRefill) / 1000 / 60; // minutes
    const tokensToAdd = Math.floor(elapsed * limiter.rateLimit);
    
    if (tokensToAdd > 0) {
      limiter.tokens = Math.min(limiter.rateLimit, limiter.tokens + tokensToAdd);
      limiter.lastRefill = now;
    }
    
    if (limiter.tokens > 0) {
      limiter.tokens--;
      return { allowed: true, retryAfter: 0 };
    }
    
    const retryAfter = Math.ceil((60 / limiter.rateLimit) * 1000); // ms
    return { allowed: false, retryAfter };
  }

  /**
   * Set a token
   */
  async setToken(provider, token) {
    // Validate provider
    const config = PROVIDER_CONFIG[provider];
    if (!config) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    
    // Basic validation
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token');
    }
    
    // Check prefix if defined
    if (config.tokenPrefix && !token.startsWith(config.tokenPrefix)) {
      console.warn(`[SecretsStore] Token doesn't start with expected prefix: ${config.tokenPrefix}`);
    }
    
    // Store token
    this.secrets[provider] = {
      token,
      addedAt: new Date().toISOString(),
    };
    
    await this._saveSecrets();
    
    this.emit('token:set', { provider, redactedToken: this.redactToken(token) });
    
    return { success: true };
  }

  /**
   * Get a token
   */
  getToken(provider) {
    const secret = this.secrets[provider];
    return secret?.token || null;
  }

  /**
   * Delete a token
   */
  async deleteToken(provider) {
    if (this.secrets[provider]) {
      delete this.secrets[provider];
      
      if (this.keytar) {
        await this.keytar.deletePassword('DevForge', `token-${provider}`);
      }
      
      await this._saveSecrets();
      
      this.emit('token:deleted', { provider });
      
      return { success: true };
    }
    return { success: false, error: 'Token not found' };
  }

  /**
   * Validate a token
   */
  async validateToken(provider, token = null) {
    const config = PROVIDER_CONFIG[provider];
    if (!config) {
      return { valid: false, error: 'Unknown provider' };
    }
    
    const tokenToValidate = token || this.getToken(provider);
    if (!tokenToValidate) {
      return { valid: false, error: 'No token provided' };
    }
    
    // Check rate limit
    const { allowed, retryAfter } = this.checkRateLimit(provider);
    if (!allowed) {
      return { valid: null, error: `Rate limited. Retry after ${retryAfter}ms` };
    }
    
    try {
      const https = require('https');
      const url = new URL(config.validateUrl);
      
      return new Promise((resolve) => {
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${tokenToValidate}`,
            'User-Agent': 'DevForge/1.0',
          },
          timeout: 10000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 201) {
              resolve({ valid: true, user: this._parseUserInfo(provider, data) });
            } else if (res.statusCode === 401) {
              resolve({ valid: false, error: 'Invalid or expired token' });
            } else if (res.statusCode === 429) {
              resolve({ valid: null, error: 'Rate limited by provider' });
            } else {
              resolve({ valid: false, error: `HTTP ${res.statusCode}` });
            }
          });
        });
        
        req.on('error', (error) => {
          resolve({ valid: false, error: error.message });
        });
        
        req.on('timeout', () => {
          req.destroy();
          resolve({ valid: false, error: 'Request timed out' });
        });
        
        req.end();
      });
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Parse user info from validation response
   */
  _parseUserInfo(provider, data) {
    try {
      const json = JSON.parse(data);
      
      switch (provider) {
        case 'huggingface':
          return { username: json.name, email: json.email };
        case 'openai':
          return { organization: json.data?.[0]?.owned_by };
        default:
          return null;
      }
    } catch (e) {
      return null;
    }
  }

  /**
   * Redact a token for logging
   */
  redactToken(token) {
    if (!token || token.length < 8) return '***';
    return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders() {
    return Object.keys(this.secrets).filter(p => this.secrets[p]?.token);
  }

  /**
   * Get provider status
   */
  getProviderStatus(provider) {
    const config = PROVIDER_CONFIG[provider];
    const secret = this.secrets[provider];
    
    return {
      provider,
      name: config?.name || provider,
      configured: !!secret?.token,
      redactedToken: secret?.token ? this.redactToken(secret.token) : null,
      addedAt: secret?.addedAt,
    };
  }

  /**
   * Get all provider statuses
   */
  getAllProviderStatuses() {
    return Object.keys(PROVIDER_CONFIG).map(p => this.getProviderStatus(p));
  }

  /**
   * Create headers with token for a provider
   */
  getAuthHeaders(provider) {
    const token = this.getToken(provider);
    if (!token) return {};
    
    return {
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Handle rate limit response
   */
  handleRateLimitResponse(provider, retryAfterHeader) {
    const retryAfter = parseInt(retryAfterHeader, 10) || 60;
    const limiter = this.rateLimiters.get(provider);
    
    if (limiter) {
      limiter.tokens = 0;
      limiter.lastRefill = Date.now() + (retryAfter * 1000);
    }
    
    this.emit('rateLimit:hit', { provider, retryAfter });
    
    return retryAfter;
  }
}

// Singleton
let secretsStoreInstance = null;

function getSecretsStore() {
  if (!secretsStoreInstance) {
    secretsStoreInstance = new SecretsStore();
  }
  return secretsStoreInstance;
}

module.exports = {
  SecretsStore,
  getSecretsStore,
  PROVIDER_CONFIG,
};



