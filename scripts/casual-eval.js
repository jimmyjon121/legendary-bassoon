#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function read(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function assertContains(haystack, needle, description, failures) {
  if (!haystack.includes(needle)) {
    failures.push(description);
  }
}

function main() {
  const failures = [];
  const messageSlice = read('src/stores/slices/messageSlice.js');

  assertContains(
    messageSlice,
    "(currentWorkspace === 'research' || currentWorkspace === 'casual' || currentWorkspace === 'work')",
    'Message generation must support web search gating for research/casual/work',
    failures
  );
  assertContains(
    messageSlice,
    'guardrailMetrics:',
    'Message slice must expose structured guardrail metrics state',
    failures
  );
  assertContains(
    messageSlice,
    'recordGuardrailEvent: (event = {}) =>',
    'Message slice must track guardrail events with typed metadata',
    failures
  );
  assertContains(
    messageSlice,
    'cleanupResponse(fullResponse)',
    'Stream completion must apply cleanup to model output',
    failures
  );
  assertContains(
    messageSlice,
    "I couldn't generate a response. Please try again.",
    'Empty response must produce a simple user-facing fallback',
    failures
  );
  assertContains(
    messageSlice,
    'final_empty_fallback',
    'Message generation must emit fallback reason codes when output is empty',
    failures
  );

  if (failures.length > 0) {
    console.error('Casual Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Casual Eval PASS');
}

main();
