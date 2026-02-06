/**
 * Code Archaeology Service
 * 
 * Deep analysis of git history to find when and why bugs were introduced,
 * track code evolution, and understand historical context.
 */

// Query types
const QUERY_TYPES = {
  BUG_INTRODUCTION: 'bug_introduction',
  AUTHOR_HISTORY: 'author_history',
  FILE_EVOLUTION: 'file_evolution',
  LINE_BLAME: 'line_blame',
  RELATED_CHANGES: 'related_changes'
};

// Change types
const CHANGE_TYPES = {
  ADDED: 'added',
  MODIFIED: 'modified',
  DELETED: 'deleted',
  RENAMED: 'renamed'
};

class CodeArchaeology {
  constructor() {
    this.history = new Map(); // file -> commit history
    this.blameCache = new Map(); // file:line -> blame info
    this.queries = [];
    this.insights = [];
    this.listeners = new Set();
  }

  /**
   * Load git history for a file (mock - real impl would use git CLI)
   */
  async loadFileHistory(filePath, commits) {
    const fileHistory = {
      path: filePath,
      commits: [],
      createdAt: null,
      lastModified: null,
      totalChanges: 0,
      authors: new Set()
    };

    for (const commit of commits) {
      const fileChange = commit.files?.find(f => f.path === filePath);
      if (fileChange) {
        fileHistory.commits.push({
          hash: commit.hash,
          shortHash: commit.hash.substring(0, 7),
          author: commit.author,
          email: commit.email,
          date: commit.timestamp,
          message: commit.message,
          changeType: fileChange.type,
          additions: fileChange.additions || 0,
          deletions: fileChange.deletions || 0,
          diff: fileChange.diff
        });
        
        fileHistory.authors.add(commit.email);
        fileHistory.totalChanges++;

        if (!fileHistory.createdAt || commit.timestamp < fileHistory.createdAt) {
          fileHistory.createdAt = commit.timestamp;
        }
        if (!fileHistory.lastModified || commit.timestamp > fileHistory.lastModified) {
          fileHistory.lastModified = commit.timestamp;
        }
      }
    }

    // Sort by date descending
    fileHistory.commits.sort((a, b) => b.date - a.date);
    fileHistory.authors = Array.from(fileHistory.authors);

    this.history.set(filePath, fileHistory);
    return fileHistory;
  }

  /**
   * Find when a specific line/code was introduced
   */
  async findIntroduction(filePath, lineNumber, codeSnippet = '') {
    const query = {
      id: `query_${Date.now()}`,
      type: QUERY_TYPES.BUG_INTRODUCTION,
      filePath,
      lineNumber,
      codeSnippet,
      timestamp: Date.now()
    };

    // Get file history
    const history = this.history.get(filePath);
    if (!history) {
      query.result = { error: 'No history loaded for file' };
      this.queries.push(query);
      return query;
    }

    // Search through commits for the introduction
    let introduction = null;
    
    for (let i = history.commits.length - 1; i >= 0; i--) {
      const commit = history.commits[i];
      
      if (commit.diff && codeSnippet) {
        // Check if this commit added the code
        if (commit.diff.includes(`+${codeSnippet}`) ||
            commit.diff.includes(`+ ${codeSnippet}`)) {
          introduction = {
            commit,
            type: 'introduced',
            confidence: 0.9
          };
          break;
        }
      }
    }

    // If not found, estimate from line changes
    if (!introduction && history.commits.length > 0) {
      // Mock: return oldest commit that modified this area
      introduction = {
        commit: history.commits[history.commits.length - 1],
        type: 'estimated',
        confidence: 0.5
      };
    }

    query.result = {
      introduction,
      context: await this.getCommitContext(introduction?.commit),
      relatedCommits: this.findRelatedCommits(history, introduction?.commit),
      timeline: this.buildTimeline(history, lineNumber)
    };

    this.queries.push(query);
    this.notifyListeners();

    return query;
  }

  /**
   * Get context for a commit
   */
  async getCommitContext(commit) {
    if (!commit) return null;

    return {
      commit: commit.hash,
      author: commit.author,
      email: commit.email,
      date: new Date(commit.date).toISOString(),
      message: commit.message,
      // Additional context that would come from PR/issue links
      prNumber: this.extractPRNumber(commit.message),
      issueNumbers: this.extractIssueNumbers(commit.message),
      coAuthors: this.extractCoAuthors(commit.message)
    };
  }

