/**
 * AST Refactor Tools
 * 
 * Provides safe, AST-aware refactoring operations:
 * - Rename symbol (across files)
 * - Extract function
 * - Move to file (with import updates)
 * - Add import
 * 
 * Uses regex-based parsing for simplicity (no Babel dependency).
 * For production, consider using @babel/parser + @babel/traverse.
 */

import { api } from '../utils/electronAPI';

// ============================================================================
// Symbol Finding
// ============================================================================

/**
 * Find all occurrences of a symbol in content
 */
export function findSymbolOccurrences(content, symbolName) {
  const occurrences = [];
  const lines = content.split('\n');
  
  // Word boundary regex to match exact symbol
  const regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`, 'g');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    regex.lastIndex = 0;
    
    while ((match = regex.exec(line)) !== null) {
      occurrences.push({
        line: i + 1,
        column: match.index,
        context: line.trim(),
        type: inferOccurrenceType(line, match.index, symbolName)
      });
    }
  }
  
  return occurrences;
}

/**
 * Infer the type of occurrence (definition, usage, import, etc.)
 */
function inferOccurrenceType(line, column, symbolName) {
  const beforeSymbol = line.slice(0, column);
  const afterSymbol = line.slice(column + symbolName.length);
  
  // Import patterns
  if (/import\s+.*{.*$/.test(beforeSymbol) || /^.*}\s+from/.test(afterSymbol)) {
    return 'import';
  }
  if (/import\s+$/.test(beforeSymbol)) {
    return 'import-default';
  }
  
  // Export patterns
  if (/export\s+(default\s+)?(const|let|var|function|class|interface|type|enum)\s+$/.test(beforeSymbol)) {
    return 'export-definition';
  }
  if (/export\s+{\s*$/.test(beforeSymbol) || /^.*}\s*(;|$)/.test(afterSymbol)) {
    return 'export';
  }
  
  // Definition patterns
  if (/(const|let|var)\s+$/.test(beforeSymbol)) {
    return 'variable-definition';
  }
  if (/function\s+$/.test(beforeSymbol)) {
    return 'function-definition';
  }
  if (/class\s+$/.test(beforeSymbol)) {
    return 'class-definition';
  }
  if (/interface\s+$/.test(beforeSymbol)) {
    return 'interface-definition';
  }
  if (/type\s+$/.test(beforeSymbol) && /\s*=/.test(afterSymbol)) {
    return 'type-definition';
  }
  
  // Parameter
  if (/\(\s*$/.test(beforeSymbol) || /,\s*$/.test(beforeSymbol)) {
    return 'parameter';
  }
  
  // Property access
  if (/\.\s*$/.test(beforeSymbol)) {
    return 'property-access';
  }
  
  // Function call
  if (/^\s*\(/.test(afterSymbol)) {
    return 'function-call';
  }
  
  return 'usage';
}

// ============================================================================
// Rename Symbol
// ============================================================================

/**
 * Rename a symbol in content
 */
export function renameSymbolInContent(content, oldName, newName, options = {}) {
  const { skipStrings = true, skipComments = true } = options;
  
  const lines = content.split('\n');
  const changes = [];
  
  const regex = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let modified = false;
    
    // Skip comment lines (simple detection)
    if (skipComments && (line.trim().startsWith('//') || line.trim().startsWith('*'))) {
      continue;
    }
    
    // Replace occurrences
    const newLine = line.replace(regex, (match, offset) => {
      // Skip if inside string (simple detection)
      if (skipStrings) {
        const before = line.slice(0, offset);
        const singleQuotes = (before.match(/'/g) || []).length;
        const doubleQuotes = (before.match(/"/g) || []).length;
        const backticks = (before.match(/`/g) || []).length;
        
        if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
          return match; // Inside a string
        }
      }
      
      modified = true;
      return newName;
    });
    
    if (modified) {
      changes.push({
        line: i + 1,
        oldLine: line,
        newLine
      });
      lines[i] = newLine;
    }
  }
  
  return {
    content: lines.join('\n'),
    changes
  };
}

/**
 * Rename a symbol across multiple files
 */
export async function renameSymbolInProject(projectRoot, oldName, newName, files) {
  const results = [];
  
  for (const filePath of files) {
    try {
      const content = await api.readFile(filePath);
      if (!content) continue;
      
      // Check if file contains the symbol
      if (!content.includes(oldName)) continue;
      
      const { content: newContent, changes } = renameSymbolInContent(content, oldName, newName);
      
      if (changes.length > 0) {
        results.push({
          path: filePath,
          changes,
          oldContent: content,
          newContent
        });
      }
    } catch (error) {
      console.warn(`[AST] Failed to process ${filePath}:`, error.message);
    }
  }
  
  return results;
}

