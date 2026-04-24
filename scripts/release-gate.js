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
];

function runCheck(check) {
  process.stdout.write(`Running ${check.id} gate... `);
  try {
    execSync(check.command, { stdio: 'pipe' });
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
