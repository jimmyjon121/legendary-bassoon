/**
 * Intent Memory Service
 * 
 * Records WHY decisions were made, not just WHAT was done.
 * Enables querying historical context and scheduled decision reviews.
 */

// Intent event types
const INTENT_EVENTS = {
  DECISION_MADE: 'decision_made',
  ALTERNATIVE_REJECTED: 'alternative_rejected',
  CONSTRAINT_APPLIED: 'constraint_applied',
  FUTURE_CONSIDERATION: 'future_consideration',
  CONTEXT_SNAPSHOT: 'context_snapshot',
  REVIEW_SCHEDULED: 'review_scheduled',
  DECISION_REVISITED: 'decision_revisited'
};

// Decision categories
const DECISION_CATEGORIES = {
  ARCHITECTURE: {
    id: 'architecture',
    name: 'Architecture',
    icon: '🏗️',
    description: 'System structure and design patterns'
  },
  TECHNOLOGY: {
    id: 'technology',
    name: 'Technology Choice',
    icon: '⚙️',
    description: 'Libraries, frameworks, and tools'
  },
  IMPLEMENTATION: {
    id: 'implementation',
    name: 'Implementation',
    icon: '💻',
    description: 'How specific features are built'
  },
  TRADEOFF: {
    id: 'tradeoff',
    name: 'Trade-off',
    icon: '⚖️',
    description: 'Balancing competing concerns'
  },
  TECHNICAL_DEBT: {
    id: 'technical_debt',
    name: 'Technical Debt',
    icon: '📋',
    description: 'Known issues to address later'
  },
  SECURITY: {
    id: 'security',
    name: 'Security',
    icon: '🔒',
    description: 'Security-related decisions'
  },
  PERFORMANCE: {
    id: 'performance',
    name: 'Performance',
    icon: '⚡',
    description: 'Performance optimization choices'
  }
};

// Review intervals
const REVIEW_INTERVALS = {
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  QUARTER: 90 * 24 * 60 * 60 * 1000,
  YEAR: 365 * 24 * 60 * 60 * 1000
};

class IntentMemory {
  constructor() {
    this.records = [];
    this.alternatives = [];
    this.constraints = [];
    this.reviews = [];
    this.tags = new Set();
    this.listeners = new Set();
  }

