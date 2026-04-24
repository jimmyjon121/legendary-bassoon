#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHAT_V2_DIR = path.join(ROOT, 'src', 'chat-v2');
const HARNESS_FILE = path.join(CHAT_V2_DIR, 'ui', 'ChatV2Harness.jsx');
const SURFACE_FILE = path.join(CHAT_V2_DIR, 'ui', 'ChatV2Surface.jsx');

function walkFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, acc);
      continue;
    }
    if (/\.(js|jsx)$/.test(entry.name)) acc.push(fullPath);
  }
  return acc;
}

function countRegex(text, regex) {
  return (text.match(regex) || []).length;
}

function main() {
  const chatFiles = walkFiles(CHAT_V2_DIR);
  let bareUseStoreCount = 0;
  const bareUseStoreFiles = [];

  for (const file of chatFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const count = countRegex(content, /useAppStore\(\s*\)/g);
    if (count > 0) {
      bareUseStoreCount += count;
      bareUseStoreFiles.push({ file: path.relative(ROOT, file), count });
    }
  }

  const harnessContent = fs.readFileSync(HARNESS_FILE, 'utf-8');
  const surfaceContent = fs.readFileSync(SURFACE_FILE, 'utf-8');

  const hasRuntimePolling = countRegex(harnessContent, /pollingCoordinator\.subscribe\(/g) > 0;
  const hasMemoizedMessageRow = countRegex(surfaceContent, /const MessageRow = memo\(/g) > 0;
  const hasFollowUpMemo = countRegex(surfaceContent, /const followUps = useMemo\(/g) > 0;
  const hasLazyMarkdown = countRegex(surfaceContent, /import\('\.\/StreamingMarkdown'\)/g) > 0;

  const result = {
    ok: bareUseStoreCount === 0 && hasRuntimePolling && hasMemoizedMessageRow && hasFollowUpMemo && hasLazyMarkdown,
    checks: {
      bareUseStoreCount,
      hasRuntimePolling,
      hasMemoizedMessageRow,
      hasFollowUpMemo,
      hasLazyMarkdown,
    },
    details: {
      bareUseStoreFiles,
      harness: path.relative(ROOT, HARNESS_FILE),
      surface: path.relative(ROOT, SURFACE_FILE),
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main();