// ============================================================================
// Extract Function
// ============================================================================

/**
 * Extract a code block into a new function
 */
export function extractFunction(content, startLine, endLine, functionName, options = {}) {
  const { async: isAsync = false, exportFn = false } = options;
  
  const lines = content.split('\n');
  
  // Get the code to extract
  const extractedLines = lines.slice(startLine - 1, endLine);
  const extractedCode = extractedLines.join('\n');
  
  // Detect variables used but not defined in the block (simple detection)
  const usedVars = detectUsedVariables(extractedCode);
  const definedVars = detectDefinedVariables(extractedCode);
  const params = usedVars.filter(v => !definedVars.includes(v));
  
  // Build the new function
  const asyncPrefix = isAsync ? 'async ' : '';
  const exportPrefix = exportFn ? 'export ' : '';
  const paramStr = params.join(', ');
  
  const newFunction = `${exportPrefix}${asyncPrefix}function ${functionName}(${paramStr}) {
${extractedLines.map(l => '  ' + l).join('\n')}
}`;
  
  // Replace extracted code with function call
  const indent = extractedLines[0]?.match(/^(\s*)/)?.[1] || '';
  const awaitPrefix = isAsync ? 'await ' : '';
  const callStr = params.length > 0 
    ? `${indent}${awaitPrefix}${functionName}(${paramStr});`
    : `${indent}${awaitPrefix}${functionName}();`;
  
  // Build new content
  const newLines = [
    ...lines.slice(0, startLine - 1),
    callStr,
    ...lines.slice(endLine)
  ];
  
  return {
    newContent: newLines.join('\n'),
    extractedFunction: newFunction,
    functionCall: callStr,
    params,
    startLine,
    endLine
  };
}

/**
 * Detect variables used in code (simple detection)
 */
function detectUsedVariables(code) {
  const vars = new Set();
  
  // Match word characters that look like variables
  const matches = code.match(/\b[a-z_][a-zA-Z0-9_]*\b/g) || [];
  
  // Filter out keywords
  const keywords = ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'return', 'function', 'const', 'let', 'var', 'class', 'new', 'this', 'true', 'false',
    'null', 'undefined', 'typeof', 'instanceof', 'async', 'await', 'try', 'catch', 'finally',
    'throw', 'import', 'export', 'default', 'from'];
  
  for (const match of matches) {
    if (!keywords.includes(match)) {
      vars.add(match);
    }
  }
  
  return Array.from(vars);
}

/**
 * Detect variables defined in code (simple detection)
 */
function detectDefinedVariables(code) {
  const vars = [];
  
  // Match const/let/var declarations
  const declMatches = code.matchAll(/(const|let|var)\s+(\w+)/g);
  for (const match of declMatches) {
    vars.push(match[2]);
  }
  
  // Match function parameters
  const funcMatches = code.matchAll(/function\s+\w*\s*\(([^)]*)\)/g);
  for (const match of funcMatches) {
    const params = match[1].split(',').map(p => p.trim().split(/\s|:/)[0]);
    vars.push(...params.filter(p => p));
  }
  
  // Match arrow function parameters
  const arrowMatches = code.matchAll(/(?:\(([^)]*)\)|(\w+))\s*=>/g);
  for (const match of arrowMatches) {
    if (match[1]) {
      const params = match[1].split(',').map(p => p.trim().split(/\s|:/)[0]);
      vars.push(...params.filter(p => p));
    } else if (match[2]) {
      vars.push(match[2]);
    }
  }
  
  return vars;
}

// ============================================================================
// Move to File
// ============================================================================

/**
 * Move a symbol to a different file
 */
export async function moveToFile(sourceContent, symbolName, targetPath, options = {}) {
  const { createIfMissing = true } = options;
  
  // Find the symbol definition
  const definition = extractSymbolDefinition(sourceContent, symbolName);
  
  if (!definition) {
    throw new Error(`Symbol "${symbolName}" not found in source`);
  }
  
  // Remove from source
  const lines = sourceContent.split('\n');
  const newSourceLines = [
    ...lines.slice(0, definition.startLine - 1),
    ...lines.slice(definition.endLine)
  ];
  
  // Build target content
  let targetContent = '';
  try {
    targetContent = await api.readFile(targetPath) || '';
  } catch {
    if (!createIfMissing) {
      throw new Error(`Target file does not exist: ${targetPath}`);
    }
  }
  
  // Add to target
  const exportedDefinition = definition.isExported 
    ? definition.code 
    : `export ${definition.code}`;
  
  const newTargetContent = targetContent 
    ? `${targetContent}\n\n${exportedDefinition}`
    : exportedDefinition;
  
  // Build import statement for source
  const relativePath = computeRelativePath(targetPath);
  const importStatement = `import { ${symbolName} } from '${relativePath}';`;
  
  // Add import to source (after existing imports)
  const importInsertIndex = findImportInsertIndex(newSourceLines);
  newSourceLines.splice(importInsertIndex, 0, importStatement);
  
  return {
    newSourceContent: newSourceLines.join('\n'),
    newTargetContent,
    importStatement,
    movedCode: definition.code,
    symbolName
  };
}

