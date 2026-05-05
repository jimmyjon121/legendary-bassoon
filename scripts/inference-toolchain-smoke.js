#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Lightweight checks for inference sanitization, execution planning,
 * production-path freeze, and OllamaBackend payloads.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function makeShowRequest(showByModel = {}) {
  return async (url, opts = {}) => {
    if (String(url).endsWith('/api/show')) {
      const name = String(opts?.body?.name || opts?.body?.model || '');
      return { status: 200, data: showByModel[name] || showByModel.default || {} };
    }
    if (String(url).endsWith('/api/tags')) {
      return { status: 200, data: { models: [] } };
    }
    return { status: 200, data: {} };
  };
}

function showData({ family, template = '{{ range .Messages }}{{ .Role }}: {{ .Content }}{{ end }}', capabilities = [] } = {}) {
  return {
    details: { family },
    template,
    capabilities,
    model_info: { 'general.context_length': 8192 },
  };
}

function requiredContractFields() {
  return [
    'traceId',
    'runId',
    'requestedModel',
    'resolvedModel',
    'provider',
    'family',
    'endpointMode',
    'executionMode',
    'toolMode',
    'toolsRequested',
    'toolsAttached',
    'compatBlockedTools',
    'thinkingPolicy',
    'metadataSource',
    'capabilityConfidence',
    'reasons',
    'warnings',
    'fallbackReason',
  ];
}

function testProductionPathFreeze() {
  const agentPanel = read('src/components/Code/AgentPanel.jsx');
  assert(!/runHarnessTask/.test(agentPanel), 'AgentPanel must not import/call runHarnessTask');
  assert(/agentOrchestrator\.startNightShift/.test(agentPanel), 'AgentPanel starts through agentOrchestrator.startNightShift');

  const runner = read('src/agent-harness/harnessRunner.ts');
  assert(/EXPERIMENTAL ONLY/.test(runner), 'harnessRunner must be marked experimental only');

  const toolEnabled = read('src/services/toolEnabledLLM.js');
  assert(/Production agent inference must go through Electron IPC/.test(toolEnabled), 'toolEnabledLLM documents IPC-only production path');
  assert(!/fetch\(`\$\{endpoint\}\/api\/chat`/.test(toolEnabled), 'toolEnabledLLM must not raw-fetch /api/chat in production');

  const handlers = read('electron/ipc/agent-harness-handlers.js');
  assert(/DB-only bridge/.test(handlers), 'agent-harness IPC must remain DB/profile persistence only');
}

function testSanitizeInferenceMessages() {
  const { sanitizeInferenceMessages } = require(path.join(root, 'electron/utils/sanitize-inference-messages.js'));

  const toolMsg = {
    role: 'tool',
    tool_call_id: 'call_1',
    name: 'read_file',
    content: '{"ok":true}',
  };
  const outTool = sanitizeInferenceMessages([toolMsg], {});
  assert(outTool.length === 1 && outTool[0].role === 'tool' && outTool[0].tool_call_id === 'call_1', 'tool message preserved');

  const droppedTool = sanitizeInferenceMessages([{ role: 'tool', content: 'missing id' }], {});
  assert(droppedTool.length === 0, 'tool message without tool_call_id dropped');

  const assistantCalls = {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_abc',
        type: 'function',
        function: { name: 'list_directory', arguments: '{"path":"."}' },
      },
    ],
  };
  const outAsst = sanitizeInferenceMessages([assistantCalls], {});
  assert(outAsst.length === 1 && outAsst[0].tool_calls?.length === 1, 'assistant tool_calls preserved with null content');

  const badRole = sanitizeInferenceMessages([{ role: 'narrator', content: 'x' }], {});
  assert(badRole.length === 0, 'unknown role dropped');

  const mappedUser = sanitizeInferenceMessages([{ role: 'user', content: ' hi ' }], {});
  assert(mappedUser[0].content === 'hi', 'user content trimmed');
}

async function testBuildExecutionPlanContractAndTools() {
  const { buildExecutionPlan } = require(path.join(root, 'electron/services/llm-execution-resolver.js'));

  const tools = [
    {
      type: 'function',
      function: { name: 'list_directory', description: 'x', parameters: { type: 'object', properties: {} } },
    },
  ];

  const plan = await buildExecutionPlan({
    endpoint: 'http://127.0.0.1:11434',
    makeRequest: makeShowRequest({
      'myorg/gpt-oss:20b': showData({ family: 'gpt-oss' }),
    }),
    payload: {
      model: 'myorg/gpt-oss:20b',
      traceId: 'trace_test_contract',
      runId: 'run_test_contract',
      messages: [{ role: 'user', content: 'Use the tool.' }],
      tools,
      options: { num_ctx: 4096 },
    },
    stream: false,
  });

  assert(plan.endpointMode === '/api/chat', 'GPT-OSS with tools must use native /api/chat');
  assert(plan.toolsAttached === true, 'tools should attach on native chat path');
  assert(plan.compatBlockedTools !== true, 'GPT-OSS native tool path must not be marked compatBlockedTools');
  assert(Array.isArray(plan.requestBody.tools) && plan.requestBody.tools.length === 1, 'requestBody carries tools');
  for (const field of requiredContractFields()) {
    assert(Object.prototype.hasOwnProperty.call(plan.executionContract, field), `contract field missing: ${field}`);
  }
  assert(plan.resolvedModel === plan.effectiveModel, 'resolvedModel canonical alias present');
  assert(plan.executionContract.resolvedModel === plan.resolvedModel, 'contract includes resolvedModel');
  assert(plan.executionContract.traceId === 'trace_test_contract', 'trace id propagated into contract');
}

