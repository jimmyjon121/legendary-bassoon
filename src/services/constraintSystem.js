/**
 * Constraint System
 * 
 * Defines and enforces constraints that the AI must respect:
 * - Code style rules
 * - Performance budgets
 * - API stability requirements
 * - File size limits
 * - Pattern preferences
 * 
 * The AI will be given these constraints in its system prompt.
 */

// ============================================================================
// Default Constraints
// ============================================================================

export const DEFAULT_CONSTRAINTS = {
  // Style constraints
  style: {
    guide: 'auto', // 'airbnb', 'prettier', 'standard', 'auto' (detect from config)
    maxFileLines: 500,
    maxFunctionLines: 50,
    maxLineLength: 120,
    preferredQuotes: 'single', // 'single', 'double', 'auto'
    semicolons: 'auto', // true, false, 'auto'
    indentation: 'auto', // 2, 4, 'tab', 'auto'
  },
  
  // Pattern preferences
  patterns: {
    preferred: [
      'functional components',
      'hooks',
      'composition over inheritance',
      'explicit returns',
      'descriptive variable names'
    ],
    avoid: [
      'class components (unless necessary)',
      'any type',
      'magic numbers',
      'nested ternaries',
      'mutation in reducers'
    ]
  },
  
  // Performance budgets
  performance: {
    maxBundleSizeKB: null, // null = no limit
    maxComponentRenderMs: 16, // Target 60fps
    warnOnLargeImports: true,
    preferLazyLoading: true
  },
  
  // API stability
  apiStability: {
    breakingChangesAllowed: false,
    deprecationNoticeRequired: true,
    exportChangesRequireReview: true,
    minorVersionBumpsAllowed: true
  },
  
  // Security
  security: {
    noHardcodedSecrets: true,
    sanitizeUserInput: true,
    useTypedAPIs: true,
    validateExternalData: true
  },
  
  // Testing
  testing: {
    requireTestsForNewCode: false,
    minimumCoverage: null, // null = no minimum
    preferIntegrationTests: false
  }
};

// ============================================================================
// Constraint Manager
// ============================================================================

export class ConstraintManager {
  constructor(projectRoot = '') {
    this.projectRoot = projectRoot;
    this.constraints = { ...DEFAULT_CONSTRAINTS };
    this.detectedConfig = null;
  }

  /**
   * Set constraints
   */
  setConstraints(constraints) {
    this.constraints = this.mergeDeep(this.constraints, constraints);
    return this;
  }

  /**
   * Get all constraints
   */
  getConstraints() {
    return this.constraints;
  }

  /**
   * Get constraints for a specific category
   */
  getCategory(category) {
    return this.constraints[category] || null;
  }

  /**
   * Auto-detect constraints from project config files
   */
  async autoDetect(fileReader) {
    const detected = {
      style: {},
      patterns: {}
    };

    try {
      // Check for ESLint config
      const eslintConfig = await this.tryReadJson(fileReader, '.eslintrc.json');
      if (eslintConfig) {
        detected.style.guide = 'eslint';
        if (eslintConfig.extends?.includes('airbnb')) {
          detected.style.guide = 'airbnb';
        }
      }

      // Check for Prettier config
      const prettierConfig = await this.tryReadJson(fileReader, '.prettierrc');
      if (prettierConfig) {
        detected.style.preferredQuotes = prettierConfig.singleQuote ? 'single' : 'double';
        detected.style.semicolons = prettierConfig.semi !== false;
        detected.style.indentation = prettierConfig.tabWidth || 2;
        detected.style.maxLineLength = prettierConfig.printWidth || 120;
      }

      // Check for TypeScript config
      const tsConfig = await this.tryReadJson(fileReader, 'tsconfig.json');
      if (tsConfig?.compilerOptions?.strict) {
        detected.patterns.preferred = [
          ...this.constraints.patterns.preferred,
          'strict TypeScript types'
        ];
        detected.patterns.avoid = [
          ...this.constraints.patterns.avoid,
          'any type'
        ];
      }

      // Check for package.json scripts
      const pkg = await this.tryReadJson(fileReader, 'package.json');
      if (pkg?.scripts?.test) {
        detected.testing = { requireTestsForNewCode: false }; // Tests exist
      }

    } catch (error) {
      console.warn('[Constraints] Auto-detect failed:', error.message);
    }

    this.detectedConfig = detected;
    this.constraints = this.mergeDeep(this.constraints, detected);
    
    return detected;
  }

  /**
   * Try to read and parse a JSON file
   */
  async tryReadJson(fileReader, filename) {
    try {
      const content = await fileReader(`${this.projectRoot}/${filename}`);
      return content ? JSON.parse(content) : null;
    } catch {
      return null;
    }
  }

