/**
 * Team Mind-Meld Service
 * 
 * Learns from team's collective coding patterns via git history
 * to provide team-aware assistance and reviewer suggestions.
 */

// Pattern types
const PATTERN_TYPES = {
  CODING_STYLE: 'coding_style',
  NAMING: 'naming',
  STRUCTURE: 'structure',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation',
  ERROR_HANDLING: 'error_handling'
};

// Team metrics
const TEAM_METRICS = {
  COMMIT_FREQUENCY: 'commit_frequency',
  CODE_OWNERSHIP: 'code_ownership',
  REVIEW_ACTIVITY: 'review_activity',
  EXPERTISE_AREAS: 'expertise_areas',
  COLLABORATION: 'collaboration'
};

class TeamMindMeld {
  constructor() {
    this.teamMembers = new Map(); // email -> member data
    this.codeOwnership = new Map(); // path pattern -> [emails]
    this.expertiseMap = new Map(); // topic -> [{ email, score }]
    this.collaborationGraph = new Map(); // email -> [{ collaborator, strength }]
    this.teamPatterns = [];
    this.conventions = [];
    this.listeners = new Set();
    this.isAnalyzing = false;
  }

  /**
   * Analyze git history for team patterns
   */
  async analyzeGitHistory(commits) {
    this.isAnalyzing = true;
    this.notifyListeners();

    try {
      // Process each commit
      for (const commit of commits) {
        await this.processCommit(commit);
      }

      // Build derived data
      this.buildCodeOwnership();
      this.buildExpertiseMap();
      this.buildCollaborationGraph();
      this.identifyConventions();

    } finally {
      this.isAnalyzing = false;
      this.notifyListeners();
    }
  }

  /**
   * Process a single commit
   */
  async processCommit(commit) {
    const { author, email, message, files, timestamp, hash } = commit;

    // Get or create member
    let member = this.teamMembers.get(email);
    if (!member) {
      member = this.createMember(email, author);
      this.teamMembers.set(email, member);
    }

    // Update member stats
    member.commits.push({
      hash,
      timestamp,
      message,
      files: files.length
    });
    member.lastActive = Math.max(member.lastActive, timestamp);
    member.totalCommits++;

    // Track file patterns
    for (const file of files) {
      this.trackFilePattern(member, file);
    }

    // Analyze commit message patterns
    this.analyzeCommitMessage(member, message);
  }

  /**
   * Create new team member record
   */
  createMember(email, name) {
    return {
      email,
      name,
      commits: [],
      totalCommits: 0,
      firstActive: Date.now(),
      lastActive: Date.now(),
      files: new Map(), // path -> count
      expertise: new Map(), // area -> score
      patterns: {
        naming: { camelCase: 0, snakeCase: 0, pascalCase: 0 },
        testing: { testFiles: 0, testCoverage: 'unknown' },
        documentation: { comments: 0, jsdoc: 0 },
        commitStyle: { conventional: 0, freeform: 0 }
      },
      collaborators: new Map() // email -> count
    };
  }

  /**
   * Track file modification patterns
   */
  trackFilePattern(member, file) {
    const path = file.path || file;
    const count = member.files.get(path) || 0;
    member.files.set(path, count + 1);

    // Track expertise areas based on file patterns
    this.updateExpertise(member, path);
  }

