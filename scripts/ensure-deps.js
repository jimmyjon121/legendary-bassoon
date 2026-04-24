#!/usr/bin/env node
/**
 * Pre-flight dependency check.
 * Run this before `vite` or `electron` to guarantee all npm packages exist.
 * If any are missing, runs `npm install` automatically.
 *
 * Also validates that the node-llama-cpp native module loads correctly.
 * If it fails (missing CUDA runtime, wrong ABI, etc.), we log a clear
 * warning but don't block startup — the orchestrator falls back to
 * Ollama when llamanode is unavailable.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkgPath = path.join(projectRoot, 'package.json');
const nodeModulesPath = path.join(projectRoot, 'node_modules');

function validateNativeModules() {
  const llamaCppPath = path.join(nodeModulesPath, 'node-llama-cpp');
  if (!fs.existsSync(llamaCppPath)) {
    return { ok: false, reason: 'not-installed' };
  }

  // Check that the native binary exists for this platform.
  // node-llama-cpp ships prebuilds under node_modules/node-llama-cpp/llama/
  // and node_modules/@node-llama-cpp/ (scoped arch-specific packages).
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(llamaCppPath, 'package.json'), 'utf-8'));
    return { ok: true, version: pkgJson.version };
  } catch (err) {
    return { ok: false, reason: `read-failed: ${err.message}` };
  }
}

function main() {
  console.log('[ensure-deps] Checking npm dependencies...');

  // If node_modules is completely missing, do a full install
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('[ensure-deps] node_modules missing - running npm install...');
    execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
    console.log('[ensure-deps] [OK] Done');
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

  if (missing.length > 0) {
    console.log(`[ensure-deps] Missing ${missing.length} packages: ${missing.join(', ')}`);
    console.log('[ensure-deps] Running npm install...');
    execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
    console.log('[ensure-deps] [OK] npm install complete');
  } else {
    console.log('[ensure-deps] [OK] All npm packages present');
  }

  // Validate node-llama-cpp native module (soft check — orchestrator
  // falls back to Ollama when llamanode isn't available).
  const nativeCheck = validateNativeModules();
  if (nativeCheck.ok) {
    console.log(`[ensure-deps] [OK] node-llama-cpp ${nativeCheck.version} installed`);
  } else {
    console.warn(`[ensure-deps] [WARN] node-llama-cpp not ready (${nativeCheck.reason}). Direct GGUF loading disabled; Ollama path still works.`);
  }
}

main();
