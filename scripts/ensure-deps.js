#!/usr/bin/env node
/**
 * Pre-flight dependency check.
 * Run this before `vite` or `electron` to guarantee all npm packages exist.
 * If any are missing, runs `npm install` automatically.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(projectRoot, 'package.json');
const nodeModulesPath = path.join(projectRoot, 'node_modules');

function main() {
  console.log('[ensure-deps] Checking npm dependencies...');

  // If node_modules is completely missing, do a full install
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('[ensure-deps] node_modules missing – running npm install...');
    execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
    console.log('[ensure-deps] ✓ Done');
    return;
  }

  // Read package.json
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (err) {
    console.error('[ensure-deps] Could not read package.json:', err.message);
    process.exit(1);
  }

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  const missing = [];
  for (const dep of Object.keys(allDeps)) {
    const depFolder = dep.startsWith('@')
      ? path.join(nodeModulesPath, ...dep.split('/'))
      : path.join(nodeModulesPath, dep);

    if (!fs.existsSync(depFolder)) {
      missing.push(dep);
    }
  }

  if (missing.length === 0) {
    console.log('[ensure-deps] ✓ All dependencies present');
    return;
  }

  console.log(`[ensure-deps] Missing ${missing.length} packages: ${missing.join(', ')}`);
  console.log('[ensure-deps] Running npm install...');
  execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
  console.log('[ensure-deps] ✓ Done');
}

main();













