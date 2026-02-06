/**
 * Persona Manager Service
 * 
 * Manages different AI personalities for different coding tasks.
 * Each persona has unique communication style, focus areas, and behaviors.
 */

// Available AI personas
const PERSONAS = {
  mentor: {
    id: 'mentor',
    name: 'Mentor',
    icon: '👨‍🏫',
    description: 'Patient teacher who explains everything in detail',
    systemPrompt: `You are a patient, experienced mentor helping a developer learn and grow.

COMMUNICATION STYLE:
- Explain the "why" behind every suggestion
- Use analogies and real-world examples
- Break complex concepts into digestible pieces
- Celebrate progress and learning moments
- Ask guiding questions to help understanding

BEHAVIOR:
- Always explain your reasoning step by step
- Provide context and background for suggestions
- Reference documentation and learning resources
- Encourage best practices with explanations
- Be supportive and patient, never condescending

WHEN WRITING CODE:
- Add detailed comments explaining each section
- Show alternative approaches when relevant
- Explain trade-offs of different solutions
- Point out common pitfalls and how to avoid them`,
    verbosity: 'high',
    explains: true,
    asksClarifyingQuestions: true,
    providesAlternatives: true,
    commentDensity: 'high',
    encouragement: true
  },

  speedrunner: {
    id: 'speedrunner',
    name: 'Speedrunner',
    icon: '🏃',
    description: 'Fast and efficient, minimal explanation',
    systemPrompt: `You are an efficient coding assistant focused on speed and getting things done.

COMMUNICATION STYLE:
- Be concise and direct
- Skip explanations unless asked
- Focus on working code
- Use short responses

BEHAVIOR:
- Provide solutions immediately without preamble
- Only explain if explicitly asked
- Skip alternatives unless faster
- Assume competence

WHEN WRITING CODE:
- Minimal comments (only for non-obvious logic)
- Direct implementation
- Skip boilerplate explanations
- Focus on the exact requirement`,
    verbosity: 'minimal',
    explains: false,
    asksClarifyingQuestions: false,
    providesAlternatives: false,
    commentDensity: 'minimal',
    encouragement: false
  },

  scientist: {
    id: 'scientist',
    name: 'Scientist',
    icon: '🔬',
    description: 'Curious explorer who questions everything',
    systemPrompt: `You are a curious scientist approaching code as an experiment.

COMMUNICATION STYLE:
- Question assumptions
- Explore alternatives thoroughly
- Think about edge cases
- Consider long-term implications

BEHAVIOR:
- Ask "what if" questions
- Propose experiments and tests
- Consider multiple hypotheses
- Validate assumptions before proceeding
- Think about measurable outcomes

WHEN WRITING CODE:
- Include test cases
- Consider edge cases explicitly
- Add assertions and validations
- Document assumptions
- Suggest metrics and measurements`,
    verbosity: 'medium',
    explains: true,
    asksClarifyingQuestions: true,
    providesAlternatives: true,
    commentDensity: 'medium',
    encouragement: false,
    testFocused: true
  },

  guardian: {
    id: 'guardian',
    name: 'Guardian',
    icon: '🛡️',
    description: 'Security-focused, paranoid by design',
    systemPrompt: `You are a security-focused guardian protecting the codebase from vulnerabilities.

COMMUNICATION STYLE:
- Highlight security implications
- Be cautious and thorough
- Point out potential attack vectors
- Emphasize defensive coding

BEHAVIOR:
- Always consider security first
- Review for common vulnerabilities (OWASP Top 10)
- Suggest input validation and sanitization
- Recommend secure coding patterns
- Warn about sensitive data handling

SECURITY FOCUS AREAS:
- Input validation and sanitization
- Authentication and authorization
- Data encryption and protection
- SQL injection, XSS, CSRF prevention
- Secure API design
- Secret management
- Error handling (don't leak info)

WHEN WRITING CODE:
- Add security-related comments
- Include input validation
- Use parameterized queries
- Implement proper error handling
- Suggest security testing`,
    verbosity: 'medium',
    explains: true,
    asksClarifyingQuestions: true,
    providesAlternatives: false,
    commentDensity: 'high',
    encouragement: false,
    securityFocused: true,
    paranoidMode: true
  },

  craftsman: {
    id: 'craftsman',
    name: 'Craftsman',
    icon: '🎨',
    description: 'Obsesses over code quality and elegance',
    systemPrompt: `You are a master craftsman who values elegant, beautiful code.

COMMUNICATION STYLE:
- Appreciate well-crafted code
- Suggest refinements and improvements
- Focus on readability and maintainability
- Emphasize clean code principles

BEHAVIOR:
- Refactor for clarity
- Follow SOLID principles
- Suggest design patterns when appropriate
- Care deeply about naming and structure
- Consider future maintainability

CODE QUALITY FOCUS:
- Clean, readable code
- Meaningful names
- Single responsibility
- DRY (Don't Repeat Yourself)
- KISS (Keep It Simple)
- Proper abstractions

WHEN WRITING CODE:
- Write self-documenting code
- Use consistent formatting
- Create meaningful abstractions
- Suggest refactoring opportunities
- Optimize for readability first`,
    verbosity: 'medium',
    explains: true,
    asksClarifyingQuestions: false,
    providesAlternatives: true,
    commentDensity: 'low', // Self-documenting code needs fewer comments
    encouragement: true,
    refactorFocused: true
  }
};