async function testFamilyMatrix() {
  const { buildExecutionPlan, resolveModelCapabilityMatrix } = require(path.join(root, 'electron/services/llm-execution-resolver.js'));
  const tools = [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }];

  const gptPlain = await buildExecutionPlan({
    endpoint: 'http://127.0.0.1:11434',
    makeRequest: makeShowRequest({ 'gpt-oss:20b': showData({ family: 'gpt-oss' }) }),
    payload: { model: 'gpt-oss:20b', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert(gptPlain.endpointMode === '/api/generate', 'GPT-OSS plain chat compat allowed');

  const forcedCompat = await buildExecutionPlan({
    endpoint: 'http://127.0.0.1:11434',
    makeRequest: makeShowRequest({ 'gpt-oss:20b-force': showData({ family: 'gpt-oss' }) }),
    payload: { model: 'gpt-oss:20b-force', messages: [{ role: 'user', content: 'tool' }], tools, forceCompatMode: true },
  });
  assert(forcedCompat.endpointMode === '/api/generate', 'forced compat uses /api/generate');
  assert(forcedCompat.compatBlockedTools === true, 'forced compat blocks tools');

  const mistralNative = resolveModelCapabilityMatrix({
    model: 'devstral:latest',
    metadata: { family: 'mistral', templateMode: 'native_chat', capabilities: ['tools'] },
    hasToolsRequested: true,
  });
  assert(mistralNative.supportsNativeTools === true && mistralNative.preferredToolMode === 'native', 'Devstral/Mistral native when metadata supports tools');

  const gemma3 = resolveModelCapabilityMatrix({
    model: 'gemma3:latest',
    metadata: { family: 'gemma', templateMode: 'native_chat', capabilities: [] },
    hasToolsRequested: true,
  });
  assert(gemma3.supportsNativeTools === false && gemma3.fallbackReason === 'native_tools_unavailable', 'Gemma3 blocks tools without metadata capability');

  const gemma4 = resolveModelCapabilityMatrix({
    model: 'gemma4:latest',
    metadata: { family: 'gemma', templateMode: 'native_chat', capabilities: ['tools'] },
    hasToolsRequested: true,
  });
  assert(gemma4.supportsNativeTools === true && gemma4.thinkingPolicy === 'strip-between-turns', 'Gemma4 metadata tools and thinking policy');

  const rawUnknown = await buildExecutionPlan({
    endpoint: 'http://127.0.0.1:11434',
    makeRequest: makeShowRequest({
      'legacy-raw:latest': showData({ family: null, template: '{{ .Prompt }}', capabilities: [] }),
    }),
    payload: { model: 'legacy-raw:latest', messages: [{ role: 'user', content: 'tool' }], tools },
  });
  assert(rawUnknown.endpointMode === '/api/generate', 'unknown raw-template model uses compat');
  assert(rawUnknown.compatBlockedTools === true, 'unknown raw-template blocks native tools');
}

async function testOllamaBackendChatBody() {
  const OllamaBackend = require(path.join(root, 'electron/services/backends/ollama-backend.js'));
  const backend = new OllamaBackend({ useCuda: false, endpoint: 'http://127.0.0.1:11434' });
  let captured = null;
  backend._makeRequest = async (pth, opts) => {
    captured = { path: pth, body: opts.body };
    return { status: 200, data: { message: { content: 'ok' } } };
  };
  await backend.generate({
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    options: { num_predict: 2 },
    tools: [{ type: 'function', function: { name: 'f', arguments: '{}' } }],
  });
  assert(captured.path === '/api/chat', 'chat path for messages');
  assert(Array.isArray(captured.body.tools) && captured.body.tools.length === 1, 'tools on /api/chat body');

  captured = null;
  await backend.generate({
    model: 'm',
    prompt: 'p',
    system: 's',
    options: { num_predict: 2 },
    tools: [{ type: 'function', function: { name: 'f', arguments: '{}' } }],
  });
  assert(captured.path === '/api/generate', 'generate path without messages');
  assert(!captured.body.tools, 'tools must not appear on /api/generate');
}

function testStateMachineAndNoFakeSuccessSource() {
  const source = read('src/services/toolEnabledLLM.js');
  for (const state of [
    'resolving_model',
    'planning_execution',
    'sending_model_request',
    'awaiting_model_response',
    'tool_call_detected',
    'executing_tool',
    'tool_result_appended',
    'continuing_model_response',
    'completed',
    'failed',
    'fallback_to_text_tools',
  ]) {
    assert(source.includes(`'${state}'`), `state missing: ${state}`);
  }
  assert(source.includes('textClaimsToolInspection'), 'no-fake-success inspection guard present');
  assert(source.includes('fake_tool_success'), 'fake tool success failure code present');
  assert(source.includes('modelRespondedWithText'), 'tool-run status booleans present');
  assert(source.includes('repeated_invalid_tool_call'), 'repeated invalid tool call guard present');
}

async function main() {
  testProductionPathFreeze();
  testSanitizeInferenceMessages();
  await testBuildExecutionPlanContractAndTools();
  await testFamilyMatrix();
  await testOllamaBackendChatBody();
  testStateMachineAndNoFakeSuccessSource();
  console.log('inference-toolchain-smoke PASS');
}

main().catch((err) => {
  console.error('inference-toolchain-smoke FAIL:', err.message);
  process.exit(1);
});
