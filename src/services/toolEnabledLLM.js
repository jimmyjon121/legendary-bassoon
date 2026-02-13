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
const DEFAULT_OLLAMA_TIMEOUT = 300000;

function normalizePatchOperation(operation, hasNewPath = false) {
  const raw = String(operation || '').trim().toLowerCase();
  if (!raw) return hasNewPath ? 'rename' : 'update';

  if (['create', 'new', 'mk', 'touch', 'create_file'].includes(raw)) return 'create';
  if (['update', 'edit', 'modify', 'change', 'replace', 'patch', 'overwrite', 'update_file'].includes(raw)) return 'update';
  if (['delete', 'remove', 'rm', 'del', 'delete_file'].includes(raw)) return 'delete';
  if (['rename', 'move', 'mv', 'rename_file', 'move_file'].includes(raw)) return 'rename';
  if (['add', 'insert', 'append'].includes(raw)) return 'add';

  return hasNewPath ? 'rename' : 'update';
}

function normalizeProposeEditArgs(rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};

  const path =
    args.path ||
    args.file_path ||
    args.filePath ||
    args.targetPath ||
    args.file ||
    '';

  const nestedChanges = args.changes && typeof args.changes === 'object' && !Array.isArray(args.changes)
    ? args.changes
    : {};

  const changesText = Array.isArray(args.changes)
    ? JSON.stringify(args.changes)
    : typeof args.changes === 'string'
      ? args.changes
      : '';

  const renamedFromText =
    changesText.match(/renamed_to\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
    changesText.match(/new_path\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
    changesText.match(/newPath\s*[:=]\s*["']([^"']+)["']/i)?.[1] ||
    null;

  const newPath =
    args.newPath ||
    args.new_path ||
    args.renamed_to ||
    args.rename_to ||
    nestedChanges.newPath ||
    nestedChanges.new_path ||
    nestedChanges.renamed_to ||
    renamedFromText ||
    null;

  const newContent =
    args.newContent ??
    args.new_content ??
    args.content ??
    nestedChanges.newContent ??
    nestedChanges.new_content ??
    nestedChanges.content;

  const oldContent =
    args.oldContent ??
    args.old_content ??
    args.before ??
    nestedChanges.oldContent ??
    nestedChanges.old_content ??
    nestedChanges.before;

  const startLine =
    args.startLine ??
    args.start_line ??
    nestedChanges.startLine ??
    nestedChanges.start_line;

  const endLine =
    args.endLine ??
    args.end_line ??
    nestedChanges.endLine ??
    nestedChanges.end_line;

  const inferredOperation = normalizePatchOperation(
    args.operation || nestedChanges.operation,
    Boolean(newPath)
  );

  const operation = inferredOperation ||
    (newPath ? 'rename' : (newContent !== undefined ? 'update' : 'update'));

  return {
    path,
    operation,
    startLine,
    endLine,
    oldContent,
    newContent,
    newPath,
    rationale: args.rationale || args.reason || nestedChanges.rationale || 'Proposed by model',
  };
}

function unwrapToolResponse(result, fallbackError = 'Tool not available') {
  if (!result) {
    return { ok: false, error: fallbackError };
  }
  if (result.ok === false || result.success === false) {
    return {
      ok: false,
      error: result.error || fallbackError,
      details: result.details || null,
      code: result.code || null,
    };
  }
  if (result.ok === true && result.data && typeof result.data === 'object') {
    return { ok: true, ...result.data };
  }
  return { ok: true, ...result };
}

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
        const raw = await safeCall('toolReadFile', [
          projectRoot, args.path, args.startLine, args.endLine
        ], { error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        if (!result.ok) throw new Error(result.error);
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
        const raw = await safeCall('toolSearchCode', [
          projectRoot, args.pattern, args.fileGlob, args.maxResults || 20, args.caseSensitive || false
        ], { error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        if (!result.ok) throw new Error(result.error);
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
        const raw = await safeCall('toolListDirectory', [
          projectRoot, args.path || '', args.recursive || false, args.maxDepth || 3
        ], { error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        if (!result.ok) throw new Error(result.error);
        return {
          success: true,
          type: 'directory_list',
          path: args.path || '.',
          entries: result.entries,
          count: result.count
        };
      }
      
      case 'propose_edit': {
        const normalized = normalizeProposeEditArgs(args);
        return {
          success: true,
          type: 'proposed_edit',
          patch: {
            path: normalized.path,
            operation: normalized.operation,
            startLine: normalized.startLine,
            endLine: normalized.endLine,
            oldContent: normalized.oldContent,
            newContent: normalized.newContent,
            newPath: normalized.newPath,
            rationale: normalized.rationale
          }
        };
      }
      
      case 'run_command': {
        const raw = await safeCall('toolRunCommand', [
          projectRoot, args.command, args.cwd, args.timeout || DEFAULT_TIMEOUT
        ], { success: false, error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        const details = raw?.details || raw;
        return {
          success: result.ok,
          type: 'command',
          command: args.command,
          stdout: result.stdout || details?.stdout,
          stderr: result.stderr || details?.stderr,
          exitCode: result.exitCode ?? details?.exitCode,
          error: result.error
        };
      }
      
      case 'run_lint': {
        const files = args.files?.length > 0 ? args.files.join(' ') : '.';
        const raw = await safeCall('toolRunCommand', [
          projectRoot, `npm run lint ${files}`, null, 60000
        ], { success: false, error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        const details = raw?.details || raw;
        return {
          success: result.ok,
          type: 'lint',
          files: args.files || ['all'],
          output: result.stdout || details?.stdout,
          errors: result.stderr || details?.stderr || result.error,
          exitCode: result.exitCode ?? details?.exitCode
        };
      }
      
      case 'run_tests': {
        const pattern = args.testPattern ? `-- ${args.testPattern}` : '';
        const raw = await safeCall('toolRunCommand', [
          projectRoot, `npm test ${pattern}`, null, 120000
        ], { success: false, error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        const details = raw?.details || raw;
        return {
          success: result.ok,
          type: 'test',
          pattern: args.testPattern,
          output: result.stdout || details?.stdout,
          errors: result.stderr || details?.stderr || result.error,
          exitCode: result.exitCode ?? details?.exitCode
        };
      }
      
      case 'check_types': {
        const files = args.files?.length > 0 ? args.files.join(' ') : '';
        const raw = await safeCall('toolRunCommand', [
          projectRoot, `npx tsc --noEmit ${files}`, null, 60000
        ], { success: false, error: 'Tool not available' });
        const result = unwrapToolResponse(raw);
        const details = raw?.details || raw;
        return {
          success: (result.exitCode ?? details?.exitCode ?? 1) === 0,
          type: 'typecheck',
          files: args.files || ['all'],
          output: result.stdout || details?.stdout,
          errors: result.stderr || details?.stderr || result.error,
          exitCode: result.exitCode ?? details?.exitCode
        };
      }

      case 'web_search': {
        const result = await safeCall(
          'webSearch',
          [args.query, { maxResults: args.maxResults || 5 }],
          { results: [], query: args.query, error: 'Tool not available' }
        );
        if (result?.error) throw new Error(result.error);

        const normalized = Array.isArray(result?.results)
          ? result.results.slice(0, args.maxResults || 5).map((entry) => ({
              title: entry?.title || '',
              url: entry?.url || entry?.link || '',
              snippet: entry?.snippet || entry?.description || '',
            }))
          : [];

        return {
          success: true,
          type: 'web_search',
          query: args.query,
          results: normalized,
          count: normalized.length,
          tookMs: result?.took || null
        };
      }

      case 'web_fetch_page': {
        const result = await safeCall(
          'webFetchPage',
          [args.url, { maxChars: args.maxChars || 5000 }],
          { content: '', title: '', url: args.url, error: 'Tool not available' }
        );
        if (result?.error) throw new Error(result.error);
        return {
          success: true,
          type: 'web_page',
          url: result?.url || args.url,
          title: result?.title || '',
          content: (result?.content || '').slice(0, args.maxChars || 5000)
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
    this.defaultTextToolMode = Boolean(options.defaultTextToolMode);
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
6. **Research when needed**: If task references an existing product/framework (e.g. "like LM Studio"), use web_search first.

## Available Tools

- **read_file**: Read file contents (required before referencing code)
- **search_code**: Search for patterns across the codebase
- **list_directory**: Explore project structure
- **propose_edit**: Propose a code change (will be reviewed by user)
- **run_command**: Execute allowed shell commands
- **run_lint**: Run linter on files
- **run_tests**: Run test suite
- **check_types**: Run TypeScript type checker
- **web_search**: Research external product/technical references
- **web_fetch_page**: Pull content from a specific source URL

## Important

- Only reference code you have actually read
- Proposed edits require user approval before being applied
- Be thorough but efficient - don't read unnecessary files`;
  }

  /**
   * Parse tool calls from Ollama response.
   * First checks native tool_calls, then falls back to parsing JSON from text.
   */
  parseToolCalls(response) {
    // 1. Native tool_calls (models that support function calling)
    if (Array.isArray(response.message?.tool_calls) && response.message.tool_calls.length > 0) {
      return response.message.tool_calls.map((tc, idx) => {
        const rawArgs = tc?.function?.arguments;
        let parsedArgs = rawArgs;
        if (typeof rawArgs === 'string') {
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            parsedArgs = {};
          }
        }

        return {
          id: `call_${Date.now()}_${idx}`,
          type: 'function',
          function: {
            name: tc?.function?.name,
            arguments: parsedArgs || {}
          }
        };
      });
    }

    // 2. Text-based fallback: parse tool calls from model's text output
    const content = response.message?.content || '';
    if (content) {
      const textCalls = this.parseToolCallsFromText(content);
      if (textCalls.length > 0) return textCalls;
    }

    return [];
  }

  /**
   * Parse tool calls from plain text output.
   * Models that don't support native function calling often output JSON blocks
   * like: ```json\n{"tool": "read_file", "arguments": {"path": "..."}}\n```
   * Or structured text like: TOOL_CALL: read_file({"path": "..."})
   */
  parseToolCallsFromText(text) {
    const calls = [];
    const toolNames = new Set(this.tools.map(t => t.function.name));

    // Strategy 1: JSON code blocks containing tool calls
    const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
    let match;
    while ((match = jsonBlockRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const extracted = this._extractToolFromJSON(parsed, toolNames);
        if (extracted) calls.push(extracted);
      } catch { /* not valid JSON, skip */ }
    }
    if (calls.length > 0) return calls;

    // Strategy 2.5: propose_edit { ... } pseudo blocks (non-JSON but recoverable)
    const pseudoProposeRegex = /propose_edit\s*\{([\s\S]{0,2500}?)\}/gi;
    while ((match = pseudoProposeRegex.exec(text)) !== null) {
      const block = match[1] || '';
      const path =
        block.match(/"(?:path|file_path|filePath)"\s*:\s*"([^"]+)"/i)?.[1] ||
        block.match(/(?:path|file_path|filePath)\s*:\s*['"]([^'"]+)['"]/i)?.[1] ||
        '';
      const renamedTo =
        block.match(/"(?:renamed_to|new_path|newPath)"\s*:\s*"([^"]+)"/i)?.[1] ||
        block.match(/(?:renamed_to|new_path|newPath)\s*:\s*['"]([^'"]+)['"]/i)?.[1] ||
        null;
      const newContent =
        block.match(/"(?:newContent|new_content|content)"\s*:\s*"([\s\S]*?)"\s*(?:,|$)/i)?.[1] ||
        null;
      if (!path) continue;
      calls.push({
        id: `call_${Date.now()}_${calls.length}`,
        type: 'function',
        function: {
          name: 'propose_edit',
          arguments: {
            path,
            operation: renamedTo ? 'rename' : (newContent ? 'update' : 'update'),
            newPath: renamedTo,
            newContent: newContent || undefined,
            rationale: 'Recovered from pseudo propose_edit block'
          }
        }
      });
    }
    if (calls.length > 0) return calls;

    // Strategy 2: Inline JSON objects { "tool": "...", "arguments": {...} }
    const inlineJsonRegex = /\{[^{}]*"(?:tool|name|function)"[^{}]*"(?:arguments|parameters|params)"[^{}]*\{[^}]*\}[^}]*\}/gi;
    while ((match = inlineJsonRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        const extracted = this._extractToolFromJSON(parsed, toolNames);
        if (extracted) calls.push(extracted);
      } catch { /* skip */ }
    }
    if (calls.length > 0) return calls;

    // Strategy 3: Function-call style: tool_name({"key": "value"})
    const funcCallRegex = /\b([a-z_]+)\s*\(\s*(\{[\s\S]*?\})\s*\)/gi;
    while ((match = funcCallRegex.exec(text)) !== null) {
      const name = match[1];
      if (!toolNames.has(name)) continue;
      try {
        const args = JSON.parse(match[2]);
        calls.push({
          id: `call_${Date.now()}_${calls.length}`,
          type: 'function',
          function: { name, arguments: args }
        });
      } catch { /* skip */ }
    }

    return calls;
  }

  /**
   * Extract a tool call from a parsed JSON object, handling multiple formats.
   */
  _extractToolFromJSON(obj, toolNames) {
    if (!obj || typeof obj !== 'object') return null;
    const name = obj.tool || obj.name || obj.function?.name || obj.function;
    const args = obj.arguments || obj.parameters || obj.params || obj.function?.arguments || {};
    
    if (typeof name === 'string' && toolNames.has(name)) {
      let parsedArgs = args;
      if (typeof args === 'string') {
        try {
          parsedArgs = JSON.parse(args);
        } catch {
          parsedArgs = {};
        }
      }
      return {
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'function',
        function: { name, arguments: parsedArgs || {} }
      };
    }
    return null;
  }

  /**
   * Build a text-based tool description for models without native tool support.
   * This goes into the system prompt so the model knows how to "call" tools via JSON.
   */
  buildTextToolInstructions() {
    const toolDescriptions = this.tools.map(t => {
      const fn = t.function;
      const params = fn.parameters?.properties || {};
      const required = fn.parameters?.required || [];
      const paramList = Object.entries(params).map(([k, v]) => {
        const req = required.includes(k) ? ' (required)' : '';
        return `    - ${k}: ${v.type}${req} — ${v.description || ''}`;
      }).join('\n');
      return `  ${fn.name}: ${fn.description}\n${paramList}`;
    }).join('\n\n');

    return `
## How to Use Tools

To use a tool, output a JSON code block with this EXACT format:

\`\`\`json
{"tool": "tool_name", "arguments": {"param1": "value1"}}
\`\`\`

After each tool result is returned to you, continue working.
When you are done and have a final answer, respond in plain text WITHOUT any tool JSON.

## Available Tools

${toolDescriptions}
`;
  }

  /**
   * Call Ollama with tools.
   * First attempts native tool calling. If the model doesn't support it,
   * falls back to text-based tool instructions in the system prompt.
   */
  async callOllama(messages, systemPrompt) {
    const endpoint = await safeCall('getSettings', ['llmEndpoint'], 'http://127.0.0.1:11434') || 'http://127.0.0.1:11434';

    // Determine whether to use native tools or text-based fallback
    const useNativeTools = !this._textToolMode;
    
    let effectiveSystemPrompt = systemPrompt;
    if (!useNativeTools) {
      effectiveSystemPrompt = systemPrompt + '\n' + this.buildTextToolInstructions();
    }

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: effectiveSystemPrompt },
        ...messages
      ],
      stream: false,
      lane: 'lane_agent',
      workloadType: 'agent',
      allowFallback: true,
      priority: 8,
    };

    // Only include tools array if using native mode
    if (useNativeTools) {
      payload.tools = this.getFormattedTools();
    }

    try {
      // Prefer Electron IPC so all inference goes through the orchestrator.
      if (typeof window !== 'undefined' && window.electronAPI?.sendToLLM) {
        const result = await window.electronAPI.sendToLLM(payload);
        if (!result) {
          throw new Error('Empty response from llm:send');
        }
        if (result?.error) {
          const details = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
          if (useNativeTools && /support tools|unsupported|tool/i.test(details)) {
            console.warn('[ToolEnabledLLM] Native tools rejected, switching to text-based mode');
            this._textToolMode = true;
            return this.callOllama(messages, systemPrompt);
          }
          throw new Error(`Ollama error: ${details}`);
        }

        if (useNativeTools && !result.message?.tool_calls?.length && !result.message?.content?.trim()) {
          console.warn('[ToolEnabledLLM] Native tools returned empty, switching to text-based mode');
          this._textToolMode = true;
          return this.callOllama(messages, systemPrompt);
        }

        return result;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_OLLAMA_TIMEOUT);
      try {
        const response = await fetch(`${endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          let details = '';
          try {
            const parsed = await response.json();
            if (parsed?.error) {
              details = parsed.error;
            } else {
              details = JSON.stringify(parsed);
            }
          } catch (_parseErr) {
            try {
              details = await response.text();
            } catch (_textErr) {
              details = '';
            }
          }

          // If native tools caused the error, retry in text mode
          if (useNativeTools && (
            details.includes('does not support tools') ||
            details.includes('unsupported') ||
            details.includes('tool')
          )) {
            console.warn('[ToolEnabledLLM] Native tools rejected, switching to text-based mode');
            this._textToolMode = true;
            clearTimeout(timeout);
            return this.callOllama(messages, systemPrompt);
          }

          const suffix = details ? ` - ${details}` : '';
          throw new Error(`Ollama error: ${response.status} ${response.statusText}${suffix}`);
        }

        const result = await response.json();

        // If native tools returned no tool_calls AND no content, try text mode
        if (useNativeTools && !result.message?.tool_calls?.length && !result.message?.content?.trim()) {
          console.warn('[ToolEnabledLLM] Native tools returned empty, switching to text-based mode');
          this._textToolMode = true;
          clearTimeout(timeout);
          return this.callOllama(messages, systemPrompt);
        }

        return result;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${Math.round(DEFAULT_OLLAMA_TIMEOUT / 1000)}s`);
      }
      throw new Error(`Failed to call Ollama: ${error.message}`);
    }
  }

  /**
   * Main chat method with tool loop.
   * Works with both native tool-calling models and text-based fallback.
   */
  async chat(userMessage, conversationHistory = []) {
    this.iteration = 0;
    this.filesRead.clear();
    this.toolCalls = [];
    this.proposedChanges = [];
    this._textToolMode = this.defaultTextToolMode; // Start native unless caller forces text mode

    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const systemPrompt = this.buildSystemPrompt();

    while (this.iteration < this.maxIterations) {
      this.iteration++;
      this.onThinking(`Iteration ${this.iteration}/${this.maxIterations}${this._textToolMode ? ' (text mode)' : ''}...`);

      const response = await this.callOllama(messages, systemPrompt);
      const toolCalls = this.parseToolCalls(response);
      const assistantText = response.message?.content || '';

      if (this._textToolMode && assistantText.trim()) {
        messages.push({
          role: 'assistant',
          content: assistantText
        });
      }

      // If no tool calls, we have the final response
      if (toolCalls.length === 0) {
        return {
          content: assistantText,
          filesRead: Array.from(this.filesRead),
          toolCalls: this.toolCalls,
          proposedChanges: this.proposedChanges,
          iterations: this.iteration,
          textToolMode: this._textToolMode
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

        if (this._textToolMode) {
          // In text mode, inject tool result as a user message for the next turn.
          // Feed result back as a "system" message so the model sees it
          const resultSummary = result.success
            ? JSON.stringify(result, null, 2).slice(0, 4000)
            : `Error: ${result.error || 'Tool execution failed'}`;
          messages.push({
            role: 'user',
            content: `[Tool Result for ${toolCall.function.name}]:\n${resultSummary}\n\nContinue with the task. Use another tool if needed, or provide your final response.`
          });
        } else {
          // Native mode: use proper tool_calls format
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
      }

      // Add partial text response if any (native mode only, not already added)
      if (!this._textToolMode && response.message?.content) {
        messages.push({
          role: 'assistant',
          content: response.message.content
        });
      }
    }

    // Return partial results instead of throwing
    return {
      content: `Agent completed ${this.iteration} iterations. ${this.proposedChanges.length} changes proposed, ${this.filesRead.size} files read.`,
      filesRead: Array.from(this.filesRead),
      toolCalls: this.toolCalls,
      proposedChanges: this.proposedChanges,
      iterations: this.iteration,
      textToolMode: this._textToolMode,
      maxIterationsReached: true
    };
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
