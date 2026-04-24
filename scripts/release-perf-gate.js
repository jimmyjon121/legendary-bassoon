#!/usr/bin/env node
/* eslint-disable no-console */

const { execSync } = require('child_process');

const checks = [
  { id: 'chat-stream', command: 'node scripts/perf-chat-stream.js' },
  { id: 'db-save', command: 'node scripts/perf-db-save.js' },
  { id: 'ui-polling', command: 'node scripts/perf-ui-polling.js' },
];

function runCheck(check) {
  process.stdout.write(`Running perf gate ${check.id}... `);
  try {
    const output = execSync(check.command, { stdio: 'pipe', encoding: 'utf-8' });
    const parsed = JSON.parse(output || '{}');
    if (!parsed.ok) {
      throw new Error(output || 'Check reported failure');
    }
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
    console.error('\nPerformance Gate FAILED');
    for (const failure of failed) {
      console.error(`- ${failure.id}: ${failure.output}`);
    }
    process.exit(1);
  }
  console.log('\nPerformance Gate PASS');
}

main();

