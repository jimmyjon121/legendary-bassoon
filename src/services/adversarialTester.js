/**
 * Adversarial Testing Service
 * 
 * AI-powered testing that tries to break your code by generating
 * malicious inputs, edge cases, and attack vectors.
 */

// Attack vector definitions
const ATTACK_VECTORS = {
  nullInputs: {
    name: 'Null/Undefined Inputs',
    description: 'Test with null, undefined, and missing values',
    severity: 'high',
    generator: (paramTypes) => {
      const inputs = [null, undefined];
      if (paramTypes.includes('array')) inputs.push([]);
      if (paramTypes.includes('object')) inputs.push({});
      if (paramTypes.includes('string')) inputs.push('');
      return inputs;
    }
  },
  
  boundaryValues: {
    name: 'Boundary Values',
    description: 'Test at boundaries (0, -1, MAX_INT, etc)',
    severity: 'medium',
    generator: (paramTypes) => {
      const inputs = [];
      if (paramTypes.includes('number')) {
        inputs.push(0, -1, 1, -0, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 
                   Infinity, -Infinity, NaN, Number.MAX_VALUE, Number.MIN_VALUE);
      }
      if (paramTypes.includes('string')) {
        inputs.push('', ' ', '\n', '\t', '\0', 'a'.repeat(10000));
      }
      if (paramTypes.includes('array')) {
        inputs.push([], new Array(10000).fill(0));
      }
      return inputs;
    }
  },
  
  typeCoercion: {
    name: 'Type Coercion',
    description: 'Test with unexpected types',
    severity: 'medium',
    generator: (paramTypes) => {
      return [
        '123',           // String that looks like number
        '0',             // Falsy string number
        'true',          // String boolean
        'false',
        'null',
        'undefined',
        [],              // Array (coerces to '')
        {},              // Object (coerces to '[object Object]')
        () => {},        // Function
        Symbol('test'),  // Symbol
        new Date(),      // Date object
        /regex/,         // RegExp
        new Map(),       // Map
        new Set()        // Set
      ];
    }
  },
  
  injection: {
    name: 'Injection Payloads',
    description: 'Test for XSS, SQL injection, command injection',
    severity: 'critical',
    generator: () => [
      // XSS payloads
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert("xss")>',
      '"><script>alert("xss")</script>',
      "'-alert('xss')-'",
      'javascript:alert("xss")',
      '<svg onload=alert("xss")>',
      '{{constructor.constructor("alert(1)")()}}',
      
      // SQL injection
      "' OR '1'='1",
      "'; DROP TABLE users; --",
      "1; SELECT * FROM users",
      "' UNION SELECT * FROM users --",
      "admin'--",
      
      // Command injection
      '; ls -la',
      '| cat /etc/passwd',
      '`whoami`',
      '$(whoami)',
      '& ping -c 10 localhost',
      
      // Path traversal
      '../../../etc/passwd',
      '....//....//....//etc/passwd',
      '%2e%2e%2f%2e%2e%2f',
      
      // Template injection
      '{{7*7}}',
      '${7*7}',
      '<%= 7*7 %>'
    ]
  },
  
  overflow: {
    name: 'Overflow/Resource Exhaustion',
    description: 'Test with very large inputs',
    severity: 'high',
    generator: () => [
      'a'.repeat(1000000),          // Very long string
      new Array(100000).fill(1),    // Very large array
      Number.MAX_VALUE * 2,         // Overflow
      parseInt('9'.repeat(100)),    // Huge number parse
      JSON.parse('{"a":'.repeat(100) + '1' + '}'.repeat(100)), // Deep nesting
    ]
  },
  
  specialChars: {
    name: 'Special Characters',
    description: 'Test with unicode and special characters',
    severity: 'low',
    generator: () => [
      '🔥',                    // Emoji
      '中文',                  // Chinese
      'مرحبا',                 // Arabic (RTL)
      '\u0000',               // Null byte
      '\uFEFF',               // BOM
      '\u202E',               // RTL override
      'Ω≈ç√∫',                // Math symbols
      '&amp;&lt;&gt;',        // HTML entities
      '%00',                  // URL encoded null
      '\\x00',                // Escaped null
    ]
  },
  
  raceConditions: {
    name: 'Race Conditions',
    description: 'Concurrent execution patterns',
    severity: 'high',
    generator: () => ({
      type: 'concurrent',
      description: 'Call function multiple times simultaneously',
      pattern: 'Promise.all([fn(), fn(), fn(), fn(), fn()])'
    })
  },
  
  prototypePollution: {
    name: 'Prototype Pollution',
    description: 'Attempt to modify object prototypes',
    severity: 'critical',
    generator: () => [
      { '__proto__': { 'polluted': true } },
      { 'constructor': { 'prototype': { 'polluted': true } } },
      JSON.parse('{"__proto__":{"polluted":true}}'),
      { '__proto__.polluted': true },
    ]
  },
  
  regexDos: {
    name: 'ReDoS Patterns',
    description: 'Regex denial of service inputs',
    severity: 'high',
    generator: () => [
      'a'.repeat(100) + '!',           // For (a+)+
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaa!',  // Catastrophic backtracking
      'x'.repeat(100),                 // For (x+x+)+y
    ]
  }
};

