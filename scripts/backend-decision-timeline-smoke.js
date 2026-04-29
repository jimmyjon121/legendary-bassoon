#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  createModelLoadConfidence,
  TIMELINE_EVENT_TYPES,
} = require(path.join(ROOT, 'electron/services/model-load-confidence'));
const resolver = require(path.join(ROOT, 'electron/services/model-experience-resolver'));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function createFakeDb() {
  const tables = {
    decisions: [],
    outcomes: [],
  };
  return {
    tables,
    run(sql, params = []) {
      if (/INSERT INTO model_backend_decisions/i.test(sql)) {
        tables.decisions.push({
          id: params[0],
          model: params[1],
          workspace: params[2],
          event_type: params[3],
          backend: params[4],
          status: params[5],
          reason: params[6],
          options_json: params[7],
          created_at: params[8],
        });
      }
      if (/INSERT INTO model_load_outcomes/i.test(sql)) {
        tables.outcomes.push({
          id: params[0],
          model: params[1],
          workspace: params[2],
          outcome: params[3],
          source: params[4],
          backend: params[5],
          context: params[6],
          batch: params[7],
          kv_cache_type: params[8],
          num_predict: params[9],
          first_token_ms: params[10],
          tokens_per_second: params[11],
          error: params[12],
          options_json: params[13],
          created_at: params[14],
        });
      }
    },
    exec(sql, params = []) {
      const [model, workspace] = params;
      if (/FROM model_backend_decisions/i.test(sql)) {
        const values = tables.decisions
          .filter((row) => row.model === model && (!row.workspace || row.workspace === workspace))
          .slice()
          .reverse()
          .map((row) => [
            row.id,
            row.model,
            row.workspace,
            row.event_type,
            row.backend,
            row.status,
            row.reason,
            row.options_json,
            row.created_at,
          ]);
        return values.length ? [{ values }] : [];
      }
      if (/FROM model_load_outcomes/i.test(sql) && /outcome = 'success'/i.test(sql)) {
        const values = tables.outcomes
          .filter((row) => row.model === model && (!row.workspace || row.workspace === workspace) && row.outcome === 'success')
          .slice()
          .reverse()
          .map((row) => [
            row.id,
            row.model,
            row.workspace,
            row.source,
            row.backend,
            row.context,
            row.batch,
            row.kv_cache_type,
            row.num_predict,
            row.first_token_ms,
            row.tokens_per_second,
            row.options_json,
            row.created_at,
          ]);
        return values.length ? [{ values: values.slice(0, 1) }] : [];
      }
      if (/FROM model_load_outcomes/i.test(sql) && /outcome = 'failed'/i.test(sql)) {
        const values = tables.outcomes
          .filter((row) => row.model === model && (!row.workspace || row.workspace === workspace) && row.outcome === 'failed')
          .slice()
          .reverse()
          .map((row) => [row.backend, row.error, row.created_at]);
        return values.length ? [{ values }] : [];
      }
      if (/FROM model_load_outcomes/i.test(sql)) {
        const values = tables.outcomes
          .filter((row) => row.model === model && (!row.workspace || row.workspace === workspace))
          .slice()
          .reverse()
          .map((row) => [row.outcome, row.first_token_ms, row.tokens_per_second, row.created_at]);
        return values.length ? [{ values }] : [];
      }
      return [];
    },
  };
}

