import { z, type ZodTypeAny } from 'zod';
import type { AgentToolCall, RecentReadTracker, TodoState } from '../masterLoop';
import type { HarnessModePhase, PermissionTier } from '../modes';

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

export interface ToolResultEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
  meta?: Record<string, unknown>;
}

export interface ToolExample {
  description: string;
  args: unknown;
}

export interface ToolAdapters {
  readFile(path: string, signal?: AbortSignal): Promise<string>;
  writeFile(path: string, content: string, signal?: AbortSignal): Promise<void>;
  editFile?(path: string, content: string, signal?: AbortSignal): Promise<void>;
  listDirectory(path: string, signal?: AbortSignal): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>;
  grep(pattern: string, path?: string, signal?: AbortSignal): Promise<Array<{ path: string; line: number; text: string }>>;
  runTerminalCommand(command: string, cwd?: string, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }>;
  runTests(command?: string, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }>;
  repoMap(signal?: AbortSignal): Promise<unknown>;
  codebaseSearch(query: string, signal?: AbortSignal): Promise<unknown>;
}

export interface ToolExecutionContext {
  adapters: ToolAdapters;
  modePhase: HarnessModePhase;
  currentTurn: number;
  readFreshnessTurns: number;
  readTracker: RecentReadTracker;
  todoState: TodoState;
  signal: AbortSignal;
}

export interface HarnessTool<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  permission: PermissionTier;
  schema: TSchema;
  examples: ToolExample[];
  execute(args: z.infer<TSchema>, context: ToolExecutionContext): Promise<ToolResultEnvelope>;
}

export interface ToolCallExecution extends Omit<ToolExecutionContext, 'adapters'> {
  toolCall: AgentToolCall;
}

const pathSchema = z.object({ path: z.string().min(1) });

export const readFileTool: HarnessTool = {
  name: 'read_file',
  description: 'Read a UTF-8 file before reasoning about or editing it.',
  permission: 'read',
  schema: pathSchema,
  examples: [{ description: 'Read a source file', args: { path: 'src/App.jsx' } }],
  async execute(args, context) {
    const content = await context.adapters.readFile(args.path, context.signal);
    context.readTracker.record(args.path, context.currentTurn);
    return { ok: true, data: { path: args.path, content } };
  },
};

export const writeFileTool: HarnessTool = {
  name: 'write_file',
  description: 'Write a complete file. Requires Act mode and write permission.',
  permission: 'write',
  schema: z.object({ path: z.string().min(1), content: z.string() }),
  examples: [{ description: 'Create a new module', args: { path: 'src/example.ts', content: 'export const ok = true;\\n' } }],
  async execute(args, context) {
    await context.adapters.writeFile(args.path, args.content, context.signal);
    return { ok: true, data: { path: args.path, bytes: args.content.length } };
  },
};

export const editFileTool: HarnessTool = {
  name: 'edit_file',
  description: 'Apply an edit to a recently-read file. Rejects stale or imagined file context.',
  permission: 'write',
  schema: z.object({
    path: z.string().min(1),
    content: z.string(),
    format: z.enum(['whole', 'diff', 'udiff', 'diff-fenced', 'patch']).default('diff'),
  }),
  examples: [
    {
      description: 'Apply a SEARCH/REPLACE edit after reading the file',
      args: { path: 'src/App.jsx', format: 'diff', content: '<<<<<<< SEARCH\\nold\\n=======\\nnew\\n>>>>>>> REPLACE' },
    },
  ],
  async execute(args, context) {
    if (!context.readTracker.wasReadRecently(args.path, context.currentTurn, context.readFreshnessTurns)) {
      return {
        ok: false,
        error: {
          code: 'READ_REQUIRED_BEFORE_EDIT',
          message: `edit_file requires read_file({ path: "${args.path}" }) within the last ${context.readFreshnessTurns} turns.`,
          retryable: true,
        },
      };
    }
    if (context.adapters.editFile) {
      await context.adapters.editFile(args.path, args.content, context.signal);
    } else {
      await context.adapters.writeFile(args.path, args.content, context.signal);
    }
    return { ok: true, data: { path: args.path, format: args.format } };
  },
};

