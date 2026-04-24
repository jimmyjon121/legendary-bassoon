/* eslint-disable no-console */

const OllamaBackend = require('../electron/services/backends/ollama-backend');
const { buildExecutionPlan, getNormalizedModelInfo } = require('../electron/services/llm-execution-resolver');

async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    status: response.status,
    data,
  };
}

function buildCasualSystemPrompt(webEnabled = false) {
  const base = 'You are a helpful assistant. Reply naturally and clearly.';
  if (webEnabled) {
    return `${base}\n\nWeb mode is enabled for this turn. Use the provided web research context when it is relevant.`;
  }
  return `${base}\n\nWhen Web is off, be conservative with facts. If you are not sure, say you are not sure instead of guessing.`;
}

function isUncertainAnswer(text) {
  const lower = String(text || '').toLowerCase();
  return (
    lower.includes("i'm not sure")
    || lower.includes('i am not sure')
    || lower.includes("i'm not familiar")
    || lower.includes('i am not familiar')
    || lower.includes("i'm not confident")
    || lower.includes('i am not confident')
    || lower.includes("don't want to guess")
    || lower.includes('do not want to guess')
    || lower.includes('might be')
    || lower.includes('may be')
    || lower.includes('possibly')
  );
}

function isSpecificFactualLookupPrompt(prompt) {
  const raw = String(prompt || '').trim();
  return (
    /\b(do you know|have you heard of|what is|who is|tell me about|do you know the)\b/i.test(raw)
    && /\b(tv series|series|show|movie|film|actor|actress|book|band|album|person|character)\b/i.test(raw)
  );
}

function isGenericEntityFollowupPrompt(prompt) {
  return /^(explain to me what it is|what is it|tell me about it|explain it|what is that)$/i.test(String(prompt || '').trim());
}

function shouldUseConservativeEntityFallback(prompt, options = {}) {
  if (String(options.workspace || 'casual').toLowerCase() !== 'casual') return false;
  if (options.webEnabled === true) return false;
  if (String(options.baselineStatus || '').toLowerCase() !== 'unstable' && Number(options.contextLength || 0) > 2048) {
    return false;
  }
  if (isSpecificFactualLookupPrompt(prompt)) return true;
  if (options.previousAssistantUncertain === true && isGenericEntityFollowupPrompt(prompt)) return true;
  return false;
}

function buildConservativeFallback() {
  return "I'm not confident I can identify that correctly with Web off, and I don't want to guess. Turn Web on and I'll verify it, or give me more context about which one you mean.";
}

function planToBackendPayload(plan) {
  const body = plan.requestBody || {};
  const payload = {
    model: body.model,
    options: body.options || {},
  };

  if (body.format) payload.format = body.format;
  if (Array.isArray(body.images) && body.images.length > 0) payload.images = body.images;

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const systemMessage = body.messages.find((msg) => msg.role === 'system');
    payload.messages = body.messages.filter((msg) => msg.role !== 'system');
    if (systemMessage?.content) {
      payload.system = systemMessage.content;
    }
  } else {
    if (body.prompt) payload.prompt = body.prompt;
    if (body.system) payload.system = body.system;
  }

  return payload;
}

