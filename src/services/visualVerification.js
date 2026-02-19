/**
 * Visual Verification Service
 * 
 * Captures screenshots before/after code changes and uses AI
 * to verify visual correctness and detect regressions.
 */

// Verification modes
const VERIFICATION_MODES = {
  PIXEL_DIFF: 'pixel_diff',
  LAYOUT_DIFF: 'layout_diff',
  SEMANTIC_DIFF: 'semantic_diff',
  AI_ANALYSIS: 'ai_analysis'
};

// Capture types
const CAPTURE_TYPES = {
  SCREENSHOT: 'screenshot',
  DOM_SNAPSHOT: 'dom_snapshot',
  COMPUTED_STYLES: 'computed_styles'
};

// Assertion types
const ASSERTION_TYPES = {
  ELEMENT_VISIBLE: 'element_visible',
  ELEMENT_HIDDEN: 'element_hidden',
  COLOR_MATCH: 'color_match',
  LAYOUT_INTACT: 'layout_intact',
  TEXT_CONTENT: 'text_content',
  DIMENSION_MATCH: 'dimension_match'
};

// Verification result status
const VERIFICATION_STATUS = {
  PASSED: 'passed',
  FAILED: 'failed',
  WARNING: 'warning',
  SKIPPED: 'skipped'
};

class VisualVerification {
  constructor() {
    this.baselines = new Map(); // key -> baseline capture
    this.captures = [];
    this.verifications = [];
    this.assertions = [];
    this.listeners = new Set();
    this.isCapturing = false;
  }

  /**
   * Set baseline for comparison
   */
  async setBaseline(key, capture) {
    const baseline = {
      key,
      capture,
      createdAt: Date.now(),
      type: capture.type || CAPTURE_TYPES.SCREENSHOT
    };
    
    this.baselines.set(key, baseline);
    this.notifyListeners();
    return baseline;
  }

  /**
   * Get baseline
   */
  getBaseline(key) {
    return this.baselines.get(key);
  }

  /**
   * Capture current state (mock - real impl would use browser API)
   */
  async captureState(options = {}) {
    const {
      selector = 'body',
      type = CAPTURE_TYPES.SCREENSHOT,
      url = null,
      viewport = { width: 1920, height: 1080 }
    } = options;

    this.isCapturing = true;
    this.notifyListeners();

    try {
      // Mock capture - real implementation would use puppeteer/playwright
      const capture = {
        id: `capture_${Date.now()}`,
        type,
        selector,
        url,
        viewport,
        timestamp: Date.now(),
        // Mock data
        screenshot: null, // Would be base64 image data
        domSnapshot: type === CAPTURE_TYPES.DOM_SNAPSHOT ? this.mockDomSnapshot() : null,
        computedStyles: type === CAPTURE_TYPES.COMPUTED_STYLES ? this.mockComputedStyles() : null
      };

      this.captures.push(capture);
      return capture;

    } finally {
      this.isCapturing = false;
      this.notifyListeners();
    }
  }

  /**
   * Mock DOM snapshot
   */
  mockDomSnapshot() {
    return {
      tagName: 'body',
      children: [
        { tagName: 'header', className: 'header', children: [] },
        { tagName: 'main', className: 'content', children: [] },
        { tagName: 'footer', className: 'footer', children: [] }
      ],
      attributes: {},
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    };
  }

  /**
   * Mock computed styles
   */
  mockComputedStyles() {
    return {
      body: {
        backgroundColor: '#ffffff',
        fontSize: '16px',
        fontFamily: 'system-ui'
      }
    };
  }

  /**
   * Compare two captures
   */
  async compare(baseline, current, options = {}) {
    const {
      mode = VERIFICATION_MODES.AI_ANALYSIS,
      threshold = 0.01 // 1% difference tolerance
    } = options;

    const comparison = {
      id: `compare_${Date.now()}`,
      baseline: baseline.id || baseline.key,
      current: current.id,
      mode,
      threshold,
      timestamp: Date.now(),
      result: null,
      differences: []
    };

    switch (mode) {
      case VERIFICATION_MODES.PIXEL_DIFF:
        comparison.result = this.pixelDiff(baseline, current, threshold);
        break;
      case VERIFICATION_MODES.LAYOUT_DIFF:
        comparison.result = this.layoutDiff(baseline, current);
        break;
      case VERIFICATION_MODES.SEMANTIC_DIFF:
        comparison.result = this.semanticDiff(baseline, current);
        break;
      case VERIFICATION_MODES.AI_ANALYSIS:
        comparison.result = await this.aiAnalysis(baseline, current);
        break;
    }

    this.verifications.push(comparison);
    this.notifyListeners();

    return comparison;
  }

