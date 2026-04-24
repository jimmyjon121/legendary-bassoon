#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

function walkFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, acc);
      continue;
    }
    if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function main() {
  const files = walkFiles(SRC_DIR);
  const findings = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const matches = content.match(/setInterval\s*\(/g) || [];
    if (matches.length > 0) {
      findings.push({
        file: path.relative(ROOT, file),
        count: matches.length,
      });
    }
  }

  const totalIntervals = findings.reduce((sum, item) => sum + item.count, 0);
  const settingsModalContent = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'Settings', 'SettingsModal.jsx'),
    'utf-8'
  );
  const hasVisibilityAwarePolling =
    settingsModalContent.includes("document.visibilityState !== 'visible'") ||
    settingsModalContent.includes('pollingCoordinator.subscribe');

  const result = {
    ok: totalIntervals <= 35,
    checks: {
      totalIntervals,
      threshold: 35,
      hasVisibilityAwarePolling,
    },
    topFiles: findings
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main();
