const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

async function summarizeFile(filePath, content) {
  const ext = path.extname(filePath || '').replace('.', '');
  const lines = content ? content.split('\n').length : 0;
  return { filePath, ext, lines };
}

async function buildDependencyGraph() {
  // Placeholder for future AST-based graph
  return { nodes: [], edges: [] };
}

async function extractSymbols() {
  return [];
}

/**
 * Analyze a project directory and return high-level stats
 */
async function analyzeProject(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return { error: 'Project path not found', stats: null };
  }

  const stats = {
    totalFiles: 0,
    totalDirectories: 0,
    fileTypes: {},
    languages: {},
    hasPackageJson: false,
    hasGitRepo: false,
    hasTsConfig: false,
    hasReadme: false,
    estimatedLinesOfCode: 0,
  };

  const languageMap = {
    '.js': 'JavaScript',
    '.jsx': 'JavaScript (React)',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript (React)',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.cpp': 'C++',
    '.c': 'C',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.html': 'HTML',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
  };

  const ignoreDirs = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', 
    '.next', '.nuxt', 'vendor', '__pycache__', 
    '.venv', 'venv', 'target', 'coverage'
  ]);

  async function scanDir(dirPath, depth = 0) {
    if (depth > 10) return; // Limit recursion

    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
            stats.totalDirectories++;
            await scanDir(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          stats.totalFiles++;
          
          const ext = path.extname(entry.name).toLowerCase();
          stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;
          
          if (languageMap[ext]) {
            const lang = languageMap[ext];
            stats.languages[lang] = (stats.languages[lang] || 0) + 1;
          }
          
          // Check for common project files at root level
          if (depth === 0) {
            if (entry.name === 'package.json') stats.hasPackageJson = true;
            if (entry.name === 'tsconfig.json') stats.hasTsConfig = true;
            if (entry.name.toLowerCase().startsWith('readme')) stats.hasReadme = true;
          }
          
          // Estimate lines of code for source files
          if (languageMap[ext]) {
            try {
              const content = await fsPromises.readFile(fullPath, 'utf-8');
              const lines = content.split('\n').length;
              stats.estimatedLinesOfCode += lines;
            } catch (e) {
              // Skip unreadable files
            }
          }
        }
      }
    } catch (error) {
      // Skip inaccessible directories
    }
  }

  // Check for git
  stats.hasGitRepo = fs.existsSync(path.join(rootPath, '.git'));

  await scanDir(rootPath);

  // Determine primary language
  const langCounts = Object.entries(stats.languages);
  if (langCounts.length > 0) {
    langCounts.sort((a, b) => b[1] - a[1]);
    stats.primaryLanguage = langCounts[0][0];
  }

  return {
    success: true,
    rootPath,
    stats,
    summary: `${stats.totalFiles} files, ${stats.totalDirectories} directories, ~${stats.estimatedLinesOfCode.toLocaleString()} lines of code`,
  };
}

module.exports = {
  summarizeFile,
  buildDependencyGraph,
  extractSymbols,
  analyzeProject,
};




