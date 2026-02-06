/**
 * Behavior Capture Service
 * 
 * Records user interactions and generates automated tests
 * from the recorded behavior.
 */

// Event types to capture
const CAPTURE_EVENTS = {
  CLICK: 'click',
  TYPE: 'type',
  NAVIGATE: 'navigate',
  SCROLL: 'scroll',
  HOVER: 'hover',
  SELECT: 'select',
  CHECK: 'check',
  UPLOAD: 'upload',
  DRAG: 'drag',
  WAIT: 'wait',
  ASSERT: 'assert'
};

// Test framework targets
const TEST_FRAMEWORKS = {
  PLAYWRIGHT: {
    id: 'playwright',
    name: 'Playwright',
    extension: '.spec.ts'
  },
  CYPRESS: {
    id: 'cypress',
    name: 'Cypress',
    extension: '.cy.js'
  },
  PUPPETEER: {
    id: 'puppeteer',
    name: 'Puppeteer',
    extension: '.test.js'
  },
  SELENIUM: {
    id: 'selenium',
    name: 'Selenium',
    extension: '.test.js'
  }
};

// Recording status
const RECORDING_STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused'
};

class BehaviorCapture {
  constructor() {
    this.sessions = [];
    this.currentSession = null;
    this.status = RECORDING_STATUS.IDLE;
    this.listeners = new Set();
    this.generatedTests = [];
    this.settings = {
      autoAssert: true,
      captureScreenshots: false,
      smartSelectors: true,
      ignoreElements: ['script', 'style', 'noscript']
    };
  }

  /**
   * Start recording session
   */
  startRecording(options = {}) {
    if (this.status === RECORDING_STATUS.RECORDING) {
      throw new Error('Already recording');
    }

    this.currentSession = {
      id: `session_${Date.now()}`,
      name: options.name || `Recording ${this.sessions.length + 1}`,
      startedAt: Date.now(),
      baseUrl: options.baseUrl || '',
      steps: [],
      assertions: [],
      status: 'recording',
      viewport: options.viewport || { width: 1280, height: 720 }
    };

    this.status = RECORDING_STATUS.RECORDING;
    this.notifyListeners();

    return this.currentSession;
  }

  /**
   * Stop recording session
   */
  stopRecording() {
    if (!this.currentSession) return null;

    this.currentSession.endedAt = Date.now();
    this.currentSession.duration = this.currentSession.endedAt - this.currentSession.startedAt;
    this.currentSession.status = 'completed';

    this.sessions.push(this.currentSession);
    const session = this.currentSession;

    this.currentSession = null;
    this.status = RECORDING_STATUS.IDLE;
    this.notifyListeners();

    return session;
  }

  /**
   * Pause recording
   */
  pauseRecording() {
    if (this.status !== RECORDING_STATUS.RECORDING) return;
    this.status = RECORDING_STATUS.PAUSED;
    this.notifyListeners();
  }

  /**
   * Resume recording
   */
  resumeRecording() {
    if (this.status !== RECORDING_STATUS.PAUSED) return;
    this.status = RECORDING_STATUS.RECORDING;
    this.notifyListeners();
  }

  /**
   * Record an interaction step
   */
  recordStep(step) {
    if (!this.currentSession || this.status !== RECORDING_STATUS.RECORDING) {
      return null;
    }

    const recordedStep = {
      id: `step_${Date.now()}_${this.currentSession.steps.length}`,
      timestamp: Date.now(),
      action: step.action,
      selector: step.selector || this.generateSelector(step.element),
      value: step.value,
      options: step.options || {},
      // For replay
      elementInfo: {
        tagName: step.element?.tagName,
        textContent: step.element?.textContent?.substring(0, 50),
        attributes: this.getRelevantAttributes(step.element)
      }
    };

    // Auto-generate assertions for certain actions
    if (this.settings.autoAssert) {
      const assertion = this.generateAutoAssertion(recordedStep);
      if (assertion) {
        recordedStep.assertion = assertion;
        this.currentSession.assertions.push(assertion);
      }
    }

    this.currentSession.steps.push(recordedStep);
    this.notifyListeners();

    return recordedStep;
  }

