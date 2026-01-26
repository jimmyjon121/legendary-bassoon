/**
 * Base Backend Class
 * Abstract interface for all inference backends
 */

class BaseBackend {
  constructor(config = {}) {
    this.id = config.id || 'unknown';
    this.name = config.name || 'Unknown Backend';
    this.type = config.type || 'unknown';
    this.endpoint = config.endpoint || null;
    this.device = config.device || null;
    this.priority = config.priority || 99;
    this.capabilities = config.capabilities || {};
    this.status = 'unknown'; // unknown, available, unavailable, error
    this.lastHealthCheck = null;
    this.healthCheckInterval = 30000; // 30 seconds
  }

  /**
   * Check if the backend is available and healthy
   * @returns {Promise<{available: boolean, status: string, error?: string}>}
   */
  async checkHealth() {
    throw new Error('checkHealth must be implemented by subclass');
  }

  /**
   * Send a prompt and get a complete response
   * @param {Object} payload - { model, prompt, system, options }
   * @returns {Promise<Object>} - Response from the backend
   */
  async generate(payload) {
    throw new Error('generate must be implemented by subclass');
  }

  /**
   * Stream a response chunk by chunk
   * @param {Object} payload - { model, prompt, system, options }
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<void>}
   */
  async stream(payload, onChunk) {
    throw new Error('stream must be implemented by subclass');
  }

  /**
   * Get available models for this backend
   * @returns {Promise<Array>} - List of available models
   */
  async getModels() {
    throw new Error('getModels must be implemented by subclass');
  }

  /**
   * Load a model into memory
   * @param {string} modelName - Name or path of the model
   * @returns {Promise<Object>} - Load result
   */
  async loadModel(modelName) {
    throw new Error('loadModel must be implemented by subclass');
  }

  /**
   * Unload the current model from memory
   * @returns {Promise<Object>} - Unload result
   */
  async unloadModel() {
    // Default: no-op (many backends manage memory automatically)
    return { success: true, message: 'Model unload not required' };
  }

  /**
   * Cancel an ongoing generation
   * @param {string} requestId - ID of the request to cancel
   * @returns {Promise<Object>} - Cancel result
   */
  async cancel(requestId) {
    throw new Error('cancel must be implemented by subclass');
  }

  /**
   * Get backend info
   * @returns {Object}
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      endpoint: this.endpoint,
      device: this.device,
      priority: this.priority,
      capabilities: this.capabilities,
      status: this.status,
      lastHealthCheck: this.lastHealthCheck
    };
  }

  /**
   * Check if backend supports a specific capability
   * @param {string} capability - e.g., 'streaming', 'vision', 'function_calling'
   * @returns {boolean}
   */
  supports(capability) {
    return this.capabilities[capability] === true;
  }

  /**
   * Estimate performance for a given model size
   * @param {number} parameterCount - Model size in billions
   * @returns {Object} - { tokensPerSecond, memoryRequired, suitable }
   */
  estimatePerformance(parameterCount) {
    // Default implementation - subclasses should override
    return {
      tokensPerSecond: 'unknown',
      memoryRequired: parameterCount * 2, // Rough estimate: 2GB per billion params
      suitable: true
    };
  }

  /**
   * Update backend status
   * @param {string} newStatus
   */
  setStatus(newStatus) {
    this.status = newStatus;
    this.lastHealthCheck = Date.now();
  }
}

module.exports = BaseBackend;


