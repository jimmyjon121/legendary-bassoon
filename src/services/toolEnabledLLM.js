/**
 * Tool-Enabled LLM Service
 * 
 * Handles the tool calling loop with Ollama:
 * 1. Send message with tool definitions
 * 2. If AI returns tool calls, execute them
 * 3. Add results to context and continue
 * 4. Repeat until AI returns final response
 */

import { CODE_TOOLS, VERIFICATION_TOOLS, isCommandAllowed } from './codeTools';
import { safeCall } from '../utils/electronAPI';

// ============================================================================
// Constants
// ============================================================================

const MAX_TOOL_ITERATIONS = 15;
const DEFAULT_TIMEOUT = 30000;

// ============================================================================
// Tool Executor
// ============================================================================

/**
 * Execute a single tool call
 * @param {object} toolCall - The tool call from the AI
 * @param {string} projectRoot - Project root path
 * @returns {object} - Tool execution result
 */
async function executeTool(toolCall, projectRoot) {
  const { name, arguments: args } = toolCall.function;
  
  try {
    switch (name) {
      case 'read_file': {
        const result = await safeCall('toolReadFile', [
          projectRoot, args.path, args.startLine, args.endLine
        ], { error: 'Tool not available' });
        if (result.error) throw new Error(result.error);
        return {
          success: true,
          type: 'file_read',
          path: args.path,
          content: result.content,
          totalLines: result.totalLines,
          truncated: result.truncated
        };
      }
      
      case 'search_code': {
        const result = await safeCall('toolSearchCode', [
          projectRoot, args.pattern, args.fileGlob, args.maxResults || 20, args.caseSensitive || false
        ], { error: 'Tool not available' });
        if (result.error) throw new Error(result.error);
        return {
          success: true,
          type: 'search',
          pattern: args.pattern,
          results: result.results,
          totalMatches: result.totalMatches,
          truncated: result.truncated
        };
      }
      
      case 'list_directory': {
        const result = await safeCall('toolListDirectory', [
          projectRoot, args.path || '', args.recursive || false, args.maxDepth || 3
        ], { error: 'Tool not available' });
        if (result.error) throw new Error(result.error);
        return {
          success: true,
          type: 'directory_list',
          path: args.path || '.',
          entries: result.entries,
          count: result.count
        };
      }
      
      case 'propose_edit': {
        return {
          success: true,
          type: 'proposed_edit',
          patch: {
            path: args.path,
            operation: args.operation,
            startLine: args.startLine,
            endLine: args.endLine,
            oldContent: args.oldContent,
            newContent: args.newContent,
            newPath: args.newPath,
            rationale: args.rationale
          }
        };
      }
      
      case 'run_command': {
        const result = await safeCall('toolRunCommand', [
          projectRoot, args.command, args.cwd, args.timeout || DEFAULT_TIMEOUT
        ], { success: false, error: 'Tool not available' });
        return {
          success: result.success,
          type: 'command',
          command: args.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          error: result.error
        };
      }
      
      case 'run_lint': {
        const files = args.files?.length > 0 ? args.files.join(' ') : '.';
        const result = await safeCall('toolRunCommand', [
          projectRoot, `npm run lint ${files}`, null, 60000
        ], { success: false, error: 'Tool not available' });
        return {
          success: result.success,
          type: 'lint',
          files: args.files || ['all'],
          output: result.stdout,
          errors: result.stderr,
          exitCode: result.exitCode
        };
      }
      
      case 'run_tests': {
        const pattern = args.testPattern ? `-- ${args.testPattern}` : '';
        const result = await safeCall('toolRunCommand', [
          projectRoot, `npm test ${pattern}`, null, 120000
        ], { success: false, error: 'Tool not available' });
        return {
          success: result.success,
          type: 'test',
          pattern: args.testPattern,
          output: result.stdout,
          errors: result.stderr,
          exitCode: result.exitCode
        };
      }
      
      case 'check_types': {
        const files = args.files?.length > 0 ? args.files.join(' ') : '';
        const result = await safeCall('toolRunCommand', [
          projectRoot, `npx tsc --noEmit ${files}`, null, 60000
        ], { success: false, error: 'Tool not available' });
        return {
          success: result.exitCode === 0,
          type: 'typecheck',
          files: args.files || ['all'],
          output: result.stdout,
          errors: result.stderr,
          exitCode: result.exitCode
        };
      }
      
      default:
        return {
          success: false,
          type: 'unknown',
          error: `Unknown tool: ${name}`
        };
    }
  } catch (error) {
    return {
      success: false,
      type: name,
      error: error.message
    };
  }
}

// ============================================================================
// Tool-Enabled LLM Class
// ============================================================================

export class ToolEnabledLLM {
  constructor(options = {}) {
    this.model = options.model;
    this.projectRoot = options.projectRoot;
    this.tools = options.tools || [...CODE_TOOLS, ...VERIFICATION_TOOLS];
    this.maxIterations = options.maxIterations || MAX_TOOL_ITERATIONS;
    
    // Callbacks
    this.onToolCall = options.onToolCall || (() => {});
    this.onToolResult = options.onToolResult || (() => {});
    this.onChunk = options.onChunk || (() => {});
    this.onThinking = options.onThinking || (() => {});
    
    // Tracking
    this.filesRead = new Set();
    this.toolCalls = [];
    this.proposedChanges = [];
    this.iteration = 0;
  }

  /**
   * Format tools for Ollama API
   */
  getFormattedTools() {
    return this.tools.map(tool => ({
      type: tool.type,
      function: tool.function
    }));
  }

