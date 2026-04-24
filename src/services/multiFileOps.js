import { api } from '../utils/electronAPI';
import { getIndexedFiles, hasCodeIndex } from './codeIndexer';

/**
 * Multi-file operations: find/replace across project, rename symbols, etc.
 */

/**
 * Find all occurrences of a string across the indexed codebase
 * @param {string} searchTerm - The string to search for
 * @param {object} options - Search options
 * @returns {Array} Array of matches with file path, line number, and context
 */
export function findInFiles(searchTerm, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  if (!searchTerm || !hasCodeIndex()) return [];

  const files = getIndexedFiles();
  const results = [];

  let pattern;
  if (regex) {
    try {
      pattern = new RegExp(searchTerm, caseSensitive ? 'g' : 'gi');
    } catch (e) {
      console.error('Invalid regex:', e);
      return [];
    }
  } else {
    // Escape special regex characters for literal search
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundary = wholeWord ? '\\b' : '';
    pattern = new RegExp(`${wordBoundary}${escaped}${wordBoundary}`, caseSensitive ? 'g' : 'gi');
  }

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(pattern)];
      
      for (const match of matches) {
        results.push({
          path: file.path,
          name: file.name,
          line: i + 1,
          column: match.index + 1,
          text: line.trim(),
          match: match[0],
        });
      }
    }
  }

  return results;
}

/**
 * Preview what a find/replace operation would change
 * @param {string} searchTerm - The string to find
 * @param {string} replaceTerm - The string to replace with
 * @param {object} options - Search options
 * @returns {Array} Array of changes to preview
 */
export function previewReplace(searchTerm, replaceTerm, options = {}) {
  const matches = findInFiles(searchTerm, options);
  
  // Group by file
  const byFile = {};
  for (const match of matches) {
    if (!byFile[match.path]) {
      byFile[match.path] = {
        path: match.path,
        name: match.name,
        changes: [],
      };
    }
    byFile[match.path].changes.push({
      line: match.line,
      before: match.text,
      after: match.text.replace(
        options.regex ? new RegExp(searchTerm, options.caseSensitive ? 'g' : 'gi') : searchTerm,
        replaceTerm
      ),
    });
  }

  return Object.values(byFile);
}

/**
 * Execute find/replace across multiple files
 * @param {string} searchTerm - The string to find
 * @param {string} replaceTerm - The string to replace with
 * @param {Array} filePaths - Array of file paths to modify (or null for all)
 * @param {object} options - Search options
 * @returns {object} Result with modified files count and errors
 */
export async function replaceInFiles(searchTerm, replaceTerm, filePaths = null, options = {}) {
  if (!searchTerm || !hasCodeIndex()) {
    return { success: false, error: 'No search term or index not ready' };
  }

  const files = getIndexedFiles();
  const targetFiles = filePaths 
    ? files.filter(f => filePaths.includes(f.path))
    : files;

  let pattern;
  if (options.regex) {
    try {
      pattern = new RegExp(searchTerm, options.caseSensitive ? 'g' : 'gi');
    } catch (e) {
      return { success: false, error: `Invalid regex: ${e.message}` };
    }
  } else {
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundary = options.wholeWord ? '\\b' : '';
    pattern = new RegExp(`${wordBoundary}${escaped}${wordBoundary}`, options.caseSensitive ? 'g' : 'gi');
  }

  const results = {
    success: true,
    modifiedFiles: 0,
    totalReplacements: 0,
    errors: [],
  };

  for (const file of targetFiles) {
    try {
      // Read full file content (not truncated)
      const fullContent = await api.readFileScoped(file.path);
      if (!fullContent) continue;

      const matches = fullContent.match(pattern);
      if (!matches || matches.length === 0) continue;

      const newContent = fullContent.replace(pattern, replaceTerm);
      
      await api.writeFileScoped(file.path, newContent);
      results.modifiedFiles++;
      results.totalReplacements += matches.length;
    } catch (error) {
      results.errors.push({ path: file.path, error: error.message });
    }
  }

  return results;
}

/**
 * Rename a symbol (variable, function, class) across the project
 * This is a simple text-based rename - not AST-aware
 * @param {string} oldName - Current symbol name
 * @param {string} newName - New symbol name
 * @param {Array} filePaths - Optional array of files to limit scope
 * @returns {object} Result with modified files
 */
export async function renameSymbol(oldName, newName, filePaths = null) {
  if (!oldName || !newName || oldName === newName) {
    return { success: false, error: 'Invalid symbol names' };
  }

  // Use whole-word matching for symbol rename
  return replaceInFiles(oldName, newName, filePaths, {
    caseSensitive: true,
    wholeWord: true,
    regex: false,
  });
}

/**
 * Get all files that import/reference a specific file
 * @param {string} targetPath - The file path to find references to
 * @returns {Array} Array of files that reference the target
 */
export function findFileReferences(targetPath) {
  if (!targetPath || !hasCodeIndex()) return [];

  const files = getIndexedFiles();
  const targetName = targetPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '';
  const results = [];

  for (const file of files) {
    if (file.path === targetPath) continue;

    // Look for import/require statements referencing this file
    const importPatterns = [
      new RegExp(`from\\s+['"][^'"]*${targetName}['"]`, 'g'),
      new RegExp(`require\\s*\\(\\s*['"][^'"]*${targetName}['"]\\s*\\)`, 'g'),
      new RegExp(`import\\s*\\(\\s*['"][^'"]*${targetName}['"]\\s*\\)`, 'g'),
    ];

    for (const pattern of importPatterns) {
      if (pattern.test(file.content)) {
        results.push({
          path: file.path,
          name: file.name,
        });
        break;
      }
    }
  }

  return results;
}

export default {
  findInFiles,
  previewReplace,
  replaceInFiles,
  renameSymbol,
  findFileReferences,
};













