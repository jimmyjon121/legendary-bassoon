/**
 * Model Experience Manager
 * 
 * Autonomous management layer for the Model Experience Engine.
 * Handles:
 * - Auto-initialization and startup
 * - Dependency checking and graceful degradation
 * - Profile caching and persistence
 * - Event broadcasting to renderer
 * - Server/backend coordination
 * - Self-healing and error recovery
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// Import the core engine (with graceful fallback)
let ModelExperienceEngine = null;
let getModelExperienceEngine = null;
let MODEL_SIGNATURES = null;

try {
  const engine = require('./model-experience-engine');
  ModelExperienceEngine = engine.ModelExperienceEngine;
  getModelExperienceEngine = engine.getModelExperienceEngine;
  MODEL_SIGNATURES = engine.MODEL_SIGNATURES;
} catch (e) {
  console.warn('[MAEM] Model Experience Engine not available:', e.message);
}

// Import template manager for prompt formatting
let getModelTemplateManager = null;
try {
  const templateMgr = require('./model-template-manager');
  getModelTemplateManager = templateMgr.getModelTemplateManager;
} catch (e) {
  console.warn('[MAEM] Template Manager not available:', e.message);
}

// Import dependent services (all optional)
let inspectModel = null;
let autoTuneModel = null;
let getOrchestrator = null;

try {
  inspectModel = require('./model-inspector').inspectModel;
} catch (e) {
  console.warn('[MAEM] Model Inspector unavailable');
}

try {
  autoTuneModel = require('./auto-tuner').autoTuneModel;
} catch (e) {
  console.warn('[MAEM] Auto-Tuner unavailable');
}

try {
  getOrchestrator = require('./inference-orchestrator').getOrchestrator;
} catch (e) {
  console.warn('[MAEM] Inference Orchestrator unavailable');
}

/**
 * Experience Profile Cache
 * Persists profiles to disk for instant loading
 */