  /**
   * Build the system prompt with tool instructions
   */
  buildSystemPrompt(basePrompt = '') {
    return `${basePrompt}

You are an AI coding assistant with access to tools that let you explore and modify the codebase.

## Tool Usage Guidelines

1. **Always read before writing**: Use read_file to examine code before proposing changes.
2. **Search first**: Use search_code to find relevant code across the project.
3. **Verify changes**: After proposing edits, use run_lint or check_types to verify.
4. **Explain rationale**: Always include clear reasoning when proposing edits.
5. **Be precise**: When editing, specify exact line ranges to minimize unintended changes.

## Available Tools

- **read_file**: Read file contents (required before referencing code)
- **search_code**: Search for patterns across the codebase
- **list_directory**: Explore project structure
- **propose_edit**: Propose a code change (will be reviewed by user)
- **run_command**: Execute allowed shell commands
- **run_lint**: Run linter on files
- **run_tests**: Run test suite
- **check_types**: Run TypeScript type checker

## Important

- Only reference code you have actually read
- Proposed edits require user approval before being applied
- Be thorough but efficient - don't read unnecessary files`;
  }

  /**
   * Parse tool calls from Ollama response
   */
  parseToolCalls(response) {
    // Ollama returns tool_calls in the message
    if (response.message?.tool_calls) {
      return response.message.tool_calls.map((tc, idx) => ({
        id: `call_${Date.now()}_${idx}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' 
            ? JSON.parse(tc.function.arguments) 
            : tc.function.arguments
        }
      }));
    }
    return [];
  }

  /**
   * Call Ollama with tools
   */
  async callOllama(messages, systemPrompt) {
    const endpoint = await safeCall('getSettings', ['llmEndpoint'], 'http://localhost:11434') || 'http://localhost:11434';
    
    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      tools: this.getFormattedTools(),
      stream: false
    };

    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Failed to call Ollama: ${error.message}`);
    }
  }

  /**
   * Main chat method with tool loop
   */
  async chat(userMessage, conversationHistory = []) {
    this.iteration = 0;
    this.filesRead.clear();
    this.toolCalls = [];
    this.proposedChanges = [];

    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const systemPrompt = this.buildSystemPrompt();

    while (this.iteration < this.maxIterations) {
      this.iteration++;
      this.onThinking(`Iteration ${this.iteration}...`);

      const response = await this.callOllama(messages, systemPrompt);
      const toolCalls = this.parseToolCalls(response);

      // If no tool calls, we have the final response
      if (toolCalls.length === 0) {
        return {
          content: response.message?.content || '',
          filesRead: Array.from(this.filesRead),
          toolCalls: this.toolCalls,
          proposedChanges: this.proposedChanges,
          iterations: this.iteration
        };
      }

      // Execute each tool call
      for (const toolCall of toolCalls) {
        this.onToolCall(toolCall);
        
        const result = await executeTool(toolCall, this.projectRoot);
        
        this.toolCalls.push({
          ...toolCall,
          result,
          timestamp: Date.now()
        });

        // Track files read for provenance
        if (result.type === 'file_read' && result.success) {
          this.filesRead.add(result.path);
        }

        // Track proposed changes
        if (result.type === 'proposed_edit' && result.success) {
          this.proposedChanges.push({
            id: `patch_${Date.now()}`,
            ...result.patch,
            status: 'pending'
          });
        }

        this.onToolResult(toolCall, result);

        // Add tool result to messages
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [toolCall]
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Add partial response if any
      if (response.message?.content) {
        messages.push({
          role: 'assistant',
          content: response.message.content
        });
      }
    }

    throw new Error(`Max tool iterations (${this.maxIterations}) reached`);
  }

  /**
   * Stream chat with tools (for real-time UI updates)
   */
  async streamChat(userMessage, conversationHistory = [], onStream) {
    // For now, use non-streaming with callbacks
    // Full streaming with tools requires more complex handling
    const result = await this.chat(userMessage, conversationHistory);
    onStream?.({ type: 'done', ...result });
    return result;
  }

  /**
   * Apply a proposed change
   */
  async applyChange(patchId) {
    const patch = this.proposedChanges.find(p => p.id === patchId);
    if (!patch) {
      throw new Error(`Patch not found: ${patchId}`);
    }

    const result = await safeCall('toolApplyPatch', [this.projectRoot, patch], { error: 'Tool not available' });
    
    if (result.error) {
      throw new Error(result.error);
    }

    patch.status = 'applied';
    patch.appliedAt = Date.now();
    
    return result;
  }

  /**
   * Reject a proposed change
   */
  rejectChange(patchId) {
    const patch = this.proposedChanges.find(p => p.id === patchId);
    if (patch) {
      patch.status = 'rejected';
      patch.rejectedAt = Date.now();
    }
    return patch;
  }

  /**
   * Get session summary
   */
  getSessionSummary() {
    return {
      model: this.model,
      projectRoot: this.projectRoot,
      iterations: this.iteration,
      filesRead: Array.from(this.filesRead),
      toolCallCount: this.toolCalls.length,
      toolCalls: this.toolCalls.map(tc => ({
        name: tc.function.name,
        success: tc.result?.success,
        timestamp: tc.timestamp
      })),
      proposedChanges: this.proposedChanges.map(p => ({
        id: p.id,
        path: p.path,
        operation: p.operation,
        status: p.status
      }))
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ToolEnabledLLM instance
 */
export function createToolEnabledLLM(options) {
  return new ToolEnabledLLM(options);
}

// ============================================================================
// Singleton for convenience
// ============================================================================

let defaultInstance = null;

export function getToolEnabledLLM(options) {
  if (!defaultInstance || options) {
    defaultInstance = new ToolEnabledLLM(options);
  }
  return defaultInstance;
}

export default {
  ToolEnabledLLM,
  createToolEnabledLLM,
  getToolEnabledLLM,
  executeTool
};