// Test result severity
const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
};

// Result status
const TEST_STATUS = {
  PASSED: 'passed',
  FAILED: 'failed',
  CRASHED: 'crashed',
  TIMEOUT: 'timeout',
  VULNERABLE: 'vulnerable'
};

class AdversarialTester {
  constructor() {
    this.attackVectors = ATTACK_VECTORS;
    this.results = [];
    this.isRunning = false;
    this.listeners = new Set();
  }

  /**
   * Analyze function for potential vulnerabilities
   */
  analyzeFunction(code, functionName) {
    const analysis = {
      functionName,
      parameters: this.extractParameters(code, functionName),
      vulnerabilities: [],
      recommendations: [],
      attackSurface: []
    };

    // Check for vulnerable patterns
    const vulnerabilityPatterns = [
      { pattern: /eval\s*\(/g, type: 'code_execution', severity: SEVERITY.CRITICAL },
      { pattern: /innerHTML\s*=/g, type: 'xss', severity: SEVERITY.HIGH },
      { pattern: /document\.write/g, type: 'xss', severity: SEVERITY.HIGH },
      { pattern: /new\s+Function\s*\(/g, type: 'code_execution', severity: SEVERITY.CRITICAL },
      { pattern: /exec\s*\(/g, type: 'command_injection', severity: SEVERITY.CRITICAL },
      { pattern: /\.query\s*\(\s*['"`].*\+/g, type: 'sql_injection', severity: SEVERITY.CRITICAL },
      { pattern: /JSON\.parse\s*\([^)]*\)/g, type: 'json_parse', severity: SEVERITY.MEDIUM },
      { pattern: /parseInt\s*\([^)]*\)/g, type: 'type_coercion', severity: SEVERITY.LOW },
      { pattern: /\.\.\./g, type: 'spread_operator', severity: SEVERITY.INFO },
    ];

    for (const { pattern, type, severity } of vulnerabilityPatterns) {
      if (pattern.test(code)) {
        analysis.vulnerabilities.push({ type, severity, pattern: pattern.source });
        analysis.attackSurface.push(type);
      }
    }

    // Check for missing input validation
    if (!code.includes('typeof') && !code.includes('instanceof')) {
      analysis.recommendations.push('Add type checking for inputs');
    }
    
    if (!code.includes('null') && !code.includes('undefined') && !code.includes('?.')) {
      analysis.recommendations.push('Add null/undefined checks');
    }

    if (!code.includes('try') || !code.includes('catch')) {
      analysis.recommendations.push('Add error handling with try/catch');
    }

    return analysis;
  }

  /**
   * Extract function parameters from code
   */
  extractParameters(code, functionName) {
    const patterns = [
      new RegExp(`function\\s+${functionName}\\s*\\(([^)]*)\\)`),
      new RegExp(`const\\s+${functionName}\\s*=\\s*\\(([^)]*)\\)\\s*=>`),
      new RegExp(`${functionName}\\s*:\\s*\\(([^)]*)\\)\\s*=>`),
      new RegExp(`${functionName}\\s*=\\s*function\\s*\\(([^)]*)\\)`)
    ];

    for (const pattern of patterns) {
      const match = code.match(pattern);
      if (match) {
        const params = match[1].split(',').map(p => {
          const cleaned = p.trim();
          // Try to extract type hints
          const typeMatch = cleaned.match(/(\w+)\s*:\s*(\w+)/);
          if (typeMatch) {
            return { name: typeMatch[1], type: typeMatch[2].toLowerCase() };
          }
          return { name: cleaned.split('=')[0].trim(), type: 'unknown' };
        }).filter(p => p.name);
        
        return params;
      }
    }
    
    return [];
  }

  /**
   * Generate test cases for a function
   */
  generateTestCases(analysis, selectedVectors = null) {
    const testCases = [];
    const vectors = selectedVectors || Object.keys(this.attackVectors);

    for (const vectorName of vectors) {
      const vector = this.attackVectors[vectorName];
      if (!vector) continue;

      const paramTypes = analysis.parameters.map(p => p.type);
      const inputs = vector.generator(paramTypes);

      if (Array.isArray(inputs)) {
        inputs.forEach((input, index) => {
          testCases.push({
            id: `${vectorName}_${index}`,
            vector: vectorName,
            vectorName: vector.name,
            description: vector.description,
            severity: vector.severity,
            input,
            inputPreview: this.formatInput(input)
          });
        });
      } else if (inputs?.type === 'concurrent') {
        testCases.push({
          id: `${vectorName}_concurrent`,
          vector: vectorName,
          vectorName: vector.name,
          description: inputs.description,
          severity: vector.severity,
          input: inputs,
          inputPreview: inputs.pattern
        });
      }
    }

    return testCases;
  }

  /**
   * Format input for display
   */
  formatInput(input) {
    if (input === null) return 'null';
    if (input === undefined) return 'undefined';
    if (typeof input === 'function') return '[Function]';
    if (typeof input === 'symbol') return input.toString();
    if (typeof input === 'string' && input.length > 50) {
      return `"${input.substring(0, 50)}..." (${input.length} chars)`;
    }
    if (Array.isArray(input) && input.length > 10) {
      return `Array(${input.length})`;
    }
    try {
      const str = JSON.stringify(input);
      return str.length > 50 ? str.substring(0, 50) + '...' : str;
    } catch {
      return String(input);
    }
  }

  /**
   * Run adversarial tests on a function
   */
  async runTests(code, functionName, options = {}) {
    const {
      timeout = 5000,
      vectors = null,
      maxTests = 100
    } = options;

    this.isRunning = true;
    this.notifyListeners();

    const analysis = this.analyzeFunction(code, functionName);
    const testCases = this.generateTestCases(analysis, vectors).slice(0, maxTests);
    
    const results = {
      functionName,
      analysis,
      startedAt: Date.now(),
      testCases: [],
      summary: {
        total: testCases.length,
        passed: 0,
        failed: 0,
        crashed: 0,
        vulnerable: 0
      }
    };

    for (const testCase of testCases) {
      const result = await this.runSingleTest(code, functionName, testCase, timeout);
      results.testCases.push(result);
      
      // Update summary
      switch (result.status) {
        case TEST_STATUS.PASSED:
          results.summary.passed++;
          break;
        case TEST_STATUS.FAILED:
          results.summary.failed++;
          break;
        case TEST_STATUS.CRASHED:
          results.summary.crashed++;
          break;
        case TEST_STATUS.VULNERABLE:
          results.summary.vulnerable++;
          break;
      }

      this.notifyListeners();
    }

    results.completedAt = Date.now();
    results.duration = results.completedAt - results.startedAt;
    
    this.results.push(results);
    this.isRunning = false;
    this.notifyListeners();

    return results;
  }

  /**
   * Run a single test case
   */
  async runSingleTest(code, functionName, testCase, timeout) {
    const result = {
      ...testCase,
      status: TEST_STATUS.PASSED,
      error: null,
      output: null,
      duration: 0,
      details: []
    };

    const startTime = Date.now();

    try {
      // Create a sandboxed execution environment
      // Note: In a real implementation, this would use a proper sandbox
      const testResult = await this.executeWithTimeout(
        () => this.simulateExecution(code, functionName, testCase.input),
        timeout
      );

      result.output = testResult;
      result.duration = Date.now() - startTime;

      // Check for vulnerability indicators
      if (this.checkForVulnerability(testCase, testResult)) {
        result.status = TEST_STATUS.VULNERABLE;
        result.details.push('Potential vulnerability detected in output');
      }

    } catch (error) {
      result.duration = Date.now() - startTime;
      result.error = error.message;

      if (error.message === 'Timeout') {
        result.status = TEST_STATUS.TIMEOUT;
        result.details.push('Function did not complete within timeout - possible DoS vulnerability');
      } else if (this.isExpectedError(error, testCase)) {
        result.status = TEST_STATUS.PASSED;
        result.details.push('Function properly rejected malicious input');
      } else {
        result.status = TEST_STATUS.CRASHED;
        result.details.push(`Unexpected crash: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Execute with timeout
   */
  async executeWithTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), timeout)
      )
    ]);
  }

  /**
   * Simulate code execution (static analysis, not actual execution)
   */
  simulateExecution(code, functionName, input) {
    // In a real implementation, this would use a sandboxed VM
    // For now, we do static analysis of how the input might be processed
    
    // Check if input would be dangerous with this code
    if (typeof input === 'string') {
      // Check for injection patterns that might work
      if (code.includes('innerHTML') && input.includes('<script')) {
        throw new Error('XSS vulnerability: script tag in innerHTML');
      }
      if (code.includes('.query') && input.includes("'")) {
        throw new Error('SQL injection vulnerability detected');
      }
    }

    return { simulated: true, input };
  }

  /**
   * Check if test result indicates vulnerability
   */
  checkForVulnerability(testCase, result) {
    // Check if malicious input was processed without sanitization
    if (testCase.vector === 'injection') {
      if (result && typeof result === 'object') {
        const resultStr = JSON.stringify(result);
        if (resultStr.includes('<script') || resultStr.includes('DROP TABLE')) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if error is expected for this input type
   */
  isExpectedError(error, testCase) {
    const expectedErrors = [
      'TypeError',
      'RangeError',
      'Invalid input',
      'Validation failed',
      'must be',
      'expected',
      'required'
    ];
    
    return expectedErrors.some(e => 
      error.message.includes(e) || error.name === e
    );
  }

  /**
   * Generate defensive code recommendations
   */
  generateDefensiveCode(analysis, results) {
    const recommendations = [];

    // Based on vulnerabilities found
    if (results.summary.crashed > 0) {
      recommendations.push({
        type: 'error_handling',
        title: 'Add Error Handling',
        code: `function ${analysis.functionName}Safe(${analysis.parameters.map(p => p.name).join(', ')}) {
  try {
    // Input validation
    ${analysis.parameters.map(p => 
      `if (${p.name} === null || ${p.name} === undefined) {
      throw new Error('${p.name} is required');
    }`
    ).join('\n    ')}
    
    // Original function logic here
    return ${analysis.functionName}(${analysis.parameters.map(p => p.name).join(', ')});
  } catch (error) {
    console.error('Error in ${analysis.functionName}:', error);
    throw error;
  }
}`
      });
    }

    if (results.summary.vulnerable > 0) {
      const vulnerableVectors = results.testCases
        .filter(t => t.status === TEST_STATUS.VULNERABLE)
        .map(t => t.vector);

      if (vulnerableVectors.includes('injection')) {
        recommendations.push({
          type: 'sanitization',
          title: 'Add Input Sanitization',
          code: `function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\\//g, '&#x2F;');
}`
        });
      }
    }

    return recommendations;
  }

  /**
   * Get test results
   */
  getResults() {
    return [...this.results];
  }

  /**
   * Clear results
   */
  clearResults() {
    this.results = [];
    this.notifyListeners();
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      isRunning: this.isRunning,
      results: this.results
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Adversarial tester listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getAdversarialTester() {
  if (!instance) {
    instance = new AdversarialTester();
  }
  return instance;
}

export { ATTACK_VECTORS, SEVERITY, TEST_STATUS };
export default AdversarialTester;