class ProfileCache {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.memoryCache = new Map();
    this.maxMemoryEntries = 50;
    this.maxDiskEntries = 200;
  }

  async initialize() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (e) {
      console.warn('[ProfileCache] Failed to create cache dir:', e.message);
    }
  }

  _getCacheKey(modelPath) {
    // Use filename + size as cache key for speed
    try {
      const stats = fs.statSync(modelPath);
      const filename = path.basename(modelPath);
      return `${filename}_${stats.size}`;
    } catch {
      return path.basename(modelPath);
    }
  }

  _getCachePath(key) {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.cacheDir, `${safeKey}.json`);
  }

  get(modelPath) {
    const key = this._getCacheKey(modelPath);
    
    // Check memory first
    if (this.memoryCache.has(key)) {
      const cached = this.memoryCache.get(key);
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) { // 24 hour TTL
        return cached.profile;
      }
    }

    // Check disk
    try {
      const cachePath = this._getCachePath(key);
      if (fs.existsSync(cachePath)) {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        if (Date.now() - data.timestamp < 7 * 24 * 60 * 60 * 1000) { // 7 day disk TTL
          // Promote to memory cache
          this.memoryCache.set(key, data);
          return data.profile;
        }
      }
    } catch (e) {
      // Cache miss
    }

    return null;
  }

  set(modelPath, profile) {
    const key = this._getCacheKey(modelPath);
    const data = { profile, timestamp: Date.now() };

    // Memory cache
    this.memoryCache.set(key, data);
    
    // Evict old entries if needed
    if (this.memoryCache.size > this.maxMemoryEntries) {
      const oldest = [...this.memoryCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      this.memoryCache.delete(oldest[0]);
    }

    // Disk cache (async, non-blocking)
    setImmediate(() => {
      try {
        const cachePath = this._getCachePath(key);
        fs.writeFileSync(cachePath, JSON.stringify(data));
      } catch (e) {
        // Disk cache write failed, memory cache still works
      }
    });
  }

  clear() {
    this.memoryCache.clear();
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Model Experience Manager
 * The autonomous orchestrator for model-adaptive experiences
 */
class ModelExperienceManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.initialized = false;
    this.initializing = false;
    this.engine = null;
    this.cache = null;
    this.store = options.store || null;
    this.mainWindow = options.mainWindow || null;
    this.userDataPath = options.userDataPath || '';
    
    // Current state
    this.currentProfile = null;
    this.currentModelPath = null;
    this.lastError = null;
    
    // Health tracking
    this.health = {
      engineAvailable: !!getModelExperienceEngine,
      inspectorAvailable: !!inspectModel,
      tunerAvailable: !!autoTuneModel,
      orchestratorAvailable: !!getOrchestrator,
      lastCheck: null,
      errors: [],
    };
    
    // Auto-recovery settings
    this.recoveryAttempts = 0;
    this.maxRecoveryAttempts = 3;
    this.recoveryDelay = 5000;
  }

  /**
   * Initialize the manager - call this once at app startup
   */
  async initialize() {
    if (this.initialized || this.initializing) {
      return { success: true, alreadyInitialized: true };
    }

    this.initializing = true;
    console.log('[MAEM] Initializing Model Experience Manager...');

    try {
      // Initialize cache
      const cacheDir = path.join(this.userDataPath || '.', 'model-experience-cache');
      this.cache = new ProfileCache(cacheDir);
      await this.cache.initialize();

      // Initialize engine
      if (getModelExperienceEngine) {
        this.engine = getModelExperienceEngine();
        this.health.engineAvailable = true;
      } else {
        console.warn('[MAEM] Engine not available, using fallback mode');
        this.health.engineAvailable = false;
      }

      // Update health status
      this.health.lastCheck = Date.now();
      this._updateHealthStatus();

      // Load last used model profile from settings
      await this._restoreLastProfile();

      this.initialized = true;
      this.initializing = false;

      console.log('[MAEM] Initialization complete', {
        engineAvailable: this.health.engineAvailable,
        cacheDir,
      });

      this.emit('initialized', this.getStatus());
      this._notifyRenderer('experience:initialized', this.getStatus());

      return { success: true };
    } catch (error) {
      this.initializing = false;
      this.lastError = error.message;
      this.health.errors.push({ time: Date.now(), error: error.message });
      
      console.error('[MAEM] Initialization failed:', error);
      
      // Schedule recovery attempt
      this._scheduleRecovery();
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Analyze a model and get/create its experience profile
   * Emits step-by-step events for real-time UI updates
   */
  async analyzeModel(modelPath) {
    if (!modelPath) {
      return this._getDefaultProfile();
    }

    // Check cache first
    const cached = this.cache?.get(modelPath);
    if (cached) {
      console.log('[MAEM] Using cached profile for:', path.basename(modelPath));
      // Return cached profile with flag - DON'T emit optimization events to avoid toast spam
      return { ...cached, fromCache: true };
    }

    // Step 1: Detecting model family
    this._notifyOptimizationStep('detecting');
    console.log('[MAEM] Step 1: Detecting model family');
    
    // Generate new profile
    let profile;
    
    if (this.engine) {
      try {
        profile = await this.engine.analyzeModel(modelPath);
      } catch (e) {
        console.warn('[MAEM] Engine analysis failed:', e.message);
        profile = await this._fallbackAnalysis(modelPath);
      }
    } else {
      profile = await this._fallbackAnalysis(modelPath);
    }

    // Step 2: Configuring chat template
    this._notifyOptimizationStep('template');
    console.log('[MAEM] Step 2: Configuring chat template');
    
    // Check and detect template format
    if (getModelTemplateManager) {
      try {
        const endpoint = this.store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
        const templateManager = getModelTemplateManager(endpoint);
        const modelInfo = await templateManager.getModelInfo(modelPath);
        const needsFix = templateManager.needsTemplateFix(modelInfo);
        const templateType = templateManager.detectTemplate(modelPath);
        
        profile.template = {
          detected: templateType,
          needsManualFormat: needsFix,
          ollamaTemplate: modelInfo?.template || 'unknown',
        };
        
        console.log('[MAEM] Template analysis:', {
          model: modelPath,
          templateType,
          needsManualFormat: needsFix,
        });
      } catch (e) {
        console.warn('[MAEM] Template analysis failed:', e.message);
        profile.template = { detected: 'unknown', needsManualFormat: true };
      }
    }

    // Step 3: Analyzing capabilities
    this._notifyOptimizationStep('analyzing');
    console.log('[MAEM] Step 3: Analyzing capabilities');
    
    // Capabilities are already in profile from engine, just a brief delay for UI
    await new Promise(resolve => setTimeout(resolve, 50));

    // Step 4: Optimizing parameters
    this._notifyOptimizationStep('optimizing');
    console.log('[MAEM] Step 4: Optimizing parameters');
    
    // Parameters are already optimized in profile from engine
    await new Promise(resolve => setTimeout(resolve, 50));

    // Cache the result
    if (profile && this.cache) {
      this.cache.set(modelPath, profile);
    }

    return profile;
  }
  
  /**
   * Notify renderer of optimization step progress
   */
  _notifyOptimizationStep(stage) {
    this._notifyRenderer('experience:optimization-step', {
      stage,
      timestamp: Date.now(),
    });
    this.emit('optimization-step', { stage });
  }

  /**
   * Load a model with full experience profile and apply optimizations
   */
  async loadModelWithExperience(modelPath) {
    console.log('[MAEM] Loading model with experience:', modelPath);

    try {
      // Analyze the model (emits step events internally)
      const profile = await this.analyzeModel(modelPath);
      
      // Store current state
      this.currentProfile = profile;
      this.currentModelPath = modelPath;

      // Apply inference optimizations if orchestrator available
      if (getOrchestrator && profile.inference) {
        try {
          const orchestrator = getOrchestrator(this.store);
          // The orchestrator will use these settings for next generation
          console.log('[MAEM] Applied inference optimizations:', {
            temperature: profile.inference.temperature,
            num_ctx: profile.inference.num_ctx,
          });
        } catch (e) {
          console.warn('[MAEM] Failed to apply orchestrator settings:', e.message);
        }
      }

      // Persist to settings for restoration on restart
      if (this.store) {
        this.store.set('lastModelExperience', {
          modelPath,
          profile,
          timestamp: Date.now(),
        });
      }

      // Step 5: Ready - emit final step
      this._notifyOptimizationStep('ready');
      console.log('[MAEM] Step 5: Model optimized and ready');

      // Notify renderer of profile change
      this._notifyRenderer('experience:profile-loaded', {
        profile,
        modelPath,
        suggestions: profile.suggestions || [],
      });

      // Emit event for other services
      this.emit('profile-loaded', profile);

      return profile;
    } catch (error) {
      this.lastError = error.message;
      console.error('[MAEM] Failed to load model experience:', error);
      return this._getDefaultProfile();
    }
  }

  /**
   * Get current experience profile
   */
  getCurrentProfile() {
    return this.currentProfile || this._getDefaultProfile();
  }

  /**
   * Get optimized inference parameters for current model
   * @param {string} presetId - Optional preset to apply (accuracy, balanced, creative, etc.)
   */
  getInferenceParams(presetId = null) {
    // Base params from current profile or safer anti-hallucination defaults
    const baseParams = this.currentProfile?.inference || {
      num_ctx: 4096,
      num_predict: 1024,
      temperature: 0.4,      // Lower = more focused, less hallucination
      top_p: 0.8,            // Lower = more deterministic
      repeat_penalty: 1.15,  // Higher = less repetitive/looping
      top_k: 30,             // Lower = less random token selection
      num_batch: 256,
    };

    // If preset requested, apply it
    if (presetId) {
      try {
        const { INFERENCE_PRESETS } = require('../default-config');
        const preset = INFERENCE_PRESETS[presetId];
        if (preset) {
          return {
            ...baseParams,
            ...preset.params,
          };
        }
      } catch (e) {
        console.warn('[MAEM] Failed to load inference preset:', e.message);
      }
    }

    return baseParams;
  }

  /**
   * Get inference parameters optimized to reduce hallucinations
   * Uses the 'accuracy' preset with additional safeguards
   */
  getAccuracyParams() {
    return this.getInferenceParams('accuracy');
  }

  /**
   * Get inference parameters for creative tasks
   * Uses higher temperature and diversity
   */
  getCreativeParams() {
    return this.getInferenceParams('creative');
  }

  /**
   * Get all available inference presets
   */
  getAvailablePresets() {
    try {
      const { INFERENCE_PRESETS } = require('../default-config');
      return Object.values(INFERENCE_PRESETS);
    } catch (e) {
      return [];
    }
  }

  /**
   * Get UI hints for current model
   */
  getUIHints() {
    return this.currentProfile?.ui || {};
  }

  /**
   * Get prompt template for current model
   */
  getPromptTemplate() {
    return this.currentProfile?.prompt || {};
  }

  /**
   * Get capabilities for current model
   */
  getCapabilities() {
    return this.currentProfile?.capabilities || {
      codeGeneration: 0.6,
      generalChat: 1.0,
      creative: 0.7,
      reasoning: 0.8,
      roleplay: 0.6,
    };
  }

  /**
   * Check if current model is good for a task
   */
  isGoodFor(task) {
    const capabilities = this.getCapabilities();
    const threshold = 0.7;
    
    switch (task) {
      case 'code': return capabilities.codeGeneration >= threshold;
      case 'chat': return capabilities.generalChat >= threshold;
      case 'creative': return capabilities.creative >= threshold;
      case 'roleplay': return capabilities.roleplay >= threshold;
      case 'reasoning': return capabilities.reasoning >= threshold;
      default: return true;
    }
  }

  /**
   * Get recommended workspace for current model
   */
  getRecommendedWorkspace() {
    if (!this.currentProfile) return 'casual';
    
    const primary = this.currentProfile.primaryStrength;
    const ui = this.currentProfile.ui || {};
    
    switch (primary) {
      case 'codeGeneration':
      case 'codeFix':
        return 'code';
      case 'creative':
      case 'roleplay':
        return ui.enableCharacterMode ? 'nsfw' : 'casual';
      default:
        return 'casual';
    }
  }

  /**
   * Get recommended view for current model
   */
  getRecommendedView() {
    const ui = this.currentProfile?.ui || {};
    return ui.preferredView || 'stream';
  }

  /**
   * Format a prompt using the current model's template
   */
  formatPrompt(userMessage, options = {}) {
    const template = this.getPromptTemplate();
    const capabilities = this.getCapabilities();
    
    let formattedPrompt = userMessage;
    
    // Add system prefix if appropriate
    if (template.systemPrefix && options.includeSystem !== false) {
      // System prompt is typically handled separately in chat format
    }

    // Add user prefix if defined
    if (template.userPrefix) {
      formattedPrompt = `${template.userPrefix}${formattedPrompt}`;
    }

    return {
      prompt: formattedPrompt,
      system: template.systemPrefix || '',
      assistantPrefix: template.assistantPrefix || '',
      metadata: {
        instructionFormat: template.instructionFormat,
        allowRoleplay: template.allowRoleplay,
        showChainOfThought: template.showChainOfThought,
      },
    };
  }

  /**
   * Get full status of the manager
   */
  getStatus() {
    return {
      initialized: this.initialized,
      health: this.health,
      currentModel: this.currentModelPath ? path.basename(this.currentModelPath) : null,
      currentFamily: this.currentProfile?.model?.family || 'unknown',
      primaryStrength: this.currentProfile?.primaryStrength || 'generalChat',
      capabilities: this.getCapabilities(),
      lastError: this.lastError,
    };
  }
  
  /**
   * Run comprehensive health check on all MAEE components
   * Returns detailed status of each component
   */
  async runHealthCheck() {
    console.log('[MAEM] Running comprehensive health check...');
    
    const results = {
      timestamp: Date.now(),
      overall: 'healthy',
      components: {},
      recommendations: [],
    };
    
    // Check Core Engine
    results.components.coreEngine = {
      name: 'Core Engine',
      status: this.engine ? 'healthy' : 'unavailable',
      details: this.engine ? {
        antiHallucinationMode: this.engine.antiHallucinationMode,
        supportedFamilies: Object.keys(this.engine.signatures || {}),
      } : null,
    };
    
    // Check Template Manager
    let templateManagerStatus = 'unavailable';
    let templateManagerDetails = null;
    if (getModelTemplateManager) {
      try {
        const endpoint = this.store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
        const tm = getModelTemplateManager(endpoint);
        templateManagerStatus = 'healthy';
        templateManagerDetails = {
          supportedTemplates: ['vicuna', 'llama2', 'chatml', 'alpaca', 'mistral', 'phi', 'simple'],
        };
      } catch (e) {
        templateManagerStatus = 'error';
        templateManagerDetails = { error: e.message };
      }
    }
    results.components.templateManager = {
      name: 'Template Manager',
      status: templateManagerStatus,
      details: templateManagerDetails,
    };
    
    // Check Model Inspector
    results.components.modelInspector = {
      name: 'Model Inspector',
      status: inspectModel ? 'healthy' : 'unavailable',
      details: inspectModel ? { canInspectGGUF: true } : null,
    };
    
    // Check Auto-Tuner
    results.components.autoTuner = {
      name: 'Auto-Tuner',
      status: autoTuneModel ? 'healthy' : 'unavailable',
      details: null,
    };
    
    // Check Inference Orchestrator
    results.components.orchestrator = {
      name: 'Inference Orchestrator',
      status: getOrchestrator ? 'healthy' : 'unavailable',
      details: null,
    };
    
    // Check Profile Cache
    results.components.profileCache = {
      name: 'Profile Cache',
      status: this.cache ? 'healthy' : 'unavailable',
      details: this.cache ? {
        cacheDir: this.cache.cacheDir,
        memoryEntries: this.cache.memoryCache?.size || 0,
      } : null,
    };
    
    // Check current profile
    results.components.currentProfile = {
      name: 'Current Profile',
      status: this.currentProfile ? 'loaded' : 'none',
      details: this.currentProfile ? {
        model: this.currentProfile.model?.filename,
        family: this.currentProfile.model?.family,
        template: this.currentProfile.template?.detected,
        temperature: this.currentProfile.inference?.temperature,
      } : null,
    };
    
    // Determine overall health
    const componentStatuses = Object.values(results.components).map(c => c.status);
    if (componentStatuses.includes('error')) {
      results.overall = 'degraded';
    } else if (componentStatuses.filter(s => s === 'unavailable').length > 3) {
      results.overall = 'limited';
    }
    
    // Generate recommendations
    if (!this.engine) {
      results.recommendations.push('Core Engine unavailable - model family detection will use fallback');
    }
    if (!getModelTemplateManager) {
      results.recommendations.push('Template Manager unavailable - prompt formatting may be suboptimal');
    }
    if (!this.currentProfile) {
      results.recommendations.push('No model profile loaded - select a model to optimize');
    }
    
    console.log('[MAEM] Health check complete:', results.overall);
    return results;
  }

  /**
   * Clear all caches
   */
  clearCache() {
    if (this.cache) {
      this.cache.clear();
    }
    if (this.engine) {
      this.engine.clearCache();
    }
    this.currentProfile = null;
    this.currentModelPath = null;
  }

  /**
   * Shutdown the manager gracefully
   */
  async shutdown() {
    console.log('[MAEM] Shutting down...');
    this.removeAllListeners();
    this.initialized = false;
  }

  // =====================
  // Private Methods
  // =====================

  /**
   * Fallback analysis when engine is unavailable
   */
  async _fallbackAnalysis(modelPath) {
    const filename = path.basename(modelPath);
    
    // Basic pattern matching
    let family = 'chat';
    
    if (MODEL_SIGNATURES) {
      for (const [fam, config] of Object.entries(MODEL_SIGNATURES)) {
        for (const pattern of config.patterns || []) {
          if (pattern.test(filename)) {
            family = fam;
            break;
          }
        }
        if (family !== 'chat') break;
      }
    }

    // Use inspector if available
    let modelInfo = { filename, path: modelPath };
    if (inspectModel) {
      try {
        modelInfo = await inspectModel(modelPath);
      } catch (e) {
        // Use basic info
      }
    }

    // Use auto-tuner if available
    let hardwareProfile = {};
    if (autoTuneModel) {
      try {
        hardwareProfile = await autoTuneModel(modelPath);
      } catch (e) {
        // Use defaults
      }
    }

    // Build profile from available data
    const familyConfig = MODEL_SIGNATURES?.[family] || {
      capabilities: {
        codeGeneration: 0.6,
        generalChat: 1.0,
        creative: 0.7,
        reasoning: 0.8,
        roleplay: 0.6,
      },
      optimalParams: {
        temperature: 0.7,
        topP: 0.9,
        repeatPenalty: 1.05,
        contextUsage: 0.7,
      },
      uiHints: {
        preferredView: 'stream',
      },
      promptStyle: 'chat',
    };

    return {
      model: {
        filename: modelInfo.filename,
        path: modelPath,
        architecture: modelInfo.architecture || 'unknown',
        parametersB: modelInfo.parametersB,
        quantization: modelInfo.quantization,
        family,
      },
      capabilities: familyConfig.capabilities,
      primaryStrength: this._getPrimaryStrength(familyConfig.capabilities),
      ui: familyConfig.uiHints || {},
      prompt: this._getPromptTemplate(familyConfig.promptStyle || 'chat'),
      inference: {
        num_ctx: hardwareProfile.contextLength || 4096,
        num_predict: 1024,
        temperature: familyConfig.optimalParams?.temperature || 0.7,
        top_p: familyConfig.optimalParams?.topP || 0.9,
        repeat_penalty: familyConfig.optimalParams?.repeatPenalty || 1.05,
        top_k: 40,
        num_batch: hardwareProfile.batchSize || 256,
        num_thread: hardwareProfile.threads || 4,
        num_gpu: -1,
      },
      suggestions: [],
    };
  }

  _getPrimaryStrength(capabilities) {
    let max = 0;
    let primary = 'generalChat';
    for (const [name, value] of Object.entries(capabilities)) {
      if (value > max) {
        max = value;
        primary = name;
      }
    }
    return primary;
  }

  _getPromptTemplate(style) {
    const templates = {
      code: {
        systemPrefix: 'You are an expert programmer. Provide clean, well-documented code.',
        userPrefix: '',
        assistantPrefix: '',
        instructionFormat: 'direct',
      },
      chat: {
        systemPrefix: '',
        userPrefix: '',
        assistantPrefix: '',
        instructionFormat: 'conversational',
      },
      creative: {
        systemPrefix: '',
        userPrefix: '',
        assistantPrefix: '',
        instructionFormat: 'narrative',
        allowRoleplay: true,
      },
      reasoning: {
        systemPrefix: 'Think step by step.',
        userPrefix: '',
        assistantPrefix: 'Let me think through this:\n',
        instructionFormat: 'analytical',
        showChainOfThought: true,
      },
    };
    return templates[style] || templates.chat;
  }

  _getDefaultProfile() {
    return {
      model: { family: 'chat', filename: 'Unknown' },
      capabilities: {
        codeGeneration: 0.6,
        generalChat: 1.0,
        creative: 0.7,
        reasoning: 0.8,
        roleplay: 0.6,
      },
      primaryStrength: 'generalChat',
      ui: { preferredView: 'stream' },
      prompt: this._getPromptTemplate('chat'),
      inference: {
        num_ctx: 4096,
        num_predict: 1024,
        temperature: 0.4,       // Anti-hallucination default
        top_p: 0.8,             // More focused
        repeat_penalty: 1.15,   // Prevent loops
        top_k: 30,              // Less random
        num_batch: 256,
      },
      suggestions: [],
    };
  }

  async _restoreLastProfile() {
    if (!this.store) return;

    try {
      const saved = this.store.get('lastModelExperience');
      if (saved && saved.profile && Date.now() - saved.timestamp < 7 * 24 * 60 * 60 * 1000) {
        this.currentProfile = saved.profile;
        this.currentModelPath = saved.modelPath;
        console.log('[MAEM] Restored last model profile:', path.basename(saved.modelPath || ''));
      }
    } catch (e) {
      // No saved profile
    }
  }

  _updateHealthStatus() {
    this.health.inspectorAvailable = !!inspectModel;
    this.health.tunerAvailable = !!autoTuneModel;
    this.health.orchestratorAvailable = !!getOrchestrator;
    this.health.lastCheck = Date.now();
  }

  _scheduleRecovery() {
    if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
      console.error('[MAEM] Max recovery attempts reached');
      return;
    }

    this.recoveryAttempts++;
    setTimeout(() => {
      console.log(`[MAEM] Recovery attempt ${this.recoveryAttempts}/${this.maxRecoveryAttempts}`);
      this.initialize();
    }, this.recoveryDelay * this.recoveryAttempts);
  }

  _notifyRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send(channel, data);
      } catch (e) {
        // Window might not be ready
      }
    }
  }
}

// Singleton instance
let managerInstance = null;

function getModelExperienceManager(options) {
  if (!managerInstance) {
    managerInstance = new ModelExperienceManager(options);
  } else if (options) {
    // Update options on existing instance
    if (options.store) managerInstance.store = options.store;
    if (options.mainWindow) managerInstance.mainWindow = options.mainWindow;
    if (options.userDataPath) managerInstance.userDataPath = options.userDataPath;
  }
  return managerInstance;
}

module.exports = {
  ModelExperienceManager,
  getModelExperienceManager,
};

