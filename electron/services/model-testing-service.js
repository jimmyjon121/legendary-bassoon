/**
 * ModelTestingService - Quick model testing and benchmarking
 * 
 * Features:
 * - Quick model test with sample prompts
 * - Post-install readiness checks
 * - Performance benchmarking
 * - Community benchmark display
 * - Example outputs preview
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Sample test prompts by model type
const TEST_PROMPTS = {
  'text-generation': [
    { name: 'Quick Response', prompt: 'Hello! Who are you?' },
    { name: 'Creative', prompt: 'Write a haiku about AI.' },
    { name: 'Reasoning', prompt: 'What is 15 + 27? Show your work.' },
    { name: 'Code', prompt: 'Write a simple function to reverse a string in Python.' },
  ],
  'code-assistant': [
    { name: 'Function', prompt: 'Write a function to find prime numbers up to n.' },
    { name: 'Debug', prompt: 'What is wrong with this code: for i in range(10) print(i)' },
    { name: 'Explain', prompt: 'Explain what a closure is in JavaScript.' },
    { name: 'Refactor', prompt: 'How would you improve this code: def add(a,b): return a+b' },
  ],
  'image-generation': [
    { name: 'Portrait', prompt: 'A portrait of a wise wizard, digital art' },
    { name: 'Landscape', prompt: 'Beautiful sunset over mountains, photorealistic' },
    { name: 'Abstract', prompt: 'Abstract geometric patterns in blue and gold' },
    { name: 'Character', prompt: 'Cute robot assistant, cartoon style' },
  ],
  'vision': [
    { name: 'Describe', prompt: 'Describe what you see in this image.' },
    { name: 'Count', prompt: 'How many objects are in this image?' },
    { name: 'Read', prompt: 'Read any text visible in this image.' },
    { name: 'Analyze', prompt: 'What is the main subject of this image?' },
  ],
  'embeddings': [
    { name: 'Similarity', prompt: 'Generate embedding for: The quick brown fox' },
    { name: 'Comparison', prompt: 'Compare: "happy" vs "joyful"' },
  ],
};

// Benchmark test suite
const BENCHMARK_SUITE = [
  { 
    name: 'Token Speed', 
    prompt: 'Count from 1 to 50.', 
    expectedTokens: 150,
    metric: 'tokens/sec',
  },
  { 
    name: 'First Token', 
    prompt: 'Say "Hello"', 
    metric: 'ttft_ms',
  },
  { 
    name: 'Context Window', 
    prompt: 'Repeat the following text: ', // + long context
    metric: 'max_context',
  },
];

// Community benchmark data (mock - would come from API)
const COMMUNITY_BENCHMARKS = {
  'llama3.2:3b': {
    avgSpeed: 45.2,
    p99Speed: 38.1,
    avgTtft: 120,
    samples: 1245,
    ratings: { quality: 4.2, speed: 4.5, value: 4.8 },
  },
  'mistral:7b': {
    avgSpeed: 28.5,
    p99Speed: 22.3,
    avgTtft: 180,
    samples: 2340,
    ratings: { quality: 4.5, speed: 4.0, value: 4.3 },
  },
};

/**
 * ModelTestingService class
 */
