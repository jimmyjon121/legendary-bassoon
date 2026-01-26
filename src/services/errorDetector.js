/**
 * Error Detection Service
 * Parses terminal output, linter errors, and runtime errors to offer fixes
 */

// Common error patterns and their suggested fixes
const ERROR_PATTERNS = [
  // JavaScript/TypeScript errors
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    type: 'missing-module',
    extract: (match) => ({ module: match[1] }),
    message: (data) => `Module "${data.module}" not found`,
    fixes: (data) => [
      { label: `Install ${data.module}`, command: `npm install ${data.module}` },
      { label: `Install as dev dependency`, command: `npm install -D ${data.module}` },
    ],
  },
  {
    pattern: /SyntaxError: Unexpected token/,
    type: 'syntax-error',
    message: () => 'Syntax error in code',
    fixes: () => [
      { label: 'Ask agent to fix', action: 'agent-fix' },
    ],
  },
  {
    pattern: /ReferenceError: (\w+) is not defined/,
    type: 'undefined-reference',
    extract: (match) => ({ variable: match[1] }),
    message: (data) => `"${data.variable}" is not defined`,
    fixes: (data) => [
      { label: `Import ${data.variable}`, action: 'agent-import', data },
      { label: 'Ask agent to fix', action: 'agent-fix' },
    ],
  },
  {
    pattern: /TypeError: Cannot read propert(?:y|ies) of (undefined|null)/,
    type: 'null-access',
    message: () => 'Accessing property of null/undefined',
    fixes: () => [
      { label: 'Add null check', action: 'agent-nullcheck' },
      { label: 'Ask agent to fix', action: 'agent-fix' },
    ],
  },
  
  // React errors
  {
    pattern: /Invalid hook call/,
    type: 'invalid-hook',
    message: () => 'Invalid React hook call',
    fixes: () => [
      { label: 'Check hook rules', action: 'show-docs', url: 'https://reactjs.org/docs/hooks-rules.html' },
      { label: 'Ask agent to fix', action: 'agent-fix' },
    ],
  },
  {
    pattern: /Each child in a list should have a unique "key" prop/,
    type: 'missing-key',
    message: () => 'Missing key prop in list',
    fixes: () => [
      { label: 'Add key prop', action: 'agent-addkey' },
    ],
  },
  
  // Build errors
  {
    pattern: /ENOENT: no such file or directory.*['"]([^'"]+)['"]/,
    type: 'file-not-found',
    extract: (match) => ({ file: match[1] }),
    message: (data) => `File not found: ${data.file}`,
    fixes: (data) => [
      { label: 'Create file', action: 'create-file', data },
      { label: 'Check import path', action: 'agent-checkpath' },
    ],
  },
  {
    pattern: /EADDRINUSE.*port (\d+)/i,
    type: 'port-in-use',
    extract: (match) => ({ port: match[1] }),
    message: (data) => `Port ${data.port} is already in use`,
    fixes: (data) => [
      { label: `Kill process on port ${data.port}`, command: process.platform === 'win32' 
        ? `netstat -ano | findstr :${data.port}` 
        : `lsof -i :${data.port}` },
      { label: 'Use different port', action: 'change-port' },
    ],
  },
  
  // npm errors
  {
    pattern: /npm ERR! peer dep missing: ([^,]+)/,
    type: 'peer-dep-missing',
    extract: (match) => ({ dep: match[1] }),
    message: (data) => `Missing peer dependency: ${data.dep}`,
    fixes: (data) => [
      { label: `Install ${data.dep}`, command: `npm install ${data.dep}` },
    ],
  },
  {
    pattern: /npm ERR! code ERESOLVE/,
    type: 'dependency-conflict',
    message: () => 'Dependency resolution conflict',
    fixes: () => [
      { label: 'Force install', command: 'npm install --force' },
      { label: 'Use legacy peer deps', command: 'npm install --legacy-peer-deps' },
    ],
  },
  
  // TypeScript errors
  {
    pattern: /TS(\d+): (.+)/,
    type: 'typescript-error',
    extract: (match) => ({ code: match[1], message: match[2] }),
    message: (data) => `TypeScript error TS${data.code}: ${data.message}`,
    fixes: () => [
      { label: 'Ask agent to fix', action: 'agent-fix' },
    ],
  },
  
  // ESLint errors
  {
    pattern: /eslint.*error.*['"]([^'"]+)['"]/i,
    type: 'eslint-error',
    extract: (match) => ({ rule: match[1] }),
    message: (data) => `ESLint error: ${data.rule}`,
    fixes: (data) => [
      { label: 'Auto-fix', command: 'npm run lint -- --fix' },
      { label: `Disable rule`, action: 'disable-eslint-rule', data },
    ],
  },
];

/**
 * Parse output text and detect errors
 * @param {string} output - Terminal or console output
 * @returns {Array} Array of detected errors with suggested fixes
 */
export function detectErrors(output) {
  if (!output) return [];
  
  const errors = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern.pattern);
      if (match) {
        const data = pattern.extract ? pattern.extract(match) : {};
        errors.push({
          type: pattern.type,
          line,
          message: pattern.message(data),
          fixes: pattern.fixes(data),
          data,
        });
        break; // Only match first pattern per line
      }
    }
  }
  
  return errors;
}

/**
 * Get a quick summary of errors
 */
export function summarizeErrors(errors) {
  const byType = {};
  for (const error of errors) {
    byType[error.type] = (byType[error.type] || 0) + 1;
  }
  return byType;
}

/**
 * Get the most actionable error (one we can auto-fix)
 */
export function getMostActionableError(errors) {
  // Prioritize errors with command fixes
  const withCommands = errors.filter(e => e.fixes.some(f => f.command));
  if (withCommands.length > 0) return withCommands[0];
  
  // Then errors with agent fixes
  const withAgentFix = errors.filter(e => e.fixes.some(f => f.action === 'agent-fix'));
  if (withAgentFix.length > 0) return withAgentFix[0];
  
  return errors[0];
}

/**
 * Watch terminal output for errors in real-time
 */
export class ErrorWatcher {
  constructor(onError) {
    this.onError = onError;
    this.buffer = '';
    this.debounceTimer = null;
  }
  
  append(text) {
    this.buffer += text;
    
    // Debounce error detection
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const errors = detectErrors(this.buffer);
      if (errors.length > 0) {
        this.onError(errors);
      }
      // Keep last 5000 chars to catch multi-line errors
      this.buffer = this.buffer.slice(-5000);
    }, 500);
  }
  
  clear() {
    this.buffer = '';
  }
}

export default {
  detectErrors,
  summarizeErrors,
  getMostActionableError,
  ErrorWatcher,
};