  /**
   * Generate smart selector for element
   */
  generateSelector(element) {
    if (!element) return null;

    // Priority: data-testid > id > unique class > nth-child
    const selectors = [];

    // Data test id
    if (element.dataset?.testid) {
      selectors.push(`[data-testid="${element.dataset.testid}"]`);
    }

    // ID
    if (element.id) {
      selectors.push(`#${element.id}`);
    }

    // Unique class
    if (element.className) {
      const classes = element.className.split(' ').filter(c => c.length > 0);
      for (const cls of classes) {
        if (!cls.includes('_') && !cls.match(/^[a-z]{1,2}$/)) {
          selectors.push(`.${cls}`);
        }
      }
    }

    // Role + name
    if (element.role && element.ariaLabel) {
      selectors.push(`[role="${element.role}"][aria-label="${element.ariaLabel}"]`);
    }

    // Text content for buttons/links
    if (['BUTTON', 'A'].includes(element.tagName) && element.textContent) {
      const text = element.textContent.trim().substring(0, 30);
      selectors.push(`${element.tagName.toLowerCase()}:has-text("${text}")`);
    }

    return selectors[0] || element.tagName?.toLowerCase();
  }

  /**
   * Get relevant attributes for element
   */
  getRelevantAttributes(element) {
    if (!element) return {};

    const relevant = ['id', 'class', 'name', 'type', 'placeholder', 'href', 'role', 'aria-label'];
    const attrs = {};

    for (const attr of relevant) {
      if (element.getAttribute?.(attr)) {
        attrs[attr] = element.getAttribute(attr);
      }
    }

    return attrs;
  }

  /**
   * Generate automatic assertion for step
   */
  generateAutoAssertion(step) {
    switch (step.action) {
      case CAPTURE_EVENTS.NAVIGATE:
        return {
          type: 'url_contains',
          value: step.value,
          description: `Verify URL contains "${step.value}"`
        };

      case CAPTURE_EVENTS.CLICK:
        if (step.elementInfo.tagName === 'BUTTON') {
          return {
            type: 'element_visible',
            selector: step.selector,
            description: `Verify button is clickable`
          };
        }
        break;

      case CAPTURE_EVENTS.TYPE:
        return {
          type: 'input_value',
          selector: step.selector,
          value: step.value,
          description: `Verify input has value`
        };

      default:
        return null;
    }
  }

  /**
   * Add manual assertion
   */
  addAssertion(assertion) {
    if (!this.currentSession) return null;

    const recorded = {
      id: `assert_${Date.now()}`,
      timestamp: Date.now(),
      type: assertion.type,
      selector: assertion.selector,
      expected: assertion.expected,
      description: assertion.description || `Assert ${assertion.type}`
    };

    this.currentSession.assertions.push(recorded);
    this.notifyListeners();

    return recorded;
  }

  /**
   * Generate test code from session
   */
  generateTest(sessionId, framework = 'playwright', options = {}) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return null;

    const config = TEST_FRAMEWORKS[framework.toUpperCase()] || TEST_FRAMEWORKS.PLAYWRIGHT;
    
    let testCode;
    switch (framework.toLowerCase()) {
      case 'playwright':
        testCode = this.generatePlaywrightTest(session, options);
        break;
      case 'cypress':
        testCode = this.generateCypressTest(session, options);
        break;
      case 'puppeteer':
        testCode = this.generatePuppeteerTest(session, options);
        break;
      default:
        testCode = this.generatePlaywrightTest(session, options);
    }

    const generatedTest = {
      id: `test_${Date.now()}`,
      sessionId,
      framework,
      code: testCode,
      filename: `${this.sanitizeFilename(session.name)}${config.extension}`,
      generatedAt: Date.now()
    };

    this.generatedTests.push(generatedTest);
    this.notifyListeners();

