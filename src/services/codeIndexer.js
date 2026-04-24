/**
 * Code Indexer - Enhanced for AI coding assistance
 * 
 * Provides:
 * - Full file indexing (no truncation for search)
 * - Line-level search with context
 * - Symbol extraction for quick navigation
 * - File type filtering and glob pattern support
 */

import { api } from '../utils/electronAPI';

// ============================================================================
// Configuration
// ============================================================================

const TRACKED_EXTENSIONS = [
  // JavaScript/TypeScript
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  // Web
  'html', 'css', 'scss', 'less', 'vue', 'svelte',
  // Data/Config
  'json', 'yaml', 'yml', 'toml', 'xml',
  // Documentation
  'md', 'mdx', 'txt',
  // Other languages (common in projects)
  'py', 'rb', 'go', 'rs', 'java', 'kt',
  'sh', 'bash', 'zsh', 'sql', 'graphql'
];

const SKIP_DIRECTORIES = [
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '__pycache__', '.cache', 'vendor', 'target'
];

// Max files to index (increased from 400)
const MAX_INDEX_FILES = 2000;

// Max file size to fully index (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ============================================================================
// Index State
// ============================================================================

let currentIndex = {
  rootPath: '',
  files: [], // { path, name, lang, content, lines, symbols }
  fileMap: new Map(), // path -> file for quick lookup
  symbolMap: new Map(), // symbol -> [{ path, line, type }]
  builtAt: 0,
  stats: {
    totalFiles: 0,
    totalLines: 0,
    totalSymbols: 0,
    indexDurationMs: 0
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

function flattenTree(nodes = []) {
  const paths = [];
  const walk = (nodeList) => {
    nodeList.forEach((node) => {
      if (node.type === 'file') {
        paths.push(node.path);
      } else if (node.type === 'dir') {
        // Skip common non-source directories
        const dirName = node.name || node.path.split(/[\\/]/).pop();
        if (!SKIP_DIRECTORIES.includes(dirName)) {
          walk(node.children || []);
        }
      }
    });
  };
  walk(nodes);
  return paths;
}

function shouldIndex(filePath) {
  const parts = filePath.split('.');
  const ext = parts[parts.length - 1]?.toLowerCase();
  return TRACKED_EXTENSIONS.includes(ext);
}

function getLanguage(filePath) {
  const ext = (filePath.split('.').pop() || 'txt').toLowerCase();
  const langMap = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    vue: 'vue', svelte: 'svelte',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', mdx: 'markdown',
    sql: 'sql', graphql: 'graphql',
    sh: 'shell', bash: 'shell', zsh: 'shell'
  };
  return langMap[ext] || ext;
}

/**
 * Extract symbols (functions, classes, exports) from code
 */
function extractSymbols(content, lang) {
  const symbols = [];
  const lines = content.split('\n');
  
  // Patterns for different languages
  const patterns = {
    javascript: [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, type: 'function' },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/gm, type: 'function' },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*function/gm, type: 'function' },
      { regex: /^(?:export\s+)?class\s+(\w+)/gm, type: 'class' },
      { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/gm, type: 'variable' },
    ],
    typescript: [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, type: 'function' },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/gm, type: 'function' },
      { regex: /^(?:export\s+)?class\s+(\w+)/gm, type: 'class' },
      { regex: /^(?:export\s+)?interface\s+(\w+)/gm, type: 'interface' },
      { regex: /^(?:export\s+)?type\s+(\w+)\s*=/gm, type: 'type' },
      { regex: /^(?:export\s+)?enum\s+(\w+)/gm, type: 'enum' },
    ],
    python: [
      { regex: /^(?:async\s+)?def\s+(\w+)/gm, type: 'function' },
      { regex: /^class\s+(\w+)/gm, type: 'class' },
    ]
  };
  
  const langPatterns = patterns[lang] || patterns.javascript || [];
  
  for (const { regex, type } of langPatterns) {
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      regex.lastIndex = 0;
      const match = regex.exec(line);
      if (match) {
        symbols.push({
          name: match[1],
          type,
          line: lineNum + 1,
          lineContent: line.trim()
        });
      }
    }
  }
  
  return symbols;
}

