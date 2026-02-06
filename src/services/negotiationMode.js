/**
 * Negotiation Mode Service
 * 
 * AI-powered devil's advocate that challenges decisions constructively,
 * helping developers think through trade-offs and alternatives.
 */

// Decision types that trigger negotiation
const DECISION_TYPES = {
  technology_choice: {
    name: 'Technology Choice',
    description: 'Choosing a new library, framework, or tool',
    triggers: [
      /add (graphql|redux|typescript|mobx|zustand|jotai|recoil|valtio)/i,
      /switch (to|from) (react|vue|angular|svelte)/i,
      /migrate to/i,
      /use (mongodb|postgresql|mysql|redis)/i,
      /implement.*with/i
    ],
    debateAreas: ['learning_curve', 'maintenance', 'community', 'performance', 'team_expertise']
  },
  
  architecture: {
    name: 'Architecture Decision',
    description: 'Changing system architecture or patterns',
    triggers: [
      /create (new|another) (service|microservice|module)/i,
      /split (into|the)/i,
      /add.*layer/i,
      /implement.*pattern/i,
      /refactor.*architecture/i
    ],
    debateAreas: ['complexity', 'scalability', 'maintenance', 'testing', 'deployment']
  },
  
  abstraction: {
    name: 'Abstraction Level',
    description: 'Creating new abstractions or components',
    triggers: [
      /create (a|an) (component|hook|utility|helper|service|class)/i,
      /extract (to|into)/i,
      /abstract/i,
      /generalize/i
    ],
    debateAreas: ['reusability', 'complexity', 'flexibility', 'premature_abstraction']
  },
  
  refactoring: {
    name: 'Refactoring',
    description: 'Restructuring existing code',
    triggers: [
      /refactor/i,
      /rewrite/i,
      /restructure/i,
      /clean up/i,
      /improve.*code/i
    ],
    debateAreas: ['scope', 'risk', 'testing', 'timeline', 'value']
  },
  
  dependency: {
    name: 'Dependency Addition',
    description: 'Adding external dependencies',
    triggers: [
      /install|add|npm|yarn.*install/i,
      /use (lodash|moment|axios|jquery)/i,
      /import.*from/i
    ],
    debateAreas: ['bundle_size', 'maintenance', 'security', 'alternatives', 'necessity']
  },
  
  optimization: {
    name: 'Optimization',
    description: 'Performance or code optimization',
    triggers: [
      /optimize/i,
      /improve performance/i,
      /make.*faster/i,
      /reduce.*size/i,
      /cache/i
    ],
    debateAreas: ['premature_optimization', 'complexity', 'maintainability', 'measurement']
  }
};

// Debate positions
const DEBATE_POSITIONS = {
  strongly_against: {
    name: 'Strongly Against',
    color: 'red',
    weight: -2
  },
  cautiously_against: {
    name: 'Cautiously Against',
    color: 'orange',
    weight: -1
  },
  neutral: {
    name: 'Neutral',
    color: 'gray',
    weight: 0
  },
  cautiously_for: {
    name: 'Cautiously For',
    color: 'blue',
    weight: 1
  },
  strongly_for: {
    name: 'Strongly For',
    color: 'green',
    weight: 2
  }
};

