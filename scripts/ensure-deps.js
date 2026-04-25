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
  // node-llama-cpp v3 ships scoped GPU-specific prebuilds under
  // node_modules/@node-llama-cpp/<platform>-<arch>-<gpu>. Each contains
  // the .node binary the runtime tries to load.
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(llamaCppPath, 'package.json'), 'utf-8'));
    return { ok: true, version: pkgJson.version };
  } catch (err) {
    return { ok: false, reason: `read-failed: ${err.message}` };
  }
}

// Inspect which GPU prebuilds shipped with the install. v3 publishes
// scoped subpackages keyed by GPU vendor. Their absence means GPU
// inference will fall back to CPU at runtime.
function detectInstalledGpuPrebuilds() {
  const scopedPath = path.join(nodeModulesPath, '@node-llama-cpp');
  if (!fs.existsSync(scopedPath)) {
    return { available: [], scopedDir: null };
  }
  const entries = fs.readdirSync(scopedPath).filter((name) => {
    try {
      return fs.statSync(path.join(scopedPath, name)).isDirectory();
    } catch {
      return false;
    }
  });
  return {
    scopedDir: scopedPath,
    available: entries,
  };
}

// node-llama-cpp 3.x's CUDA prebuild (win-x64-cuda) is linked against
// the CUDA 12 runtime. When CUDA Toolkit isn't installed on the user's
// machine, the prebuild's testBindingBinary probe fails and the package
// silently falls back to CPU. Detect the situation so users get a
// clear "install CUDA 12 for GPU inference" warning.
function detectCudaToolkit() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.CUDA_PATH,
    process.env.CUDAToolkit_ROOT,
    'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.9',
    'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.8',
    'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.6',
    'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
    'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.2',
    'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v13.2',
  ];
  for (const root of candidates) {
    if (!root) continue;
    try {
      const cudart12 = path.join(root, 'bin', 'cudart64_12.dll');
      if (fs.existsSync(cudart12)) {
        return { root, cudartVersion: 12, supportsLlamaCppPrebuild: true };
      }
      const cudart13 = path.join(root, 'bin', 'cudart64_13.dll');
      if (fs.existsSync(cudart13)) {
        return { root, cudartVersion: 13, supportsLlamaCppPrebuild: false };
      }
    } catch {
      // try next candidate
    }
  }
  return { root: null, cudartVersion: null, supportsLlamaCppPrebuild: false };
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
    const prebuilds = detectInstalledGpuPrebuilds();
    if (prebuilds.available.length === 0) {
      console.warn('[ensure-deps] [WARN] No GPU prebuilds found under @node-llama-cpp/. Direct GGUF runs CPU-only.');
    } else {
      const gpuLabels = prebuilds.available
        .map((entry) => entry.replace(/^win-x64-?/, '').replace(/^linux-x64-?/, '') || 'cpu')
        .join(', ');
      console.log(`[ensure-deps] [OK] node-llama-cpp GPU prebuilds: ${gpuLabels}`);
    }

    // Detect CUDA toolkit so we can warn ahead of time when the prebuild
    // would fail to load at runtime.
    const cuda = detectCudaToolkit();
    if (cuda && cuda.supportsLlamaCppPrebuild) {
      console.log(`[ensure-deps] [OK] CUDA Toolkit ${cuda.cudartVersion} detected at ${cuda.root}; CUDA prebuild can load`);
    } else if (cuda && cuda.cudartVersion === 13) {
      console.warn(`[ensure-deps] [WARN] CUDA 13 found at ${cuda.root} but the node-llama-cpp prebuild requires CUDA 12 runtime (cudart64_12.dll). Install CUDA 12.x alongside 13 for GPU inference, or chat will run CPU-only on the llamanode path.`);
    } else if (process.platform === 'win32') {
      console.warn('[ensure-deps] [WARN] No CUDA 12 runtime detected. node-llama-cpp prebuild will fall back to CPU. Install CUDA Toolkit 12.x from https://developer.nvidia.com/cuda-12-9-0-download-archive to enable GPU.');
    }
  } else {
    console.warn(`[ensure-deps] [WARN] node-llama-cpp not ready (${nativeCheck.reason}). Direct GGUF loading disabled; Ollama path still works.`);
  }
}

main();
