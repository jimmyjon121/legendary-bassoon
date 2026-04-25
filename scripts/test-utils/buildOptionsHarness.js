/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const { mergePresetSystemPrompt } = require(path.join(ROOT, 'src/chat-v2/runtime/mergePresetSystemPrompt.cjs'));

function transformBuildOptionsSource() {
  const filePath = path.join(ROOT, 'src/chat-v2/runtime/buildInferenceOptions.js');
  return fs.readFileSync(filePath, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export async function buildChatV2InferenceOptions', 'async function buildChatV2InferenceOptions')
    .concat('\nmodule.exports = { buildChatV2InferenceOptions };\n');
}

function transformSessionStoreSource() {
  const filePath = path.join(ROOT, 'src/stores/chatV2SessionStore.js');
  return fs.readFileSync(filePath, 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export const useChatV2SessionStore = create(', 'const useChatV2SessionStore = create(')
    .replace('export const CHAT_V2_BACKEND_OVERRIDES = ALLOWED_BACKEND_OVERRIDES;', 'const CHAT_V2_BACKEND_OVERRIDES = ALLOWED_BACKEND_OVERRIDES;')
    .concat('\nmodule.exports = { useChatV2SessionStore, CHAT_V2_BACKEND_OVERRIDES };\n');
}

function createZustandStub() {
  return (initializer) => {
    let state = {};
    const set = (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      state = { ...state, ...(next || {}) };
    };
    const get = () => state;
    state = initializer(set, get);
    const useStore = (selector = (s) => s) => selector(state);
    useStore.getState = () => state;
    useStore.setState = set;
    return useStore;
  };
}

function createPersistStub() {
  return (initializer) => initializer;
}

function evaluateSessionStore() {
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    create: createZustandStub(),
    persist: createPersistStub(),
    Set,
    String,
  });
  const script = new vm.Script(transformSessionStoreSource(), {
    filename: 'chatV2SessionStore.harness.js',
  });
  script.runInContext(context);
  return module.exports;
}

async function buildOptionsWithState({
  appState = {},
  sessionState = {},
  presets = [],
  adaptiveOptions = {},
  optimizedOptions = {},
  vaultProfile = null,
  model = 'qwen2.5:1.5b',
  workspace = 'casual',
} = {}) {
  const module = { exports: {} };
  const finalAppState = {
    currentModel: model,
    currentWorkspace: workspace,
    currentModelInfo: null,
    autoTuneResult: null,
    fastChatMode: false,
    ...appState,
  };
  const finalSessionState = {
    contextLengthTokens: null,
    backendOverride: null,
    ...sessionState,
  };

  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Set,
    buildOptimizedOllamaOptionsWithInfo: () => ({
      temperature: 0.7,
      num_ctx: 4096,
      num_predict: 2048,
      ...optimizedOptions,
    }),
    useAdaptiveGeneration: {
      getState: () => ({
        buildOllamaOptions: async () => adaptiveOptions,
      }),
    },
    useAppStore: {
      getState: () => finalAppState,
    },
    useChatV2SessionStore: {
      getState: () => finalSessionState,
    },
    api: {
      getModelPresets: async () => presets,
      vaultGetProfile: async () => (
        vaultProfile ? { success: true, profile: vaultProfile } : { success: false }
      ),
    },
    clampInferenceOptionsToModel: (options = {}) => ({
      options: Object.fromEntries(
        Object.entries(options).filter(([key]) => key !== 'systemPrompt' && key !== 'forceBackend'),
      ),
      effectiveContextLength: Number(options.num_ctx) || 8192,
    }),
    mergePresetSystemPrompt,
  });

  const script = new vm.Script(transformBuildOptionsSource(), {
    filename: 'buildInferenceOptions.harness.js',
  });
  script.runInContext(context);
  return module.exports.buildChatV2InferenceOptions({ model, workspace });
}

module.exports = {
  buildOptionsWithState,
  evaluateSessionStore,
};
