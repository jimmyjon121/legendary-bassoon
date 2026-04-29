#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NATIVE_DIR = path.join(ROOT, 'native', 'mosaic-coordinator');
const MANIFEST = path.join(NATIVE_DIR, 'Cargo.toml');
const PROFILE = process.env.MOSAIC_COORDINATOR_PROFILE === 'debug' ? 'debug' : 'release';
const DEFAULT_TARGET_DIR = path.join(process.env.LOCALAPPDATA || NATIVE_DIR, 'DevForge', 'cargo-target', 'mosaic-coordinator');

function platformLibraryName() {
  switch (process.platform) {
    case 'win32':
      return 'mosaic_coordinator.dll';
    case 'darwin':
      return 'libmosaic_coordinator.dylib';
    default:
      return 'libmosaic_coordinator.so';
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: NATIVE_DIR,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function main() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`Missing Mosaic coordinator manifest: ${MANIFEST}`);
  }

  const cargoVersion = spawnSync('cargo', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (cargoVersion.error || cargoVersion.status !== 0) {
    throw new Error('Rust cargo is required to build the Mosaic coordinator native addon');
  }

  const cargoTargetDir = process.env.CARGO_TARGET_DIR || DEFAULT_TARGET_DIR;
  fs.mkdirSync(cargoTargetDir, { recursive: true });

  const args = ['build', '--manifest-path', MANIFEST];
  if (PROFILE === 'release') args.push('--release');
  run('cargo', args, {
    env: {
      ...process.env,
      CARGO_TARGET_DIR: cargoTargetDir,
    },
  });

  const source = path.join(cargoTargetDir, PROFILE, platformLibraryName());
  const dest = path.join(NATIVE_DIR, 'index.node');
  if (!fs.existsSync(source)) {
    throw new Error(`Cargo completed but native library was not found: ${source}`);
  }

  fs.copyFileSync(source, dest);
  console.log(`[mosaic-coordinator] Built ${dest}`);
}

try {
  main();
} catch (error) {
  console.error(`[mosaic-coordinator] ${error.message}`);
  process.exit(1);
}