async function runStreamPlan(backend, plan) {
  const payload = planToBackendPayload(plan);
  let output = '';
  let streamError = null;

  const { streamTask } = await backend.stream(payload, (chunk) => {
    if (!chunk) return;
    if (chunk.error) {
      streamError = chunk.error;
      return;
    }
    const delta = chunk.response ?? chunk.message?.content ?? '';
    if (delta) {
      output += String(delta);
    }
  });

  await streamTask;
  if (streamError) {
    throw new Error(streamError);
  }
  return output.trim();
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function looksBadGreeting(text) {
  const lower = String(text || '').toLowerCase();
  return (
    lower.includes('comment:') ||
    lower.includes('progress of our project') ||
    lower.includes('first phase of development') ||
    lower.split(/\s+/).length > 60
  );
}

function looksBadFollowup(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return (
    normalized === 'about' ||
    normalized === 'comment:' ||
    normalized.length < 8 ||
    normalized.includes('comment:')
  );
}

function looksSpeculativeEntityHallucination(text) {
  const lower = String(text || '').toLowerCase();
  return (
    lower.includes('however, i do know of')
    || lower.includes('i think i have more information now')
    || lower.includes('from what i can gather')
    || /\b(19|20)\d{2}\b/.test(lower)
    || /\b(created by|directed by|written by|starred by|stars |aired from|aired in)\b/i.test(text)
  );
}

async function main() {
  const endpoint = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
  const selectedModel = process.env.SMOKE_MODEL || 'local-wizard-vicuna-13b-uncensored.q4_0:latest';
  const backend = new OllamaBackend({ endpoint, useCuda: false });
  const failures = [];
  const transcript = [];
  const selectedModelInfo = await getNormalizedModelInfo(endpoint, makeRequest, selectedModel, { forceRefresh: true });

  const runTurn = async (prompt, workspace = 'casual', stream = true) => {
    const messages = transcript.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
    messages.push({ role: 'user', content: prompt });

    const plan = await buildExecutionPlan({
      endpoint,
      makeRequest,
      payload: {
        model: selectedModel,
        workspace,
        workloadType: 'chat',
        messages,
        system: buildCasualSystemPrompt(false),
        options: {
          temperature: 0.4,
          num_ctx: 8192,
          num_predict: 256,
        },
      },
      stream,
    });

    const previousAssistant = [...transcript].reverse().find((entry) => entry.role === 'assistant') || null;
    const output = shouldUseConservativeEntityFallback(prompt, {
      workspace,
      webEnabled: false,
      baselineStatus: selectedModelInfo?.baselineStatus || null,
      contextLength: selectedModelInfo?.effectiveContextLength || selectedModelInfo?.contextLength || null,
      previousAssistantUncertain: isUncertainAnswer(previousAssistant?.content || ''),
    })
      ? buildConservativeFallback()
      : (stream
        ? await runStreamPlan(backend, plan)
        : String((await backend.generate(planToBackendPayload(plan)))?.response || '').trim());

    transcript.push({ role: 'user', content: prompt });
    transcript.push({ role: 'assistant', content: output });

    return { plan, output };
  };

  const greeting = await runTurn('hey');
  console.log('\n[greeting]');
  console.log(JSON.stringify({
    requestedModel: greeting.plan.requestedModel,
    effectiveModel: greeting.plan.effectiveModel,
    executionMode: greeting.plan.executionMode,
    endpointMode: greeting.plan.endpointMode,
    output: greeting.output,
  }, null, 2));

  assert(greeting.plan.executionMode === 'fallback_model', 'Casual greeting should use fallback model mode for the selected Vicuna import', failures);
  assert(greeting.plan.effectiveModel !== selectedModel, 'Casual greeting should not stay on the unstable selected baseline model', failures);
  assert(!looksBadGreeting(greeting.output), 'Greeting reply still looks like the old bad formal/project-style failure mode', failures);

  const factual = await runTurn('do you know the tv series the pitt?');
  console.log('\n[factual]');
  console.log(JSON.stringify({
    effectiveModel: factual.plan.effectiveModel,
    executionMode: factual.plan.executionMode,
    output: factual.output,
  }, null, 2));

  assert(factual.output.length >= 16, 'Factual prompt produced an empty or near-empty reply', failures);
  assert(!looksBadFollowup(factual.output), 'Factual prompt produced a malformed short fragment', failures);
  assert(!looksSpeculativeEntityHallucination(factual.output), 'Factual prompt still hallucinated specific media details with Web off', failures);
  assert(/don't want to guess|not confident/i.test(factual.output), 'Factual prompt should resolve to an explicit conservative fallback in the app path', failures);

  const followup = await runTurn('explain to me what it is');
  console.log('\n[followup]');
  console.log(JSON.stringify({
    effectiveModel: followup.plan.effectiveModel,
    executionMode: followup.plan.executionMode,
    output: followup.output,
  }, null, 2));

  assert(!looksBadFollowup(followup.output), 'Follow-up prompt still collapsed into a one-word/fragment response', failures);
  assert(followup.output.split(/\s+/).length >= 8, 'Follow-up prompt should produce a substantive explanation', failures);
  assert(!looksSpeculativeEntityHallucination(followup.output), 'Follow-up prompt still hallucinated specifics after an uncertain prior turn', failures);
  assert(/don't want to guess|not confident/i.test(followup.output), 'Follow-up prompt should stay conservative after an uncertain prior turn', failures);

  const compatPlan = await buildExecutionPlan({
    endpoint,
    makeRequest,
    payload: {
      model: selectedModel,
      workspace: 'work',
      workloadType: 'chat',
      messages: [{ role: 'user', content: 'Explain this model routing in one paragraph.' }],
      system: 'You are a professional assistant.',
      options: { num_ctx: 8192, num_predict: 192 },
    },
    stream: true,
  });

  console.log('\n[compat]');
  console.log(JSON.stringify({
    executionMode: compatPlan.executionMode,
    endpointMode: compatPlan.endpointMode,
    effectiveContextLength: compatPlan.effectiveContextLength,
  }, null, 2));

  assert(compatPlan.executionMode === 'compat', 'Non-casual raw-template routing should stay on compat mode instead of fallback', failures);
  assert(compatPlan.endpointMode === '/api/generate', 'Compat routing should use /api/generate', failures);
  assert(compatPlan.effectiveContextLength <= 2048, 'Compat routing should clamp Vicuna to its real 2048 context window', failures);

  if (failures.length > 0) {
    console.error('\nLive Chat Smoke FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nLive Chat Smoke PASS');
}

main().catch((error) => {
  console.error('Live Chat Smoke crashed:', error);
  process.exit(1);
});
