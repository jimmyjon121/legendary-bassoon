/**
 * Launch DevForge with robust fallback behavior.
 *
 * Primary path:
 * - Use local Electron runtime from node_modules (dev/stable source mode).
 *
 * Fallback path (Windows policy environments):
 * - If Electron runtime is blocked by Application Control, run built DevForge
 *   executable from release/win-unpacked or release portable EXE.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

function spawnProcess(executable, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: false,
      ...options,
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
}

function isWindowsPolicyBlock(error) {
  if (!error) return false;
  const text = `${error.message || ''}`.toLowerCase();
  return (
    error.code === 'UNKNOWN' ||
    text.includes('application control policy') ||
    text.includes('blocked this file')
  );
}

function findFallbackExecutable() {
  const staticCandidates = [
    path.join(projectRoot, 'release', 'win-unpacked', 'DevForge.exe'),
    path.join(projectRoot, 'release', 'DevForge 0.1.0.exe'),
  ];

  for (const candidate of staticCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const releaseDir = path.join(projectRoot, 'release');
  if (!fs.existsSync(releaseDir)) return null;

  const dynamicPortable = fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^DevForge .*\.exe$/i.test(entry.name) && !/setup/i.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name))
    .sort((a, b) => {
      const aTime = fs.statSync(a).mtimeMs;
      const bTime = fs.statSync(b).mtimeMs;
      return bTime - aTime;
    })[0];

  return dynamicPortable || null;
}

async function main() {
  let electronPath = null;
  try {
    electronPath = require('electron');
  } catch (error) {
    console.error('[launch] Failed to resolve Electron runtime:', error.message);
    process.exit(1);
  }

  if (!fs.existsSync(electronPath)) {
    console.error('[launch] Electron runtime missing at:', electronPath);
    process.exit(1);
  }

  try {
    const result = await spawnProcess(electronPath, ['.']);
    if (result.code === null) {
      console.error('[launch] Electron exited with signal:', result.signal);
      process.exit(1);
    }
    process.exit(result.code);
  } catch (error) {
    if (process.platform !== 'win32' || !isWindowsPolicyBlock(error)) {
      console.error('[launch] Failed to spawn Electron runtime:', error.message);
      process.exit(1);
    }

    console.warn('[launch] Electron runtime blocked by Windows policy, attempting fallback executable...');
    const fallbackExe = findFallbackExecutable();
    if (!fallbackExe) {
      console.error('[launch] No fallback DevForge executable found in release/.');
      console.error('[launch] Run `npm run build` once, then relaunch.');
      process.exit(1);
    }

    try {
      const result = await spawnProcess(fallbackExe, []);
      if (result.code === null) {
        console.error('[launch] Fallback executable exited with signal:', result.signal);
        process.exit(1);
      }
      process.exit(result.code);
    } catch (fallbackError) {
      console.error('[launch] Failed to start fallback executable:', fallbackError.message);
      process.exit(1);
    }
  }
}

main();
