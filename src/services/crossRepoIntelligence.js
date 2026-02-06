/**
 * Cross-Repository Intelligence Service
 * 
 * Analyzes patterns across all user projects to identify reusable code,
 * best practices, and opportunities for shared libraries.
 */

// Pattern categories
const PATTERN_CATEGORIES = {
  AUTH: {
    id: 'auth',
    name: 'Authentication',
    icon: '🔐',
    patterns: ['login', 'logout', 'auth', 'token', 'session', 'jwt', 'oauth']
  },
  API: {
    id: 'api',
    name: 'API Layer',
    icon: '🌐',
    patterns: ['fetch', 'axios', 'request', 'endpoint', 'api', 'rest', 'graphql']
  },
  VALIDATION: {
    id: 'validation',
    name: 'Validation',
    icon: '✅',
    patterns: ['validate', 'schema', 'yup', 'zod', 'check', 'sanitize']
  },
  STATE: {
    id: 'state',
    name: 'State Management',
    icon: '📊',
    patterns: ['store', 'reducer', 'action', 'zustand', 'redux', 'context']
  },
  UTILS: {
    id: 'utils',
    name: 'Utilities',
    icon: '🔧',
    patterns: ['utils', 'helpers', 'format', 'parse', 'convert']
  },
  HOOKS: {
    id: 'hooks',
    name: 'React Hooks',
    icon: '🪝',
    patterns: ['use', 'hook', 'useState', 'useEffect', 'useCallback']
  },
  COMPONENTS: {
    id: 'components',
    name: 'UI Components',
    icon: '🎨',
    patterns: ['Button', 'Modal', 'Form', 'Input', 'Table', 'Card']
  },
  ERROR_HANDLING: {
    id: 'error_handling',
    name: 'Error Handling',
    icon: '⚠️',
    patterns: ['error', 'catch', 'boundary', 'fallback', 'retry']
  }
};

// Similarity thresholds
const SIMILARITY_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.70,
  LOW: 0.50
};

class CrossRepoIntelligence {
  constructor() {
    this.repositories = new Map(); // path -> repo data
    this.patterns = [];
    this.similarities = [];
    this.bestPractices = [];
    this.listeners = new Set();
    this.isScanning = false;
    this.lastScan = null;
  }

  /**
   * Register a repository for analysis
   */
  registerRepository(repoPath, metadata = {}) {
    const repo = {
      path: repoPath,
      name: metadata.name || repoPath.split('/').pop(),
      registeredAt: Date.now(),
      lastScanned: null,
      patterns: [],
      files: [],
      summary: null,
      ...metadata
    };

    this.repositories.set(repoPath, repo);
    this.notifyListeners();
    return repo;
  }

  /**
   * Unregister a repository
   */
  unregisterRepository(repoPath) {
    this.repositories.delete(repoPath);
    this.rebuildPatterns();
    this.notifyListeners();
  }

  /**
   * Get all registered repositories
   */
  getRepositories() {
    return Array.from(this.repositories.values());
  }

  /**
   * Scan a repository for patterns
   */
  async scanRepository(repoPath, files) {
    const repo = this.repositories.get(repoPath);
    if (!repo) {
      throw new Error(`Repository not registered: ${repoPath}`);
    }

    this.isScanning = true;
    this.notifyListeners();

    try {
      const patterns = [];
      const codeSnippets = [];

      for (const file of files) {
        if (!this.isAnalyzableFile(file.path)) continue;

        const filePatterns = this.extractPatterns(file.content, file.path);
        patterns.push(...filePatterns);

        // Extract reusable code snippets
        const snippets = this.extractSnippets(file.content, file.path);
        codeSnippets.push(...snippets);
      }

      repo.patterns = patterns;
      repo.snippets = codeSnippets;
      repo.lastScanned = Date.now();
      repo.summary = this.generateRepoSummary(repo);

      this.rebuildPatterns();
      this.findSimilarities();
      this.identifyBestPractices();

    } finally {
      this.isScanning = false;
      this.lastScan = Date.now();
      this.notifyListeners();
    }

    return repo;
  }

  /**
   * Check if file should be analyzed
   */
  isAnalyzableFile(filePath) {
    const analyzableExtensions = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'];
    const excludePatterns = ['node_modules', 'dist', 'build', '.min.', 'vendor'];
    
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const isAnalyzable = analyzableExtensions.includes(ext);
    const isExcluded = excludePatterns.some(p => filePath.includes(p));
    
    return isAnalyzable && !isExcluded;
  }