  /**
   * Pixel-level diff (mock)
   */
  pixelDiff(baseline, current, threshold) {
    // Mock implementation
    const diffPercentage = Math.random() * 0.05; // 0-5% random diff
    
    return {
      match: diffPercentage <= threshold,
      diffPercentage: Math.round(diffPercentage * 10000) / 100,
      threshold: threshold * 100,
      diffPixels: Math.floor(diffPercentage * 1920 * 1080),
      totalPixels: 1920 * 1080,
      diffImage: null // Would be base64 diff visualization
    };
  }

  /**
   * Layout diff (mock)
   */
  layoutDiff(baseline, current) {
    // Mock implementation
    const layoutChanges = [];
    
    // Simulate layout analysis
    if (Math.random() > 0.7) {
      layoutChanges.push({
        element: '.header',
        change: 'height_changed',
        before: '60px',
        after: '72px'
      });
    }

    return {
      match: layoutChanges.length === 0,
      changes: layoutChanges,
      elementsChecked: 15,
      elementsChanged: layoutChanges.length
    };
  }

  /**
   * Semantic diff (mock)
   */
  semanticDiff(baseline, current) {
    // Mock implementation
    const semanticChanges = [];
    
    // Simulate semantic analysis
    if (Math.random() > 0.8) {
      semanticChanges.push({
        type: 'content_change',
        element: 'h1',
        description: 'Heading text changed'
      });
    }

    return {
      match: semanticChanges.length === 0,
      changes: semanticChanges,
      confidence: 0.95
    };
  }

  /**
   * AI-powered analysis (mock)
   */
  async aiAnalysis(baseline, current) {
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock AI analysis results
    const issues = [];
    
    if (Math.random() > 0.7) {
      issues.push({
        severity: 'warning',
        description: 'Button appears slightly misaligned',
        location: { x: 400, y: 300 },
        confidence: 0.85
      });
    }

    if (Math.random() > 0.9) {
      issues.push({
        severity: 'error',
        description: 'Content appears to be cut off',
        location: { x: 800, y: 600 },
        confidence: 0.92
      });
    }

    return {
      match: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      aiConfidence: 0.88,
      analysis: 'Visual inspection completed. ' + 
        (issues.length === 0 ? 'No significant changes detected.' : 
        `Found ${issues.length} potential issue(s).`)
    };
  }

  /**
   * Add visual assertion
   */
  addAssertion(assertion) {
    const validatedAssertion = {
      id: `assert_${Date.now()}`,
      type: assertion.type,
      selector: assertion.selector,
      expected: assertion.expected,
      tolerance: assertion.tolerance || 0,
      description: assertion.description || `Assert ${assertion.type} for ${assertion.selector}`,
      status: VERIFICATION_STATUS.PENDING,
      createdAt: Date.now()
    };

    this.assertions.push(validatedAssertion);
    this.notifyListeners();

    return validatedAssertion;
  }

  /**
   * Run assertion
   */
  async runAssertion(assertionId, capture) {
    const assertion = this.assertions.find(a => a.id === assertionId);
    if (!assertion) return null;

    assertion.lastRun = Date.now();

    // Mock assertion execution based on type
    switch (assertion.type) {
      case ASSERTION_TYPES.ELEMENT_VISIBLE:
        assertion.status = Math.random() > 0.1 ? 
          VERIFICATION_STATUS.PASSED : VERIFICATION_STATUS.FAILED;
        assertion.actual = assertion.status === VERIFICATION_STATUS.PASSED;
        break;

      case ASSERTION_TYPES.COLOR_MATCH: {
        const colorMatch = Math.random() > 0.2;
        assertion.status = colorMatch ? 
          VERIFICATION_STATUS.PASSED : VERIFICATION_STATUS.FAILED;
        assertion.actual = colorMatch ? assertion.expected : '#ff0000';
        break;
      }

      case ASSERTION_TYPES.LAYOUT_INTACT:
        assertion.status = Math.random() > 0.15 ? 
          VERIFICATION_STATUS.PASSED : VERIFICATION_STATUS.WARNING;
        break;

      default:
        assertion.status = VERIFICATION_STATUS.PASSED;
    }

    this.notifyListeners();
    return assertion;
  }

