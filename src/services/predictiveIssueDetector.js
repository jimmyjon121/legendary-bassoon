/**
 * Predictive Issue Detector
 * 
 * Analyzes code patterns to predict potential issues before they
 * manifest in production, using pattern matching and heuristics.
 */

// Issue categories
const ISSUE_CATEGORIES = {
  MEMORY: 'memory',
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  RELIABILITY: 'reliability',
  MAINTAINABILITY: 'maintainability',
  CONCURRENCY: 'concurrency'
};

// Severity levels
const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
};

// Issue patterns with detection rules
const ISSUE_PATTERNS = [
  // Memory Issues
  {
    id: 'memory_leak_event_listener',
    category: ISSUE_CATEGORIES.MEMORY,
    severity: SEVERITY.HIGH,
    name: 'Potential Memory Leak: Event Listener',
    description: 'Event listener added without corresponding cleanup',
    pattern: /addEventListener\s*\([^)]+\)/g,
    negativePattern: /removeEventListener/,
    fix: 'Ensure removeEventListener is called in cleanup (useEffect return, componentWillUnmount)',
    example: `// Add cleanup:
useEffect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);`
  },
  {
    id: 'memory_leak_interval',
    category: ISSUE_CATEGORIES.MEMORY,
    severity: SEVERITY.HIGH,
    name: 'Potential Memory Leak: Interval',
    description: 'setInterval without clearInterval',
    pattern: /setInterval\s*\(/g,
    negativePattern: /clearInterval/,
    fix: 'Store interval ID and call clearInterval in cleanup'
  },
  {
    id: 'memory_leak_timeout',
    category: ISSUE_CATEGORIES.MEMORY,
    severity: SEVERITY.MEDIUM,
    name: 'Potential Memory Leak: Timeout',
    description: 'setTimeout in component without cleanup',
    pattern: /setTimeout\s*\(/g,
    negativePattern: /clearTimeout/,
    contextPattern: /useEffect|componentDidMount/,
    fix: 'Clear timeout on unmount to prevent state updates on unmounted components'
  },
  {
    id: 'memory_leak_subscription',
    category: ISSUE_CATEGORIES.MEMORY,
    severity: SEVERITY.HIGH,
    name: 'Potential Memory Leak: Subscription',
    description: 'Observable subscription without unsubscribe',
    pattern: /\.subscribe\s*\(/g,
    negativePattern: /\.unsubscribe|subscription\.remove/,
    fix: 'Store subscription and unsubscribe in cleanup'
  },

  // Performance Issues
  {
    id: 'perf_n_plus_one',
    category: ISSUE_CATEGORIES.PERFORMANCE,
    severity: SEVERITY.HIGH,
    name: 'N+1 Query Pattern',
    description: 'Database/API call inside a loop',
    pattern: /for\s*\([^)]+\)\s*\{[^}]*await[^}]*\.(find|get|fetch|query)/gs,
    fix: 'Batch queries outside the loop or use bulk operations'
  },
  {
    id: 'perf_sync_in_render',
    category: ISSUE_CATEGORIES.PERFORMANCE,
    severity: SEVERITY.MEDIUM,
    name: 'Expensive Operation in Render',
    description: 'Potentially expensive computation during render',
    pattern: /return\s*\([^)]*\{[^}]*(\.filter\([^)]+\)\.map|\.sort\(|\.reduce\()/gs,
    fix: 'Move computation to useMemo or compute before render'
  },
  {
    id: 'perf_inline_objects',
    category: ISSUE_CATEGORIES.PERFORMANCE,
    severity: SEVERITY.LOW,
    name: 'Inline Object in JSX',
    description: 'Inline objects cause unnecessary re-renders',
    pattern: /style\s*=\s*\{\s*\{/g,
    fix: 'Move styles to constant or use useMemo for dynamic styles'
  },
  {
    id: 'perf_console_log',
    category: ISSUE_CATEGORIES.PERFORMANCE,
    severity: SEVERITY.LOW,
    name: 'Console Statements in Production',
    description: 'Console statements should be removed for production',
    pattern: /console\.(log|debug|info|warn|trace)\s*\(/g,
    fix: 'Remove or guard console statements for production builds'
  },
  {
    id: 'perf_large_bundle',
    category: ISSUE_CATEGORIES.PERFORMANCE,
    severity: SEVERITY.MEDIUM,
    name: 'Large Import',
    description: 'Importing entire library when tree-shaking possible',
    pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"](?!\.)/g,
    fix: 'Import only needed exports: import { specific } from "library"'
  },

  // Security Issues
  {
    id: 'sec_xss_innerhtml',
    category: ISSUE_CATEGORIES.SECURITY,
    severity: SEVERITY.CRITICAL,
    name: 'XSS Vulnerability: innerHTML',
    description: 'Direct innerHTML assignment can lead to XSS',
    pattern: /\.innerHTML\s*=(?!\s*['"`])/g,
    fix: 'Use textContent for text, or sanitize HTML with DOMPurify'
  },
  {
    id: 'sec_xss_dangerously',
    category: ISSUE_CATEGORIES.SECURITY,
    severity: SEVERITY.HIGH,
    name: 'XSS Vulnerability: dangerouslySetInnerHTML',
    description: 'Using dangerouslySetInnerHTML without sanitization',
    pattern: /dangerouslySetInnerHTML/g,
    negativePattern: /DOMPurify|sanitize/i,
    fix: 'Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML'
  },
  {
    id: 'sec_eval',
    category: ISSUE_CATEGORIES.SECURITY,
    severity: SEVERITY.CRITICAL,
    name: 'Code Injection: eval()',
    description: 'eval() can execute arbitrary code',
    pattern: /\beval\s*\(/g,
    fix: 'Use safer alternatives like JSON.parse() or specific parsers'
  },
  {
    id: 'sec_sql_injection',
    category: ISSUE_CATEGORIES.SECURITY,
    severity: SEVERITY.CRITICAL,
    name: 'SQL Injection Risk',
    description: 'String concatenation in SQL query',
    pattern: /\.(query|execute)\s*\(\s*['"`].*\+/g,
    fix: 'Use parameterized queries or prepared statements'
  },
  {
    id: 'sec_hardcoded_secret',
    category: ISSUE_CATEGORIES.SECURITY,
    severity: SEVERITY.HIGH,
    name: 'Hardcoded Secret',
    description: 'Potential hardcoded secret or API key',
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    fix: 'Use environment variables for secrets'
  },

  // Reliability Issues
  {
    id: 'rel_unhandled_promise',
    category: ISSUE_CATEGORIES.RELIABILITY,
    severity: SEVERITY.HIGH,
    name: 'Unhandled Promise',
    description: 'Promise without .catch() or try/catch',
    pattern: /\.then\s*\([^)]+\)(?!\s*\.catch|\s*\.finally)/g,
    fix: 'Add .catch() handler or use try/catch with async/await'
  },
  {
    id: 'rel_missing_error_boundary',
    category: ISSUE_CATEGORIES.RELIABILITY,
    severity: SEVERITY.MEDIUM,
    name: 'Missing Error Boundary',
    description: 'Component tree without error boundary',
    pattern: /throw new Error|throw Error/g,
    negativePattern: /ErrorBoundary|componentDidCatch/,
    fix: 'Wrap component tree with ErrorBoundary component'
  },
  {
    id: 'rel_null_check',
    category: ISSUE_CATEGORIES.RELIABILITY,
    severity: SEVERITY.MEDIUM,
    name: 'Missing Null Check',
    description: 'Accessing property without null check',
    pattern: /\w+\.\w+\.\w+(?!\?)/g,
    negativePattern: /\?\./,
    fix: 'Use optional chaining (?.) or explicit null checks'
  },
  {
    id: 'rel_race_condition',
    category: ISSUE_CATEGORIES.CONCURRENCY,
    severity: SEVERITY.HIGH,
    name: 'Potential Race Condition',
    description: 'Async state update without cancellation',
    pattern: /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*await[^}]*set\w+\s*\(/gs,
    negativePattern: /cancelled|aborted|isMounted|abort/i,
    fix: 'Add cancellation check before setting state in async effects'
  },

  // Maintainability Issues
  {
    id: 'maint_magic_number',
    category: ISSUE_CATEGORIES.MAINTAINABILITY,
    severity: SEVERITY.LOW,
    name: 'Magic Number',
    description: 'Unexplained numeric literal',
    pattern: /(?<!const\s+\w+\s*=\s*)(?<!\w)\b(?!0\b|1\b|2\b|-1\b)\d{3,}\b/g,
    fix: 'Extract to named constant with descriptive name'
  },
  {
    id: 'maint_todo_comment',
    category: ISSUE_CATEGORIES.MAINTAINABILITY,
    severity: SEVERITY.INFO,
    name: 'TODO Comment',
    description: 'Outstanding TODO in code',
    pattern: /\/\/\s*(TODO|FIXME|HACK|XXX):/gi,
    fix: 'Address or create ticket for tracking'
  },
  {
    id: 'maint_any_type',
    category: ISSUE_CATEGORIES.MAINTAINABILITY,
    severity: SEVERITY.MEDIUM,
    name: 'Any Type Usage',
    description: 'Using "any" type reduces type safety',
    pattern: /:\s*any\b|as\s+any\b/g,
    fix: 'Define proper types or use unknown with type guards'
  },
  {
    id: 'maint_long_function',
    category: ISSUE_CATEGORIES.MAINTAINABILITY,
    severity: SEVERITY.MEDIUM,
    name: 'Long Function',
    description: 'Function exceeds recommended length',
    check: (content) => {
      const functionPattern = /function\s+\w+\s*\([^)]*\)\s*\{|=>\s*\{/g;
      const matches = [...content.matchAll(functionPattern)];
      const issues = [];
      
      matches.forEach(match => {
        const start = match.index;
        let depth = 0;
        let end = start;
        
        for (let i = start; i < content.length; i++) {
          if (content[i] === '{') depth++;
          if (content[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        
        const lines = content.substring(start, end).split('\n').length;
        if (lines > 50) {
          issues.push({ start, lines });
        }
      });
      
      return issues;
    },
    fix: 'Break into smaller, focused functions'
  }
];

class PredictiveIssueDetector {
  constructor() {
    this.patterns = ISSUE_PATTERNS;
    this.detectedIssues = [];
    this.listeners = new Set();
    this.suppressedIssues = new Set();
  }

  /**
   * Analyze code for potential issues
   */
  analyze(code, filePath = '', options = {}) {
    const {
      categories = Object.values(ISSUE_CATEGORIES),
      minSeverity = SEVERITY.LOW,
      includeInfo = false
    } = options;

    this.detectedIssues = [];
    const severityOrder = [SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.MEDIUM, SEVERITY.LOW, SEVERITY.INFO];
    const minSeverityIndex = severityOrder.indexOf(minSeverity);

    for (const pattern of this.patterns) {
      // Skip if category not selected
      if (!categories.includes(pattern.category)) continue;

      // Skip if below minimum severity
      const severityIndex = severityOrder.indexOf(pattern.severity);
      if (!includeInfo && pattern.severity === SEVERITY.INFO) continue;
      if (severityIndex > minSeverityIndex) continue;

      // Skip if suppressed
      if (this.suppressedIssues.has(pattern.id)) continue;

      // Check custom checker
      if (pattern.check) {
        const customIssues = pattern.check(code);
        if (customIssues && customIssues.length > 0) {
          customIssues.forEach(issue => {
            this.detectedIssues.push({
              ...pattern,
              filePath,
              ...issue,
              detectedAt: Date.now()
            });
          });
        }
        continue;
      }

      // Check pattern match
      const matches = [...code.matchAll(pattern.pattern)];
      if (matches.length === 0) continue;

      // Check if negative pattern exists (mitigation present)
      if (pattern.negativePattern && pattern.negativePattern.test(code)) {
        continue;
      }

      // Check context pattern if specified
      if (pattern.contextPattern && !pattern.contextPattern.test(code)) {
        continue;
      }

      // Record each match
      matches.forEach((match, index) => {
        // Find line number
        const beforeMatch = code.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

        this.detectedIssues.push({
          id: pattern.id,
          instanceId: `${pattern.id}_${index}`,
          category: pattern.category,
          severity: pattern.severity,
          name: pattern.name,
          description: pattern.description,
          fix: pattern.fix,
          example: pattern.example,
          filePath,
          lineNumber,
          matchedCode: match[0].substring(0, 100),
          detectedAt: Date.now()
        });
      });
    }

    // Sort by severity
    this.detectedIssues.sort((a, b) => {
      const severityA = severityOrder.indexOf(a.severity);
      const severityB = severityOrder.indexOf(b.severity);
      return severityA - severityB;
    });

    this.notifyListeners();
    return this.getReport();
  }

  /**
   * Get analysis report
   */
  getReport() {
    const summary = {
      total: this.detectedIssues.length,
      bySeverity: {
        [SEVERITY.CRITICAL]: 0,
        [SEVERITY.HIGH]: 0,
        [SEVERITY.MEDIUM]: 0,
        [SEVERITY.LOW]: 0,
        [SEVERITY.INFO]: 0
      },
      byCategory: {}
    };

    for (const issue of this.detectedIssues) {
      summary.bySeverity[issue.severity]++;
      summary.byCategory[issue.category] = (summary.byCategory[issue.category] || 0) + 1;
    }

    return {
      issues: this.detectedIssues,
      summary,
      riskScore: this.calculateRiskScore(summary),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Calculate overall risk score (0-100)
   */
  calculateRiskScore(summary) {
    const weights = {
      [SEVERITY.CRITICAL]: 25,
      [SEVERITY.HIGH]: 15,
      [SEVERITY.MEDIUM]: 5,
      [SEVERITY.LOW]: 2,
      [SEVERITY.INFO]: 0
    };

    let totalRisk = 0;
    for (const [severity, count] of Object.entries(summary.bySeverity)) {
      totalRisk += count * weights[severity];
    }

    // Cap at 100
    return Math.min(100, totalRisk);
  }

  /**
   * Generate prioritized recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    const seen = new Set();

    for (const issue of this.detectedIssues) {
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);

      const count = this.detectedIssues.filter(i => i.id === issue.id).length;
      
      recommendations.push({
        id: issue.id,
        name: issue.name,
        severity: issue.severity,
        category: issue.category,
        count,
        fix: issue.fix,
        example: issue.example,
        impact: this.getImpactDescription(issue.severity, count)
      });
    }

    return recommendations;
  }

  /**
   * Get impact description
   */
  getImpactDescription(severity, count) {
    const base = {
      [SEVERITY.CRITICAL]: 'Could cause security breach or data loss',
      [SEVERITY.HIGH]: 'May cause application crashes or degraded UX',
      [SEVERITY.MEDIUM]: 'Could lead to bugs or performance issues',
      [SEVERITY.LOW]: 'May affect code quality or maintainability',
      [SEVERITY.INFO]: 'Informational finding'
    };

    const impact = base[severity];
    if (count > 1) {
      return `${impact} (${count} occurrences)`;
    }
    return impact;
  }

  /**
   * Suppress an issue type
   */
  suppressIssue(issueId) {
    this.suppressedIssues.add(issueId);
  }

  /**
   * Unsuppress an issue type
   */
  unsuppressIssue(issueId) {
    this.suppressedIssues.delete(issueId);
  }

  /**
   * Get suppressed issues
   */
  getSuppressed() {
    return Array.from(this.suppressedIssues);
  }

  /**
   * Get available patterns
   */
  getPatterns() {
    return this.patterns.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      severity: p.severity,
      description: p.description
    }));
  }

  /**
   * Add custom pattern
   */
  addPattern(pattern) {
    if (!pattern.id || !pattern.pattern || !pattern.name) {
      throw new Error('Pattern must have id, pattern, and name');
    }
    this.patterns.push({
      category: ISSUE_CATEGORIES.MAINTAINABILITY,
      severity: SEVERITY.MEDIUM,
      ...pattern
    });
  }

  /**
   * Clear detected issues
   */
  clear() {
    this.detectedIssues = [];
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
    const report = this.getReport();
    
    this.listeners.forEach(callback => {
      try {
        callback(report);
      } catch (error) {
        console.error('Predictive issue detector listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getPredictiveIssueDetector() {
  if (!instance) {
    instance = new PredictiveIssueDetector();
  }
  return instance;
}

export { ISSUE_CATEGORIES, SEVERITY, ISSUE_PATTERNS };
export default PredictiveIssueDetector;
