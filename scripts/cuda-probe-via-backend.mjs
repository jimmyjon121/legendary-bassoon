// End-to-end probe: instantiate LlamaNodeBackend with useGpu=true and
// verify it reports CUDA. This is what the orchestrator does at runtime
// for real chat turns; if this passes, the spec-decode verifier path
// will get CUDA on its in-process verifier.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const LlamaNodeBackend = require('../electron/services/backends/llamanode-backend.js');

const backend = new LlamaNodeBackend({
  id: 'llamanode-cuda-probe',
  name: 'llama.cpp (CUDA probe)',
  useGpu: true,
});

const health = await backend.checkHealth();
console.log(JSON.stringify(health, null, 2));
if (!health.available) {
  console.error('FAILED: backend not available');
  process.exit(1);
}
if (health.gpu !== 'cuda') {
  console.error(`FAILED: expected gpu='cuda', got '${health.gpu}'`);
  process.exit(1);
}
console.log('PASS: llamanode is on CUDA via auto-injected toolkit path');