// ============================================================================
// Index Building
// ============================================================================

/**
 * Build or rebuild the code index
 */
export async function buildCodeIndex(rootPath, tree, options = {}) {
  const startTime = Date.now();
  
  if (!rootPath || !Array.isArray(tree)) {
    return currentIndex;
  }

  await api.grantFsRoot(rootPath, 'code-indexer-root');

  const { forceRebuild = false, extractSymbolsFlag = true } = options;
  
  // Check if we can skip rebuild
  if (!forceRebuild && currentIndex.rootPath === rootPath && currentIndex.files.length > 0) {
    const age = Date.now() - currentIndex.builtAt;
    if (age < 60000) { // Less than 1 minute old
      return currentIndex;
    }
  }

  const allPaths = flattenTree(tree).filter(shouldIndex);
  const files = [];
  const fileMap = new Map();
  const symbolMap = new Map();
  let totalLines = 0;
  let totalSymbols = 0;

  // Limit files but prioritize source code
  const limitedPaths = allPaths.slice(0, MAX_INDEX_FILES);

  console.log(`[CodeIndexer] Indexing ${limitedPaths.length} files...`);

  // Process files in batches for better performance
  const BATCH_SIZE = 50;
  for (let i = 0; i < limitedPaths.length; i += BATCH_SIZE) {
    const batch = limitedPaths.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (filePath) => {
      try {
        const content = await api.readFileScoped(filePath, rootPath);
        if (!content) return;
        
        // Skip very large files (but still track them)
        const isLarge = content.length > MAX_FILE_SIZE;
        const indexContent = isLarge ? content.slice(0, MAX_FILE_SIZE) : content;
        
        const lines = indexContent.split('\n');
        const lang = getLanguage(filePath);
        const name = filePath.split(/[\\/]/).pop() || filePath;
        
        // Extract symbols
        let symbols = [];
        if (extractSymbolsFlag && !isLarge) {
          symbols = extractSymbols(indexContent, lang);
          totalSymbols += symbols.length;
          
          // Add to symbol map
          for (const symbol of symbols) {
            if (!symbolMap.has(symbol.name)) {
              symbolMap.set(symbol.name, []);
            }
            symbolMap.get(symbol.name).push({
              path: filePath,
              line: symbol.line,
              type: symbol.type
            });
          }
        }
        
        const fileEntry = {
          path: filePath,
          name,
          lang,
          content: indexContent,
          contentLower: indexContent.toLowerCase(),
          lines,
          lineCount: lines.length,
          symbols,
          size: content.length,
          isLarge
        };
        
        files.push(fileEntry);
        fileMap.set(filePath, fileEntry);
        totalLines += lines.length;
        
      } catch (error) {
        console.warn(`[CodeIndexer] Failed to index: ${filePath}`, error.message);
      }
    }));
  }

  const duration = Date.now() - startTime;
  
  currentIndex = {
    rootPath,
    files,
    fileMap,
    symbolMap,
    builtAt: Date.now(),
    stats: {
      totalFiles: files.length,
      totalLines,
      totalSymbols,
      indexDurationMs: duration
    }
  };

  console.log(`[CodeIndexer] Indexed ${files.length} files, ${totalLines} lines, ${totalSymbols} symbols in ${duration}ms`);

  return currentIndex;
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Search code with line-level results and context
 */