export const listDirectoryTool: HarnessTool = {
  name: 'list_directory',
  description: 'List files and folders in a directory.',
  permission: 'read',
  schema: pathSchema,
  examples: [{ description: 'List source root', args: { path: 'src' } }],
  async execute(args, context) {
    return { ok: true, data: await context.adapters.listDirectory(args.path, context.signal) };
  },
};

export const grepTool: HarnessTool = {
  name: 'grep',
  description: 'Search text with ripgrep-compatible semantics.',
  permission: 'read',
  schema: z.object({ pattern: z.string().min(1), path: z.string().optional() }),
  examples: [{ description: 'Find IPC channel references', args: { pattern: 'agent:harnessRun', path: 'src electron' } }],
  async execute(args, context) {
    return { ok: true, data: await context.adapters.grep(args.pattern, args.path, context.signal) };
  },
};

export const runTerminalCommandTool: HarnessTool = {
  name: 'run_terminal_command',
  description: 'Run a terminal command in Act mode.',
  permission: 'execute',
  schema: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
  examples: [{ description: 'Run lint', args: { command: 'npm run lint -- --format unix' } }],
  async execute(args, context) {
    return { ok: true, data: await context.adapters.runTerminalCommand(args.command, args.cwd, context.signal) };
  },
};

export const runTestsTool: HarnessTool = {
  name: 'run_tests',
  description: 'Run the project test or eval command selected by the harness.',
  permission: 'execute',
  schema: z.object({ command: z.string().optional() }),
  examples: [{ description: 'Run release gate', args: { command: 'npm run eval:release-gate' } }],
  async execute(args, context) {
    return { ok: true, data: await context.adapters.runTests(args.command, context.signal) };
  },
};

export const repoMapTool: HarnessTool = {
  name: 'repo_map',
  description: 'Return a ranked codebase map built from parser-registry symbols and graph importance.',
  permission: 'read',
  schema: z.object({ focus: z.string().optional() }),
  examples: [{ description: 'Map the harness package', args: { focus: 'agent-harness' } }],
  async execute(_args, context) {
    return { ok: true, data: await context.adapters.repoMap(context.signal) };
  },
};

export const codebaseSearchTool: HarnessTool = {
  name: 'codebase_search',
  description: 'Hybrid code search using lexical, vector, and reciprocal rank fusion results.',
  permission: 'read',
  schema: z.object({ query: z.string().min(1) }),
  examples: [{ description: 'Find model profile detection logic', args: { query: 'Gemma tool capability metadata gate' } }],
  async execute(args, context) {
    return { ok: true, data: await context.adapters.codebaseSearch(args.query, context.signal) };
  },
};

export const todoWriteTool: HarnessTool = {
  name: 'todo_write',
  description: 'Create or update the agent TODO state for long-running tasks.',
  permission: 'read',
  schema: z.object({
    items: z.array(
      z.object({
        id: z.string().min(1),
        content: z.string().min(1),
        status: z.enum(['pending', 'in_progress', 'completed']),
      }),
    ),
  }),
  examples: [
    {
      description: 'Track implementation progress',
      args: { items: [{ id: '1', content: 'Implement model profiles', status: 'in_progress' }] },
    },
  ],
  async execute(args, context) {
    context.todoState.items = args.items;
    context.todoState.touched = true;
    return { ok: true, data: { count: args.items.length } };
  },
};

export const attemptCompletionTool: HarnessTool = {
  name: 'attempt_completion',
  description: 'Signal that the agent believes the requested task is complete.',
  permission: 'read',
  schema: z.object({ summary: z.string().min(1), tests: z.array(z.string()).default([]) }),
  examples: [{ description: 'Complete after tests', args: { summary: 'Implemented harness foundation.', tests: ['agent-harness-smoke'] } }],
  async execute(args) {
    return { ok: true, data: args };
  },
};

export const MINIMUM_TOOLS: HarnessTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  grepTool,
  runTerminalCommandTool,
  runTestsTool,
  repoMapTool,
  codebaseSearchTool,
  todoWriteTool,
  attemptCompletionTool,
];

export class ToolRegistry {
  private readonly tools = new Map<string, HarnessTool>();