    return generatedTest;
  }

  /**
   * Generate Playwright test
   */
  generatePlaywrightTest(session, options = {}) {
    const { testName = session.name } = options;
    
    let code = `import { test, expect } from '@playwright/test';

test.describe('${testName}', () => {
  test('should complete user flow', async ({ page }) => {
    // Set viewport
    await page.setViewportSize({ width: ${session.viewport.width}, height: ${session.viewport.height} });

`;

    for (const step of session.steps) {
      code += this.stepToPlaywright(step);
    }

    code += `  });
});
`;

    return code;
  }

  /**
   * Convert step to Playwright code
   */
  stepToPlaywright(step) {
    let code = '';

    switch (step.action) {
      case CAPTURE_EVENTS.NAVIGATE:
        code = `    await page.goto('${step.value}');\n`;
        if (step.assertion?.type === 'url_contains') {
          code += `    await expect(page).toHaveURL(/${step.assertion.value}/);\n`;
        }
        break;

      case CAPTURE_EVENTS.CLICK:
        code = `    await page.locator('${step.selector}').click();\n`;
        break;

      case CAPTURE_EVENTS.TYPE:
        code = `    await page.locator('${step.selector}').fill('${step.value}');\n`;
        if (step.assertion?.type === 'input_value') {
          code += `    await expect(page.locator('${step.selector}')).toHaveValue('${step.value}');\n`;
        }
        break;

      case CAPTURE_EVENTS.HOVER:
        code = `    await page.locator('${step.selector}').hover();\n`;
        break;

      case CAPTURE_EVENTS.SELECT:
        code = `    await page.locator('${step.selector}').selectOption('${step.value}');\n`;
        break;

      case CAPTURE_EVENTS.WAIT:
        code = `    await page.waitForTimeout(${step.value || 1000});\n`;
        break;

      case CAPTURE_EVENTS.ASSERT:
        if (step.assertion?.type === 'element_visible') {
          code = `    await expect(page.locator('${step.selector}')).toBeVisible();\n`;
        }
        break;

      default:
        code = `    // ${step.action}: ${step.selector}\n`;
    }

    return code;
  }

  /**
   * Generate Cypress test
   */
  generateCypressTest(session, options = {}) {
    const { testName = session.name } = options;
    
    let code = `describe('${testName}', () => {
  beforeEach(() => {
    cy.viewport(${session.viewport.width}, ${session.viewport.height});
  });

  it('should complete user flow', () => {
`;

    for (const step of session.steps) {
      code += this.stepToCypress(step);
    }

    code += `  });
});
`;

    return code;
  }

  /**
   * Convert step to Cypress code
   */
  stepToCypress(step) {
    let code = '';

    switch (step.action) {
      case CAPTURE_EVENTS.NAVIGATE:
        code = `    cy.visit('${step.value}');\n`;
        if (step.assertion?.type === 'url_contains') {
          code += `    cy.url().should('include', '${step.assertion.value}');\n`;
        }
        break;

      case CAPTURE_EVENTS.CLICK:
        code = `    cy.get('${step.selector}').click();\n`;
        break;

      case CAPTURE_EVENTS.TYPE:
        code = `    cy.get('${step.selector}').clear().type('${step.value}');\n`;
        if (step.assertion?.type === 'input_value') {
          code += `    cy.get('${step.selector}').should('have.value', '${step.value}');\n`;
        }
        break;

      case CAPTURE_EVENTS.HOVER:
        code = `    cy.get('${step.selector}').trigger('mouseover');\n`;
        break;

      case CAPTURE_EVENTS.SELECT:
        code = `    cy.get('${step.selector}').select('${step.value}');\n`;
        break;

      case CAPTURE_EVENTS.WAIT:
        code = `    cy.wait(${step.value || 1000});\n`;
        break;

      default:
        code = `    // ${step.action}: ${step.selector}\n`;
    }

    return code;
  }

  /**
   * Generate Puppeteer test
   */
  generatePuppeteerTest(session, options = {}) {
    const { testName = session.name } = options;
    
    let code = `const puppeteer = require('puppeteer');

describe('${testName}', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch();
    page = await browser.newPage();
    await page.setViewport({ width: ${session.viewport.width}, height: ${session.viewport.height} });
  });

  afterAll(async () => {
    await browser.close();
  });

  test('should complete user flow', async () => {
`;

    for (const step of session.steps) {
      code += this.stepToPuppeteer(step);
    }

    code += `  });
});
`;

    return code;
  }

  /**
   * Convert step to Puppeteer code
   */
  stepToPuppeteer(step) {
    let code = '';

    switch (step.action) {
      case CAPTURE_EVENTS.NAVIGATE:
        code = `    await page.goto('${step.value}');\n`;
        break;

      case CAPTURE_EVENTS.CLICK:
        code = `    await page.click('${step.selector}');\n`;
        break;

      case CAPTURE_EVENTS.TYPE:
        code = `    await page.type('${step.selector}', '${step.value}');\n`;
        break;

      case CAPTURE_EVENTS.WAIT:
        code = `    await page.waitForTimeout(${step.value || 1000});\n`;
        break;

      default:
        code = `    // ${step.action}: ${step.selector}\n`;
    }

    return code;
  }

  /**
   * Sanitize filename
   */
  sanitizeFilename(name) {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.sessions.find(s => s.id === sessionId);
  }

  /**
   * Get all sessions
   */
  getSessions() {
    return [...this.sessions];
  }

  /**
   * Delete session
   */
  deleteSession(sessionId) {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    this.notifyListeners();
  }

  /**
   * Get generated tests
   */
  getGeneratedTests() {
    return [...this.generatedTests];
  }

  /**
   * Update settings
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
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
      status: this.status,
      currentSession: this.currentSession,
      sessions: this.sessions,
      settings: this.settings
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Behavior capture listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getBehaviorCapture() {
  if (!instance) {
    instance = new BehaviorCapture();
  }
  return instance;
}

export { CAPTURE_EVENTS, TEST_FRAMEWORKS, RECORDING_STATUS };
export default BehaviorCapture;
