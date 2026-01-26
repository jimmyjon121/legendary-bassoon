/**
 * Context Manager - Smart context handling for AI conversations
 * Manages context windows, summarization, and task detection
 */

/**
 * Task types and their characteristics
 */
export const TASK_TYPES = {
  code: {
    id: 'code',
    name: 'Code',
    keywords: ['code', 'function', 'class', 'bug', 'error', 'implement', 'debug', 'fix', 'syntax', 'programming'],
    patterns: [/```[\w]*\n/, /function\s+\w+/, /class\s+\w+/, /import\s+/, /const\s+\w+\s*=/, /def\s+\w+/],
    suggestedWorkspace: 'code',
    contextStrategy: 'technical',
    maxTokens: 8000
  },
  writing: {
    id: 'writing',
    name: 'Writing',
    keywords: ['write', 'essay', 'article', 'blog', 'story', 'creative', 'content', 'draft', 'edit'],
    patterns: [/write\s+(a|an|the)\s+/, /paragraph/, /essay/, /article/, /story/],
    suggestedWorkspace: 'casual',
    contextStrategy: 'creative',
    maxTokens: 4000
  },
  analysis: {
    id: 'analysis',
    name: 'Analysis',
    keywords: ['analyze', 'compare', 'evaluate', 'pros', 'cons', 'review', 'assess', 'examine'],
    patterns: [/compare\s+/, /analyze\s+/, /pros\s+and\s+cons/, /advantages?\s+and\s+disadvantages?/],
    suggestedWorkspace: 'work',
    contextStrategy: 'analytical',
    maxTokens: 6000
  },
  chat: {
    id: 'chat',
    name: 'Chat',
    keywords: ['hi', 'hello', 'hey', 'thanks', 'thank you', 'how are', 'what is', 'tell me'],
    patterns: [/^(hi|hello|hey)\b/i, /\?$/, /^what\s+(is|are)\s+/i],
    suggestedWorkspace: 'casual',
    contextStrategy: 'conversational',
    maxTokens: 2000
  },
  math: {
    id: 'math',
    name: 'Math',
    keywords: ['calculate', 'solve', 'equation', 'formula', 'math', 'computation', 'number'],
    patterns: [/\d+\s*[\+\-\*\/\^]\s*\d+/, /solve\s+/, /calculate\s+/, /=\s*\?/],
    suggestedWorkspace: 'work',
    contextStrategy: 'precise',
    maxTokens: 2000
  },
  summarize: {
    id: 'summarize',
    name: 'Summarize',
    keywords: ['summarize', 'summary', 'tldr', 'brief', 'key points', 'main ideas'],
    patterns: [/summarize\s+/, /summary\s+of/, /tldr/i, /key\s+points/],
    suggestedWorkspace: 'work',
    contextStrategy: 'condensed',
    maxTokens: 4000
  }
};

/**
 * Context strategies for different task types
 */
const CONTEXT_STRATEGIES = {
  technical: {
    includeSystemInfo: true,
    includeCodeContext: true,
    preserveFormatting: true,
    summaryStyle: 'technical'
  },
  creative: {
    includeSystemInfo: false,
    includeCodeContext: false,
    preserveFormatting: false,
    summaryStyle: 'narrative'
  },
  analytical: {
    includeSystemInfo: false,
    includeCodeContext: false,
    preserveFormatting: true,
    summaryStyle: 'bullet'
  },
  conversational: {
    includeSystemInfo: false,
    includeCodeContext: false,
    preserveFormatting: false,
    summaryStyle: 'brief'
  },
  precise: {
    includeSystemInfo: true,
    includeCodeContext: false,
    preserveFormatting: true,
    summaryStyle: 'exact'
  },
  condensed: {
    includeSystemInfo: false,
    includeCodeContext: false,
    preserveFormatting: false,
    summaryStyle: 'bullet'
  }
};

/**
 * Detect the task type from message content
 */
export function detectTaskType(content) {
  if (!content || typeof content !== 'string') {
    return TASK_TYPES.chat;
  }

  const contentLower = content.toLowerCase();
  const scores = {};

  for (const [typeId, taskType] of Object.entries(TASK_TYPES)) {
    let score = 0;

    // Check keywords
    for (const keyword of taskType.keywords) {
      if (contentLower.includes(keyword)) {
        score += 10;
      }
    }

    // Check patterns
    for (const pattern of taskType.patterns) {
      if (pattern.test(content)) {
        score += 20;
      }
    }

    scores[typeId] = score;
  }

  // Find highest scoring type
  let maxScore = 0;
  let detectedType = 'chat';

  for (const [typeId, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedType = typeId;
    }
  }

  return {
    ...TASK_TYPES[detectedType],
    confidence: Math.min(maxScore / 50, 1) // Normalize to 0-1
  };
}

/**
 * Estimate token count for a string
 * Rough estimate: ~4 characters per token
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate messages to fit within token limit
 */
export function truncateMessages(messages, maxTokens, preserveRecent = 5) {
  if (!messages || messages.length === 0) return [];

  let totalTokens = 0;
  const result = [];

  // Always preserve the most recent messages
  const recentMessages = messages.slice(-preserveRecent);
  const olderMessages = messages.slice(0, -preserveRecent);

  // Calculate tokens for recent messages (these are always included)
  for (const msg of recentMessages) {
    totalTokens += estimateTokens(msg.content);
  }

  // Add older messages until we hit the limit
  for (let i = olderMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(olderMessages[i].content);
    if (totalTokens + msgTokens <= maxTokens) {
      result.unshift(olderMessages[i]);
      totalTokens += msgTokens;
    } else {
      break;
    }
  }

  // Add recent messages
  result.push(...recentMessages);

  return result;
}

/**
 * Generate a summary of conversation for context
 */
export function summarizeConversation(messages, style = 'brief') {
  if (!messages || messages.length === 0) return '';

  const userMessages = messages.filter(m => m.role === 'user');
  const aiMessages = messages.filter(m => m.role === 'assistant');

  switch (style) {
    case 'technical':
      return generateTechnicalSummary(userMessages, aiMessages);
    case 'narrative':
      return generateNarrativeSummary(userMessages, aiMessages);
    case 'bullet':
      return generateBulletSummary(userMessages, aiMessages);
    case 'exact':
      return generateExactSummary(userMessages, aiMessages);
    case 'brief':
    default:
      return generateBriefSummary(userMessages, aiMessages);
  }
}

function generateBriefSummary(userMessages, aiMessages) {
  const topics = extractTopics(userMessages);
  return `Previous conversation covered: ${topics.slice(0, 3).join(', ')}.`;
}

function generateTechnicalSummary(userMessages, aiMessages) {
  const codeBlocks = [];
  const topics = [];

  for (const msg of [...userMessages, ...aiMessages]) {
    const content = msg.content || '';
    
    // Extract code language mentions
    const codeMatch = content.match(/```(\w+)/g);
    if (codeMatch) {
      codeBlocks.push(...codeMatch.map(m => m.replace('```', '')));
    }

    // Extract technical terms
    const techTerms = content.match(/\b(function|class|api|database|server|client|component|module)\b/gi);
    if (techTerms) {
      topics.push(...techTerms.map(t => t.toLowerCase()));
    }
  }

  const uniqueLanguages = [...new Set(codeBlocks)];
  const uniqueTopics = [...new Set(topics)];

  return `Technical context: ${uniqueLanguages.length > 0 ? `Languages: ${uniqueLanguages.join(', ')}. ` : ''}${uniqueTopics.length > 0 ? `Topics: ${uniqueTopics.slice(0, 5).join(', ')}.` : ''}`;
}

