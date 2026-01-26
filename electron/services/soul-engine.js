/**
 * Soul Engine - What makes DevForge different from everything else
 * 
 * This isn't just memory. This is PERSONALITY PERSISTENCE.
 * 
 * Most AI apps: Stateless. Every conversation starts fresh.
 * Cloud AI: Remembers nothing. You're a stranger every time.
 * DevForge: Develops a relationship. Learns YOU. Becomes YOUR AI.
 * 
 * The Soul Engine tracks:
 * - Your communication style preferences
 * - Topics that excite you vs bore you
 * - Your knowledge level in different domains
 * - Time patterns (when you work, what you do at different times)
 * - Emotional patterns (frustration signals, excitement markers)
 * - Your evolving projects and goals
 * - What kind of responses you find helpful vs unhelpful
 * 
 * Over time, DevForge becomes uniquely YOURS - unlike any other instance.
 */

const { app } = require('electron');

class SoulEngine {
  constructor() {
    this.db = null;
    this.soul = null;
    this.initialized = false;
  }

  init(db) {
    this.db = db;
    this.ensureTables();
    this.loadSoul();
    this.initialized = true;
    console.log('[SoulEngine] Awakened');
  }

  ensureTables() {
    if (!this.db) return;

    // Core soul state - the persistent personality
    this.db.run(`
      CREATE TABLE IF NOT EXISTS soul_state (
        id TEXT PRIMARY KEY DEFAULT 'main',
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Interaction patterns - how you communicate
    this.db.run(`
      CREATE TABLE IF NOT EXISTS soul_patterns (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        pattern TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        occurrences INTEGER DEFAULT 1,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Feedback signals - what works and what doesn't
    this.db.run(`
      CREATE TABLE IF NOT EXISTS soul_feedback (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        signal TEXT NOT NULL,
        value REAL,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Time patterns - your rhythms
    this.db.run(`
      CREATE TABLE IF NOT EXISTS soul_rhythms (
        id TEXT PRIMARY KEY,
        hour INTEGER,
        day_of_week INTEGER,
        activity_type TEXT,
        count INTEGER DEFAULT 1,
        avg_session_length REAL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Topic expertise tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS soul_expertise (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        your_level TEXT DEFAULT 'unknown',
        interactions INTEGER DEFAULT 0,
        last_discussed DATETIME,
        notes TEXT
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_soul_patterns_cat ON soul_patterns(category)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_soul_feedback_signal ON soul_feedback(signal)');
  }

  loadSoul() {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare('SELECT data FROM soul_state WHERE id = ?');
      stmt.bind(['main']);
      
      if (stmt.step()) {
        const row = stmt.getAsObject();
        this.soul = JSON.parse(row.data);
        stmt.free();
      } else {
        stmt.free();
        // Create default soul
        this.soul = this.createDefaultSoul();
        this.saveSoul();
      }
    } catch (error) {
      console.error('[SoulEngine] Failed to load soul:', error);
      this.soul = this.createDefaultSoul();
    }
  }

  createDefaultSoul() {
    return {
      // Core identity
      name: null, // User's preferred name for the AI
      personality: 'adaptive', // Will develop over time
      
      // Communication preferences (learned)
      preferences: {
        verbosity: 0.5, // 0 = terse, 1 = detailed
        formality: 0.5, // 0 = casual, 1 = formal
        humor: 0.5, // 0 = serious, 1 = playful
        technicalDepth: 0.5, // 0 = simple, 1 = deep technical
        codeComments: 0.5, // 0 = minimal, 1 = heavily commented
        exampleFrequency: 0.5, // 0 = rare, 1 = always include examples
      },
      
      // Learned facts about the user
      user: {
        name: null,
        timezone: null,
        occupation: null,
        interests: [],
        currentProjects: [],
        techStack: [],
        communicationStyle: null,
      },
      
      // Relationship metrics
      relationship: {
        totalInteractions: 0,
        totalTokens: 0,
        firstMet: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        streak: 0, // Days in a row
        longestStreak: 0,
        trustLevel: 0.5, // Earned over time
      },
      
      // Adaptive behavior
      adaptations: {
        // These get tuned based on feedback
        responseLength: 'medium',
        codeBlockStyle: 'fenced',
        listStyle: 'bullets',
        explanationApproach: 'mixed', // examples-first, theory-first, mixed
      },
      
      // What I've learned about what works
      insights: [],
      
      // Version for migrations
      version: 1,
    };
  }

  saveSoul() {
    if (!this.db || !this.soul) return;

    try {
      this.soul.relationship.lastSeen = new Date().toISOString();
      
      this.db.run(`
        INSERT OR REPLACE INTO soul_state (id, data, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, ['main', JSON.stringify(this.soul)]);
    } catch (error) {
      console.error('[SoulEngine] Failed to save soul:', error);
    }
  }

  /**
   * Record an interaction and learn from it
   */
  async recordInteraction(data) {
    const { 
      userMessage, 
      assistantResponse, 
      responseTime,
      tokensUsed,
      workspace,
      model,
    } = data;

    if (!this.soul) return;

    // Update basic stats
    this.soul.relationship.totalInteractions++;
    this.soul.relationship.totalTokens += tokensUsed || 0;
    this.soul.relationship.lastSeen = new Date().toISOString();

    // Update streak
    this.updateStreak();

    // Analyze user message for patterns
    if (userMessage) {
      await this.analyzeUserStyle(userMessage);
      await this.extractUserInfo(userMessage);
    }

    // Learn from response length preferences
    if (assistantResponse) {
      const responseLength = assistantResponse.length;
      // We'll learn if they prefer shorter/longer based on follow-up behavior
    }

    // Record time pattern
    this.recordTimePattern(workspace);

    this.saveSoul();
  }

  /**
   * Analyze user's communication style
   */
  async analyzeUserStyle(message) {
    if (!message || message.length < 10) return;

    const patterns = [];

    // Check for question style
    if (message.endsWith('?')) {
      patterns.push({ category: 'question_style', pattern: 'direct_question' });
    }
    
    // Check verbosity
    if (message.length > 500) {
      patterns.push({ category: 'verbosity', pattern: 'detailed' });
      this.adjustPreference('verbosity', 0.1);
    } else if (message.length < 50) {
      patterns.push({ category: 'verbosity', pattern: 'concise' });
      this.adjustPreference('verbosity', -0.1);
    }

    // Check formality
    const informalMarkers = ['hey', 'yo', 'sup', 'lol', 'haha', 'btw', 'gonna', 'wanna', 'kinda'];
    const formalMarkers = ['please', 'kindly', 'would you', 'could you', 'i would appreciate'];
    
    const lowerMessage = message.toLowerCase();
    const informalScore = informalMarkers.filter(m => lowerMessage.includes(m)).length;
    const formalScore = formalMarkers.filter(m => lowerMessage.includes(m)).length;
    
    if (informalScore > formalScore) {
      this.adjustPreference('formality', -0.05);
    } else if (formalScore > informalScore) {
      this.adjustPreference('formality', 0.05);
    }

    // Check for code/technical content
    if (message.includes('```') || message.includes('function') || message.includes('const ')) {
      this.adjustPreference('technicalDepth', 0.05);
    }

    // Record patterns
    for (const p of patterns) {
      this.recordPattern(p.category, p.pattern);
    }
  }

  /**
   * Extract user information from messages
   */
  async extractUserInfo(message) {
    if (!this.soul) return;

    const lowerMessage = message.toLowerCase();

    // Name detection
    const namePatterns = [
      /(?:my name is|i'm called|call me|i am)\s+(\w+)/i,
      /(?:^|\s)i'm\s+(\w+)(?:\s|,|\.)/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match && match[1] && match[1].length > 1 && match[1].length < 20) {
        const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        if (!this.soul.user.name) {
          this.soul.user.name = name;
          console.log(`[SoulEngine] Learned user's name: ${name}`);
        }
      }
    }

    // Occupation detection
    const occupationPatterns = [
      /i(?:'m| am) a[n]?\s+(\w+(?:\s+\w+)?)\s*(?:developer|engineer|designer|manager|student|writer)/i,
      /i work as a[n]?\s+(.+?)(?:\.|,|$)/i,
      /my job is\s+(.+?)(?:\.|,|$)/i,
    ];

    for (const pattern of occupationPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        this.soul.user.occupation = match[1].trim();
      }
    }

    // Tech stack detection
    const techKeywords = [
      'react', 'vue', 'angular', 'svelte', 'node', 'python', 'rust', 'go', 'java',
      'typescript', 'javascript', 'c++', 'c#', 'unity', 'unreal', 'godot',
      'pytorch', 'tensorflow', 'docker', 'kubernetes', 'aws', 'azure', 'gcp'
    ];

    for (const tech of techKeywords) {
      if (lowerMessage.includes(tech) && !this.soul.user.techStack.includes(tech)) {
        this.soul.user.techStack.push(tech);
      }
    }

    // Interest detection
    const interestPatterns = [
      /i (?:love|enjoy|like|am interested in|am passionate about)\s+(.+?)(?:\.|,|!|$)/i,
    ];

    for (const pattern of interestPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const interest = match[1].trim().substring(0, 50);
        if (!this.soul.user.interests.includes(interest)) {
          this.soul.user.interests.push(interest);
        }
      }
    }
  }

  /**
   * Adjust a preference value (clamped 0-1)
   */
  adjustPreference(key, delta) {
    if (!this.soul?.preferences) return;
    
    const current = this.soul.preferences[key] || 0.5;
    this.soul.preferences[key] = Math.max(0, Math.min(1, current + delta));
  }

  /**
   * Record a pattern occurrence
   */
  recordPattern(category, pattern) {
    if (!this.db) return;

    const id = `${category}_${pattern}`;
    
    try {
      // Try to update existing
      const existing = this.db.exec(`SELECT occurrences FROM soul_patterns WHERE id = '${id}'`);
      
      if (existing.length > 0 && existing[0].values.length > 0) {
        this.db.run(`
          UPDATE soul_patterns 
          SET occurrences = occurrences + 1, last_seen = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [id]);
      } else {
        this.db.run(`
          INSERT INTO soul_patterns (id, category, pattern, occurrences)
          VALUES (?, ?, ?, 1)
        `, [id, category, pattern]);
      }
    } catch (error) {
      // Ignore
    }
  }

  /**
   * Record time-based patterns
   */
  recordTimePattern(workspace) {
    if (!this.db) return;

    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const id = `${dayOfWeek}_${hour}_${workspace}`;

    try {
      this.db.run(`
        INSERT INTO soul_rhythms (id, hour, day_of_week, activity_type, count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP
      `, [id, hour, dayOfWeek, workspace]);
    } catch (error) {
      // Fallback for sql.js which doesn't support ON CONFLICT
      try {
        this.db.run(`
          INSERT OR REPLACE INTO soul_rhythms (id, hour, day_of_week, activity_type, count, updated_at)
          VALUES (?, ?, ?, ?, COALESCE((SELECT count FROM soul_rhythms WHERE id = ?), 0) + 1, CURRENT_TIMESTAMP)
        `, [id, hour, dayOfWeek, workspace, id]);
      } catch (e) {}
    }
  }

  /**
   * Update usage streak
   */
  updateStreak() {
    if (!this.soul) return;

    const lastSeen = new Date(this.soul.relationship.lastSeen);
    const now = new Date();
    
    // Check if this is a new day
    const lastDay = lastSeen.toDateString();
    const today = now.toDateString();
    
    if (lastDay !== today) {
      // Check if it was yesterday
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (lastDay === yesterday.toDateString()) {
        this.soul.relationship.streak++;
        if (this.soul.relationship.streak > this.soul.relationship.longestStreak) {
          this.soul.relationship.longestStreak = this.soul.relationship.streak;
        }
      } else {
        // Streak broken
        this.soul.relationship.streak = 1;
      }
    }
  }

  /**
   * Record explicit feedback (thumbs up/down, regenerate, edit)
   */
  async recordFeedback(signal, messageId, value, context = {}) {
    if (!this.db) return;

    const id = `fb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    try {
      this.db.run(`
        INSERT INTO soul_feedback (id, message_id, signal, value, context)
        VALUES (?, ?, ?, ?, ?)
      `, [id, messageId, signal, value, JSON.stringify(context)]);

      // Adjust preferences based on feedback
      if (signal === 'too_long') {
        this.adjustPreference('verbosity', -0.1);
      } else if (signal === 'too_short') {
        this.adjustPreference('verbosity', 0.1);
      } else if (signal === 'too_technical') {
        this.adjustPreference('technicalDepth', -0.1);
      } else if (signal === 'not_technical_enough') {
        this.adjustPreference('technicalDepth', 0.1);
      } else if (signal === 'helpful') {
        this.soul.relationship.trustLevel = Math.min(1, this.soul.relationship.trustLevel + 0.01);
      } else if (signal === 'unhelpful') {
        this.soul.relationship.trustLevel = Math.max(0, this.soul.relationship.trustLevel - 0.02);
      }

      this.saveSoul();
    } catch (error) {
      console.error('[SoulEngine] recordFeedback error:', error);
    }
  }

  /**
   * Generate a personalized system prompt based on what we've learned
   */
  generatePersonalizedPrompt() {
    if (!this.soul) return '';

    const parts = [];

    // Personal greeting
    if (this.soul.user.name) {
      parts.push(`The user's name is ${this.soul.user.name}. Use it occasionally but not every message.`);
    }

    // Communication style
    const prefs = this.soul.preferences;
    
    if (prefs.verbosity < 0.3) {
      parts.push('The user prefers concise, to-the-point responses. Keep answers brief.');
    } else if (prefs.verbosity > 0.7) {
      parts.push('The user appreciates detailed, thorough explanations. Be comprehensive.');
    }

    if (prefs.formality < 0.3) {
      parts.push('Use a casual, friendly tone. The user responds well to informal communication.');
    } else if (prefs.formality > 0.7) {
      parts.push('Maintain a professional, formal tone in responses.');
    }

    if (prefs.technicalDepth > 0.7) {
      parts.push('The user is technically proficient. Use technical terminology and assume background knowledge.');
    } else if (prefs.technicalDepth < 0.3) {
      parts.push('Explain technical concepts simply. Avoid jargon without explanation.');
    }

    // Tech stack awareness
    if (this.soul.user.techStack.length > 0) {
      parts.push(`The user works with: ${this.soul.user.techStack.slice(0, 5).join(', ')}. Tailor examples accordingly.`);
    }

    // Relationship context
    if (this.soul.relationship.totalInteractions > 100) {
      parts.push('You have an established relationship with this user. Be familiar but not presumptuous.');
    }

    if (this.soul.relationship.streak > 7) {
      parts.push(`The user has been chatting with you for ${this.soul.relationship.streak} days in a row.`);
    }

    // Occupation awareness
    if (this.soul.user.occupation) {
      parts.push(`The user works as a ${this.soul.user.occupation}.`);
    }

    return parts.length > 0 
      ? `\n\n[Personal context - use naturally, don't mention explicitly]\n${parts.join('\n')}`
      : '';
  }

  /**
   * Get current soul state
   */
  getSoul() {
    return this.soul;
  }

  /**
   * Get soul stats for display
   */
  getStats() {
    if (!this.soul) return null;

    return {
      totalInteractions: this.soul.relationship.totalInteractions,
      totalTokens: this.soul.relationship.totalTokens,
      daysTogether: Math.floor((Date.now() - new Date(this.soul.relationship.firstMet).getTime()) / (1000 * 60 * 60 * 24)),
      currentStreak: this.soul.relationship.streak,
      longestStreak: this.soul.relationship.longestStreak,
      trustLevel: Math.round(this.soul.relationship.trustLevel * 100),
      knownName: this.soul.user.name,
      occupation: this.soul.user.occupation,
      techStack: this.soul.user.techStack,
      interests: this.soul.user.interests,
      preferences: this.soul.preferences,
    };
  }

  /**
   * Manually update user info
   */
  updateUserInfo(updates) {
    if (!this.soul) return;

    this.soul.user = { ...this.soul.user, ...updates };
    this.saveSoul();
  }

  /**
   * Reset soul (start fresh)
   */
  reset() {
    this.soul = this.createDefaultSoul();
    this.saveSoul();
    
    if (this.db) {
      this.db.run('DELETE FROM soul_patterns');
      this.db.run('DELETE FROM soul_feedback');
      this.db.run('DELETE FROM soul_rhythms');
      this.db.run('DELETE FROM soul_expertise');
    }
  }
}

// Singleton
let soulEngineInstance = null;

function getSoulEngine() {
  if (!soulEngineInstance) {
    soulEngineInstance = new SoulEngine();
  }
  return soulEngineInstance;
}

module.exports = {
  SoulEngine,
  getSoulEngine,
};