  /**
   * Extract PR number from commit message
   */
  extractPRNumber(message) {
    const match = message.match(/#(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Extract issue numbers from commit message
   */
  extractIssueNumbers(message) {
    const matches = message.match(/(?:fixes?|closes?|resolves?)\s*#(\d+)/gi);
    if (!matches) return [];
    
    return matches.map(m => {
      const num = m.match(/#(\d+)/);
      return num ? parseInt(num[1]) : null;
    }).filter(Boolean);
  }

  /**
   * Extract co-authors from commit message
   */
  extractCoAuthors(message) {
    const matches = message.match(/Co-authored-by:\s*(.+)\s*<(.+)>/gi);
    if (!matches) return [];
    
    return matches.map(m => {
      const parsed = m.match(/Co-authored-by:\s*(.+)\s*<(.+)>/i);
      return parsed ? { name: parsed[1].trim(), email: parsed[2].trim() } : null;
    }).filter(Boolean);
  }

  /**
   * Find related commits
   */
  findRelatedCommits(history, targetCommit) {
    if (!history || !targetCommit) return [];

    const targetDate = targetCommit.date;
    const timeWindow = 7 * 24 * 60 * 60 * 1000; // 7 days

    return history.commits.filter(commit => 
      commit.hash !== targetCommit.hash &&
      Math.abs(commit.date - targetDate) <= timeWindow
    ).slice(0, 5);
  }

  /**
   * Build timeline of changes for line/area
   */
  buildTimeline(history, lineNumber) {
    if (!history) return [];

    return history.commits.map(commit => ({
      hash: commit.shortHash,
      author: commit.author,
      date: commit.date,
      dateFormatted: new Date(commit.date).toLocaleDateString(),
      message: commit.message.substring(0, 60),
      changeType: commit.changeType,
      additions: commit.additions,
      deletions: commit.deletions
    }));
  }

  /**
   * Perform git blame on file (mock)
   */
  async blame(filePath) {
    const history = this.history.get(filePath);
    if (!history) return null;

    // Mock blame data - would come from git blame
    const blameResult = {
      filePath,
      lines: []
    };

    // Simulate blame for 100 lines
    for (let i = 1; i <= 100; i++) {
      const commit = history.commits[Math.floor(Math.random() * history.commits.length)] ||
                    history.commits[0];
      
      if (commit) {
        blameResult.lines.push({
          lineNumber: i,
          commit: commit.shortHash,
          author: commit.author,
          date: commit.date,
          content: `// Line ${i} content`
        });

        // Cache blame info
        this.blameCache.set(`${filePath}:${i}`, {
          commit: commit.hash,
          author: commit.author,
          date: commit.date
        });
      }
    }

    return blameResult;
  }

  /**
   * Get blame for specific line
   */
  getLineBlame(filePath, lineNumber) {
    return this.blameCache.get(`${filePath}:${lineNumber}`);
  }

  /**
   * Find all changes by author in file
   */
  async findAuthorChanges(filePath, authorEmail) {
    const history = this.history.get(filePath);
    if (!history) return [];

    return history.commits.filter(c => c.email === authorEmail);
  }

  /**
   * Get file evolution summary
   */
  getFileEvolution(filePath) {
    const history = this.history.get(filePath);
    if (!history) return null;

    // Calculate metrics over time
    const evolution = {
      filePath,
      age: history.createdAt ? Date.now() - history.createdAt : 0,
      ageFormatted: this.formatAge(history.createdAt),
      totalCommits: history.totalChanges,
      uniqueAuthors: history.authors.length,
      authors: history.authors,
      
      // Activity periods
      activityByMonth: this.groupByMonth(history.commits),
      
      // Churn analysis
      churn: this.calculateChurn(history.commits),
      
      // Risk indicators
      risk: this.calculateRisk(history)
    };

    return evolution;
  }

  /**
   * Format age in human readable form
   */
  formatAge(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const age = Date.now() - timestamp;
    const days = Math.floor(age / (24 * 60 * 60 * 1000));
    
    if (days < 30) return `${days} days`;
    if (days < 365) return `${Math.floor(days / 30)} months`;
    return `${Math.floor(days / 365)} years`;
  }

  /**
   * Group commits by month
   */
  groupByMonth(commits) {
    const byMonth = {};
    
    for (const commit of commits) {
      const month = new Date(commit.date).toISOString().substring(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
    }

    return byMonth;
  }

  /**
   * Calculate code churn metrics
   */
  calculateChurn(commits) {
    let totalAdditions = 0;
    let totalDeletions = 0;
    
    for (const commit of commits) {
      totalAdditions += commit.additions || 0;
      totalDeletions += commit.deletions || 0;
    }

    return {
      totalAdditions,
      totalDeletions,
      netChange: totalAdditions - totalDeletions,
      churnRatio: totalDeletions > 0 ? 
        Math.round((totalDeletions / totalAdditions) * 100) / 100 : 0
    };
  }

  /**
   * Calculate risk score for file
   */
  calculateRisk(history) {
    let score = 0;
    const factors = [];

    // High churn = higher risk
    const churn = this.calculateChurn(history.commits);
    if (churn.churnRatio > 0.5) {
      score += 20;
      factors.push('High code churn');
    }

    // Many authors = potential inconsistency
    if (history.authors.length > 5) {
      score += 10;
      factors.push('Many different authors');
    }

    // Recent frequent changes = unstable
    const recentCommits = history.commits.filter(c => 
      Date.now() - c.date < 30 * 24 * 60 * 60 * 1000
    );
    if (recentCommits.length > 10) {
      score += 15;
      factors.push('Frequent recent changes');
    }

    // Old file with no recent changes might be outdated
    const lastChange = history.commits[0]?.date;
    if (lastChange && Date.now() - lastChange > 365 * 24 * 60 * 60 * 1000) {
      score += 10;
      factors.push('No recent maintenance');
    }

    return {
      score: Math.min(100, score),
      level: score >= 30 ? 'high' : score >= 15 ? 'medium' : 'low',
      factors
    };
  }

  /**
   * Generate insight about code area
   */
  generateInsight(filePath) {
    const evolution = this.getFileEvolution(filePath);
    if (!evolution) return null;

    const insight = {
      id: `insight_${Date.now()}`,
      filePath,
      timestamp: Date.now(),
      summary: [],
      recommendations: []
    };

    // Generate insights based on evolution data
    if (evolution.uniqueAuthors === 1) {
      insight.summary.push(`Single author (${evolution.authors[0]}) - potential knowledge silo`);
      insight.recommendations.push('Consider code review or pair programming');
    }

    if (evolution.risk.level === 'high') {
      insight.summary.push('High risk file based on change patterns');
      insight.recommendations.push('Add comprehensive tests before modifying');
    }

    if (evolution.churn.churnRatio > 0.7) {
      insight.summary.push('High deletion rate suggests frequent rewrites');
      insight.recommendations.push('Consider refactoring for stability');
    }

    this.insights.push(insight);
    return insight;
  }

  /**
   * Search history for pattern
   */
  searchHistory(pattern) {
    const results = [];
    const regex = new RegExp(pattern, 'i');

    for (const [filePath, history] of this.history) {
      for (const commit of history.commits) {
        if (regex.test(commit.message) || regex.test(commit.diff || '')) {
          results.push({
            filePath,
            commit,
            matchType: regex.test(commit.message) ? 'message' : 'diff'
          });
        }
      }
    }

    return results;
  }

  /**
   * Get queries
   */
  getQueries() {
    return [...this.queries];
  }

  /**
   * Get insights
   */
  getInsights() {
    return [...this.insights];
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.history.clear();
    this.blameCache.clear();
    this.queries = [];
    this.insights = [];
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
      filesTracked: this.history.size,
      queriesRun: this.queries.length,
      insightsGenerated: this.insights.length
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Code archaeology listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getCodeArchaeology() {
  if (!instance) {
    instance = new CodeArchaeology();
  }
  return instance;
}

export { QUERY_TYPES, CHANGE_TYPES };
export default CodeArchaeology;
