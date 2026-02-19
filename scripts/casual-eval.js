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
  const chatArea = read('src/components/Chat/ChatArea.jsx');
  const smartInput = read('src/components/Chat/SmartInput.jsx');
  const messageSlice = read('src/stores/slices/messageSlice.js');

  assertContains(
    chatArea,
    "const canUseWebSearch = currentWorkspace === 'research';",
    'ChatArea must gate web search toggle to research workspace',
    failures
  );
  assertContains(
    smartInput,
    "const canUseWebSearch = currentWorkspace === 'research';",
    'SmartInput must gate web search toggle to research workspace',
    failures
  );
  assertContains(
    messageSlice,
    "const canUseWebSearch = currentWorkspace === 'research'",
    'Message generation must enforce research-only web search',
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