  /**
   * Validate code against constraints
   */
  validateCode(content, filePath) {
    const violations = [];
    const lines = content.split('\n');
    const { style, patterns, security } = this.constraints;

    // Check file length
    if (style.maxFileLines && lines.length > style.maxFileLines) {
      violations.push({
        type: 'style',
        rule: 'maxFileLines',
        message: `File has ${lines.length} lines (max: ${style.maxFileLines})`,
        severity: 'warning'
      });
    }

    // Check line length
    if (style.maxLineLength) {
      lines.forEach((line, i) => {
        if (line.length > style.maxLineLength) {
          violations.push({
            type: 'style',
            rule: 'maxLineLength',
            message: `Line ${i + 1} has ${line.length} characters (max: ${style.maxLineLength})`,
            severity: 'info',
            line: i + 1
          });
        }
      });
    }

    // Check for avoided patterns
    const avoidChecks = [
      { pattern: /\bany\b/, name: 'any type', applies: filePath.endsWith('.ts') || filePath.endsWith('.tsx') },
      { pattern: /class\s+\w+\s+extends\s+React\.Component/, name: 'class components', applies: true },
      { pattern: /\/\/\s*@ts-ignore/, name: '@ts-ignore', applies: true },
      { pattern: /console\.(log|debug|info)/, name: 'console.log', applies: true },
    ];

    for (const check of avoidChecks) {
      if (!check.applies) continue;
      if (patterns.avoid?.some(p => p.toLowerCase().includes(check.name.toLowerCase()))) {
        if (check.pattern.test(content)) {
          violations.push({
            type: 'pattern',
            rule: 'avoidPattern',
            message: `Code contains avoided pattern: ${check.name}`,
            severity: 'warning'
          });
        }
      }
    }

    // Security checks
    if (security.noHardcodedSecrets) {
      const secretPatterns = [
        /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
        /password\s*[:=]\s*['"][^'"]+['"]/i,
        /secret\s*[:=]\s*['"][^'"]+['"]/i,
        /token\s*[:=]\s*['"][A-Za-z0-9_-]{20,}['"]/i,
      ];

      for (const pattern of secretPatterns) {
        if (pattern.test(content)) {
          violations.push({
            type: 'security',
            rule: 'noHardcodedSecrets',
            message: 'Possible hardcoded secret detected',
            severity: 'error'
          });
          break;
        }
      }
    }

    return {
      valid: violations.filter(v => v.severity === 'error').length === 0,
      violations
    };
  }

  /**
   * Generate prompt context from constraints
   */
  toPromptContext() {
    const sections = [];
    const { style, patterns, apiStability, security, testing } = this.constraints;

    sections.push(`## Code Constraints

You MUST follow these constraints when writing or modifying code:`);

    // Style
    sections.push(`
### Style Rules
- Max file length: ${style.maxFileLines || 'no limit'} lines
- Max function length: ${style.maxFunctionLines || 'no limit'} lines  
- Max line length: ${style.maxLineLength || 'no limit'} characters
- Style guide: ${style.guide}`);

    // Patterns
    if (patterns.preferred?.length > 0) {
      sections.push(`
### Preferred Patterns
${patterns.preferred.map(p => `- Use: ${p}`).join('\n')}`);
    }

    if (patterns.avoid?.length > 0) {
      sections.push(`
### Patterns to Avoid
${patterns.avoid.map(p => `- Avoid: ${p}`).join('\n')}`);
    }

    // API stability
    if (!apiStability.breakingChangesAllowed) {
      sections.push(`
### API Stability
- Breaking changes are NOT allowed
- Deprecate before removing (add @deprecated comment)
- Export changes require explicit approval`);
    }

    // Security
    sections.push(`
### Security Requirements
- No hardcoded secrets/API keys
- Sanitize all user input
- Validate external data`);

    return sections.join('\n');
  }

  /**
   * Deep merge helper
   */
  mergeDeep(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(target[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Export constraints to JSON
   */
  export() {
    return {
      projectRoot: this.projectRoot,
      constraints: this.constraints,
      detectedConfig: this.detectedConfig,
      exportedAt: Date.now()
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let manager = null;

export function getConstraintManager(projectRoot) {
  if (!manager || (projectRoot && manager.projectRoot !== projectRoot)) {
    manager = new ConstraintManager(projectRoot);
  }
  return manager;
}

export function createConstraintManager(projectRoot) {
  return new ConstraintManager(projectRoot);
}

// ============================================================================
// Export
// ============================================================================

export default {
  DEFAULT_CONSTRAINTS,
  ConstraintManager,
  getConstraintManager,
  createConstraintManager
};
