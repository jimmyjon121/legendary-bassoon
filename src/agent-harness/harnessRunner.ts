import { detectModelProfile } from './detection/detectModelProfile';
import type { OllamaShowMetadata, BenchmarkCache } from './detection/detectModelProfile';
import type { AgentMessage, MasterLoopResult } from './masterLoop';
import { runMasterLoop } from './masterLoop';
import type { ModelProfile } from './modelProfiles';
import { resolveHarnessMode } from './modes';
import { OllamaHarnessClient } from './runtime/ollamaHarnessClient';
import { createMinimumToolRegistry } from './tools/registry';
import { createElectronToolAdapters } from './adapters/electronToolAdapters';

/**
 * EXPERIMENTAL ONLY.
 *
 * This runner is retained as a future harness prototype and must not power
 * production chat or Code Agent behavior. Production inference must route:
 * AgentPanel -> agentOrchestrator -> toolEnabledLLM -> sendToLLM -> IPC ->
 * resolver -> inference orchestrator -> backend adapter.
 */
export type HarnessProgressEvent =
  | { type: 'turn'; turn: number; totalTokens?: number }
  | { type: 'tool'; name: string; ok: boolean }
  | { type: 'done'; ok: boolean; turns: number; error?: string };

export interface HarnessRunRequest {
  task: string;
  projectRoot: string;
  ollamaEndpoint: string;
  modelName: string;
  systemPrompt?: string;
  maxTurns?: number;
  onProgress?: (event: HarnessProgressEvent) => void;
  signal?: AbortSignal;
}

export interface HarnessRunResult extends MasterLoopResult {
  profile: ModelProfile;
}

declare global {
  interface Window {
    electronAPI: Record<string, (...args: unknown[]) => Promise<unknown>>;
  }
}

function electronAPI(): Window['electronAPI'] {
  return window.electronAPI;
}

// Benchmark cache is keyed by digest; the profile DB is keyed by model name.
// For now we don't run live benchmarks (runBenchmark: false), so the cache is a no-op.
// Once live benchmarks are wired, switch this to a dedicated digest table.
function buildIpcBenchmarkCache(): BenchmarkCache {
  return {
    async getByDigest(_digest) {
      return null;
    },
    async saveByDigest(_result) {
      // Non-blocking; not wired yet.
    },
  };
}

async function fetchOllamaMetadata(
  ollamaEndpoint: string,
  modelName: string,
): Promise<OllamaShowMetadata | null> {
  try {
    const base = ollamaEndpoint.replace(/\/$/, '');
    const res = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });
    if (!res.ok) return null;
    return (await res.json()) as OllamaShowMetadata;
  } catch {
    return null;
  }
}

function buildSystemPrompt(profile: ModelProfile, customPrompt?: string): string {
  const base = customPrompt?.trim() ||
    'You are a skilled coding agent. Think carefully, use your tools to read and understand the codebase before making edits, and produce minimal targeted changes that solve the requested task.';
  return `${base}\n\nProfile: ${profile.id} | Edit format: ${profile.edit_format} | Context: ${profile.context_window} tokens`;
}

function stripThinkingBlocks(content: string): string {
  // Same tags as isThinkingModel() in src/services/modelOptimizer.js
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export async function runHarnessTask(request: HarnessRunRequest): Promise<HarnessRunResult> {
  const { task, projectRoot, ollamaEndpoint, modelName, onProgress, signal } = request;

  const metadata = await fetchOllamaMetadata(ollamaEndpoint, modelName);
  const benchmarkCache = buildIpcBenchmarkCache();

  const profile = await detectModelProfile({
    modelName,
    metadata,
    runBenchmark: false,
    benchmarkCache,
  });

  const resolved = resolveHarnessMode('coding', profile, {}, { phase: 'act' });

  const adapters = createElectronToolAdapters({ projectRoot });
  const registry = createMinimumToolRegistry(adapters);

  const client = new OllamaHarnessClient({
    endpoint: ollamaEndpoint,
    model: modelName,
  });

  const systemMessage: AgentMessage = {
    role: 'system',
    content: buildSystemPrompt(profile, request.systemPrompt),
  };
  const userMessage: AgentMessage = {
    role: 'user',
    content: task,
  };

  let lastTurn = 0;
  const wrappedClient = {
    async completeTurn(input: Parameters<OllamaHarnessClient['completeTurn']>[0]) {
      const turn = await client.completeTurn(input);

      // Strip <think> between turns for Gemma-family models (preserve within tool-call sequences)
      if (
        profile.thinking_style === 'strip-between-turns' &&
        !turn.message.tool_calls?.length
      ) {
        turn.message = {
          ...turn.message,
          content: stripThinkingBlocks(turn.message.content),
        };
      }

      lastTurn += 1;
      onProgress?.({ type: 'turn', turn: lastTurn });
      return turn;
    },
  };

  const loopResult = await runMasterLoop(
    {
      profile,
      modePhase: resolved.phase,
      messages: [systemMessage, userMessage],
      maxTurns: request.maxTurns ?? 32,
      signal,
    },
    wrappedClient,
    registry,
  );

  client.abortHeartbeat();

  // Persist profile for next session (non-blocking).
  try {
    await electronAPI().agentHarnessSaveProfile(profile as unknown as Parameters<Window['electronAPI']['agentHarnessSaveProfile']>[0]);
  } catch {
    // Non-blocking.
  }

  onProgress?.({ type: 'done', ok: loopResult.ok, turns: loopResult.turns, error: loopResult.error });

  return { ...loopResult, profile };
}

export { detectModelProfile };
export type { ModelProfile, OllamaShowMetadata };