  constructor(
    tools: HarnessTool[],
    private readonly adapters: ToolAdapters,
    private readonly allowedPlanTools = new Set(['read_file', 'list_directory', 'grep', 'repo_map', 'codebase_search', 'todo_write', 'attempt_completion']),
  ) {
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  getTool(name: string): HarnessTool | undefined {
    return this.tools.get(name);
  }

  listTools(modePhase: HarnessModePhase): HarnessTool[] {
    return [...this.tools.values()].filter((tool) => this.isToolAllowed(tool, modePhase));
  }

  async executeToolCalls(executions: ToolCallExecution[]): Promise<Array<{ toolCall: AgentToolCall; result: ToolResultEnvelope }>> {
    const readExecutions = executions.filter((execution) => this.isReadOnlyExecution(execution));
    const serialExecutions = executions.filter((execution) => !this.isReadOnlyExecution(execution));
    const readResults = await Promise.all(readExecutions.map((execution) => this.executeOne(execution)));
    const serialResults = [];
    for (const execution of serialExecutions) {
      serialResults.push(await this.executeOne(execution));
    }
    return restoreOriginalOrder(executions, [...readResults, ...serialResults]);
  }

  private async executeOne(execution: ToolCallExecution): Promise<{ toolCall: AgentToolCall; result: ToolResultEnvelope }> {
    const tool = this.tools.get(execution.toolCall.name);
    if (!tool) {
      return {
        toolCall: execution.toolCall,
        result: {
          ok: false,
          error: {
            code: 'UNKNOWN_TOOL',
            message: `Unknown tool "${execution.toolCall.name}".`,
            details: { suggestions: suggestToolNames(execution.toolCall.name, [...this.tools.keys()]) },
            retryable: true,
          },
        },
      };
    }

    if (!this.isToolAllowed(tool, execution.modePhase)) {
      return {
        toolCall: execution.toolCall,
        result: {
          ok: false,
          error: {
            code: 'TOOL_NOT_ALLOWED_IN_MODE',
            message: `${tool.name} is not available in ${execution.modePhase} mode.`,
            details: { permission: tool.permission },
            retryable: true,
          },
        },
      };
    }

    const parsed = tool.schema.safeParse(execution.toolCall.arguments);
    if (!parsed.success) {
      return {
        toolCall: execution.toolCall,
        result: {
          ok: false,
          error: {
            code: 'INVALID_TOOL_ARGUMENTS',
            message: `Invalid arguments for ${tool.name}.`,
            details: parsed.error.flatten(),
            retryable: true,
          },
        },
      };
    }

    try {
      const result = await tool.execute(parsed.data, { ...execution, adapters: this.adapters });
      return { toolCall: execution.toolCall, result };
    } catch (error) {
      return {
        toolCall: execution.toolCall,
        result: {
          ok: false,
          error: {
            code: 'TOOL_EXECUTION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        },
      };
    }
  }

  private isReadOnlyExecution(execution: ToolCallExecution): boolean {
    const tool = this.tools.get(execution.toolCall.name);
    return Boolean(tool && tool.permission === 'read');
  }

  private isToolAllowed(tool: HarnessTool, modePhase: HarnessModePhase): boolean {
    if (modePhase === 'act') return true;
    return tool.permission === 'read' && this.allowedPlanTools.has(tool.name);
  }
}

export function createMinimumToolRegistry(adapters: ToolAdapters): ToolRegistry {
  return new ToolRegistry(MINIMUM_TOOLS, adapters);
}

export function suggestToolNames(input: string, candidates: string[]): string[] {
  return candidates
    .map((candidate) => ({ candidate, score: levenshtein(input, candidate) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => item.candidate);
}

function restoreOriginalOrder(
  executions: ToolCallExecution[],
  results: Array<{ toolCall: AgentToolCall; result: ToolResultEnvelope }>,
): Array<{ toolCall: AgentToolCall; result: ToolResultEnvelope }> {
  const byId = new Map(results.map((result) => [result.toolCall.id, result]));
  return executions.map((execution) => byId.get(execution.toolCall.id) as { toolCall: AgentToolCall; result: ToolResultEnvelope });
}

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}
