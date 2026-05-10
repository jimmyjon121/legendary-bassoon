#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { createDevForgeHandoff, HANDOFF_SCHEMA_VERSION } = require('../electron/services/devforge-handoff.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devforge-handoff-smoke-'));
const projectRoot = path.join(tmpRoot, 'project with spaces');
const sharedHome = path.join(tmpRoot, '.devforge');
const fakeLauncher = path.join(tmpRoot, 'fake-devforge');
const fakeCheckout = path.join(tmpRoot, 'checkout');
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(fakeCheckout, { recursive: true });
fs.writeFileSync(fakeLauncher, '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(
  path.join(fakeCheckout, 'product.json'),
  `${JSON.stringify({ urlProtocol: 'anvil', applicationName: 'anvil', nameLong: 'Anvil' }, null, 2)}\n`,
);

let spawned = null;
let openedUrl = null;

const handoff = createDevForgeHandoff({
  homeDir: tmpRoot,
  env: {
    DEVFORGE_SHARED_HOME: sharedHome,
    DEVFORGE_IDE_BINARY: fakeLauncher,
    DEVFORGE_IDE_CHECKOUT: fakeCheckout,
    ELECTRON_RUN_AS_NODE: '1',
    VSCODE_ESM_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess',
    VSCODE_IPC_HOOK: '/tmp/stale-extension-host.sock',
    VSCODE_PID: '12345',
    PATH: '/usr/bin',
  },
  shell: {
    openExternal: async (url) => {
      openedUrl = url;
      throw new Error('protocol unavailable in smoke');
    },
  },
  spawnDetached: (command, args, options) => {
    spawned = { command, args, options };
    return { pid: 4242 };
  },
});

const validation = handoff.validateProjectPath(projectRoot);
assert.equal(validation.ok, true, 'project path should validate');

const url = handoff.buildHandoffUrl(projectRoot);
assert.equal(url.startsWith('devforge://open?'), true, 'devforge handoff URL should use devforge://open');
assert.equal(new URL(url).searchParams.get('project'), projectRoot, 'handoff URL should preserve project path');

const status = handoff.getStatus(projectRoot);
assert.equal(status.success, true, 'status should succeed');
assert.equal(status.sharedHome, sharedHome, 'status should report shared home');
assert.equal(status.launcherAvailable, true, 'fake launcher should be discovered');

const opened = await handoff.openProject({ projectPath: projectRoot });
assert.equal(opened.success, true, 'openProject should succeed through launcher fallback');
assert.equal(opened.launchedVia, 'launcher', 'anvil protocol builds should use launcher fallback');
assert.equal(opened.pid, 4242, 'launcher fallback should report pid');
assert.equal(opened.sharedHome, sharedHome, 'openProject should use shared home');
assert.equal(openedUrl, null, 'devforge protocol should not be attempted when product protocol is anvil');
assert.match(opened.skippedProtocolReason, /urlProtocol "anvil"/, 'skip reason should explain protocol mismatch');
assert.equal(spawned.command, fakeLauncher, 'launcher fallback should use configured binary');
assert.equal(spawned.args.at(-1), projectRoot, 'launcher should receive project root as the final argument');
assert.ok(spawned.args.includes('--user-data-dir'), 'launcher should receive an isolated shared user-data dir');
assert.ok(spawned.args.includes('--extensions-dir'), 'launcher should receive an isolated shared extensions dir');
assert.ok(spawned.args.includes('GitHub.copilot-chat'), 'launcher should keep Copilot Chat disabled');
if (process.platform === 'linux') {
  assert.ok(spawned.args.includes('--no-sandbox'), 'Linux dev launch should avoid the unconfigured chrome-sandbox helper');
  assert.ok(spawned.args.includes('--disable-gpu'), 'Linux dev launch should use the stable GUI smoke flags');
}
assert.equal(spawned.options.cwd, fakeCheckout, 'launcher should run from the Code-OSS checkout');
assert.equal(spawned.options.env.DEVFORGE_HOME, sharedHome, 'launcher should receive shared config env');
assert.equal(spawned.options.env.VSCODE_DEV, '1', 'launcher should receive VS Code dev env');
assert.equal(spawned.options.env.ELECTRON_RUN_AS_NODE, undefined, 'launcher must not inherit ELECTRON_RUN_AS_NODE');
assert.equal(spawned.options.env.VSCODE_ESM_ENTRYPOINT, undefined, 'launcher must not inherit extension-host entrypoint');
assert.equal(spawned.options.env.VSCODE_IPC_HOOK, undefined, 'launcher must not inherit stale VS Code IPC hook');
assert.equal(spawned.options.env.VSCODE_PID, undefined, 'launcher must not inherit parent VS Code pid');
assert.match(spawned.options.env.PATH, /\.local\/node-v22\.14\.0-linux-arm64\/bin/, 'launcher PATH should include bundled local Node for script fallback');
assert.equal(opened.ideUserDataDir, path.join(sharedHome, 'ide-user-data'), 'launcher result should report IDE user-data dir');
assert.equal(opened.ideExtensionsDir, path.join(sharedHome, 'ide-extensions'), 'launcher result should report IDE extensions dir');
assert.ok(fs.existsSync(opened.launchRecordPath), 'launcher should write a local launch record');

