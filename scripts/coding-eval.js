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
  const llm = read('src/services/toolEnabledLLM.js');
  const codeToolsIpc = read('electron/ipc/code-tools-handlers.js');
  const safetyProtocol = read('src/services/agents/safetyProtocol.js');
  const codeChatPanel = read('src/components/Code/CodeChatPanel.jsx');

  assertContains(
    llm,
    "const NETWORK_POLICY_OFFLINE = 'offline';",
    'ToolEnabledLLM must define offline network policy',
    failures
  );
  assertContains(
    llm,
    'this.maxToolSteps',
    'ToolEnabledLLM must enforce maxToolSteps',
    failures
  );
  assertContains(
    codeToolsIpc,
    'scoreCommandRisk',
    'Code tools IPC must include command risk scoring',
    failures
  );
  assertContains(
    codeToolsIpc,
    "ipcMain.handle('tool:rollbackCheckpoint'",
    'Code tools IPC must expose rollback checkpoint handler',
    failures
  );
  assertContains(
    safetyProtocol,
    'api.toolRollbackCheckpoint',
    'Safety protocol must call rollback checkpoint',
    failures
  );
  assertContains(
    codeChatPanel,
    "networkPolicy: 'offline'",
    'Code chat agent must run with offline policy',
    failures
  );

  if (failures.length > 0) {
    console.error('Coding Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Coding Eval PASS');
}

main();