  /**
   * Run all assertions
   */
  async runAllAssertions(capture) {
    const results = [];
    
    for (const assertion of this.assertions) {
      const result = await this.runAssertion(assertion.id, capture);
      results.push(result);
    }

    return {
      total: results.length,
      passed: results.filter(r => r.status === VERIFICATION_STATUS.PASSED).length,
      failed: results.filter(r => r.status === VERIFICATION_STATUS.FAILED).length,
      warnings: results.filter(r => r.status === VERIFICATION_STATUS.WARNING).length,
      results
    };
  }

  /**
   * Verify code change visually
   */
  async verifyChange(baselineKey, options = {}) {
    const baseline = this.getBaseline(baselineKey);
    if (!baseline) {
      throw new Error(`No baseline found for key: ${baselineKey}`);
    }

    // Capture current state
    const current = await this.captureState(options);

    // Compare with baseline
    const comparison = await this.compare(baseline.capture, current, options);

    // Run assertions
    const assertionResults = await this.runAllAssertions(current);

    // Combine results
    const verification = {
      id: `verify_${Date.now()}`,
      baselineKey,
      comparison,
      assertions: assertionResults,
      overallStatus: this.determineOverallStatus(comparison, assertionResults),
      timestamp: Date.now()
    };

    return verification;
  }

  /**
   * Determine overall verification status
   */
  determineOverallStatus(comparison, assertionResults) {
    if (!comparison.result.match) {
      return VERIFICATION_STATUS.FAILED;
    }
    
    if (assertionResults.failed > 0) {
      return VERIFICATION_STATUS.FAILED;
    }
    
    if (assertionResults.warnings > 0) {
      return VERIFICATION_STATUS.WARNING;
    }

    return VERIFICATION_STATUS.PASSED;
  }

  /**
   * Update baseline from current
   */
  async updateBaseline(key, options = {}) {
    const capture = await this.captureState(options);
    return this.setBaseline(key, capture);
  }

  /**
   * Get all baselines
   */
  getBaselines() {
    return Array.from(this.baselines.values());
  }

  /**
   * Get verification history
   */
  getHistory() {
    return [...this.verifications].reverse();
  }

  /**
   * Get assertions
   */
  getAssertions() {
    return [...this.assertions];
  }

  /**
   * Remove assertion
   */
  removeAssertion(assertionId) {
    this.assertions = this.assertions.filter(a => a.id !== assertionId);
    this.notifyListeners();
  }

  /**
   * Clear all data
   */
  clear() {
    this.baselines.clear();
    this.captures = [];
    this.verifications = [];
    this.assertions = [];
    this.notifyListeners();
  }

  /**
   * Export configuration
   */
  export() {
    return {
      baselines: Array.from(this.baselines.entries()),
      assertions: this.assertions,
      exportedAt: Date.now()
    };
  }

  /**
   * Import configuration
   */
  import(data) {
    if (data.baselines) {
      this.baselines = new Map(data.baselines);
    }
    if (data.assertions) {
      this.assertions = data.assertions;
    }
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
      baselines: this.getBaselines(),
      assertions: this.assertions,
      recentVerifications: this.verifications.slice(-5),
      isCapturing: this.isCapturing
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Visual verification listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getVisualVerification() {
  if (!instance) {
    instance = new VisualVerification();
  }
  return instance;
}

export { VERIFICATION_MODES, CAPTURE_TYPES, ASSERTION_TYPES, VERIFICATION_STATUS };
export default VisualVerification;
