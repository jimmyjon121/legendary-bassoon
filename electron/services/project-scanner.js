const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'release',
  '.turbo',
  '.next',
  '.DS_Store',
]);

function shouldIgnore(name) {
  if (!name) return true;
  if (name.startsWith('.')) {
    // Allow .gitignore-style hidden files only if explicitly needed
    if (name === '.git') return true;
  }
  return DEFAULT_IGNORE.has(name);
}

function scanDirectory(root, maxDepth = 6, currentDepth = 0, gitStatusMap = {}) {
  if (currentDepth > maxDepth) {
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    console.warn('project-scanner: failed to read directory', root, error.message);
    return [];
  }

  const result = [];

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push({
        type: 'dir',
        name: entry.name,
        path: fullPath,
        children: scanDirectory(fullPath, maxDepth, currentDepth + 1, gitStatusMap),
      });
    } else if (entry.isFile()) {
      result.push({
        type: 'file',
        name: entry.name,
        path: fullPath,
        gitStatus: gitStatusMap[fullPath] || null,
      });
    }
  }

  // Sort directories first, then files, alphabetically
  result.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}

function getGitStatusMap(rootPath) {
  try {
    const res = spawnSync('git', ['status', '--porcelain'], {
      cwd: rootPath,
      encoding: 'utf8',
    });
    if (res.status !== 0 || !res.stdout) {
      return {};
    }
    const map = {};
    res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        // format: XY path
        const status = line.slice(0, 2).trim();
        const rel = line.slice(2).trim();
        if (!rel) return;
        const full = path.resolve(rootPath, rel);
        // Simplify status: just take first meaningful char
        let s = '?';
        if (status.includes('M')) s = 'M';
        else if (status.includes('A')) s = 'A';
        else if (status.includes('D')) s = 'D';
        map[full] = s;
      });
    return map;
  } catch {
    return {};
  }
}

function scanProject(rootPath, options = {}) {
  if (!rootPath) {
    throw new Error('Root path is required for project scan');
  }

  // Be defensive about stray whitespace/newlines from dialogs
  const normalized = path.resolve(String(rootPath).trim());
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 6;
  const gitStatusMap = getGitStatusMap(normalized);

  return {
    root: normalized,
    tree: scanDirectory(normalized, maxDepth, 0, gitStatusMap),
  };
}

module.exports = {
  scanProject,
};


