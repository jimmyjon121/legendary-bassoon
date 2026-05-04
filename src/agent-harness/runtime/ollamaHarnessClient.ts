import type { AgentMessage, AssistantTurn, HarnessLLMClient } from '../masterLoop';
import type { ModelOptimalOptions, ModelProfile, ReasoningLevel } from '../modelProfiles';

export interface OllamaHarnessClientOptions {
  endpoint: string;
  model: string;
  fetchImpl?: typeof fetch;
  messagePort?: MessagePort;
}

export interface OllamaUsageMetrics {
  prompt_eval_count?: number;
  eval_count?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
}

export class OllamaHarnessClient implements HarnessLLMClient {
  private readonly fetchImpl: typeof fetch;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: OllamaHarnessClientOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async completeTurn(input: {
    profile: ModelProfile;
    messages: AgentMessage[];
    signal: AbortSignal;
    purpose: 'tool-turn' | 'default' | 'hard-task';
  }): Promise<AssistantTurn> {
    const body = buildOllamaChatRequest({
      model: this.options.model,
      profile: input.profile,
      messages: input.messages,
      purpose: input.purpose,
      stream: true,
    });
    this.startHeartbeat(input.profile);
    const response = await this.fetchImpl(`${this.options.endpoint.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama chat failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistant: AgentMessage = { role: 'assistant', content: '' };
    let usage: OllamaUsageMetrics = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        const message = parsed.message || {};
        assistant = {
          role: 'assistant',
          content: `${assistant.content}${message.content || ''}`,
          tool_calls: message.tool_calls || assistant.tool_calls,
        };
        usage = extractUsageMetrics(parsed);
        this.options.messagePort?.postMessage({ type: 'agent:harnessStreamChunk', message, usage });
      }
    }

    this.options.messagePort?.postMessage({ type: 'agent:harnessStreamDone', usage });
    return { message: assistant };
  }

  abortHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private startHeartbeat(profile: ModelProfile): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      this.options.messagePort?.postMessage({
        type: 'agent:harnessHeartbeat',
        keep_alive: profile.optimal_options.keep_alive,
      });
    }, 4 * 60 * 1000);
  }
}

export function buildOllamaChatRequest(args: {
  model: string;
  profile: ModelProfile;
  messages: AgentMessage[];
  purpose: 'tool-turn' | 'default' | 'hard-task';
  stream?: boolean;
  overrides?: Partial<ModelOptimalOptions>;
}): Record<string, unknown> {
  const options = buildOllamaOptions(args.profile, args.overrides);
  const reasoning = resolveReasoningLevel(args.profile, args.purpose);
  return {
    model: args.model,
    messages: args.messages.map(toOllamaMessage),
    stream: args.stream ?? true,
    keep_alive: options.keep_alive,
    options,
    think: reasoning === 'none' ? false : reasoning,
  };
}

export function buildOllamaOptions(profile: ModelProfile, overrides: Partial<ModelOptimalOptions> = {}): ModelOptimalOptions {
  const merged = { ...profile.optimal_options, ...overrides };
  return {
    ...merged,
    num_ctx: Math.max(32768, merged.num_ctx),
    stop: [...(merged.stop || [])],
  };
}

export function resolveReasoningLevel(
  profile: ModelProfile,
  purpose: 'tool-turn' | 'default' | 'hard-task',
): Exclude<ReasoningLevel, 'auto'> {
  if (profile.id === 'gpt-oss' && profile.reasoning_levels) {
    if (purpose === 'tool-turn') return profile.reasoning_levels.tool_turns;
    if (purpose === 'hard-task') return profile.reasoning_levels.hard_tasks;
    return profile.reasoning_levels.default;
  }
  return profile.reasoning_default === 'auto' ? 'medium' : profile.reasoning_default;
}

export function requiredOllamaRuntimeEnv(): Record<string, string> {
  return {
    OLLAMA_FLASH_ATTENTION: '1',
    OLLAMA_KV_CACHE_TYPE: 'q8_0',
  };
}

function toOllamaMessage(message: AgentMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    tool_call_id: message.tool_call_id,
    name: message.name,
    tool_calls: message.tool_calls,
  };
}

function extractUsageMetrics(chunk: Record<string, unknown>): OllamaUsageMetrics {
  return {
    prompt_eval_count: asNumber(chunk.prompt_eval_count),
    eval_count: asNumber(chunk.eval_count),
    prompt_eval_duration: asNumber(chunk.prompt_eval_duration),
    eval_duration: asNumber(chunk.eval_duration),
    total_duration: asNumber(chunk.total_duration),
    load_duration: asNumber(chunk.load_duration),
  };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
