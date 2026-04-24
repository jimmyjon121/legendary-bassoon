#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Llamanode LIVE smoke.
 *
 * Verifies the LlamaNodeBackend instantiates, the native module loads,
 * and checkHealth reports available. Does NOT load a model (would require
 * a GGUF file). Intended as a fast first-boot check after npm install.
 *
 * Not added to release-gate because it requires the native module to be
 * present; release-gate stays static-analysis only.
 */

const LlamaNodeBackend = require('../electron/services/backends/llamanode-backend');

async function main() {
  const backend = new LlamaNodeBackend({
    id: 'llamanode-test',
    name: 'llama.cpp (smoke test)',
    device: 'cpu',
    useGpu: false,
  });

  const health = await backend.checkHealth();
  console.log('[smoke] checkHealth:', JSON.stringify(health, null, 2));

  if (!health.available) {
    console.error('[smoke] FAIL — backend reports unavailable');
    process.exit(1);
  }

  console.log('[smoke] PASS — node-llama-cpp loaded and backend is healthy');
}

main().catch((err) => {
  console.error('[smoke] ERROR:', err?.message || err);
  process.exit(1);
});