function main() {
  const failures = [];
  const fakeDb = createFakeDb();
  let saved = 0;
  const service = createModelLoadConfidence({
    getDb: () => fakeDb,
    saveDatabase: () => { saved += 1; },
  });

  const missingDecisionModel = service.recordBackendDecision({ eventType: 'autopilot_plan' });
  assert(missingDecisionModel.success === false, 'timeline recording must require a model', failures);

  const model = 'qwen2.5:7b';
  service.recordBackendDecision({
    model,
    workspace: 'casual',
    eventType: 'autopilot_plan',
    backend: 'ollama-cuda',
    status: 'info',
    reason: 'Autopilot chose chat route.',
    options: { num_ctx: 8192, num_batch: 128, script: 'ignored' },
  });
  service.recordBackendDecision({
    model,
    workspace: 'casual',
    eventType: 'generation_succeeded',
    backend: 'ollama-cuda',
    status: 'success',
    reason: 'Generation completed.',
  });
  assert(saved >= 2, 'timeline recording must persist through saveDatabase', failures);

  const timeline = service.getBackendDecisionTimeline({ model, workspace: 'casual', limit: 5 });
  assert(timeline.length === 2, 'timeline query must return recorded decisions', failures);
  assert(timeline[0].eventType === 'generation_succeeded', 'timeline must return newest decision first', failures);
  assert(!Object.prototype.hasOwnProperty.call(timeline[1].options, 'script'), 'timeline options must be sanitized', failures);

  service.recordLoadOutcome({
    model,
    workspace: 'casual',
    success: true,
    source: 'chat-generation',
    backend: 'llamanode',
    context: 4096,
    batch: 64,
    kvCacheType: 'q4_0',
    numPredict: 768,
    options: { num_ctx: 4096, num_batch: 64, kv_cache_type: 'q4_0', num_predict: 768 },
  });
  service.recordLoadOutcome({ model, workspace: 'casual', success: false, backend: 'openvino-npu', error: 'load failed' });
  service.recordLoadOutcome({ model, workspace: 'casual', success: false, backend: 'openvino-npu', error: 'load failed again' });

  const confidence = service.resolveLoadConfidence({
    model,
    workspace: 'casual',
    runtimeState: { currentBackend: { id: 'ollama-cuda' } },
    effectiveOptions: { num_ctx: 8192, num_batch: 128 },
  });
  assert(Array.isArray(confidence.timeline) && confidence.timeline.length >= 2, 'load confidence must include recent timeline rows', failures);
  assert(Array.isArray(confidence.failureMemory) && confidence.failureMemory[0]?.backend === 'openvino-npu', 'repeated backend failures must surface as failure memory', failures);
  assert(confidence.warnings.some((warning) => /failed 2 recent times/i.test(warning)), 'repeated backend failures must produce confidence warnings', failures);
  assert(confidence.suggestedActions.includes('auto_fallback'), 'failure memory must suggest Auto fallback', failures);

  const lastGoodPlan = resolver.resolveModelExperiencePlan({
    model,
    workspace: 'casual',
    lastKnownGood: {
      backend: 'llamanode',
      context: 4096,
      batch: 64,
      kvCacheType: 'q4_0',
      numPredict: 768,
    },
  });
  assert(lastGoodPlan.plan?.softBackendPreference === 'llamanode', 'last-good backend must become a soft backend hint', failures);
  assert(lastGoodPlan.plan?.effectiveOptions?.num_ctx <= 4096, 'last-good context must lower auto context when no explicit override exists', failures);
  assert(lastGoodPlan.plan?.overrideTrace?.includes('last-good-soft-hint'), 'last-good option use must be visible in override trace', failures);
  assert(lastGoodPlan.plan?.overrideTrace?.includes('last-good-backend-soft-hint'), 'last-good backend use must be visible in override trace', failures);
  assert(lastGoodPlan.plan?.lastGoodHint?.backend === 'llamanode', 'plan must expose sanitized last-good hint metadata', failures);

  const explicitBackendPlan = resolver.resolveModelExperiencePlan({
    model,
    workspace: 'casual',
    session: { backendOverride: 'openvino-npu' },
    lastKnownGood: { backend: 'llamanode', context: 4096 },
  });
  assert(explicitBackendPlan.plan?.explicitBackendPin === 'openvino-npu', 'explicit session backend must still win', failures);
  assert(explicitBackendPlan.plan?.softBackendPreference === null, 'last-good must not set soft backend when an explicit pin exists', failures);

  const presetPlan = resolver.resolveModelExperiencePlan({
    model,
    workspace: 'casual',
    preset: { context_length: 16384, advanced_options: { num_batch: 256 } },
    lastKnownGood: { backend: 'llamanode', context: 4096, batch: 64 },
  });
  assert(presetPlan.plan?.effectiveOptions?.num_ctx === 16384, 'stored preset context must win over last-good context', failures);
  assert(presetPlan.plan?.effectiveOptions?.num_batch === 256, 'stored preset advanced batch must win over last-good batch', failures);

  const serviceSource = read('electron/services/model-load-confidence.js');
  const resolverSource = read('electron/services/model-experience-resolver.js');
  const ipcSource = read('electron/ipc-handlers.js');
  const preloadSource = read('electron/preload.js');
  const apiSource = read('src/utils/electronAPI.js');
  const buildOptionsSource = read('src/chat-v2/runtime/buildInferenceOptions.js');
  const surfaceSource = read('src/chat-v2/ui/ChatV2Surface.jsx');
  const releaseGate = read('scripts/release-gate.js');

  ['autopilot_plan', 'last_good_found', 'last_good_applied', 'safe_fit_applied', 'generation_failed'].forEach((eventType) => {
    assert(TIMELINE_EVENT_TYPES.has(eventType), `timeline event allow-list must include ${eventType}`, failures);
  });
  assert(serviceSource.includes('model_backend_decisions')
    && serviceSource.includes('recordBackendDecision')
    && serviceSource.includes('getBackendDecisionTimeline')
    && serviceSource.includes('getBackendFailureMemory'),
  'model-load-confidence service must own timeline and failure memory', failures);
  assert(resolverSource.includes('last-good-soft-hint')
    && resolverSource.includes('last-good-backend-soft-hint')
    && resolverSource.includes('lastGoodHint'),
  'Autopilot resolver must expose last-good soft hints in trace metadata', failures);
  assert(!resolverSource.includes('DEVFORGE_SPEC_DECODE_ENABLE'), 'last-good hints must not enable speculative decoding', failures);
  assert(!resolver.ALLOWED_BACKENDS.has('mosaic'), 'last-good backend hints must not allow Mosaic in normal Autopilot', failures);
  ['model:recordBackendDecision', 'model:getBackendDecisionTimeline'].forEach((channel) => {
    assert(ipcSource.includes(channel), `IPC must expose ${channel}`, failures);
  });
  assert(ipcSource.includes('sanitizeBackendDecisionPayload'), 'IPC must sanitize backend decision payloads', failures);
  assert(preloadSource.includes('recordBackendDecision') && preloadSource.includes('getBackendDecisionTimeline'), 'preload must bridge timeline methods', failures);
  assert(apiSource.includes('recordBackendDecision') && apiSource.includes('getBackendDecisionTimeline'), 'renderer API must expose timeline helpers', failures);
  assert(buildOptionsSource.includes('getLastKnownGoodModelLoad') && buildOptionsSource.includes('lastKnownGood'), 'Chat V2 option builder must pass last-good to Autopilot', failures);
  assert(surfaceSource.includes('Backend Decision Timeline')
    && surfaceSource.includes('backendDecisionTimeline')
    && surfaceSource.includes('handleUseLastGood')
    && surfaceSource.includes('Use Last Good')
    && surfaceSource.includes('recordBackendDecision')
    && surfaceSource.includes('Failure Memory'),
  'Chat V2 must render timeline, Use Last Good, and failure memory', failures);
  assert(releaseGate.includes('backend-decision-timeline'), 'release gate must include backend-decision-timeline smoke', failures);

  if (failures.length) {
    console.error('backend-decision-timeline-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('backend-decision-timeline-smoke PASS');
}

main();
