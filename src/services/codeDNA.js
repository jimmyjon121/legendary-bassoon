/**
 * Code DNA Service
 * 
 * Finds similar code patterns across the codebase using structural
 * analysis rather than text matching.
 */

// Pattern types for DNA matching
const DNA_PATTERN_TYPES = {
  FUNCTION: 'function',
  CLASS: 'class',
  LOOP: 'loop',
  CONDITIONAL: 'conditional',
  API_CALL: 'api_call',
  ERROR_HANDLING: 'error_handling',
  DATA_TRANSFORM: 'data_transform'
};

// Similarity thresholds
const SIMILARITY_LEVELS = {
  EXACT: 1.0,
  HIGH: 0.85,
  MEDIUM: 0.70,
  LOW: 0.50
};

class CodeDNA {
  constructor() {
    this.fingerprints = new Map(); // id -> fingerprint
    this.fileIndex = new Map(); // file -> [fingerprint ids]
    this.similarities = [];
    this.clusters = [];
    this.listeners = new Set();
  }

  /**
   * Extract DNA fingerprint from code
   */
  extractFingerprint(code, options = {}) {
    const {
      filePath = '',
      startLine = 1,
      name = ''
    } = options;

    const fingerprint = {
      id: `dna_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      filePath,
      startLine,
      name,
      code: code.substring(0, 500), // Store truncated code
      
      // Structural features
      structure: this.analyzeStructure(code),
      
      // Pattern signature
      signature: this.generateSignature(code),
      
      // Metrics
      metrics: this.calculateMetrics(code),
      
      // Hash for quick comparison
      hash: this.hashCode(code),
      
      createdAt: Date.now()
    };

    this.fingerprints.set(fingerprint.id, fingerprint);
    
    // Update file index
    if (filePath) {
      const fileFingerprints = this.fileIndex.get(filePath) || [];
      fileFingerprints.push(fingerprint.id);
      this.fileIndex.set(filePath, fileFingerprints);
    }

    return fingerprint;
  }

  /**
   * Analyze structural features of code
   */
  analyzeStructure(code) {
    const structure = {
      type: this.detectPatternType(code),
      depth: this.calculateNestingDepth(code),
      branches: 0,
      loops: 0,
      calls: 0,
      assignments: 0
    };

    // Count branches (if/else/switch)
    structure.branches = (code.match(/\bif\b|\belse\b|\bswitch\b|\bcase\b|\?\s*:/g) || []).length;
    
    // Count loops
    structure.loops = (code.match(/\bfor\b|\bwhile\b|\bdo\b|\.forEach\b|\.map\b|\.filter\b/g) || []).length;
    
    // Count function calls
    structure.calls = (code.match(/\w+\s*\(/g) || []).length;
    
    // Count assignments
    structure.assignments = (code.match(/[^=!<>]=[^=]/g) || []).length;

    return structure;
  }

  /**
   * Detect the primary pattern type
   */
  detectPatternType(code) {
    if (/^(async\s+)?function\s+\w+|^\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>/m.test(code)) {
      return DNA_PATTERN_TYPES.FUNCTION;
    }
    if (/^class\s+\w+/m.test(code)) {
      return DNA_PATTERN_TYPES.CLASS;
    }
    if (/\bfor\s*\(|\bwhile\s*\(|\.forEach\(|\.map\(/m.test(code)) {
      return DNA_PATTERN_TYPES.LOOP;
    }
    if (/^if\s*\(|^switch\s*\(/m.test(code)) {
      return DNA_PATTERN_TYPES.CONDITIONAL;
    }
    if (/\btry\s*{|\bcatch\s*\(/m.test(code)) {
      return DNA_PATTERN_TYPES.ERROR_HANDLING;
    }
    if (/fetch\(|axios\.|\.get\(|\.post\(/m.test(code)) {
      return DNA_PATTERN_TYPES.API_CALL;
    }
    if (/\.map\(|\.filter\(|\.reduce\(|\.transform/m.test(code)) {
      return DNA_PATTERN_TYPES.DATA_TRANSFORM;
    }
    return DNA_PATTERN_TYPES.FUNCTION;
  }

  /**
   * Calculate nesting depth
   */
  calculateNestingDepth(code) {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of code) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }

    return maxDepth;
  }

  /**
   * Generate pattern signature (normalized representation)
   */
  generateSignature(code) {
    // Normalize code for comparison
    let normalized = code
      // Remove comments
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Normalize string literals
      .replace(/['"`][^'"`]*['"`]/g, 'STRING')
      // Normalize numbers
      .replace(/\b\d+\.?\d*\b/g, 'NUM')
      // Normalize variable names (keep structure)
      .replace(/\b([a-z_]\w*)\b/gi, (match, name) => {
        // Keep keywords
        const keywords = ['if', 'else', 'for', 'while', 'function', 'return', 
                         'const', 'let', 'var', 'class', 'async', 'await',
                         'try', 'catch', 'throw', 'new', 'this', 'true', 'false'];
        return keywords.includes(name.toLowerCase()) ? name : 'VAR';
      })
      .trim();

    return normalized;
  }

  /**
   * Calculate code metrics
   */
  calculateMetrics(code) {
    const lines = code.split('\n');
    
    return {
      totalLines: lines.length,
      codeLines: lines.filter(l => l.trim().length > 0).length,
      complexity: this.estimateComplexity(code),
      paramCount: this.countParameters(code)
    };
  }

  /**
   * Estimate cyclomatic complexity
   */
  estimateComplexity(code) {
    let complexity = 1;
    
    const patterns = [
      /\bif\b/g,
      /\belse\s+if\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\?\s*[^:]+\s*:/g, // Ternary
      /&&/g,
      /\|\|/g
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) complexity += matches.length;
    }

    return complexity;
  }

