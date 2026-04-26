#!/usr/bin/env node
/* eslint-disable no-console */

const { execSync } = require('child_process');

const checks = [
  { id: 'research', command: 'node scripts/research-eval.js' },
  { id: 'casual', command: 'node scripts/casual-eval.js' },
  { id: 'coding', command: 'node scripts/coding-eval.js' },
  { id: 'chat-v2', command: 'node scripts/chat-v2-eval.js' },
  { id: 'perf', command: 'node scripts/release-perf-gate.js' },
  { id: 'model-hub', command: 'node scripts/model-hub-eval.js' },
  { id: 'ipc-security', command: 'node scripts/ipc-security-eval.js' },
  { id: 'normal-mode', command: 'node scripts/normal-mode-eval.js' },
  { id: 'long-context', command: 'node scripts/long-context-eval.js' },
  { id: 'mode-switch', command: 'node scripts/mode-switch-smoke.js' },
  { id: 'llamanode', command: 'node scripts/llamanode-smoke.js' },
  { id: 'tiered-utilization', command: 'node scripts/tiered-utilization-smoke.js' },
  { id: 'draft-selector', command: 'node scripts/draft-selector-smoke.js' },
  { id: 'npu-draft', command: 'node scripts/npu-draft-smoke.js' },
  { id: 'spec-verifier', command: 'node scripts/spec-verifier-smoke.js' },
  { id: 'spec-bus', command: 'node scripts/spec-bus-smoke.js' },
  { id: 'spec-dashboard', command: 'node scripts/spec-dashboard-smoke.js' },
  {
    id: 'spec-decoding',
    command: 'node scripts/speculative-decoding-eval.js',
    env: {
      DEVFORGE_SPEC_EVAL_MODE: 'static',
      DEVFORGE_SPEC_DECODE_ENABLE: '',
      DEVFORGE_SPEC_DRAFTER: '',
    },
  },
  { id: 'preset-system-prompt', command: 'node scripts/preset-system-prompt-smoke.js' },
  { id: 'spec-decode-residency', command: 'node scripts/spec-decode-residency-smoke.js' },
  { id: 'cuda-verifier-guard', command: 'node scripts/cuda-verifier-guard-smoke.js' },
  { id: 'autonomy-routing', command: 'node scripts/autonomy-routing-smoke.js' },
  { id: 'autonomy-build-options', command: 'node scripts/autonomy-build-options-smoke.js' },
  { id: 'autonomy-orchestrator-route', command: 'node scripts/autonomy-orchestrator-route-smoke.js' },
  { id: 'mosaic-gate1', command: 'node scripts/mosaic-gate1-smoke.js' },
];

function runCheck(check) {
  process.stdout.write(`Running ${check.id} gate... `);
  try {
    execSync(check.command, {
      stdio: 'pipe',
      env: { ...process.env, ...(check.env || {}) },
    });
    console.log('PASS');
    return { id: check.id, ok: true };
  } catch (error) {
    console.log('FAIL');
    const stderr = String(error?.stderr || '').trim();
    const stdout = String(error?.stdout || '').trim();
    const output = stderr || stdout || String(error?.message || 'Unknown failure');
    return { id: check.id, ok: false, output };
  }
}

function main() {
  const results = checks.map(runCheck);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error('\nRelease Gate FAILED');
    for (const failure of failed) {
      console.error(`- ${failure.id}: ${failure.output}`);
    }
    process.exit(1);
  }
  console.log('\nRelease Gate PASS');
}

main();