export function searchCodeIndex(query, options = {}) {
  const {
    limit = 30,
    caseSensitive = false,
    fileGlob = null,
    contextLines = 2,
    regex = false
  } = options;
  
  if (!query || !currentIndex.files.length) return [];
  
  const results = [];
  let searchPattern;
  
  if (regex) {
    try {
      searchPattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch (e) {
      // Invalid regex, fall back to literal search
      searchPattern = null;
    }
  }
  
  const queryLower = caseSensitive ? query : query.toLowerCase();
  
  // Parse file glob if provided
  let globPattern = null;
  if (fileGlob) {
    globPattern = new RegExp(
      fileGlob
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*'),
      'i'
    );
  }
  
  for (const file of currentIndex.files) {
    if (results.length >= limit) break;
    
    // Check file glob filter
    if (globPattern && !globPattern.test(file.path)) continue;
    
    const searchContent = caseSensitive ? file.content : file.contentLower;
    const lines = file.lines;
    
    // Search line by line
    for (let i = 0; i < lines.length && results.length < limit; i++) {
      const line = lines[i];
      const searchLine = caseSensitive ? line : line.toLowerCase();
      
      let isMatch = false;
      if (searchPattern) {
        searchPattern.lastIndex = 0;
        isMatch = searchPattern.test(line);
      } else {
        isMatch = searchLine.includes(queryLower);
      }
      
      if (isMatch) {
        // Build context
        const contextStart = Math.max(0, i - contextLines);
        const contextEnd = Math.min(lines.length, i + contextLines + 1);
        const context = [];
        
        for (let j = contextStart; j < contextEnd; j++) {
          context.push({
            line: j + 1,
            content: lines[j],
            isMatch: j === i
          });
        }
        
        results.push({
          path: file.path,
          name: file.name,
          lang: file.lang,
          line: i + 1,
          content: line.trim(),
          context,
          matchIndex: searchLine.indexOf(queryLower)
        });
      }
    }
  }
  
  return results;
}

/**
 * Search for a symbol by name
 */
export function searchSymbol(symbolName, options = {}) {
  const { exact = false, type = null } = options;
  
  if (!symbolName || !currentIndex.symbolMap.size) return [];
  
  const results = [];
  const queryLower = symbolName.toLowerCase();
  
  for (const [name, locations] of currentIndex.symbolMap) {
    const nameLower = name.toLowerCase();
    const matches = exact ? (nameLower === queryLower) : nameLower.includes(queryLower);
    
    if (matches) {
      for (const loc of locations) {
        if (type && loc.type !== type) continue;
        results.push({
          name,
          ...loc
        });
      }
    }
  }
  
  return results;
}

/**
 * Get file by path from index
 */
export function getIndexedFile(filePath) {
  return currentIndex.fileMap.get(filePath) || null;
}

/**
 * Get files matching a glob pattern
 */
export function getFilesByPattern(pattern) {
  const regex = new RegExp(
    pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*'),
    'i'
  );
  
  return currentIndex.files.filter(f => regex.test(f.path));
}

// ============================================================================
// Status & Summary Functions
// ============================================================================

export function getCodeIndexSummary() {
  return {
    rootPath: currentIndex.rootPath,
    fileCount: currentIndex.files.length,
    builtAt: currentIndex.builtAt,
    stats: currentIndex.stats
  };
}

export function hasCodeIndex() {
  return !!currentIndex.rootPath && currentIndex.files.length > 0;
}

export function getIndexedFiles() {
  return currentIndex.files;
}

export function getIndexStats() {
  return currentIndex.stats;
}

/**
 * Clear the index
 */
export function clearCodeIndex() {
  currentIndex = {
    rootPath: '',
    files: [],
    fileMap: new Map(),
    symbolMap: new Map(),
    builtAt: 0,
    stats: {
      totalFiles: 0,
      totalLines: 0,
      totalSymbols: 0,
      indexDurationMs: 0
    }
  };
}

// ============================================================================
// Export
// ============================================================================

export default {
  buildCodeIndex,
  searchCodeIndex,
  searchSymbol,
  getIndexedFile,
  getFilesByPattern,
  getCodeIndexSummary,
  hasCodeIndex,
  getIndexedFiles,
  getIndexStats,
  clearCodeIndex
};
