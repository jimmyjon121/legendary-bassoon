#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {
  ALPHA_READINESS_SCHEMA_VERSION,
  createAlphaReadiness,
} = require('../electron/services/alpha-readiness.js');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function runNodeScript(relativePath) {
  execFileSync(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'pipe',
  });
}

const pkg = JSON.parse(read('package.json'));
const alphaReadme = read('ALPHA_README.md');
assert.equal(pkg.build?.productName, 'Anvil', 'paid alpha package productName should be Anvil');
assert.equal(pkg.build?.nsis?.shortcutName, 'Anvil', 'paid alpha installer shortcut should be Anvil');
assert.equal(typeof pkg.version, 'string', 'package version should be readable');
assert.equal(pkg.scripts?.['eval:alpha-ship'], 'node scripts/alpha-ship-smoke.mjs', 'package should expose eval:alpha-ship');

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-alpha-readiness-'));
const readiness = await createAlphaReadiness({
  db: { exec: () => [{ values: [[1]] }] },
  devforgeHandoff: {
    getStatus: () => ({
      launcherAvailable: true,
      launcher: '/tmp/devforge',
      checkoutRoot: '/tmp/devforge-vscode/upstream',
      detectedUrlProtocol: 'anvil',
    }),
  },
  getAppVersion: () => pkg.version,
  homeDir: fakeHome,
  isPackaged: false,
  packageJsonPath: path.join(repoRoot, 'package.json'),
  fetchJson: async () => ({
    status: 200,
    data: { models: [{ name: 'qwen2.5-coder:latest' }] },
  }),
  store: {
    get(key) {
      if (key === 'currentModel') return 'qwen2.5-coder:latest';
      if (key === 'llmEndpoint') return 'http://127.0.0.1:11434';
      return undefined;
    },
  },
}).getReadiness({ currentWorkspace: 'code', projectPath: repoRoot });

assert.equal(readiness.schemaVersion, ALPHA_READINESS_SCHEMA_VERSION, 'readiness schema should be versioned');
assert.equal(readiness.product.name, 'Anvil', 'readiness product name should be Anvil');
assert.equal(readiness.product.artifact, 'Anvil Hub', 'readiness artifact should be Anvil Hub');
assert.ok(['ready', 'degraded', 'needs_setup'].includes(readiness.status), 'readiness status should be structured');
assert.ok(Array.isArray(readiness.checks), 'readiness checks should be an array');
assert.ok(alphaReadme.includes('Anvil paid alpha is the hub app'), 'alpha README should explain paid artifact');
assert.ok(alphaReadme.includes('DevForge IDE is the optional deep-coding companion'), 'alpha README should explain DevForge boundary');
assert.ok(alphaReadme.includes('must not store raw prompts'), 'alpha README should document privacy boundary');
assert.ok(readiness.checks.some((check) => check.id === 'selected_model'), 'readiness should include selected model status');
assert.ok(readiness.checks.some((check) => check.id === 'local_model_runtime'), 'readiness should include local model runtime status');
assert.ok(readiness.checks.some((check) => check.id === 'devforge_handoff'), 'readiness should include DevForge handoff status');
assert.ok(readiness.checks.some((check) => check.id === 'storage'), 'readiness should include storage status');

const missingModel = await createAlphaReadiness({
  db: null,
  devforgeHandoff: { getStatus: () => ({ launcherAvailable: false, checkoutRoot: '/missing' }) },
  homeDir: fakeHome,
  packageJsonPath: path.join(repoRoot, 'package.json'),
  fetchJson: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
  },
  store: { get: () => null },
}).getReadiness({ currentWorkspace: 'nsfw' });
assert.equal(missingModel.status, 'needs_setup', 'missing selected model/storage should require setup');
assert.ok(
  missingModel.checks.some((check) => check.id === 'selected_model' && check.action?.includes('model picker')),
  'missing model check should include actionable setup guidance',
);
assert.ok(
  missingModel.checks.some((check) => check.id === 'local_model_runtime' && check.action?.includes('Start Ollama')),
  'unavailable Ollama should include Start Ollama guidance',
);
assert.ok(
  missingModel.checks.some((check) => check.id === 'policy' && check.message.includes('Vault')),
  'Vault workspace should surface Vault policy status',
);

const codeWorkbench = read('src/components/Code/CodeWorkbench.jsx');
const codeEditor = read('src/components/Code/CodeEditor.jsx');
const codeChatPanel = read('src/components/Code/CodeChatPanel.jsx');
const sidebar = read('src/components/Sidebar/Sidebar.jsx');
const layout = read('src/components/Layout/Layout.jsx');
const preload = read('electron/preload.js');
const ipcHandlers = read('electron/ipc-handlers.js');
const releaseGate = read('scripts/release-gate.js');

assert.ok(codeEditor.includes('Quick Code Workspace'), 'empty Code editor should identify quick workspace scope');
assert.ok(codeEditor.includes('Open Full DevForge IDE'), 'empty Code editor should expose full IDE handoff');
assert.ok(codeWorkbench.includes('Paid alpha scope'), 'Code workbench should show alpha scope guardrail');
assert.ok(!codeWorkbench.includes('TeammateToolbar'), 'Code workbench should not render fake teammate toolbar actions in alpha');
assert.ok(!codeChatPanel.includes("label: 'Refactor'"), 'alpha quick actions should not imply direct refactor execution');
assert.ok(!codeChatPanel.includes("label: 'Write Tests'"), 'alpha quick actions should not imply direct test writing execution');
assert.ok(!codeChatPanel.includes("label: 'Document'"), 'alpha quick actions should not imply direct documentation edits');
assert.ok(sidebar.includes('getAlphaReadiness'), 'sidebar should consume alpha readiness');
assert.ok(sidebar.includes('Paid alpha readiness'), 'sidebar should expose paid alpha readiness surface');
assert.ok(layout.includes('alphaReadiness'), 'title bar should consume alpha readiness');
assert.ok(layout.includes('Alpha Ready'), 'title bar should expose alpha readiness status');
assert.ok(preload.includes('alpha:getReadiness'), 'preload should expose alpha readiness IPC');
assert.ok(ipcHandlers.includes("ipcMain.handle('alpha:getReadiness'"), 'main process should register alpha readiness IPC');
assert.ok(releaseGate.includes('alpha-ship'), 'release gate should include alpha ship smoke');

runNodeScript('scripts/devforge-handoff-smoke.mjs');
runNodeScript('scripts/ipc-security-eval.js');

console.log(JSON.stringify({
  success: true,
  checked: [
    'Anvil app metadata/version',
    'paid alpha README boundary',
    'versioned alpha readiness object',
    'local model runtime setup guidance',
    'selected model/storage/policy/handoff checks',
    'Quick Code Workspace copy',
    'Open Full DevForge IDE handoff copy',
    'alpha-blocked fake actions hidden',
    'readiness IPC wiring',
    'title bar alpha readiness pill',
    'release gate includes alpha smoke',
    'DevForge handoff smoke',
    'IPC security smoke',
  ],
  status: readiness.status,
}, null, 2));
