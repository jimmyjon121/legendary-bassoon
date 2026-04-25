#!/usr/bin/env node
/* eslint-disable no-console */

const {
  buildOptionsWithState,
  evaluateSessionStore,
} = require('./test-utils/buildOptionsHarness');

function assert(condition, description, failures) {
  if (!condition) failures.push(description);
}

async function main() {
  const failures = [];

  const sessionWins = await buildOptionsWithState({
    sessionState: { backendOverride: 'openvino-npu' },
    presets: [{ is_default: true, device_pin: 'ollama-cuda' }],
  });
  assert(
    sessionWins.forceBackend === 'openvino-npu',
    `session backendOverride should win over preset device_pin (got ${sessionWins.forceBackend})`,
    failures,
  );

  const presetOnly = await buildOptionsWithState({
    sessionState: { backendOverride: null },
    presets: [{ is_default: true, device_pin: 'ollama-cuda' }],
  });
  assert(
    presetOnly.forceBackend === 'ollama-cuda',
    `preset device_pin should set forceBackend when session override is absent (got ${presetOnly.forceBackend})`,
    failures,
  );

  const neither = await buildOptionsWithState({
    sessionState: { backendOverride: null },
    presets: [{ is_default: true }],
  });
  assert(
    !Object.prototype.hasOwnProperty.call(neither, 'forceBackend'),
    'forceBackend should be absent when neither preset nor session supplies it',
    failures,
  );

  const { useChatV2SessionStore } = evaluateSessionStore();
  useChatV2SessionStore.getState().setBackendOverride('not-a-real-backend');
  assert(
    useChatV2SessionStore.getState().backendOverride == null,
    'chatV2SessionStore.setBackendOverride must reject invalid backend ids',
    failures,
  );

  const invalidRejected = await buildOptionsWithState({
    sessionState: {
      backendOverride: useChatV2SessionStore.getState().backendOverride,
    },
    presets: [{ is_default: true }],
  });
  assert(
    !Object.prototype.hasOwnProperty.call(invalidRejected, 'forceBackend'),
    'invalid rejected backendOverride must not become forceBackend',
    failures,
  );

  if (failures.length) {
    console.error('autonomy-build-options-smoke FAILED');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('autonomy-build-options-smoke PASS');
}

main().catch((error) => {
  console.error(`autonomy-build-options-smoke FAILED: ${error?.message || error}`);
  process.exit(1);
});