  /**
   * Record a new decision with its rationale
   */
  recordDecision(decision) {
    const record = {
      id: `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: INTENT_EVENTS.DECISION_MADE,
      timestamp: Date.now(),
      
      // Core decision info
      decision: decision.decision,
      rationale: decision.rationale,
      category: decision.category || DECISION_CATEGORIES.IMPLEMENTATION.id,
      
      // Context
      context: {
        files: decision.files || [],
        currentFile: decision.currentFile,
        codeSnippet: decision.codeSnippet,
        projectState: decision.projectState
      },
      
      // Alternatives considered
      alternatives: (decision.alternatives || []).map(alt => ({
        option: alt.option,
        reasonRejected: alt.reasonRejected || alt.reason_rejected,
        consideredAt: Date.now()
      })),
      
      // Constraints that influenced decision
      constraints: decision.constraints || [],
      
      // Future considerations
      futureReview: decision.futureReview,
      technicalDebt: decision.technicalDebt,
      
      // Metadata
      author: decision.author || 'user',
      tags: decision.tags || [],
      confidence: decision.confidence || 'high',
      
      // Links
      relatedDecisions: decision.relatedDecisions || [],
      linkedIssues: decision.linkedIssues || []
    };

    // Add tags to global set
    record.tags.forEach(tag => this.tags.add(tag));

    // Store alternatives separately for easier querying
    record.alternatives.forEach(alt => {
      this.alternatives.push({
        ...alt,
        decisionId: record.id,
        category: record.category
      });
    });

    // Store constraints
    record.constraints.forEach(constraint => {
      this.constraints.push({
        constraint,
        decisionId: record.id,
        timestamp: record.timestamp
      });
    });

    // Schedule review if specified
    if (record.futureReview) {
      this.scheduleReview(record.id, record.futureReview);
    }

    this.records.push(record);
    this.notifyListeners();

    return record;
  }

  /**
   * Schedule a decision review
   */
  scheduleReview(decisionId, reviewDate) {
    let reviewTime;
    
    if (typeof reviewDate === 'string') {
      // Parse relative dates like "3 months"
      const match = reviewDate.match(/(\d+)\s*(day|week|month|quarter|year)s?/i);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        const multipliers = {
          day: 24 * 60 * 60 * 1000,
          week: REVIEW_INTERVALS.WEEK,
          month: REVIEW_INTERVALS.MONTH,
          quarter: REVIEW_INTERVALS.QUARTER,
          year: REVIEW_INTERVALS.YEAR
        };
        reviewTime = Date.now() + (amount * multipliers[unit]);
      } else {
        // Try parsing as date
        reviewTime = new Date(reviewDate).getTime();
      }
    } else if (typeof reviewDate === 'number') {
      reviewTime = reviewDate;
    }

    if (reviewTime && reviewTime > Date.now()) {
      const review = {
        id: `review_${Date.now()}`,
        decisionId,
        scheduledFor: reviewTime,
        createdAt: Date.now(),
        status: 'scheduled',
        reminded: false
      };

      this.reviews.push(review);
      return review;
    }

    return null;
  }

  /**
   * Query decisions by natural language question
   */
  query(question) {
    const questionLower = question.toLowerCase();
    const results = [];

    // Keywords to search for
    const keywords = questionLower
      .replace(/[?.,!]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    for (const record of this.records) {
      let score = 0;
      const matchReasons = [];

      // Check decision text
      const decisionLower = record.decision.toLowerCase();
      keywords.forEach(keyword => {
        if (decisionLower.includes(keyword)) {
          score += 2;
          matchReasons.push(`Decision contains "${keyword}"`);
        }
      });

      // Check rationale
      const rationaleLower = record.rationale.toLowerCase();
      keywords.forEach(keyword => {
        if (rationaleLower.includes(keyword)) {
          score += 1.5;
          matchReasons.push(`Rationale contains "${keyword}"`);
        }
      });

      // Check tags
      record.tags.forEach(tag => {
        if (keywords.some(k => tag.toLowerCase().includes(k))) {
          score += 1;
          matchReasons.push(`Tagged with "${tag}"`);
        }
      });

      // Check files
      record.context.files.forEach(file => {
        if (keywords.some(k => file.toLowerCase().includes(k))) {
          score += 0.5;
          matchReasons.push(`Related to file "${file}"`);
        }
      });

      // Special queries
      if (questionLower.includes('why') && rationaleLower.length > 50) {
        score += 1;
      }
      if (questionLower.includes('alternative') && record.alternatives.length > 0) {
        score += 2;
        matchReasons.push('Has alternatives considered');
      }
      if (questionLower.includes('technical debt') && record.technicalDebt) {
        score += 2;
        matchReasons.push('Contains technical debt');
      }

      if (score > 0) {
        results.push({
          record,
          score,
          matchReasons
        });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return {
      query: question,
      results: results.slice(0, 10),
      totalMatches: results.length
    };
  }

  /**
   * Get decision by ID
   */
  getDecision(decisionId) {
    return this.records.find(r => r.id === decisionId);
  }

  /**
   * Get decisions by category
   */
  getByCategory(categoryId) {
    return this.records.filter(r => r.category === categoryId);
  }

  /**
   * Get decisions related to a file
   */
  getByFile(filePath) {
    return this.records.filter(r => 
      r.context.files.includes(filePath) ||
      r.context.currentFile === filePath
    );
  }

  /**
   * Get decisions by tag
   */
  getByTag(tag) {
    return this.records.filter(r => r.tags.includes(tag));
  }

  /**
   * Get all rejected alternatives
   */
  getRejectedAlternatives() {
    return [...this.alternatives];
  }

  /**
   * Get upcoming reviews
   */
  getUpcomingReviews(days = 30) {
    const cutoff = Date.now() + (days * 24 * 60 * 60 * 1000);
    return this.reviews
      .filter(r => r.status === 'scheduled' && r.scheduledFor <= cutoff)
      .map(review => ({
        ...review,
        decision: this.getDecision(review.decisionId),
        daysUntil: Math.ceil((review.scheduledFor - Date.now()) / (24 * 60 * 60 * 1000))
      }))
      .sort((a, b) => a.scheduledFor - b.scheduledFor);
  }

  /**
   * Get overdue reviews
   */
  getOverdueReviews() {
    return this.reviews
      .filter(r => r.status === 'scheduled' && r.scheduledFor < Date.now())
      .map(review => ({
        ...review,
        decision: this.getDecision(review.decisionId),
        overdueDays: Math.ceil((Date.now() - review.scheduledFor) / (24 * 60 * 60 * 1000))
      }));
  }

  /**
   * Complete a review
   */
  completeReview(reviewId, outcome) {
    const review = this.reviews.find(r => r.id === reviewId);
    if (!review) return null;

    review.status = 'completed';
    review.completedAt = Date.now();
    review.outcome = outcome;

    // Record the revisit
    const decision = this.getDecision(review.decisionId);
    if (decision && outcome.newDecision) {
      this.recordDecision({
        ...outcome.newDecision,
        type: INTENT_EVENTS.DECISION_REVISITED,
        previousDecisionId: decision.id
      });
    }

    this.notifyListeners();
    return review;
  }

  /**
   * Get technical debt items
   */
  getTechnicalDebt() {
    return this.records
      .filter(r => r.technicalDebt)
      .map(r => ({
        decisionId: r.id,
        decision: r.decision,
        debt: r.technicalDebt,
        createdAt: r.timestamp,
        category: r.category,
        files: r.context.files
      }));
  }

  /**
   * Get decision timeline
   */
  getTimeline(options = {}) {
    const { startDate, endDate, category, limit = 50 } = options;
    
    let filtered = [...this.records];

    if (startDate) {
      filtered = filtered.filter(r => r.timestamp >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(r => r.timestamp <= endDate);
    }
    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }

    return filtered
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get all tags
   */
  getAllTags() {
    return Array.from(this.tags);
  }

  /**
   * Get statistics
   */
  getStatistics() {
    const categoryBreakdown = {};
    const monthlyDecisions = {};

    for (const record of this.records) {
      // Category breakdown
      categoryBreakdown[record.category] = (categoryBreakdown[record.category] || 0) + 1;

      // Monthly breakdown
      const month = new Date(record.timestamp).toISOString().substring(0, 7);
      monthlyDecisions[month] = (monthlyDecisions[month] || 0) + 1;
    }

    return {
      totalDecisions: this.records.length,
      totalAlternatives: this.alternatives.length,
      totalConstraints: this.constraints.length,
      totalTags: this.tags.size,
      categoryBreakdown,
      monthlyDecisions,
      upcomingReviews: this.getUpcomingReviews(14).length,
      overdueReviews: this.getOverdueReviews().length,
      technicalDebtItems: this.getTechnicalDebt().length
    };
  }

  /**
   * Export all data
   */
  export() {
    return {
      records: this.records,
      alternatives: this.alternatives,
      constraints: this.constraints,
      reviews: this.reviews,
      tags: Array.from(this.tags),
      exportedAt: Date.now()
    };
  }

  /**
   * Import data
   */
  import(data) {
    if (data.records) this.records = data.records;
    if (data.alternatives) this.alternatives = data.alternatives;
    if (data.constraints) this.constraints = data.constraints;
    if (data.reviews) this.reviews = data.reviews;
    if (data.tags) {
      this.tags = new Set(data.tags);
    }
    this.notifyListeners();
  }

  /**
   * Clear all data
   */
  clear() {
    this.records = [];
    this.alternatives = [];
    this.constraints = [];
    this.reviews = [];
    this.tags.clear();
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
      recentDecisions: this.getTimeline({ limit: 5 }),
      upcomingReviews: this.getUpcomingReviews(7)
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Intent memory listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getIntentMemory() {
  if (!instance) {
    instance = new IntentMemory();
  }
  return instance;
}

export { INTENT_EVENTS, DECISION_CATEGORIES, REVIEW_INTERVALS };
export default IntentMemory;