function generateNarrativeSummary(userMessages, aiMessages) {
  if (userMessages.length === 0) return '';
  
  const firstMsg = userMessages[0].content.slice(0, 100);
  const lastMsg = userMessages[userMessages.length - 1].content.slice(0, 100);
  
  return `The conversation started with: "${firstMsg}..." and most recently discussed: "${lastMsg}..."`;
}

function generateBulletSummary(userMessages) {
  const points = userMessages
    .slice(-5)
    .map(m => `- ${m.content.slice(0, 50)}...`)
    .join('\n');
  
  return `Key discussion points:\n${points}`;
}

function generateExactSummary(userMessages, aiMessages) {
  const messageCount = userMessages.length + aiMessages.length;
  const totalChars = [...userMessages, ...aiMessages]
    .reduce((acc, m) => acc + (m.content?.length || 0), 0);
  
  return `Conversation stats: ${messageCount} messages, ~${estimateTokens(totalChars)} tokens.`;
}

function extractTopics(messages) {
  const words = messages
    .map(m => m.content)
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4);

  const wordCounts = {};
  for (const word of words) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }

  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Build optimized context for AI request
 */
export function buildOptimizedContext(messages, options = {}) {
  const {
    maxTokens = 4000,
    taskType = null,
    includeSystemPrompt = true,
    customSystemPrompt = null
  } = options;

  // Detect task type if not provided
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const detected = taskType || detectTaskType(lastUserMessage?.content);
  const strategy = CONTEXT_STRATEGIES[detected.contextStrategy] || CONTEXT_STRATEGIES.conversational;

  // Calculate available tokens for messages
  const systemPromptTokens = customSystemPrompt ? estimateTokens(customSystemPrompt) : 200;
  const availableTokens = maxTokens - (includeSystemPrompt ? systemPromptTokens : 0);

  // Truncate messages to fit
  const truncatedMessages = truncateMessages(messages, availableTokens);

  // Generate summary if we had to truncate significantly
  let contextSummary = '';
  if (messages.length > truncatedMessages.length + 2) {
    const removedMessages = messages.slice(0, messages.length - truncatedMessages.length);
    contextSummary = summarizeConversation(removedMessages, strategy.summaryStyle);
  }

  return {
    messages: truncatedMessages,
    contextSummary,
    taskType: detected,
    strategy,
    stats: {
      originalMessageCount: messages.length,
      includedMessageCount: truncatedMessages.length,
      estimatedTokens: truncatedMessages.reduce((acc, m) => acc + estimateTokens(m.content), 0),
      hasSummary: !!contextSummary
    }
  };
}

/**
 * Context Manager class for managing conversation context
 */
export class ContextManager {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 4000;
    this.conversationMemory = new Map();
  }

  /**
   * Store conversation context
   */
  setContext(conversationId, context) {
    this.conversationMemory.set(conversationId, {
      ...context,
      updatedAt: Date.now()
    });
  }

  /**
   * Get stored context
   */
  getContext(conversationId) {
    return this.conversationMemory.get(conversationId);
  }

  /**
   * Build context for a conversation
   */
  buildContext(conversationId, messages, options = {}) {
    const context = buildOptimizedContext(messages, {
      maxTokens: this.maxTokens,
      ...options
    });

    this.setContext(conversationId, context);
    return context;
  }

  /**
   * Clear context for a conversation
   */
  clearContext(conversationId) {
    this.conversationMemory.delete(conversationId);
  }

  /**
   * Get memory usage
   */
  getStats() {
    return {
      conversationsTracked: this.conversationMemory.size,
      maxTokens: this.maxTokens
    };
  }
}

// Singleton instance
export const contextManager = new ContextManager();

export default {
  TASK_TYPES,
  detectTaskType,
  estimateTokens,
  truncateMessages,
  summarizeConversation,
  buildOptimizedContext,
  ContextManager,
  contextManager
};






