/* eslint-disable no-console */

const {
  buildExecutionPlan,
  getNormalizedModelInfo,
} = require('../electron/services/llm-execution-resolver');

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function createFakeMakeRequest() {
  const showData = {
    'local-wizard-vicuna-13b-uncensored.q4_0:latest': {
      template: '{{ .Prompt }}',
      details: {
        family: 'llama',
        format: 'gguf',
      },
      model_info: {
        'llama.context_length': 2048,
      },
      parameters: 'num_ctx 2048',
    },
    'llama3.2:3b': {
      template: '{{ range .Messages }}{{ .Role }}: {{ .Content }}{{ end }}',
      details: {
        family: 'llama',
        format: 'gguf',
      },
      model_info: {
        'llama.context_length': 8192,
      },
    },
    'qwen2.5:7b-instruct': {
      template: '{{ range .Messages }}{{ .Role }}: {{ .Content }}{{ end }}',
      details: {
        family: 'qwen2',
        format: 'gguf',
      },
      model_info: {
        'qwen.context_length': 32768,
      },
    },
  };

  return async function makeRequest(url, options = {}) {
    if (url.endsWith('/api/tags')) {
      return {
        data: {
          models: [
            { name: 'local-wizard-vicuna-13b-uncensored.q4_0:latest' },
            { name: 'llama3.2:3b' },
            { name: 'qwen2.5:7b-instruct' },
          ],
        },
      };
    }

    if (url.endsWith('/api/show')) {
      const name = options?.body?.name;
      return {
        data: showData[name] || {
          template: null,
          details: {},
          model_info: {},
        },
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };
}

async function main() {
  const failures = [];
  const endpoint = 'http://127.0.0.1:11434';
  const makeRequest = createFakeMakeRequest();

  const vicunaInfo = await getNormalizedModelInfo(
    endpoint,
    makeRequest,
    'local-wizard-vicuna-13b-uncensored.q4_0:latest',
    { forceRefresh: true }
  );
  assert(vicunaInfo.templateMode === 'raw_prompt', 'Raw-template Vicuna model must resolve to raw_prompt mode', failures);
  assert(vicunaInfo.effectiveContextLength === 2048, 'Raw-template Vicuna model must preserve its 2048 context limit', failures);
  assert(vicunaInfo.baselineStatus === 'unstable', 'Raw-template Vicuna model must be flagged as an unstable casual baseline', failures);

  const casualFallbackPlan = await buildExecutionPlan({
    endpoint,
    makeRequest,
    payload: {
      model: 'local-wizard-vicuna-13b-uncensored.q4_0:latest',
      workspace: 'casual',
      workloadType: 'chat',
      messages: [{ role: 'user', content: 'hey there' }],
      system: 'You are a helpful assistant.',
      options: { num_ctx: 8192, num_predict: 256 },
    },
    stream: true,
  });
  assert(casualFallbackPlan.executionMode === 'fallback_model', 'Casual chat must use fallback_model mode for unstable raw-template baselines', failures);
  assert(casualFallbackPlan.effectiveModel === 'llama3.2:3b', 'Casual fallback plan must route to the first installed vetted fallback model', failures);
  assert(casualFallbackPlan.endpointMode === '/api/chat', 'Fallback native-chat model must use /api/chat', failures);

  const compatPlan = await buildExecutionPlan({
    endpoint,
    makeRequest,
    payload: {
      model: 'local-wizard-vicuna-13b-uncensored.q4_0:latest',
      workspace: 'work',
      workloadType: 'chat',
      messages: [{ role: 'user', content: 'Explain this in one paragraph.' }],
      system: 'You are a helpful assistant.',
      options: { num_ctx: 8192, num_predict: 256 },
    },
    stream: false,
  });
  assert(compatPlan.executionMode === 'compat', 'Non-casual raw-template chats must stay on the selected model in compat mode', failures);
  assert(compatPlan.endpointMode === '/api/generate', 'Compat mode must route through /api/generate', failures);
  assert(compatPlan.effectiveOptions.num_ctx === 2048, 'Compat mode must clamp effective context to the model maximum', failures);

  const nativePlan = await buildExecutionPlan({
    endpoint,
    makeRequest,
    payload: {
      model: 'qwen2.5:7b-instruct',
      workspace: 'work',
      workloadType: 'chat',
      messages: [{ role: 'user', content: 'Summarize this repo.' }],
      system: 'You are a helpful assistant.',
      options: { num_ctx: 8192, num_predict: 256 },
    },
    stream: true,
  });
  assert(nativePlan.executionMode === 'direct', 'Native chat models must stay in direct mode', failures);
  assert(nativePlan.endpointMode === '/api/chat', 'Native chat models must route through /api/chat', failures);

  const forcedCompatPlan = await buildExecutionPlan({
    endpoint,
    makeRequest,
    payload: {
      model: 'qwen2.5:7b-instruct',
      workspace: 'work',
      workloadType: 'chat',
      messages: [{ role: 'user', content: 'Give me a safer retry.' }],
      system: 'You are a helpful assistant.',
      options: { num_ctx: 4096, num_predict: 128 },
      forceCompatMode: true,
    },
    stream: false,
  });
  assert(forcedCompatPlan.executionMode === 'compat', 'Forced compat retries must override native chat routing', failures);
  assert(forcedCompatPlan.endpointMode === '/api/generate', 'Forced compat retries must route through /api/generate', failures);

  if (failures.length > 0) {
    console.error('LLM Mode Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('LLM Mode Eval PASS');
}

main().catch((error) => {
  console.error('LLM Mode Eval crashed:', error);
  process.exit(1);
});
