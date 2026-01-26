import { api } from '../utils/electronAPI';

// Very lightweight in-memory index of code files for the current project.
// This avoids any external services or model calls.

const TRACKED_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'json', 'md', 'css', 'scss'];

let currentIndex = {
  rootPath: '',
  files: [], // { path, name, lang, content, contentLower }
  builtAt: 0,
};

function flattenTree(nodes = []) {
  const paths = [];
  const walk = (nodeList) => {
    nodeList.forEach((node) => {
      if (node.type === 'file') {
        paths.push(node.path);
      } else if (node.type === 'dir') {
        walk(node.children || []);
      }
    });
  };
  walk(nodes);
  return paths;
}

function shouldIndex(path) {
  const parts = path.split('.');
  const ext = parts[parts.length - 1]?.toLowerCase();
  return TRACKED_EXTENSIONS.includes(ext);
}

export async function buildCodeIndex(rootPath, tree) {
  if (!rootPath || !Array.isArray(tree)) {
    return currentIndex;
  }

  const allPaths = flattenTree(tree).filter(shouldIndex);
  const files = [];

  // Cap total files to avoid huge memory usage
  const limitedPaths = allPaths.slice(0, 400);

  // Read files sequentially to keep things simple and avoid hammering IPC
  // (project sizes here are typically modest).
  // We also truncate each file to the first ~4000 characters.
  // eslint-disable-next-line no-restricted-syntax
  for (const path of limitedPaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const content = await api.readFile(path);
      const snippet = (content || '').slice(0, 4000);
      files.push({
        path,
        name: path.split(/[\\/]/).pop() || path,
        lang: (path.split('.').pop() || 'txt').toLowerCase(),
        content: snippet,
        contentLower: snippet.toLowerCase(),
      });
    } catch (error) {
      // Best effort – skip unreadable files
      // eslint-disable-next-line no-console
      console.error('Failed to index file:', path, error);
    }
  }

  currentIndex = {
    rootPath,
    files,
    builtAt: Date.now(),
  };

  return currentIndex;
}

export function getCodeIndexSummary() {
  return {
    rootPath: currentIndex.rootPath,
    fileCount: currentIndex.files.length,
    builtAt: currentIndex.builtAt,
  };
}

export function hasCodeIndex() {
  return !!currentIndex.rootPath && currentIndex.files.length > 0;
}

export function getIndexedFiles() {
  return currentIndex.files;
}

export function searchCodeIndex(query, { limit = 20 } = {}) {
  if (!query || !currentIndex.files.length) return [];
  const q = query.toLowerCase();

  const scored = currentIndex.files
    .map((file) => {
      let score = 0;
      if (file.name.toLowerCase().includes(q)) score += 5;
      const idx = file.contentLower.indexOf(q);
      if (idx !== -1) {
        score += 10;
      }
      return { file, score, idx };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ file, idx }) => {
    let excerpt = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(file.content.length, idx + 80);
      excerpt = file.content.slice(start, end);
    }
    return {
      path: file.path,
      name: file.name,
      lang: file.lang,
      excerpt,
    };
  });
}

export default {
  buildCodeIndex,
  getCodeIndexSummary,
  hasCodeIndex,
  getIndexedFiles,
  searchCodeIndex,
};