// Counterargument templates by debate area
const COUNTERARGUMENTS = {
  learning_curve: {
    concern: 'Learning Curve',
    points: [
      'Team may need significant time to become proficient',
      'Documentation quality and availability varies',
      'Hidden complexity may emerge during implementation',
      'Training and onboarding costs should be factored in'
    ]
  },
  maintenance: {
    concern: 'Long-term Maintenance',
    points: [
      'Who will maintain this in 2 years?',
      'Is there risk of the project becoming unmaintained?',
      'How often does this require updates for security patches?',
      'What happens when the original author leaves?'
    ]
  },
  community: {
    concern: 'Community & Ecosystem',
    points: [
      'Community size may not reflect quality',
      'Popular today doesn\'t mean supported tomorrow',
      'Consider the bus factor of maintainers',
      'Check GitHub issues and response times'
    ]
  },
  performance: {
    concern: 'Performance Impact',
    points: [
      'Have you measured the actual performance bottleneck?',
      'Added complexity may offset performance gains',
      'Consider the 80/20 rule - is this in the critical path?',
      'What\'s the performance cost of the abstraction itself?'
    ]
  },
  team_expertise: {
    concern: 'Team Expertise',
    points: [
      'Does the team have experience with this?',
      'Who will review code in this technology?',
      'Can the team debug issues independently?',
      'Is there sufficient coverage for on-call support?'
    ]
  },
  complexity: {
    concern: 'Added Complexity',
    points: [
      'Is this complexity justified by the benefits?',
      'Could a simpler solution work for now?',
      'How does this affect new team member onboarding?',
      'What\'s the cognitive load of understanding this?'
    ]
  },
  scalability: {
    concern: 'Scalability Considerations',
    points: [
      'Are you solving for current scale or hypothetical future?',
      'What\'s the cost of premature scaling?',
      'Can you scale incrementally instead?',
      'Is vertical scaling sufficient for now?'
    ]
  },
  testing: {
    concern: 'Testing Impact',
    points: [
      'How will this change affect test coverage?',
      'Is the new code easier or harder to test?',
      'Do you need new testing infrastructure?',
      'What\'s the testing strategy for this?'
    ]
  },
  deployment: {
    concern: 'Deployment Complexity',
    points: [
      'How does this affect deployment pipelines?',
      'Can this be rolled back easily?',
      'What new monitoring is needed?',
      'How does this affect environment parity?'
    ]
  },
  reusability: {
    concern: 'Reusability Value',
    points: [
      'Will this actually be reused?',
      'Is the abstraction general enough?',
      'Could YAGNI apply here?',
      'What\'s the cost of over-generalization?'
    ]
  },
  flexibility: {
    concern: 'Flexibility Trade-offs',
    points: [
      'Flexibility often means complexity',
      'Are all these options actually needed?',
      'What\'s the cost of future-proofing?',
      'Could constraints actually be beneficial?'
    ]
  },
  premature_abstraction: {
    concern: 'Premature Abstraction',
    points: [
      'Rule of three: have you seen this pattern 3 times?',
      'Is this abstraction based on real or imagined needs?',
      'Could concrete code be clearer for now?',
      'Can you defer this abstraction until patterns emerge?'
    ]
  },
  scope: {
    concern: 'Scope Creep Risk',
    points: [
      'How do you prevent this from expanding?',
      'What\'s the minimum viable change?',
      'Can this be broken into smaller refactors?',
      'What\'s explicitly out of scope?'
    ]
  },
  risk: {
    concern: 'Risk Assessment',
    points: [
      'What\'s the worst case if this goes wrong?',
      'Do you have a rollback plan?',
      'What tests verify the refactor is correct?',
      'How do you validate behavior is unchanged?'
    ]
  },
  timeline: {
    concern: 'Timeline Reality',
    points: [
      'Estimates tend to be optimistic - add buffer',
      'What else gets delayed?',
      'Is there urgency driving this that may not be real?',
      'What\'s the cost of doing this later?'
    ]
  },
  value: {
    concern: 'Value Delivered',
    points: [
      'Does this deliver user value?',
      'Is technical debt the real problem?',
      'What concrete benefit does this provide?',
      'Could this effort be spent elsewhere?'
    ]
  },
  bundle_size: {
    concern: 'Bundle Size Impact',
    points: [
      'What\'s the size cost of this dependency?',
      'Can you tree-shake unused parts?',
      'Are there lighter alternatives?',
      'Does this push you over a performance budget?'
    ]
  },
  security: {
    concern: 'Security Implications',
    points: [
      'What\'s the security history of this package?',
      'How quickly are vulnerabilities patched?',
      'Does this expand your attack surface?',
      'Have you audited the code?'
    ]
  },
  alternatives: {
    concern: 'Alternatives Considered',
    points: [
      'What alternatives did you evaluate?',
      'Could native/browser APIs work instead?',
      'Is there a smaller utility that does just what you need?',
      'Have you considered writing this yourself?'
    ]
  },
  necessity: {
    concern: 'Necessity Check',
    points: [
      'Is this dependency actually needed?',
      'Could you solve this with existing code?',
      'How much of the library will you use?',
      'What\'s the cost/benefit of one more dependency?'
    ]
  },
  premature_optimization: {
    concern: 'Premature Optimization',
    points: [
      '"Premature optimization is the root of all evil" - Knuth',
      'Have you profiled to find the actual bottleneck?',
      'Is this a real problem or hypothetical?',
      'What\'s the cost of optimizing later if needed?'
    ]
  },
  measurement: {
    concern: 'Measurement & Validation',
    points: [
      'How will you measure the improvement?',
      'What\'s the baseline performance?',
      'Do you have before/after benchmarks?',
      'What metrics matter for this optimization?'
    ]
  },
  maintainability: {
    concern: 'Maintainability Cost',
    points: [
      'Is this code harder to understand now?',
      'Will future maintainers understand why?',
      'Does cleverness outweigh readability?',
      'What documentation does this need?'
    ]
  }
};