const launchJson = JSON.parse(fs.readFileSync(opened.launchRecordPath, 'utf8'));
assert.deepEqual(
  launchJson.sanitizedEnvRemoved,
  ['ELECTRON_RUN_AS_NODE', 'VSCODE_ESM_ENTRYPOINT', 'VSCODE_IPC_HOOK', 'VSCODE_PID'],
  'launch record should show inherited extension-host env cleanup',
);

const rawBinary = path.join(fakeCheckout, '.build', 'electron', 'anvil');
fs.mkdirSync(path.dirname(rawBinary), { recursive: true });
fs.writeFileSync(rawBinary, '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });

let rawSpawned = null;
const rawBinaryHandoff = createDevForgeHandoff({
  homeDir: tmpRoot,
  env: {
    DEVFORGE_SHARED_HOME: sharedHome,
    DEVFORGE_IDE_CHECKOUT: fakeCheckout,
  },
  spawnDetached: (command, args, options) => {
    rawSpawned = { command, args, options };
    return { pid: 5150 };
  },
});

const rawResult = await rawBinaryHandoff.openProject({ projectPath: projectRoot });
assert.equal(rawResult.success, true, 'raw binary launch should succeed');
assert.equal(rawSpawned.command, rawBinary, 'raw binary should be used when no explicit launcher is set');
assert.equal(rawSpawned.args[0], '.', 'raw Code-OSS Electron binary must receive repo-root dot argument first');

const forcedProtocol = createDevForgeHandoff({
  homeDir: tmpRoot,
  env: {
    DEVFORGE_SHARED_HOME: sharedHome,
    DEVFORGE_IDE_BINARY: fakeLauncher,
    DEVFORGE_IDE_CHECKOUT: fakeCheckout,
  },
  shell: {
    openExternal: async (urlToOpen) => {
      openedUrl = urlToOpen;
    },
  },
  spawnDetached: () => {
    throw new Error('forced protocol should not spawn');
  },
});

openedUrl = null;
const protocolResult = await forcedProtocol.openProject({ projectPath: projectRoot, forceProtocol: true });
assert.equal(protocolResult.success, true, 'forceProtocol should still allow explicit protocol launch');
assert.equal(protocolResult.launchedVia, 'protocol', 'forceProtocol should launch via protocol');
assert.equal(openedUrl.startsWith('devforge://open?'), true, 'forceProtocol should attempt devforge protocol');

const handoffPath = path.join(sharedHome, 'handoff', 'last-open.json');
const handoffJson = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
assert.equal(handoffJson.schemaVersion, HANDOFF_SCHEMA_VERSION, 'handoff metadata should be versioned');
assert.equal(handoffJson.projectPath, projectRoot, 'handoff metadata should record project root locally');
assert.equal(typeof handoffJson.projectPathHash, 'string', 'handoff metadata should include a path hash');

console.log(JSON.stringify({
  success: true,
  checked: [
    'project validation',
    'devforge protocol URL',
    'shared ~/.devforge-style home',
    'protocol mismatch skip',
    'launcher fallback',
    'isolated IDE profile args',
    'linux dev launch flags',
    'sanitized inherited extension-host env',
    'raw binary dot arg',
    'forced protocol path',
    'versioned handoff metadata',
  ],
  sharedHome,
}, null, 2));