  /**
   * Count function parameters
   */
  countParameters(code) {
    const match = code.match(/function\s*\w*\s*\(([^)]*)\)|=>\s*{|^\s*\(([^)]*)\)\s*=>/m);
    if (match) {
      const params = match[1] || match[2] || '';
      return params.split(',').filter(p => p.trim().length > 0).length;
    }
    return 0;
  }

  /**
   * Simple hash function
   */
  hashCode(str) {
    let hash = 0;
    const normalized = str.replace(/\s+/g, '');
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Find similar code to a fingerprint
   */
  findSimilar(fingerprintId, options = {}) {
    const {
      minSimilarity = SIMILARITY_LEVELS.MEDIUM,
      maxResults = 10,
      excludeSameFile = true
    } = options;

    const target = this.fingerprints.get(fingerprintId);
    if (!target) return [];

    const matches = [];

    for (const [id, fingerprint] of this.fingerprints) {
      if (id === fingerprintId) continue;
      if (excludeSameFile && fingerprint.filePath === target.filePath) continue;

      const similarity = this.calculateSimilarity(target, fingerprint);
      
      if (similarity >= minSimilarity) {
        matches.push({
          fingerprint,
          similarity,
          similarityPercent: Math.round(similarity * 100),
          matchType: this.classifySimilarity(similarity)
        });
      }
    }

    // Sort by similarity
    matches.sort((a, b) => b.similarity - a.similarity);
    
    return matches.slice(0, maxResults);
  }

  /**
   * Calculate similarity between two fingerprints
   */
  calculateSimilarity(fp1, fp2) {
    let score = 0;
    let weights = 0;

    // Exact hash match
    if (fp1.hash === fp2.hash) {
      return SIMILARITY_LEVELS.EXACT;
    }

    // Structure similarity (40%)
    const structureSim = this.compareStructures(fp1.structure, fp2.structure);
    score += structureSim * 0.4;
    weights += 0.4;

    // Signature similarity (40%)
    const signatureSim = this.compareSignatures(fp1.signature, fp2.signature);
    score += signatureSim * 0.4;
    weights += 0.4;

    // Metrics similarity (20%)
    const metricsSim = this.compareMetrics(fp1.metrics, fp2.metrics);
    score += metricsSim * 0.2;
    weights += 0.2;

    return score / weights;
  }

  /**
   * Compare structural features
   */
  compareStructures(s1, s2) {
    if (s1.type !== s2.type) return 0.3;

    let score = 1.0;

    // Penalize depth differences
    const depthDiff = Math.abs(s1.depth - s2.depth);
    score -= depthDiff * 0.1;

    // Compare counts
    const branchDiff = Math.abs(s1.branches - s2.branches);
    const loopDiff = Math.abs(s1.loops - s2.loops);
    const callDiff = Math.abs(s1.calls - s2.calls);

    score -= (branchDiff + loopDiff + callDiff) * 0.05;

    return Math.max(0, score);
  }

  /**
   * Compare pattern signatures
   */
  compareSignatures(sig1, sig2) {
    if (sig1 === sig2) return 1.0;

    // Jaccard similarity on tokens
    const tokens1 = new Set(sig1.split(/\s+/));
    const tokens2 = new Set(sig2.split(/\s+/));

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
  }

  /**
   * Compare metrics
   */
  compareMetrics(m1, m2) {
    const lineDiff = Math.abs(m1.codeLines - m2.codeLines) / Math.max(m1.codeLines, m2.codeLines);
    const complexityDiff = Math.abs(m1.complexity - m2.complexity) / Math.max(m1.complexity, m2.complexity);
    
    return 1 - (lineDiff + complexityDiff) / 2;
  }

  /**
   * Classify similarity level
   */
  classifySimilarity(score) {
    if (score >= SIMILARITY_LEVELS.EXACT) return 'exact';
    if (score >= SIMILARITY_LEVELS.HIGH) return 'high';
    if (score >= SIMILARITY_LEVELS.MEDIUM) return 'medium';
    return 'low';
  }

  /**
   * Find all duplicates in codebase
   */
  findAllDuplicates(options = {}) {
    const {
      minSimilarity = SIMILARITY_LEVELS.HIGH,
      excludeSameFile = true
    } = options;

    const duplicates = [];
    const processed = new Set();

    for (const [id1, fp1] of this.fingerprints) {
      for (const [id2, fp2] of this.fingerprints) {
        if (id1 === id2) continue;
        if (processed.has(`${id2}:${id1}`)) continue;
        if (excludeSameFile && fp1.filePath === fp2.filePath) continue;

        const similarity = this.calculateSimilarity(fp1, fp2);
        
        if (similarity >= minSimilarity) {
          duplicates.push({
            fingerprint1: fp1,
            fingerprint2: fp2,
            similarity,
            similarityPercent: Math.round(similarity * 100),
            matchType: this.classifySimilarity(similarity)
          });
          processed.add(`${id1}:${id2}`);
        }
      }
    }

    // Sort by similarity
    duplicates.sort((a, b) => b.similarity - a.similarity);
    this.similarities = duplicates;
    
    return duplicates;
  }

  /**
   * Cluster similar code
   */
  clusterSimilar(options = {}) {
    const { minSimilarity = SIMILARITY_LEVELS.MEDIUM } = options;
    
    const clusters = [];
    const assigned = new Set();

    const fingerprints = Array.from(this.fingerprints.values());

    for (const fp of fingerprints) {
      if (assigned.has(fp.id)) continue;

      const cluster = {
        id: `cluster_${clusters.length}`,
        members: [fp],
        centroid: fp
      };

      // Find all similar fingerprints
      for (const other of fingerprints) {
        if (other.id === fp.id || assigned.has(other.id)) continue;

        const similarity = this.calculateSimilarity(fp, other);
        if (similarity >= minSimilarity) {
          cluster.members.push(other);
          assigned.add(other.id);
        }
      }

      if (cluster.members.length > 1) {
        assigned.add(fp.id);
        clusters.push(cluster);
      }
    }

    this.clusters = clusters;
    return clusters;
  }

  /**
   * Get refactoring suggestions
   */
  getSuggestions() {
    const suggestions = [];

    // Suggest based on duplicates
    for (const dup of this.similarities) {
      if (dup.similarity >= SIMILARITY_LEVELS.HIGH) {
        suggestions.push({
          type: 'extract_shared',
          priority: dup.similarity >= SIMILARITY_LEVELS.EXACT ? 'high' : 'medium',
          files: [dup.fingerprint1.filePath, dup.fingerprint2.filePath],
          description: `Extract shared pattern from ${dup.fingerprint1.name || 'code'} and ${dup.fingerprint2.name || 'code'}`,
          similarity: dup.similarityPercent
        });
      }
    }

    // Suggest based on clusters
    for (const cluster of this.clusters) {
      if (cluster.members.length >= 3) {
        suggestions.push({
          type: 'create_utility',
          priority: 'high',
          files: cluster.members.map(m => m.filePath),
          description: `Create shared utility - ${cluster.members.length} similar implementations found`,
          pattern: cluster.centroid.structure.type
        });
      }
    }

    return suggestions;
  }

  /**
   * Get all fingerprints
   */
  getFingerprints() {
    return Array.from(this.fingerprints.values());
  }

  /**
   * Get fingerprint by ID
   */
  getFingerprint(id) {
    return this.fingerprints.get(id);
  }

  /**
   * Get fingerprints for file
   */
  getFileFingerprints(filePath) {
    const ids = this.fileIndex.get(filePath) || [];
    return ids.map(id => this.fingerprints.get(id)).filter(Boolean);
  }

  /**
   * Remove fingerprint
   */
  removeFingerprint(id) {
    const fp = this.fingerprints.get(id);
    if (fp) {
      this.fingerprints.delete(id);
      
      // Update file index
      const fileIds = this.fileIndex.get(fp.filePath) || [];
      this.fileIndex.set(fp.filePath, fileIds.filter(fid => fid !== id));
    }
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      totalFingerprints: this.fingerprints.size,
      filesIndexed: this.fileIndex.size,
      duplicatesFound: this.similarities.length,
      clustersFound: this.clusters.length,
      suggestions: this.getSuggestions().length
    };
  }

  /**
   * Clear all data
   */
  clear() {
    this.fingerprints.clear();
    this.fileIndex.clear();
    this.similarities = [];
    this.clusters = [];
    this.notifyListeners();
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
      statistics: this.getStatistics(),
      suggestions: this.getSuggestions()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Code DNA listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getCodeDNA() {
  if (!instance) {
    instance = new CodeDNA();
  }
  return instance;
}

export { DNA_PATTERN_TYPES, SIMILARITY_LEVELS };
export default CodeDNA;