class NegotiationMode {
  constructor() {
    this.activeDebate = null;
    this.debateHistory = [];
    this.listeners = new Set();
  }

  /**
   * Detect if a message triggers negotiation
   */
  detectDecisionType(message) {
    for (const [type, config] of Object.entries(DECISION_TYPES)) {
      for (const trigger of config.triggers) {
        if (trigger.test(message)) {
          return { type, ...config };
        }
      }
    }
    return null;
  }

  /**
   * Start a debate session
   */
  startDebate(decision, context = {}) {
    const decisionType = this.detectDecisionType(decision) || {
      type: 'general',
      name: 'General Decision',
      debateAreas: ['complexity', 'value', 'risk', 'timeline']
    };

    // Build counterarguments
    const counterarguments = this.buildCounterarguments(decisionType.debateAreas);
    
    // Determine AI position
    const position = this.determinePosition(decision, decisionType, context);

    this.activeDebate = {
      id: `debate_${Date.now()}`,
      decision,
      decisionType,
      position,
      counterarguments,
      context,
      userResponses: [],
      startedAt: Date.now(),
      resolved: false
    };

    this.notifyListeners();
    return this.activeDebate;
  }

  /**
   * Build counterarguments for debate areas
   */
  buildCounterarguments(debateAreas) {
    const args = [];
    
    for (const area of debateAreas) {
      const template = COUNTERARGUMENTS[area];
      if (template) {
        args.push({
          area,
          concern: template.concern,
          points: template.points.slice(0, 3), // Limit to 3 points
          addressed: false
        });
      }
    }

    return args;
  }

  /**
   * Determine AI's debate position
   */
  determinePosition(decision, decisionType, context) {
    // Analyze the decision for red flags
    let score = 0;
    
    // Check for risk indicators
    const riskPatterns = [
      { pattern: /rewrite|rebuild|from scratch/i, weight: -2 },
      { pattern: /migrate|upgrade major/i, weight: -1 },
      { pattern: /new.*technology|framework/i, weight: -1 },
      { pattern: /optimize|performance/i, weight: 0 },
      { pattern: /refactor.*small|minor/i, weight: 1 },
      { pattern: /fix|bug|security/i, weight: 1 },
      { pattern: /test|document/i, weight: 2 }
    ];

    for (const { pattern, weight } of riskPatterns) {
      if (pattern.test(decision)) {
        score += weight;
      }
    }

    // Adjust based on context
    if (context.hasTests) score += 0.5;
    if (context.isProduction) score -= 0.5;
    if (context.teamSize === 1) score += 0.5; // Solo dev can iterate faster
    if (context.deadline) score -= 1; // Deadline pressure = more risk

    // Map score to position
    if (score <= -2) return DEBATE_POSITIONS.strongly_against;
    if (score <= -1) return DEBATE_POSITIONS.cautiously_against;
    if (score <= 1) return DEBATE_POSITIONS.neutral;
    if (score <= 2) return DEBATE_POSITIONS.cautiously_for;
    return DEBATE_POSITIONS.strongly_for;
  }

