/**
 * Provenance Tracker
 * 
 * Ensures AI only speaks about code it has actually read.
 * Tracks:
 * - Files read during session
 * - Citations made (claims with file references)
 * - Coverage metrics
 * 
 * This eliminates hallucination about code that doesn't exist.
 */

// ============================================================================
// Provenance Tracker Class
// ============================================================================

export class ProvenanceTracker {
  constructor() {
    this.filesRead = new Map(); // path -> { content, readAt, lines, hash }
    this.citations = [];        // [{ claim, filePath, lineRange, snippet, citedAt }]
    this.sessionId = `session_${Date.now()}`;
    this.createdAt = Date.now();
  }

  /**
   * Record that a file was read
   */
  recordFileRead(path, content, metadata = {}) {
    const lines = content.split('\n');
    const hash = this.hashContent(content);
    
    this.filesRead.set(path, {
      content,
      contentLower: content.toLowerCase(),
      lines,
      lineCount: lines.length,
      hash,
      readAt: Date.now(),
      size: content.length,
      ...metadata
    });
    
    return {
      path,
      lineCount: lines.length,
      size: content.length,
      hash
    };
  }

  /**
   * Check if we have read a specific file
   */
  hasRead(path) {
    return this.filesRead.has(path);
  }

  /**
   * Check if we can cite from a file (must have read it)
   */
  canCite(path) {
    return this.hasRead(path);
  }

  /**
   * Get content of a file we've read
   */
  getReadContent(path) {
    const file = this.filesRead.get(path);
    return file ? file.content : null;
  }

  /**
   * Get specific lines from a file we've read
   */
  getReadLines(path, startLine, endLine) {
    const file = this.filesRead.get(path);
    if (!file) return null;
    
    const start = Math.max(1, startLine) - 1;
    const end = Math.min(endLine || start + 1, file.lineCount);
    
    return {
      lines: file.lines.slice(start, end),
      startLine: start + 1,
      endLine: end
    };
  }

  /**
   * Add a citation - linking a claim to actual code
   */
  addCitation(claim, filePath, startLine, endLine) {
    if (!this.canCite(filePath)) {
      throw new Error(`Cannot cite ${filePath} - file not in provenance ledger. Read the file first.`);
    }
    
    const file = this.filesRead.get(filePath);
    const lines = file.lines.slice(startLine - 1, endLine);
    const snippet = lines.join('\n');
    
    const citation = {
      id: `cite_${Date.now()}_${this.citations.length}`,
      claim,
      filePath,
      lineRange: [startLine, endLine],
      snippet,
      snippetHash: this.hashContent(snippet),
      citedAt: Date.now()
    };
    
    this.citations.push(citation);
    return citation;
  }

  /**
   * Verify that a claim's citation is still valid (content hasn't changed)
   */
  verifyCitation(citationId, currentContent) {
    const citation = this.citations.find(c => c.id === citationId);
    if (!citation) return { valid: false, reason: 'Citation not found' };
    
    const currentHash = this.hashContent(currentContent);
    const file = this.filesRead.get(citation.filePath);
    
    if (!file) {
      return { valid: false, reason: 'Source file not in ledger' };
    }
    
    // Check if the specific lines still match
    const currentLines = currentContent.split('\n').slice(
      citation.lineRange[0] - 1,
      citation.lineRange[1]
    );
    const currentSnippet = currentLines.join('\n');
    const snippetHash = this.hashContent(currentSnippet);
    
    if (snippetHash !== citation.snippetHash) {
      return {
        valid: false,
        reason: 'Content has changed since citation was made',
        originalSnippet: citation.snippet,
        currentSnippet
      };
    }
    
    return { valid: true };
  }

  /**
   * Get all files read in this session
   */
  getFilesRead() {
    return Array.from(this.filesRead.keys());
  }

  /**
   * Get detailed info about files read
   */
  getFilesReadDetails() {
    return Array.from(this.filesRead.entries()).map(([path, data]) => ({
      path,
      lineCount: data.lineCount,
      size: data.size,
      readAt: data.readAt,
      hash: data.hash
    }));
  }