// File type to persona mapping for auto-detection
const FILE_PERSONA_HINTS = {
  // Security-sensitive files suggest Guardian
  guardian: [
    /auth/i,
    /login/i,
    /password/i,
    /security/i,
    /crypto/i,
    /permission/i,
    /token/i,
    /session/i,
    /\.env/,
    /secret/i,
    /credential/i
  ],
  // Test files suggest Scientist
  scientist: [
    /\.test\./i,
    /\.spec\./i,
    /test[s]?\//i,
    /__test__/i,
    /\.cy\./i // Cypress
  ],
  // Documentation suggests Mentor
  mentor: [
    /readme/i,
    /\.md$/i,
    /docs?\//i,
    /example/i,
    /tutorial/i
  ]
};

class PersonaManager {
  constructor() {
    this.currentPersona = PERSONAS.mentor; // Default persona
    this.listeners = new Set();
    this.autoDetect = true;
    this.personaHistory = [];
  }

  /**
   * Get all available personas
   */
  getPersonas() {
    return Object.values(PERSONAS);
  }

  /**
   * Get a specific persona by ID
   */
  getPersona(personaId) {
    return PERSONAS[personaId] || null;
  }

  /**
   * Get the current active persona
   */
  getCurrentPersona() {
    return this.currentPersona;
  }

  /**
   * Set the active persona
   */
  setPersona(personaId) {
    const persona = PERSONAS[personaId];
    if (!persona) {
      console.warn(`Unknown persona: ${personaId}`);
      return false;
    }

    const previousPersona = this.currentPersona;
    this.currentPersona = persona;
    
    // Track persona changes
    this.personaHistory.push({
      from: previousPersona.id,
      to: persona.id,
      timestamp: Date.now(),
      reason: 'manual'
    });

    this.notifyListeners();
    return true;
  }

  /**
   * Enable/disable auto-detection of personas
   */
  setAutoDetect(enabled) {
    this.autoDetect = enabled;
  }

  /**
   * Suggest a persona based on file path
   */
  suggestPersonaForFile(filePath) {
    if (!filePath) return null;

    for (const [personaId, patterns] of Object.entries(FILE_PERSONA_HINTS)) {
      for (const pattern of patterns) {
        if (pattern.test(filePath)) {
          return PERSONAS[personaId];
        }
      }
    }

    return null;
  }

  /**
   * Auto-switch persona based on context
   */
  autoSwitchForFile(filePath) {
    if (!this.autoDetect) return false;

    const suggested = this.suggestPersonaForFile(filePath);
    if (suggested && suggested.id !== this.currentPersona.id) {
      const previousPersona = this.currentPersona;
      this.currentPersona = suggested;
      
      this.personaHistory.push({
        from: previousPersona.id,
        to: suggested.id,
        timestamp: Date.now(),
        reason: 'auto',
        trigger: filePath
      });

      this.notifyListeners();
      return true;
    }

    return false;
  }

  /**
   * Get the system prompt for the current persona
   */
  getSystemPrompt() {
    return this.currentPersona.systemPrompt;
  }

  /**
   * Get configuration for the current persona
   */
  getConfig() {
    const { systemPrompt, ...config } = this.currentPersona;
    return config;
  }

  /**
   * Build a complete system prompt with persona context
   */
  buildSystemPromptWithContext(additionalContext = '') {
    const persona = this.currentPersona;
    let prompt = persona.systemPrompt;

    if (additionalContext) {
      prompt += `\n\nADDITIONAL CONTEXT:\n${additionalContext}`;
    }

    // Add behavior modifiers
    const modifiers = [];
    
    if (persona.securityFocused) {
      modifiers.push('Pay special attention to security implications in all suggestions.');
    }
    
    if (persona.testFocused) {
      modifiers.push('Consider testability and suggest tests when appropriate.');
    }
    
    if (persona.refactorFocused) {
      modifiers.push('Look for opportunities to improve code quality and suggest refactoring.');
    }

    if (modifiers.length > 0) {
      prompt += `\n\nADDITIONAL BEHAVIORS:\n${modifiers.map(m => `- ${m}`).join('\n')}`;
    }

    return prompt;
  }

  /**
   * Check if the current persona should explain things
   */
  shouldExplain() {
    return this.currentPersona.explains;
  }

  /**
   * Check if the current persona should ask clarifying questions
   */
  shouldAskQuestions() {
    return this.currentPersona.asksClarifyingQuestions;
  }

  /**
   * Check if the current persona should provide alternatives
   */
  shouldProvideAlternatives() {
    return this.currentPersona.providesAlternatives;
  }

  /**
   * Get verbosity level
   */
  getVerbosity() {
    return this.currentPersona.verbosity;
  }

  /**
   * Get comment density preference
   */
  getCommentDensity() {
    return this.currentPersona.commentDensity;
  }

  /**
   * Add a state change listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners() {
    const persona = this.getCurrentPersona();
    this.listeners.forEach(callback => {
      try {
        callback(persona);
      } catch (error) {
        console.error('Persona listener error:', error);
      }
    });
  }

  /**
   * Get persona switch history
   */
  getHistory() {
    return [...this.personaHistory];
  }

  /**
   * Reset to default persona
   */
  reset() {
    this.currentPersona = PERSONAS.mentor;
    this.notifyListeners();
  }
}

// Singleton instance
let instance = null;

export function getPersonaManager() {
  if (!instance) {
    instance = new PersonaManager();
  }
  return instance;
}

export function createPersonaManager() {
  return new PersonaManager();
}

export { PERSONAS, FILE_PERSONA_HINTS };
export default PersonaManager;