  /**
   * Add user response to an argument
   */
  respondToArgument(argumentArea, response) {
    if (!this.activeDebate) return null;

    const arg = this.activeDebate.counterarguments.find(a => a.area === argumentArea);
    if (arg) {
      arg.addressed = true;
      arg.response = response;
      
      this.activeDebate.userResponses.push({
        area: argumentArea,
        response,
        timestamp: Date.now()
      });
    }

    // Check if all arguments addressed
    const allAddressed = this.activeDebate.counterarguments.every(a => a.addressed);
    if (allAddressed) {
      this.activeDebate.canProceed = true;
    }

    this.notifyListeners();
    return this.activeDebate;
  }

  /**
   * User decides to proceed despite concerns
   */
  proceedAnyway(reason = '') {
    if (!this.activeDebate) return null;

    this.activeDebate.resolved = true;
    this.activeDebate.resolution = 'proceed';
    this.activeDebate.resolutionReason = reason;
    this.activeDebate.resolvedAt = Date.now();

    this.debateHistory.push({ ...this.activeDebate });
    
    const result = this.activeDebate;
    this.activeDebate = null;
    this.notifyListeners();

    return result;
  }

  /**
   * User decides to reconsider
   */
  reconsider(newApproach = '') {
    if (!this.activeDebate) return null;

    this.activeDebate.resolved = true;
    this.activeDebate.resolution = 'reconsidered';
    this.activeDebate.newApproach = newApproach;
    this.activeDebate.resolvedAt = Date.now();

    this.debateHistory.push({ ...this.activeDebate });
    
    const result = this.activeDebate;
    this.activeDebate = null;
    this.notifyListeners();

    return result;
  }

  /**
   * Cancel active debate
   */
  cancelDebate() {
    this.activeDebate = null;
    this.notifyListeners();
  }

  /**
   * Generate debate summary
   */
  generateSummary() {
    if (!this.activeDebate) return null;

    const { decision, position, counterarguments, userResponses } = this.activeDebate;
    
    const addressedCount = counterarguments.filter(a => a.addressed).length;
    const totalCount = counterarguments.length;

    return {
      decision,
      aiPosition: position.name,
      concernsRaised: totalCount,
      concernsAddressed: addressedCount,
      progress: Math.round((addressedCount / totalCount) * 100),
      canProceed: addressedCount === totalCount,
      mainConcerns: counterarguments.filter(a => !a.addressed).map(a => a.concern)
    };
  }

  /**
   * Get what would change AI's mind
   */
  getWhatWouldChangeMyMind() {
    if (!this.activeDebate) return [];

    const unaddressed = this.activeDebate.counterarguments.filter(a => !a.addressed);
    
    return unaddressed.map(arg => ({
      concern: arg.concern,
      suggestion: `Explain how you'll address: ${arg.points[0]}`
    }));
  }

  /**
   * Get active debate
   */
  getActiveDebate() {
    return this.activeDebate;
  }

  /**
   * Get debate history
   */
  getHistory() {
    return [...this.debateHistory];
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
      activeDebate: this.activeDebate,
      summary: this.generateSummary()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Negotiation listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getNegotiationMode() {
  if (!instance) {
    instance = new NegotiationMode();
  }
  return instance;
}

export { DECISION_TYPES, DEBATE_POSITIONS, COUNTERARGUMENTS };
export default NegotiationMode;