  /**
   * Extract patterns from file content
   */
  extractPatterns(content, filePath) {
    const patterns = [];

    for (const [categoryId, category] of Object.entries(PATTERN_CATEGORIES)) {
      for (const patternKeyword of category.patterns) {
        const regex = new RegExp(`\\b${patternKeyword}\\w*\\b`, 'gi');
        const matches = content.match(regex);
        
        if (matches && matches.length > 0) {
          patterns.push({
            category: categoryId,
            categoryName: category.name,
            icon: category.icon,
            keyword: patternKeyword,
            matches: [...new Set(matches)],
            count: matches.length,
            filePath
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Extract reusable code snippets
   */
  extractSnippets(content, filePath) {
    const snippets = [];

    // Extract functions
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g;
    let match;
    
    while ((match = functionRegex.exec(content)) !== null) {
      const functionName = match[1];
      const startIndex = match.index;
      const snippet = this.extractFunctionBody(content, startIndex);
      
      if (snippet && snippet.length > 50 && snippet.length < 2000) {
        snippets.push({
          type: 'function',
          name: functionName,
          code: snippet,
          hash: this.hashCode(snippet),
          filePath,
          lines: snippet.split('\n').length
        });
      }
    }

    // Extract React hooks
    const hookRegex = /(?:export\s+)?const\s+(use\w+)\s*=\s*\([^)]*\)\s*=>/g;
    while ((match = hookRegex.exec(content)) !== null) {
      const hookName = match[1];
      const startIndex = match.index;
      const snippet = this.extractArrowFunctionBody(content, startIndex);
      
      if (snippet && snippet.length > 50 && snippet.length < 2000) {
        snippets.push({
          type: 'hook',
          name: hookName,
          code: snippet,
          hash: this.hashCode(snippet),
          filePath,
          lines: snippet.split('\n').length
        });
      }
    }

    return snippets;
  }

  /**
   * Extract function body from content
   */
  extractFunctionBody(content, startIndex) {
    let depth = 0;
    let started = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') {
        depth++;
        started = true;
      } else if (content[i] === '}') {
        depth--;
        if (started && depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    return content.substring(startIndex, endIndex);
  }

  /**
   * Extract arrow function body
   */
  extractArrowFunctionBody(content, startIndex) {
    const arrowIndex = content.indexOf('=>', startIndex);
    if (arrowIndex === -1) return null;

    // Check if it's a block body { } or expression
    let bodyStart = arrowIndex + 2;
    while (content[bodyStart] === ' ' || content[bodyStart] === '\n') bodyStart++;

    if (content[bodyStart] === '{') {
      return this.extractFunctionBody(content, bodyStart);
    } else {
      // Expression body - find the end (semicolon or closing paren)
      let endIndex = content.indexOf(';', bodyStart);
      if (endIndex === -1) endIndex = content.length;
      return content.substring(startIndex, endIndex + 1);
    }
  }

  /**
   * Simple hash function for code comparison
   */
  hashCode(str) {
    let hash = 0;
    const normalized = str.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Calculate similarity between two code snippets
   */
  calculateSimilarity(code1, code2) {
    // Normalize code
    const normalize = (code) => code
      .replace(/\s+/g, ' ')
      .replace(/['"`]/g, '"')
      .toLowerCase()
      .trim();

    const norm1 = normalize(code1);
    const norm2 = normalize(code2);

    if (norm1 === norm2) return 1.0;

    // Calculate Jaccard similarity of tokens
    const tokens1 = new Set(norm1.split(/\W+/).filter(t => t.length > 2));
    const tokens2 = new Set(norm2.split(/\W+/).filter(t => t.length > 2));

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
  }

  /**
   * Rebuild global patterns from all repositories
   */
  rebuildPatterns() {
    this.patterns = [];
    
    for (const repo of this.repositories.values()) {
      if (repo.patterns) {
        repo.patterns.forEach(pattern => {
          this.patterns.push({
            ...pattern,
            repoPath: repo.path,
            repoName: repo.name
          });
        });
      }
    }
  }

  /**
   * Find similar code across repositories
   */
  findSimilarities() {
    this.similarities = [];
    const allSnippets = [];

    // Collect all snippets
    for (const repo of this.repositories.values()) {
      if (repo.snippets) {
        repo.snippets.forEach(snippet => {
          allSnippets.push({
            ...snippet,
            repoPath: repo.path,
            repoName: repo.name
          });
        });
      }
    }

    // Compare snippets
    for (let i = 0; i < allSnippets.length; i++) {
      for (let j = i + 1; j < allSnippets.length; j++) {
        const snippet1 = allSnippets[i];
        const snippet2 = allSnippets[j];

        // Skip if from same repo
        if (snippet1.repoPath === snippet2.repoPath) continue;

        // Quick hash check first
        if (snippet1.hash === snippet2.hash) {
          this.similarities.push({
            similarity: 1.0,
            snippet1,
            snippet2,
            type: 'identical'
          });
          continue;
        }

        // Detailed similarity for same-type snippets
        if (snippet1.type === snippet2.type) {
          const similarity = this.calculateSimilarity(snippet1.code, snippet2.code);
          
          if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) {
            this.similarities.push({
              similarity,
              snippet1,
              snippet2,
              type: similarity >= SIMILARITY_THRESHOLDS.HIGH ? 'high' : 'medium'
            });
          }
        }
      }
    }

    // Sort by similarity
    this.similarities.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Identify best practices from patterns
   */
  identifyBestPractices() {
    this.bestPractices = [];
    
    // Group patterns by category
    const categoryUsage = {};
    
    for (const pattern of this.patterns) {
      if (!categoryUsage[pattern.category]) {
        categoryUsage[pattern.category] = {
          category: pattern.category,
          categoryName: pattern.categoryName,
          icon: pattern.icon,
          repos: new Set(),
          patterns: [],
          totalCount: 0
        };
      }
      
      categoryUsage[pattern.category].repos.add(pattern.repoPath);
      categoryUsage[pattern.category].patterns.push(pattern);
      categoryUsage[pattern.category].totalCount += pattern.count;
    }

    // Identify patterns used across multiple repos
    for (const usage of Object.values(categoryUsage)) {
      if (usage.repos.size >= 2) {
        this.bestPractices.push({
          category: usage.category,
          categoryName: usage.categoryName,
          icon: usage.icon,
          repoCount: usage.repos.size,
          totalUsage: usage.totalCount,
          suggestion: this.generateBestPracticeSuggestion(usage)
        });
      }
    }

    // Sort by repo count
    this.bestPractices.sort((a, b) => b.repoCount - a.repoCount);
  }

  /**
   * Generate suggestion for best practice
   */
  generateBestPracticeSuggestion(usage) {
    if (usage.repoCount >= 3) {
      return `You use ${usage.categoryName} patterns in ${usage.repoCount} projects. Consider creating a shared library.`;
    }
    return `${usage.categoryName} pattern found in ${usage.repoCount} projects.`;
  }

  /**
   * Generate repository summary
   */
  generateRepoSummary(repo) {
    const categoryBreakdown = {};
    
    for (const pattern of repo.patterns) {
      if (!categoryBreakdown[pattern.category]) {
        categoryBreakdown[pattern.category] = {
          name: pattern.categoryName,
          icon: pattern.icon,
          count: 0
        };
      }
      categoryBreakdown[pattern.category].count += pattern.count;
    }

    return {
      patternCount: repo.patterns.length,
      snippetCount: repo.snippets?.length || 0,
      categoryBreakdown,
      dominantCategory: Object.entries(categoryBreakdown)
        .sort((a, b) => b[1].count - a[1].count)[0]?.[0]
    };
  }

  /**
   * Get suggestions for extracting shared code
   */
  getSuggestions() {
    const suggestions = [];

    // Suggest based on high similarity
    const highSimilarity = this.similarities.filter(s => s.type === 'high' || s.type === 'identical');
    
    if (highSimilarity.length > 0) {
      suggestions.push({
        type: 'extract_shared',
        priority: 'high',
        title: 'Extract Shared Code',
        description: `Found ${highSimilarity.length} highly similar code snippets across repositories`,
        items: highSimilarity.slice(0, 5).map(s => ({
          name: s.snippet1.name,
          repos: [s.snippet1.repoName, s.snippet2.repoName],
          similarity: Math.round(s.similarity * 100)
        }))
      });
    }

    // Suggest based on best practices
    const sharedPractices = this.bestPractices.filter(bp => bp.repoCount >= 3);
    
    if (sharedPractices.length > 0) {
      suggestions.push({
        type: 'shared_library',
        priority: 'medium',
        title: 'Create Shared Library',
        description: `${sharedPractices.length} patterns are used in 3+ projects`,
        items: sharedPractices.map(bp => ({
          category: bp.categoryName,
          repoCount: bp.repoCount,
          suggestion: bp.suggestion
        }))
      });
    }

    return suggestions;
  }

  /**
   * Search for pattern across all repos
   */
  searchPattern(query) {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const repo of this.repositories.values()) {
      for (const snippet of repo.snippets || []) {
        if (snippet.name.toLowerCase().includes(queryLower) ||
            snippet.code.toLowerCase().includes(queryLower)) {
          results.push({
            ...snippet,
            repoName: repo.name,
            repoPath: repo.path
          });
        }
      }
    }

    return results;
  }

  /**
   * Get cross-repo statistics
   */
  getStatistics() {
    const repos = this.getRepositories();
    let totalPatterns = 0;
    let totalSnippets = 0;

    for (const repo of repos) {
      totalPatterns += repo.patterns?.length || 0;
      totalSnippets += repo.snippets?.length || 0;
    }

    return {
      repositories: repos.length,
      totalPatterns,
      totalSnippets,
      similarities: this.similarities.length,
      highSimilarities: this.similarities.filter(s => s.type === 'high' || s.type === 'identical').length,
      bestPractices: this.bestPractices.length,
      isScanning: this.isScanning,
      lastScan: this.lastScan
    };
  }

  /**
   * Export analysis
   */
  exportAnalysis() {
    return {
      repositories: this.getRepositories(),
      patterns: this.patterns,
      similarities: this.similarities,
      bestPractices: this.bestPractices,
      suggestions: this.getSuggestions(),
      statistics: this.getStatistics(),
      exportedAt: Date.now()
    };
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      repositories: this.getRepositories(),
      statistics: this.getStatistics(),
      suggestions: this.getSuggestions()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Cross-repo intelligence listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getCrossRepoIntelligence() {
  if (!instance) {
    instance = new CrossRepoIntelligence();
  }
  return instance;
}

export { PATTERN_CATEGORIES, SIMILARITY_THRESHOLDS };
export default CrossRepoIntelligence;
