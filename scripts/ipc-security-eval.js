#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function walk(dirPath, out = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function checkFile(filePath, checks, failures) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const check of checks) {
    if (check.pattern.test(content)) {
      failures.push(`${filePath}: ${check.message}`);
    }
  }
}

function main() {
  const repoRoot = process.cwd();
  const srcRoot = path.join(repoRoot, 'src');
  const preloadPath = path.join(repoRoot, 'electron', 'preload.js');
  const ipcHandlersPath = path.join(repoRoot, 'electron', 'ipc-handlers.js');
  const dataServicePath = path.join(repoRoot, 'electron', 'services', 'ipc', 'data-service.js');
  const fsServicePath = path.join(repoRoot, 'electron', 'services', 'ipc', 'fs-access-service.js');

  const failures = [];

  const srcFiles = walk(srcRoot).filter((file) => {
    const normalized = file.replace(/\\/g, '/');
    return !normalized.endsWith('src/utils/electronAPI.js');
  });

  const forbiddenPatterns = [
    {
      pattern: /window\.electronAPI\?\.db(?:Query|Run)\s*\(/,
      message: 'raw DB IPC call detected',
    },
    {
      pattern: /safeCall\(\s*['"]db(?:Query|Run)['"]\s*,/,
      message: 'raw DB safeCall alias detected',
    },
    {
      pattern: /safeCall\(\s*['"](?:readFile|writeFile|createFolder)['"]\s*,/,
      message: 'broad FS safeCall alias detected',
    },
    {
      pattern: /\bapi\.(?:readFile|writeFile|createFolder)\s*\(/,
      message: 'broad FS convenience API detected',
    },
  ];

  for (const filePath of srcFiles) {
    checkFile(filePath, forbiddenPatterns, failures);
  }

  const preload = fs.readFileSync(preloadPath, 'utf8');
  if (!preload.includes('fsScoped: {')) {
    failures.push('electron/preload.js: fsScoped API object missing');
  }
  if (!preload.includes('data: {')) {
    failures.push('electron/preload.js: data API object missing');
  }

  const ipcHandlers = fs.readFileSync(ipcHandlersPath, 'utf8');
  const dataService = fs.readFileSync(dataServicePath, 'utf8');
  const fsService = fs.readFileSync(fsServicePath, 'utf8');
  const allRegistrationSources = `${ipcHandlers}\n${dataService}\n${fsService}`;
  const requiredChannels = [
    "'fs:grantRoot'",
    "'fs:readScoped'",
    "'conversations:list'",
    "'messages:listByConversation'",
    "'attachments:save'",
  ];
  for (const channel of requiredChannels) {
    if (!allRegistrationSources.includes(channel)) {
      failures.push(`IPC channel registration missing ${channel}`);
    }
  }

  if (failures.length > 0) {
    console.error('IPC Security Eval FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('IPC Security Eval PASS');
}

main();