/**
 * Extract a symbol's definition from content
 */
function extractSymbolDefinition(content, symbolName) {
  const lines = content.split('\n');
  
  // Patterns for different definition types
  const patterns = [
    // export function/const/class
    new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${escapeRegex(symbolName)}\\s*\\(`),
    new RegExp(`^(export\\s+)?(const|let|var)\\s+${escapeRegex(symbolName)}\\s*=`),
    new RegExp(`^(export\\s+)?class\\s+${escapeRegex(symbolName)}\\s*[{<]`),
    new RegExp(`^(export\\s+)?(interface|type)\\s+${escapeRegex(symbolName)}\\s*[{<=]`),
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (const pattern of patterns) {
      if (pattern.test(line.trim())) {
        // Find the end of the definition
        const endLine = findDefinitionEnd(lines, i);
        
        return {
          startLine: i + 1,
          endLine: endLine + 1,
          code: lines.slice(i, endLine + 1).join('\n'),
          isExported: line.trim().startsWith('export')
        };
      }
    }
  }
  
  return null;
}

/**
 * Find the end of a definition (brace matching)
 */
function findDefinitionEnd(lines, startIndex) {
  let braceCount = 0;
  let started = false;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    for (const char of line) {
      if (char === '{' || char === '(') {
        braceCount++;
        started = true;
      } else if (char === '}' || char === ')') {
        braceCount--;
      }
    }
    
    // End of single-line definition (no braces)
    if (!started && line.includes(';')) {
      return i;
    }
    
    // End of multi-line definition
    if (started && braceCount === 0) {
      return i;
    }
  }
  
  return lines.length - 1;
}

/**
 * Find where to insert a new import
 */
function findImportInsertIndex(lines) {
  let lastImportIndex = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) {
      lastImportIndex = i + 1;
    } else if (lines[i].trim() && !lines[i].trim().startsWith('//')) {
      break;
    }
  }
  
  return lastImportIndex;
}

// ============================================================================
// Add Import
// ============================================================================

/**
 * Add an import statement to content
 */
export function addImport(content, importPath, namedImports = [], defaultImport = null) {
  const lines = content.split('\n');
  
  // Check if import already exists
  const existingImportIndex = lines.findIndex(line => 
    line.includes(`from '${importPath}'`) || line.includes(`from "${importPath}"`)
  );
  
  if (existingImportIndex !== -1) {
    // Merge with existing import
    const existingLine = lines[existingImportIndex];
    
    if (namedImports.length > 0) {
      // Add named imports
      const existingNamed = existingLine.match(/\{([^}]*)\}/)?.[1] || '';
      const existingNames = existingNamed.split(',').map(s => s.trim()).filter(Boolean);
      const newNames = [...new Set([...existingNames, ...namedImports])];
      
      if (existingLine.includes('{')) {
        lines[existingImportIndex] = existingLine.replace(
          /\{[^}]*\}/,
          `{ ${newNames.join(', ')} }`
        );
      } else {
        // Add named imports to default-only import
        lines[existingImportIndex] = existingLine.replace(
          /from\s+(['"])/,
          `{ ${newNames.join(', ')} } from $1`
        );
      }
    }
    
    return {
      content: lines.join('\n'),
      modified: true,
      action: 'merged'
    };
  }
  
  // Build new import statement
  const parts = [];
  if (defaultImport) {
    parts.push(defaultImport);
  }
  if (namedImports.length > 0) {
    parts.push(`{ ${namedImports.join(', ')} }`);
  }
  
  const importStatement = `import ${parts.join(', ')} from '${importPath}';`;
  
  // Find where to insert
  const insertIndex = findImportInsertIndex(lines);
  lines.splice(insertIndex, 0, importStatement);
  
  return {
    content: lines.join('\n'),
    modified: true,
    action: 'added',
    importStatement
  };
}

// ============================================================================
// Utilities
// ============================================================================

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function computeRelativePath(targetPath) {
  // Simplified - just return the path without extension
  return targetPath.replace(/\.(js|ts|jsx|tsx)$/, '').replace(/\\/g, '/');
}

// ============================================================================
// Export
// ============================================================================

export default {
  findSymbolOccurrences,
  renameSymbolInContent,
  renameSymbolInProject,
  extractFunction,
  moveToFile,
  addImport
};