  /**
   * Update expertise based on file patterns
   */
  updateExpertise(member, filePath) {
    const expertisePatterns = {
      'frontend': [/components?\//, /pages?\//, /\.jsx$/, /\.tsx$/, /\.vue$/],
      'backend': [/api\//, /server\//, /routes?\//, /controllers?\//],
      'database': [/models?\//, /migrations?\//, /schema/, /\.sql$/],
      'testing': [/test/, /spec/, /\.test\./, /\.spec\./],
      'devops': [/docker/, /\.ya?ml$/, /ci\//, /deploy/],
      'auth': [/auth/, /login/, /session/, /jwt/],
      'styling': [/\.css$/, /\.scss$/, /styles?\//, /theme/]
    };

    for (const [area, patterns] of Object.entries(expertisePatterns)) {
      if (patterns.some(p => p.test(filePath))) {
        const current = member.expertise.get(area) || 0;
        member.expertise.set(area, current + 1);
      }
    }
  }

  /**
   * Analyze commit message patterns
   */
  analyzeCommitMessage(member, message) {
    // Check for conventional commits
    if (/^(feat|fix|docs|style|refactor|test|chore)\([^)]+\):/.test(message)) {
      member.patterns.commitStyle.conventional++;
    } else {
      member.patterns.commitStyle.freeform++;
    }
  }

  /**
   * Build code ownership map
   */
  buildCodeOwnership() {
    this.codeOwnership.clear();

    // Aggregate file ownership
    const ownership = new Map();
    
    for (const member of this.teamMembers.values()) {
      for (const [path, count] of member.files) {
        // Get directory pattern
        const dir = path.substring(0, path.lastIndexOf('/') + 1) || '/';
        
        if (!ownership.has(dir)) {
          ownership.set(dir, new Map());
        }
        
        const dirOwnership = ownership.get(dir);
        const current = dirOwnership.get(member.email) || 0;
        dirOwnership.set(member.email, current + count);
      }
    }

    // Convert to sorted lists
    for (const [dir, members] of ownership) {
      const sorted = Array.from(members.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([email, commits]) => ({
          email,
          name: this.teamMembers.get(email)?.name || email,
          commits,
          percentage: Math.round((commits / Array.from(members.values()).reduce((a, b) => a + b, 0)) * 100)
        }));
      
      this.codeOwnership.set(dir, sorted);
    }
  }

  /**
   * Build expertise map
   */
  buildExpertiseMap() {
    this.expertiseMap.clear();

    const areas = ['frontend', 'backend', 'database', 'testing', 'devops', 'auth', 'styling'];
    
    for (const area of areas) {
      const experts = [];
      
      for (const member of this.teamMembers.values()) {
        const score = member.expertise.get(area) || 0;
        if (score > 0) {
          experts.push({
            email: member.email,
            name: member.name,
            score,
            commits: member.totalCommits
          });
        }
      }

      experts.sort((a, b) => b.score - a.score);
      this.expertiseMap.set(area, experts.slice(0, 5));
    }
  }

  /**
   * Build collaboration graph
   */
  buildCollaborationGraph() {
    this.collaborationGraph.clear();

    // Find co-authors and file overlap
    const members = Array.from(this.teamMembers.values());
    
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const collaborations = [];
      
      for (let j = 0; j < members.length; j++) {
        if (i === j) continue;
        
        const other = members[j];
        let overlap = 0;
        
        // Count file overlap
        for (const file of member.files.keys()) {
          if (other.files.has(file)) {
            overlap += Math.min(member.files.get(file), other.files.get(file));
          }
        }
        
        if (overlap > 0) {
          collaborations.push({
            email: other.email,
            name: other.name,
            strength: overlap
          });
        }
      }

      collaborations.sort((a, b) => b.strength - a.strength);
      this.collaborationGraph.set(member.email, collaborations.slice(0, 5));
    }
  }

  /**
   * Identify team conventions
   */
  identifyConventions() {
    this.conventions = [];

    // Analyze patterns across team
    const patterns = {
      commitStyle: { conventional: 0, freeform: 0 },
      naming: { camelCase: 0, snakeCase: 0, pascalCase: 0 }
    };

    for (const member of this.teamMembers.values()) {
      patterns.commitStyle.conventional += member.patterns.commitStyle.conventional;
      patterns.commitStyle.freeform += member.patterns.commitStyle.freeform;
    }

    // Determine conventions
    if (patterns.commitStyle.conventional > patterns.commitStyle.freeform * 2) {
      this.conventions.push({
        type: 'commit_style',
        convention: 'conventional_commits',
        description: 'Team uses Conventional Commits format',
        adoption: Math.round((patterns.commitStyle.conventional / 
          (patterns.commitStyle.conventional + patterns.commitStyle.freeform)) * 100)
      });
    }
  }

  /**
   * Suggest reviewers for a file change
   */
  suggestReviewers(filePath, excludeEmail = null) {
    const suggestions = [];
    
    // Get directory ownership
    const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1) || '/';
    const owners = this.codeOwnership.get(dir) || [];
    
    for (const owner of owners) {
      if (owner.email === excludeEmail) continue;
      
      const member = this.teamMembers.get(owner.email);
      if (!member) continue;

      suggestions.push({
        email: owner.email,
        name: owner.name,
        reason: `${owner.percentage}% ownership of ${dir}`,
        score: owner.commits,
        lastActive: member.lastActive
      });
    }

    // Sort by score and recency
    suggestions.sort((a, b) => {
      const scoreA = a.score + (Date.now() - a.lastActive < 7 * 24 * 60 * 60 * 1000 ? 10 : 0);
      const scoreB = b.score + (Date.now() - b.lastActive < 7 * 24 * 60 * 60 * 1000 ? 10 : 0);
      return scoreB - scoreA;
    });

    return suggestions.slice(0, 3);
  }

  /**
   * Get expert for a topic
   */
  getExpertFor(topic) {
    const experts = this.expertiseMap.get(topic);
    return experts?.[0] || null;
  }

  /**
   * Simulate "How would X write this?"
   */
  simulateStyle(email, code) {
    const member = this.teamMembers.get(email);
    if (!member) return null;

    const suggestions = [];

    // Based on member's patterns
    if (member.patterns.commitStyle.conventional > member.patterns.commitStyle.freeform) {
      suggestions.push('Uses conventional commit messages');
    }

    // Based on expertise
    const topExpertise = Array.from(member.expertise.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([area]) => area);

    if (topExpertise.includes('testing')) {
      suggestions.push('Would likely add unit tests');
    }
    if (topExpertise.includes('frontend')) {
      suggestions.push('Prefers component-based architecture');
    }

    return {
      member: { email, name: member.name },
      styleSuggestions: suggestions,
      expertise: topExpertise
    };
  }

  /**
   * Identify knowledge silos
   */
  identifyKnowledgeSilos() {
    const silos = [];
    
    for (const [dir, owners] of this.codeOwnership) {
      // Check if one person owns > 80%
      if (owners.length > 0 && owners[0].percentage > 80) {
        silos.push({
          path: dir,
          owner: owners[0],
          risk: 'high',
          suggestion: `${owners[0].name} is the sole expert for ${dir}. Consider pair programming to spread knowledge.`
        });
      }
    }

    return silos;
  }

  /**
   * Get team member info
   */
  getMember(email) {
    return this.teamMembers.get(email);
  }

  /**
   * Get all team members
   */
  getTeamMembers() {
    return Array.from(this.teamMembers.values())
      .sort((a, b) => b.totalCommits - a.totalCommits);
  }

  /**
   * Get team statistics
   */
  getStatistics() {
    const members = Array.from(this.teamMembers.values());
    const totalCommits = members.reduce((sum, m) => sum + m.totalCommits, 0);
    
    return {
      teamSize: members.length,
      totalCommits,
      avgCommitsPerMember: members.length > 0 ? Math.round(totalCommits / members.length) : 0,
      topContributors: members.slice(0, 5).map(m => ({
        name: m.name,
        email: m.email,
        commits: m.totalCommits,
        percentage: Math.round((m.totalCommits / totalCommits) * 100)
      })),
      knowledgeSilos: this.identifyKnowledgeSilos().length,
      conventions: this.conventions.length,
      isAnalyzing: this.isAnalyzing
    };
  }

  /**
   * Export team data
   */
  export() {
    return {
      members: Array.from(this.teamMembers.entries()),
      codeOwnership: Array.from(this.codeOwnership.entries()),
      expertiseMap: Array.from(this.expertiseMap.entries()),
      conventions: this.conventions,
      exportedAt: Date.now()
    };
  }

  /**
   * Import team data
   */
  import(data) {
    if (data.members) {
      this.teamMembers = new Map(data.members);
    }
    if (data.codeOwnership) {
      this.codeOwnership = new Map(data.codeOwnership);
    }
    if (data.expertiseMap) {
      this.expertiseMap = new Map(data.expertiseMap);
    }
    if (data.conventions) {
      this.conventions = data.conventions;
    }
    this.notifyListeners();
  }

  /**
   * Clear all data
   */
  clear() {
    this.teamMembers.clear();
    this.codeOwnership.clear();
    this.expertiseMap.clear();
    this.collaborationGraph.clear();
    this.teamPatterns = [];
    this.conventions = [];
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
      conventions: this.conventions
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Team mind-meld listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getTeamMindMeld() {
  if (!instance) {
    instance = new TeamMindMeld();
  }
  return instance;
}

export { PATTERN_TYPES, TEAM_METRICS };
export default TeamMindMeld;