  /**
   * Get all citations
   */
  getCitations() {
    return this.citations.map(c => ({
      ...c,
      // Don't include full snippet in summary
      snippetPreview: c.snippet.slice(0, 100) + (c.snippet.length > 100 ? '...' : '')
    }));
  }

  /**
   * Check if a code reference is grounded (we've actually read it)
   */
  isGrounded(filePath, lineNumber = null) {
    const file = this.filesRead.get(filePath);
    if (!file) return { grounded: false, reason: 'File not read' };
    
    if (lineNumber !== null) {
      if (lineNumber < 1 || lineNumber > file.lineCount) {
        return { grounded: false, reason: `Line ${lineNumber} out of range (1-${file.lineCount})` };
      }
    }
    
    return { grounded: true };
  }

  /**
   * Search within files we've read
   */
  searchReadFiles(query, options = {}) {
    const { caseSensitive = false, maxResults = 20 } = options;
    const results = [];
    const queryLower = caseSensitive ? query : query.toLowerCase();
    
    for (const [path, file] of this.filesRead) {
      if (results.length >= maxResults) break;
      
      const searchContent = caseSensitive ? file.content : file.contentLower;
      
      for (let i = 0; i < file.lines.length && results.length < maxResults; i++) {
        const line = file.lines[i];
        const searchLine = caseSensitive ? line : line.toLowerCase();
        
        if (searchLine.includes(queryLower)) {
          results.push({
            path,
            line: i + 1,
            content: line.trim(),
            matchIndex: searchLine.indexOf(queryLower)
          });
        }
      }
    }
    
    return results;
  }

  /**
   * Calculate coverage metrics
   */
  calculateCoverage() {
    const totalLinesRead = Array.from(this.filesRead.values())
      .reduce((sum, f) => sum + f.lineCount, 0);
    
    const citedLines = new Set();
    for (const citation of this.citations) {
      for (let i = citation.lineRange[0]; i <= citation.lineRange[1]; i++) {
        citedLines.add(`${citation.filePath}:${i}`);
      }
    }
    
    return {
      filesRead: this.filesRead.size,
      totalLinesRead,
      citationsCount: this.citations.length,
      uniqueLinesCited: citedLines.size,
      coverageRatio: totalLinesRead > 0 ? citedLines.size / totalLinesRead : 0
    };
  }

  /**
   * Get a provenance report
   */
  getProvenanceReport() {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      duration: Date.now() - this.createdAt,
      filesRead: this.getFilesReadDetails(),
      citations: this.getCitations(),
      coverage: this.calculateCoverage()
    };
  }

  /**
   * Export provenance data for verification
   */
  export() {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      files: Array.from(this.filesRead.entries()).map(([path, data]) => ({
        path,
        hash: data.hash,
        lineCount: data.lineCount,
        readAt: data.readAt
      })),
      citations: this.citations.map(c => ({
        id: c.id,
        claim: c.claim,
        filePath: c.filePath,
        lineRange: c.lineRange,
        snippetHash: c.snippetHash,
        citedAt: c.citedAt
      }))
    };
  }

  /**
   * Clear all tracked data
   */
  clear() {
    this.filesRead.clear();
    this.citations = [];
  }

  /**
   * Simple content hash for comparison
   */
  hashContent(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultTracker = null;

export function getProvenanceTracker() {
  if (!defaultTracker) {
    defaultTracker = new ProvenanceTracker();
  }
  return defaultTracker;
}

export function createProvenanceTracker() {
  return new ProvenanceTracker();
}

export function resetProvenanceTracker() {
  defaultTracker = new ProvenanceTracker();
  return defaultTracker;
}

// ============================================================================
// Export
// ============================================================================

export default {
  ProvenanceTracker,
  getProvenanceTracker,
  createProvenanceTracker,
  resetProvenanceTracker
};