class ModelTestingService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.testResults = new Map();
    this.activeTests = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the service
   */
  async initialize(dbInstance) {
    if (this.isInitialized) return;
    
    this.db = dbInstance;
    await this._ensureTables();
    
    this.isInitialized = true;
    console.log('[ModelTestingService] Initialized');
  }

  /**
   * Ensure database tables exist
   */
  async _ensureTables() {
    if (!this.db) throw new Error('Database not initialized');
    
    // Test results table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS model_test_results (
        id TEXT PRIMARY KEY,
        modelId TEXT NOT NULL,
        provider TEXT NOT NULL,
        testType TEXT NOT NULL,
        prompt TEXT,
        response TEXT,
        tokensGenerated INTEGER,
        timeMs INTEGER,
        tokensPerSec REAL,
        ttftMs INTEGER,
        success INTEGER,
        error TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Benchmark results table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS model_benchmarks (
        id TEXT PRIMARY KEY,
        modelId TEXT NOT NULL,
        provider TEXT NOT NULL,
        avgSpeed REAL,
        p99Speed REAL,
        avgTtft INTEGER,
        maxContext INTEGER,
        memoryUsageMb INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_test_results_model ON model_test_results(modelId)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_benchmarks_model ON model_benchmarks(modelId)`);
  }

  /**
   * Get test prompts for a model type
   */
  getTestPrompts(modelType = 'text-generation') {
    return TEST_PROMPTS[modelType] || TEST_PROMPTS['text-generation'];
  }

  /**
   * Run a quick test on a model
   */
  async runQuickTest(modelId, provider, prompt, options = {}) {
    const testId = `test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    this.activeTests.set(testId, {
      modelId,
      provider,
      prompt,
      status: 'running',
      startTime: Date.now(),
    });
    
    this.emit('test:started', { testId, modelId, prompt });
    
    try {
      const startTime = Date.now();
      let ttft = null;
      let tokensGenerated = 0;
      let response = '';
      
      // Call appropriate backend based on provider
      if (provider === 'ollama') {
        const result = await this._testOllamaModel(modelId, prompt, (data) => {
          if (ttft === null) {
            ttft = Date.now() - startTime;
          }
          tokensGenerated += data.tokens || 1;
          response += data.content || '';
          
          this.emit('test:progress', { 
            testId, 
            tokensGenerated, 
            response,
            ttft,
          });
        });
        
        response = result.response || response;
        tokensGenerated = result.tokens || tokensGenerated;
      } else {
        // Generic test for other providers
        response = 'Test response (provider not connected)';
        tokensGenerated = 10;
        ttft = 100;
      }
      
      const endTime = Date.now();
      const timeMs = endTime - startTime;
      const tokensPerSec = tokensGenerated / (timeMs / 1000);
      
      const testResult = {
        id: testId,
        modelId,
        provider,
        testType: 'quick',
        prompt,
        response,
        tokensGenerated,
        timeMs,
        tokensPerSec: Math.round(tokensPerSec * 10) / 10,
        ttftMs: ttft,
        success: true,
        error: null,
        createdAt: new Date().toISOString(),
      };
      
      // Save to database
      await this._saveTestResult(testResult);
      
      this.testResults.set(testId, testResult);
      this.activeTests.delete(testId);
      
      this.emit('test:completed', testResult);
      
      return testResult;
    } catch (error) {
      const testResult = {
        id: testId,
        modelId,
        provider,
        testType: 'quick',
        prompt,
        response: null,
        tokensGenerated: 0,
        timeMs: Date.now() - this.activeTests.get(testId).startTime,
        tokensPerSec: 0,
        ttftMs: null,
        success: false,
        error: error.message,
        createdAt: new Date().toISOString(),
      };
      
      await this._saveTestResult(testResult);
      
      this.testResults.set(testId, testResult);
      this.activeTests.delete(testId);
      
      this.emit('test:error', testResult);
      
      return testResult;
    }
  }

  /**
   * Test Ollama model
   */
  async _testOllamaModel(modelId, prompt, onProgress) {
    const http = require('http');
    
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: modelId,
        prompt: prompt,
        stream: true,
      });
      
      const options = {
        hostname: 'localhost',
        port: 11434,
        path: '/api/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: 60000,
      };
      
      let fullResponse = '';
      let totalTokens = 0;
      
      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama returned status ${res.statusCode}`));
          return;
        }
        
        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          const lines = chunk.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              
              if (json.response) {
                fullResponse += json.response;
                totalTokens++;
                
                if (onProgress) {
                  onProgress({
                    content: json.response,
                    tokens: 1,
                  });
                }
              }
              
              if (json.done) {
                resolve({
                  response: fullResponse,
                  tokens: json.eval_count || totalTokens,
                });
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        });
        
        res.on('end', () => {
          resolve({
            response: fullResponse,
            tokens: totalTokens,
          });
        });
      });
      
      req.on('error', (error) => {
        if (error.code === 'ECONNREFUSED') {
          reject(new Error('Ollama is not running. Start Ollama first.'));
        } else {
          reject(error);
        }
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Test request timed out'));
      });
      
      req.write(data);
      req.end();
    });
  }

  /**
   * Run full benchmark suite
   */
  async runBenchmark(modelId, provider, options = {}) {
    const benchmarkId = `bench-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    this.emit('benchmark:started', { benchmarkId, modelId });
    
    const results = {
      id: benchmarkId,
      modelId,
      provider,
      tests: [],
      avgSpeed: 0,
      p99Speed: 0,
      avgTtft: 0,
      maxContext: 0,
      memoryUsageMb: 0,
      createdAt: new Date().toISOString(),
    };
    
    try {
      // Run speed tests
      const speedTests = [];
      for (let i = 0; i < 5; i++) {
        const test = await this.runQuickTest(modelId, provider, BENCHMARK_SUITE[0].prompt);
        speedTests.push(test.tokensPerSec);
        
        this.emit('benchmark:progress', { 
          benchmarkId, 
          testIndex: i + 1, 
          totalTests: 5,
          currentSpeed: test.tokensPerSec,
        });
      }
      
      // Calculate statistics
      speedTests.sort((a, b) => a - b);
      results.avgSpeed = speedTests.reduce((a, b) => a + b, 0) / speedTests.length;
      results.p99Speed = speedTests[0]; // Worst case
      
      // Test TTFT
      const ttftTest = await this.runQuickTest(modelId, provider, BENCHMARK_SUITE[1].prompt);
      results.avgTtft = ttftTest.ttftMs;
      
      // Save benchmark
      await this._saveBenchmark(results);
      
      this.emit('benchmark:completed', results);
      
      return results;
    } catch (error) {
      this.emit('benchmark:error', { benchmarkId, error: error.message });
      throw error;
    }
  }

  /**
   * Check model readiness after install
   */
  async checkReadiness(modelId, provider) {
    const checks = {
      modelId,
      provider,
      ready: false,
      checks: [],
    };
    
    try {
      // Check 1: Model exists/loaded
      if (provider === 'ollama') {
        const http = require('http');
        
        await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: 'localhost',
            port: 11434,
            path: '/api/tags',
            method: 'GET',
            timeout: 5000,
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                const found = response.models?.some(m => m.name === modelId);
                checks.checks.push({
                  name: 'Model Loaded',
                  passed: found,
                  message: found ? 'Model is available' : 'Model not found',
                });
                resolve();
              } catch (e) {
                checks.checks.push({
                  name: 'Model Loaded',
                  passed: false,
                  message: 'Failed to parse Ollama response',
                });
                resolve();
              }
            });
          });
          
          req.on('error', () => {
            checks.checks.push({
              name: 'Ollama Service',
              passed: false,
              message: 'Ollama is not running',
            });
            resolve();
          });
          
          req.end();
        });
      }
      
      // Check 2: Quick inference test
      const testResult = await this.runQuickTest(modelId, provider, 'Say "ready"');
      checks.checks.push({
        name: 'Inference Test',
        passed: testResult.success,
        message: testResult.success ? `Responded in ${testResult.ttftMs}ms` : testResult.error,
      });
      
      // Check 3: Speed check
      if (testResult.success && testResult.tokensPerSec > 1) {
        checks.checks.push({
          name: 'Speed Check',
          passed: true,
          message: `${testResult.tokensPerSec} tokens/sec`,
        });
      }
      
      // Determine overall readiness
      checks.ready = checks.checks.every(c => c.passed);
      
      this.emit('readiness:checked', checks);
      
      return checks;
    } catch (error) {
      checks.checks.push({
        name: 'Readiness Check',
        passed: false,
        message: error.message,
      });
      
      return checks;
    }
  }

  /**
   * Get community benchmarks for a model
   */
  getCommunityBenchmarks(modelId) {
    // In production, this would fetch from an API
    return COMMUNITY_BENCHMARKS[modelId] || null;
  }

  /**
   * Get local benchmark history
   */
  getLocalBenchmarks(modelId) {
    if (!this.db) return [];
    
    const results = this.db.exec(`
      SELECT * FROM model_benchmarks 
      WHERE modelId = ? 
      ORDER BY createdAt DESC 
      LIMIT 10
    `, [modelId]);
    
    if (results.length === 0) return [];
    
    return results[0].values.map(row => ({
      id: row[0],
      modelId: row[1],
      provider: row[2],
      avgSpeed: row[3],
      p99Speed: row[4],
      avgTtft: row[5],
      maxContext: row[6],
      memoryUsageMb: row[7],
      createdAt: row[8],
    }));
  }

  /**
   * Get test history for a model
   */
  getTestHistory(modelId, limit = 10) {
    if (!this.db) return [];
    
    const results = this.db.exec(`
      SELECT * FROM model_test_results 
      WHERE modelId = ? 
      ORDER BY createdAt DESC 
      LIMIT ?
    `, [modelId, limit]);
    
    if (results.length === 0) return [];
    
    return results[0].values.map(row => ({
      id: row[0],
      modelId: row[1],
      provider: row[2],
      testType: row[3],
      prompt: row[4],
      response: row[5],
      tokensGenerated: row[6],
      timeMs: row[7],
      tokensPerSec: row[8],
      ttftMs: row[9],
      success: row[10] === 1,
      error: row[11],
      createdAt: row[12],
    }));
  }

  /**
   * Save test result to database
   */
  async _saveTestResult(result) {
    if (!this.db) return;
    
    this.db.run(`
      INSERT INTO model_test_results 
      (id, modelId, provider, testType, prompt, response, tokensGenerated, timeMs, tokensPerSec, ttftMs, success, error, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      result.id,
      result.modelId,
      result.provider,
      result.testType,
      result.prompt,
      result.response,
      result.tokensGenerated,
      result.timeMs,
      result.tokensPerSec,
      result.ttftMs,
      result.success ? 1 : 0,
      result.error,
      result.createdAt,
    ]);
  }

  /**
   * Save benchmark to database
   */
  async _saveBenchmark(benchmark) {
    if (!this.db) return;
    
    this.db.run(`
      INSERT INTO model_benchmarks 
      (id, modelId, provider, avgSpeed, p99Speed, avgTtft, maxContext, memoryUsageMb, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      benchmark.id,
      benchmark.modelId,
      benchmark.provider,
      benchmark.avgSpeed,
      benchmark.p99Speed,
      benchmark.avgTtft,
      benchmark.maxContext,
      benchmark.memoryUsageMb,
      benchmark.createdAt,
    ]);
  }

  /**
   * Cancel an active test
   */
  cancelTest(testId) {
    if (this.activeTests.has(testId)) {
      this.activeTests.delete(testId);
      this.emit('test:cancelled', { testId });
      return true;
    }
    return false;
  }

  /**
   * Get active tests
   */
  getActiveTests() {
    return Array.from(this.activeTests.entries()).map(([id, test]) => ({
      id,
      ...test,
    }));
  }
}

// Singleton
let modelTestingServiceInstance = null;

function getModelTestingService() {
  if (!modelTestingServiceInstance) {
    modelTestingServiceInstance = new ModelTestingService();
  }
  return modelTestingServiceInstance;
}

module.exports = {
  ModelTestingService,
  getModelTestingService,
  TEST_PROMPTS,
  BENCHMARK_SUITE,
};



