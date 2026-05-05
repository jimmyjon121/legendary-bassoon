import { getCompactionThreshold, type ModelProfile } from './modelProfiles';
import type { HarnessModePhase } from './modes';
import type { ToolCallExecution, ToolRegistry, ToolResultEnvelope } from './tools/registry';

export type AgentRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  role: AgentRole;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: AgentToolCall[];
  tokenEstimate?: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface MasterLoopRequest {
  profile: ModelProfile;
  modePhase: HarnessModePhase;
  messages: AgentMessage[];
  maxTurns?: number;
  maxRepeatedIdenticalCalls?: number;
  toolReadFreshnessTurns?: number;
  signal?: AbortSignal;
}

export interface AssistantTurn {
  message: AgentMessage;
  tokenEstimate?: number;
}

export interface HarnessLLMClient {
  completeTurn(input: {
    profile: ModelProfile;
    messages: AgentMessage[];
    signal: AbortSignal;
    purpose: 'tool-turn' | 'default' | 'hard-task';
  }): Promise<AssistantTurn>;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoState {
  items: TodoItem[];
  touched: boolean;
}

export interface MasterLoopResult {
  ok: boolean;
  finalMessage: AgentMessage;
  messages: AgentMessage[];
  turns: number;
  aborted: boolean;
  error?: string;
}

export class RecentReadTracker {
  private readonly reads = new Map<string, number>();

  record(path: string, turn: number): void {
    this.reads.set(normalizePathKey(path), turn);
  }

  wasReadRecently(path: string, currentTurn: number, freshnessTurns = 5): boolean {
    const lastRead = this.reads.get(normalizePathKey(path));
    return typeof lastRead === 'number' && currentTurn - lastRead <= freshnessTurns;
  }
}

export function renderTodoReminder(todoState: TodoState): string {
  const lines = todoState.items.map((item) => `- [${item.status}] ${item.content}`);
  return `Current TODO state:\n${lines.join('\n')}`;
}

export function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => {
    if (typeof message.tokenEstimate === 'number') return total + message.tokenEstimate;
    return total + Math.ceil((message.content || '').length / 4);
  }, 0);
}

export function compactMessagesAtThreshold(messages: AgentMessage[], profile: ModelProfile): AgentMessage[] {
  const threshold = getCompactionThreshold(profile);
  if (estimateMessagesTokens(messages) < threshold || messages.length <= 4) {
    return messages;
  }

  const systemMessages = messages.filter((message) => message.role === 'system').slice(0, 1);
  const recentMessages = messages.slice(-12);
  const compactedCount = Math.max(0, messages.length - systemMessages.length - recentMessages.length);
  const summary: AgentMessage = {
    role: 'system',
    content: `Earlier conversation compacted at ${threshold} tokens. Preserve all user goals, active constraints, files read, TODO state, and pending tool context from the omitted ${compactedCount} messages.`,
  };

  return [...systemMessages, summary, ...recentMessages];
}

export async function runMasterLoop(
  request: MasterLoopRequest,
  client: HarnessLLMClient,
  registry: ToolRegistry,
): Promise<MasterLoopResult> {
  const abortController = new AbortController();
  if (request.signal) {
    if (request.signal.aborted) {
      abortController.abort();
    } else {
      request.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    }
  }
  const maxTurns = request.maxTurns ?? 32;
  const repeatedLimit = request.maxRepeatedIdenticalCalls ?? 2;
  const readFreshnessTurns = request.toolReadFreshnessTurns ?? 5;
  const readTracker = new RecentReadTracker();
  const todoState: TodoState = { items: [], touched: false };
  const repeatedCalls = new Map<string, number>();
  let messages = [...request.messages];
  let finalMessage: AgentMessage = messages[messages.length - 1] || { role: 'assistant', content: '' };

  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      messages = compactMessagesAtThreshold(messages, request.profile);
      const assistant = await client.completeTurn({
        profile: request.profile,
        messages,
        signal: abortController.signal,
        purpose: hasPendingToolWork(messages) ? 'tool-turn' : 'default',
      });

      finalMessage = assistant.message;
      messages.push(finalMessage);

      const toolCalls = finalMessage.tool_calls || [];
      if (toolCalls.length === 0) {
        return { ok: true, finalMessage, messages, turns: turn, aborted: abortController.signal.aborted };
      }

      for (const toolCall of toolCalls) {
        const key = stableToolCallKey(toolCall);
        const count = (repeatedCalls.get(key) || 0) + 1;
        repeatedCalls.set(key, count);
        if (count > repeatedLimit) {
          const errorResult = serializeToolResultMessage(toolCall, {
            ok: false,
            error: {
              code: 'REPEATED_IDENTICAL_TOOL_CALL',
              message: `Repeated identical tool call guard fired for ${toolCall.name}.`,
              retryable: false,
            },
          });
          messages.push(errorResult);
          return { ok: false, finalMessage: errorResult, messages, turns: turn, aborted: false, error: errorResult.content };
        }
      }

      const executions: ToolCallExecution[] = toolCalls.map((toolCall) => ({
        toolCall,
        modePhase: request.modePhase,
        currentTurn: turn,
        readFreshnessTurns,
        readTracker,
        todoState,
        signal: abortController.signal,
      }));
      const toolResults = await registry.executeToolCalls(executions);
      const resultMessages = toolResults.map(({ toolCall, result }) => serializeToolResultMessage(toolCall, result));
      messages.push(...resultMessages);

      if (request.modePhase === 'act' && todoState.touched) {
        messages.push({ role: 'system', content: renderTodoReminder(todoState) });
      }
    }

    return {
      ok: false,
      finalMessage,
      messages,
      turns: maxTurns,
      aborted: abortController.signal.aborted,
      error: `Master loop exhausted max turn budget (${maxTurns}).`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      finalMessage,
      messages,
      turns: maxTurns,
      aborted: abortController.signal.aborted,
      error: errorMessage,
    };
  }
}

export function serializeToolResultMessage(toolCall: AgentToolCall, result: ToolResultEnvelope): AgentMessage {
  const prefix = result.ok ? '' : '[ERROR] ';
  return {
    role: 'tool',
    name: toolCall.name,
    tool_call_id: toolCall.id,
    content: `${prefix}${JSON.stringify(result)}`,
  };
}

function stableToolCallKey(toolCall: AgentToolCall): string {
  return `${toolCall.name}:${stableStringify(toolCall.arguments)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => `${JSON.stringify(key)}:${stableStringify(inner)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hasPendingToolWork(messages: AgentMessage[]): boolean {
  const lastMessage = messages[messages.length - 1];
  return Boolean(lastMessage?.tool_calls?.length);
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}
