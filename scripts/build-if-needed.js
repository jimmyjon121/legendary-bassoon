/**
 * Auto-build gate for app mode.
 *
 * Why this exists:
 * - `npm run app` loads `dist/` in Electron.
 * - Timestamp-only checks can fail when clocks/files have skewed mtimes.
 *
 * Strategy:
 * - Build a deterministic source signature from watched inputs.
 * - Compare against `dist/.build-meta.json`.
 * - Rebuild only when signature changes (or dist is missing).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const distIndexPath = path.join(distPath, 'index.html');
const buildMetaPath = path.join(distPath, '.build-meta.json');

const WATCH_TARGETS = [
  'src',
  'public',
  'index.html',
  'vite.config.mjs',
  'package.json',
  'package-lock.json',
];

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist']);

console.log('Checking if build is needed...');

function safeExists(relOrAbsPath) {
  const full = path.isAbsolute(relOrAbsPath)
    ? relOrAbsPath
    : path.join(projectRoot, relOrAbsPath);
  return fs.existsSync(full) ? full : null;
}

function listFilesRecursive(absPath, bucket = []) {
  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      listFilesRecursive(full, bucket);
    } else if (entry.isFile()) {
      bucket.push(full);
    }
  }
  return bucket;
}

function toRel(absPath) {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

function computeSourceSignature() {
  const files = [];

  for (const target of WATCH_TARGETS) {
    const resolved = safeExists(target);
    if (!resolved) continue;

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      listFilesRecursive(resolved, files);
    } else if (stat.isFile()) {
      files.push(resolved);
    }
  }

  const normalized = files
    .map((fullPath) => {
      const stat = fs.statSync(fullPath);
      return `${toRel(fullPath)}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
    })
    .sort();

  const hash = crypto
    .createHash('sha256')
    .update(normalized.join('\n'))
    .digest('hex');

  return {
    hash,
    fileCount: normalized.length,
  };
}

function readBuildMeta() {
  try {
    if (!fs.existsSync(buildMetaPath)) return null;
    const raw = fs.readFileSync(buildMetaPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeBuildMeta(meta) {
  fs.mkdirSync(distPath, { recursive: true });
  fs.writeFileSync(buildMetaPath, JSON.stringify(meta, null, 2), 'utf8');
}

function shouldRebuild() {
  if (!fs.existsSync(distIndexPath)) {
    return { needed: true, reason: 'dist_missing' };
  }

  const current = computeSourceSignature();
  const previous = readBuildMeta();

  if (!previous || !previous.hash) {
    return { needed: true, reason: 'meta_missing', current };
  }

  if (previous.hash !== current.hash) {
    return { needed: true, reason: 'source_changed', current, previous };
  }

  return { needed: false, reason: 'up_to_date', current, previous };
}

function runBuild(currentSignature) {
  console.log('Running vite build...');
  try {
    execSync('npm run build:app', {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const signature = currentSignature || computeSourceSignature();
    writeBuildMeta({
      hash: signature.hash,
      fileCount: signature.fileCount,
      builtAt: new Date().toISOString(),
      tool: 'build-if-needed',
      version: 2,
    });
    console.log('Build complete!');
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    console.log('');
    console.log('Tip: You can still run in dev mode with: npm run dev');
    process.exit(1);
  }
}

const decision = shouldRebuild();
if (decision.needed) {
  const reasonMap = {
    dist_missing: 'dist output missing',
    meta_missing: 'build metadata missing',
    source_changed: 'source signature changed',
  };
  console.log(`Rebuilding app (${reasonMap[decision.reason] || decision.reason})...`);
  runBuild(decision.current);
} else {
  console.log('Build is up-to-date - launching app...');
}
