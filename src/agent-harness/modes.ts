import type { ModelOptimalOptions, ModelProfile } from './modelProfiles';

export type HarnessModeName = 'coding' | 'chat' | 'creative' | 'vault';
export type HarnessModePhase = 'plan' | 'act';
export type PermissionTier = 'read' | 'write' | 'execute';

export interface HarnessMode {
  name: HarnessModeName;
  defaultPhase: HarnessModePhase;
  promptLayer: string;
  allowedPlanPermissions: PermissionTier[];
  allowedActPermissions: PermissionTier[];
  defaultTools: string[];
  defaultOptions: Partial<ModelOptimalOptions>;
}

export interface HarnessOverrides {
  options?: Partial<ModelOptimalOptions>;
  tools?: string[];
  phase?: HarnessModePhase;
  promptLayer?: string;
}

export interface ResolvedHarnessMode {
  mode: HarnessMode;
  phase: HarnessModePhase;
  options: ModelOptimalOptions;
  tools: string[];
  promptLayer: string;
}

export const HARNESS_MODES: Record<HarnessModeName, HarnessMode> = {
  coding: {
    name: 'coding',
    defaultPhase: 'plan',
    promptLayer: 'coding-agent',
    allowedPlanPermissions: ['read'],
    allowedActPermissions: ['read', 'write', 'execute'],
    defaultTools: ['read_file', 'list_directory', 'grep', 'repo_map', 'codebase_search', 'todo_write', 'attempt_completion'],
    defaultOptions: {},
  },
  chat: {
    name: 'chat',
    defaultPhase: 'plan',
    promptLayer: 'chat-agent',
    allowedPlanPermissions: ['read'],
    allowedActPermissions: ['read'],
    defaultTools: ['read_file', 'list_directory', 'grep', 'codebase_search', 'todo_write', 'attempt_completion'],
    defaultOptions: {},
  },
  creative: {
    name: 'creative',
    defaultPhase: 'plan',
    promptLayer: 'creative-agent',
    allowedPlanPermissions: ['read'],
    allowedActPermissions: ['read'],
    defaultTools: ['read_file', 'list_directory', 'grep', 'codebase_search', 'todo_write', 'attempt_completion'],
    defaultOptions: {},
  },
  vault: {
    name: 'vault',
    defaultPhase: 'plan',
    promptLayer: 'vault-agent',
    allowedPlanPermissions: ['read'],
    allowedActPermissions: ['read'],
    defaultTools: ['read_file', 'list_directory', 'grep', 'codebase_search', 'todo_write', 'attempt_completion'],
    defaultOptions: {},
  },
};

export function allowedPermissionsForPhase(mode: HarnessMode, phase: HarnessModePhase): PermissionTier[] {
  return phase === 'act' ? mode.allowedActPermissions : mode.allowedPlanPermissions;
}

export function resolveHarnessMode(
  modeName: HarnessModeName,
  profile: ModelProfile,
  userSessionOverrides: HarnessOverrides = {},
  requestOverrides: HarnessOverrides = {},
): ResolvedHarnessMode {
  const mode = HARNESS_MODES[modeName];
  const phase = requestOverrides.phase || userSessionOverrides.phase || mode.defaultPhase;
  const tools = requestOverrides.tools || userSessionOverrides.tools || mode.defaultTools;
  const options = {
    ...mode.defaultOptions,
    ...profile.optimal_options,
    ...(userSessionOverrides.options || {}),
    ...(requestOverrides.options || {}),
  };

  return {
    mode,
    phase,
    options,
    tools,
    promptLayer: requestOverrides.promptLayer || userSessionOverrides.promptLayer || mode.promptLayer,
  };
}
