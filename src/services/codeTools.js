/**
 * Code Tools - Tool definitions for AI-powered code assistance
 * 
 * These tools allow the AI to interact with the codebase:
 * - Read files and understand code
 * - Search across the project
 * - Propose and apply changes
 * - Run verification commands
 */

// ============================================================================
// Core Tools - Basic file and search operations
// ============================================================================

export const CODE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. MUST be called before referencing any code from that file.',
      parameters: {
        type: 'object',
        properties: {
          path: { 
            type: 'string', 
            description: 'File path relative to project root' 
          },
          startLine: { 
            type: 'number', 
            description: 'Optional: start line number (1-indexed)' 
          },
          endLine: { 
            type: 'number', 
            description: 'Optional: end line number (1-indexed)' 
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for text or patterns across the codebase. Returns file paths, line numbers, and surrounding context.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { 
            type: 'string', 
            description: 'Search pattern (supports regex)' 
          },
          fileGlob: { 
            type: 'string', 
            description: 'Optional file pattern to filter, e.g. "*.js", "src/**/*.tsx"' 
          },
          maxResults: { 
            type: 'number', 
            description: 'Maximum number of results to return (default: 20)' 
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether search is case-sensitive (default: false)'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { 
            type: 'string', 
            description: 'Directory path relative to project root (empty string for root)' 
          },
          recursive: { 
            type: 'boolean', 
            description: 'Whether to include subdirectories (default: false)' 
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum depth for recursive listing (default: 3)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_edit',
      description: 'Propose a code change as a structured patch. Changes are NOT applied until user approves.',
      parameters: {
        type: 'object',
        properties: {
          path: { 
            type: 'string',
            description: 'File path relative to project root'
          },
          operation: { 
            type: 'string', 
            enum: ['create', 'update', 'delete', 'rename'],
            description: 'Type of operation'
          },
          startLine: { 
            type: 'number', 
            description: 'For updates: starting line number of the change (1-indexed)' 
          },
          endLine: { 
            type: 'number', 
            description: 'For updates: ending line number of the change (1-indexed)' 
          },
          oldContent: { 
            type: 'string', 
            description: 'For updates: the exact content being replaced (for verification)' 
          },
          newContent: { 
            type: 'string', 
            description: 'The new content to insert' 
          },
          newPath: {
            type: 'string',
            description: 'For rename: the new file path'
          },
          rationale: { 
            type: 'string', 
            description: 'Brief explanation of why this change is needed' 
          }
        },
        required: ['path', 'operation', 'rationale']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command from the allowlist (npm test, npm run lint, git status, etc.)',
      parameters: {
        type: 'object',
        properties: {
          command: { 
            type: 'string', 
            description: 'The command to run' 
          },
          cwd: { 
            type: 'string', 
            description: 'Working directory relative to project root (default: project root)' 
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)'
          }
        },
        required: ['command']
      }
    }
  }
];

// ============================================================================
// Verification Tools - For checking AI's own work
// ============================================================================

export const VERIFICATION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_lint',
      description: 'Run the linter on specific files or the entire project',
      parameters: {
        type: 'object',
        properties: {
          files: { 
            type: 'array', 
            items: { type: 'string' }, 
            description: 'Files to lint (empty array for all files)' 
          },
          fix: {
            type: 'boolean',
            description: 'Whether to auto-fix issues (default: false)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_tests',
      description: 'Run the test suite or specific test files',
      parameters: {
        type: 'object',
        properties: {
          testPattern: { 
            type: 'string', 
            description: 'Test file pattern or test name to run' 
          },
          coverage: {
            type: 'boolean',
            description: 'Whether to collect coverage (default: false)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_types',
      description: 'Run TypeScript type checker on specific files or the project',
      parameters: {
        type: 'object',
        properties: {
          files: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Files to check (empty array for all)'
          }
        }
      }
    }
  }
];

// ============================================================================
// AST Refactoring Tools - Safe structural changes
// ============================================================================

export const AST_REFACTOR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'rename_symbol',
      description: 'Safely rename a variable, function, class, or component across all files',
      parameters: {
        type: 'object',
        properties: {
          symbolName: { 
            type: 'string',
            description: 'Current name of the symbol'
          },
          newName: { 
            type: 'string',
            description: 'New name for the symbol'
          },
          filePath: {
            type: 'string',
            description: 'File where the symbol is defined (helps disambiguate)'
          },
          scope: { 
            type: 'string', 
            enum: ['file', 'project'], 
            description: 'Scope of rename: file-local or project-wide' 
          }
        },
        required: ['symbolName', 'newName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_function',
      description: 'Extract a code block into a new function',
      parameters: {
        type: 'object',
        properties: {
          filePath: { 
            type: 'string',
            description: 'File containing the code to extract'
          },
          startLine: { 
            type: 'number',
            description: 'Start line of code block (1-indexed)'
          },
          endLine: { 
            type: 'number',
            description: 'End line of code block (1-indexed)'
          },
          functionName: { 
            type: 'string',
            description: 'Name for the new function'
          },
          exportFunction: {
            type: 'boolean',
            description: 'Whether to export the new function (default: false)'
          }
        },
        required: ['filePath', 'startLine', 'endLine', 'functionName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_to_file',
      description: 'Move a function, class, or component to a different file, updating all imports',
      parameters: {
        type: 'object',
        properties: {
          symbolName: { 
            type: 'string',
            description: 'Name of the symbol to move'
          },
          fromPath: { 
            type: 'string',
            description: 'Current file path'
          },
          toPath: { 
            type: 'string',
            description: 'Destination file path (will be created if needed)'
          }
        },
        required: ['symbolName', 'fromPath', 'toPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_import',
      description: 'Add an import statement to a file',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'File to add import to'
          },
          importPath: {
            type: 'string',
            description: 'Module path to import from'
          },
          namedImports: {
            type: 'array',
            items: { type: 'string' },
            description: 'Named exports to import'
          },
          defaultImport: {
            type: 'string',
            description: 'Default import name (if any)'
          }
        },
        required: ['filePath', 'importPath']
      }
    }
  }
];

// ============================================================================
// Command Allowlist - For safety
// ============================================================================

export const ALLOWED_COMMANDS = [
  // npm/yarn commands
  /^npm (test|run (lint|build|typecheck|format|dev|start))(\s|$)/,
  /^npm install(\s|$)/,
  /^yarn (test|lint|build|typecheck|format|dev|start)(\s|$)/,
  /^pnpm (test|lint|build|typecheck|format|dev|start)(\s|$)/,
  
  // npx tools
  /^npx (eslint|prettier|tsc|jest|vitest|playwright)/,
  
  // git read-only commands
  /^git (status|diff|log|branch|show|blame)(\s|$)/,
  
  // file listing (read-only)
  /^ls(\s|$)/,
  /^dir(\s|$)/,
  /^tree(\s|$)/,
  
  // file reading (read-only)
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  
  // Search tools
  /^grep\s/,
  /^rg\s/,  // ripgrep
  /^find\s/,
  
  // Node/Python version checks
  /^node\s+--version$/,
  /^python\s+--version$/,
  /^python3\s+--version$/,
];

/**
 * Check if a command is allowed
 * @param {string} command - The command to check
 * @returns {boolean} - Whether the command is allowed
 */
export function isCommandAllowed(command) {
  const trimmed = command.trim();
  return ALLOWED_COMMANDS.some(pattern => pattern.test(trimmed));
}

// ============================================================================
// All Tools Combined
// ============================================================================

// Note: AST_REFACTOR_TOOLS are excluded from ALL_TOOLS because their backend
// handlers are not yet implemented. Including them would cause the LLM to
// attempt calls that always return "Unknown tool" errors.
export const ALL_TOOLS = [
  ...CODE_TOOLS,
  ...VERIFICATION_TOOLS,
];

// ============================================================================
// Tool Execution Helpers
// ============================================================================

/**
 * Get tool by name
 * @param {string} name - Tool name
 * @returns {object|null} - Tool definition or null
 */
export function getToolByName(name) {
  return ALL_TOOLS.find(t => t.function.name === name) || null;
}

/**
 * Get tool names for a category
 * @param {'core'|'verification'|'refactor'|'all'} category
 * @returns {string[]} - Array of tool names
 */
export function getToolNames(category = 'all') {
  switch (category) {
    case 'core':
      return CODE_TOOLS.map(t => t.function.name);
    case 'verification':
      return VERIFICATION_TOOLS.map(t => t.function.name);
    case 'refactor':
      return AST_REFACTOR_TOOLS.map(t => t.function.name);
    case 'all':
    default:
      return ALL_TOOLS.map(t => t.function.name);
  }
}

/**
 * Format tools for Ollama API
 * @param {string[]} toolNames - Names of tools to include (empty for all)
 * @returns {object[]} - Tools formatted for Ollama
 */
export function formatToolsForOllama(toolNames = []) {
  if (toolNames.length === 0) {
    return ALL_TOOLS;
  }
  return ALL_TOOLS.filter(t => toolNames.includes(t.function.name));
}

export default {
  CODE_TOOLS,
  VERIFICATION_TOOLS,
  AST_REFACTOR_TOOLS,
  ALL_TOOLS,
  ALLOWED_COMMANDS,
  isCommandAllowed,
  getToolByName,
  getToolNames,
  formatToolsForOllama,
};
