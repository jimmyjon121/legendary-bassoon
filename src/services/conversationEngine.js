/**
 * Conversation Engine - Advanced conversation analysis and processing
 * Powers the intelligent features of the casual workspace
 */

// Topic keywords for classification
const TOPIC_CATEGORIES = {
  technology: ['ai', 'machine learning', 'programming', 'software', 'computer', 'tech', 'algorithm', 'data', 'api', 'code'],
  creative: ['art', 'design', 'music', 'writing', 'creative', 'imagination', 'story', 'poetry', 'visual', 'aesthetic'],
  science: ['research', 'study', 'experiment', 'theory', 'hypothesis', 'analysis', 'method', 'scientific', 'discovery'],
  business: ['strategy', 'market', 'customer', 'revenue', 'profit', 'business', 'company', 'startup', 'growth'],
  personal: ['life', 'relationship', 'emotion', 'feeling', 'experience', 'memory', 'personal', 'family', 'friend'],
  learning: ['learn', 'education', 'knowledge', 'understand', 'explain', 'teach', 'study', 'concept', 'skill'],
  philosophy: ['meaning', 'purpose', 'existence', 'truth', 'reality', 'consciousness', 'ethics', 'morality'],
  practical: ['how', 'what', 'when', 'where', 'why', 'help', 'solve', 'fix', 'problem', 'solution'],
};

/**
 * Extract topics from a conversation
 */
export function extractTopics(messages, options = {}) {
  const { maxTopics = 10, minRelevance = 0.1 } = options;
  
  if (!messages || messages.length === 0) return [];
  
  // Combine all message content
  const allText = messages
    .map(m => m.content || '')
    .join(' ')
    .toLowerCase();
  
  // Extract potential topics
  const words = allText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !COMMON_WORDS.includes(word));
  
  // Count word frequency
  const wordCounts = {};
  words.forEach(word => {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  });
  
  // Categorize and score topics
  const topicScores = {};
  
  Object.entries(TOPIC_CATEGORIES).forEach(([category, keywords]) => {
    let score = 0;
    keywords.forEach(keyword => {
      if (wordCounts[keyword]) {
        score += wordCounts[keyword];
      }
    });
    if (score > 0) {
      topicScores[category] = score / words.length; // Normalize by total words
    }
  });
  
  // Extract specific high-frequency words as topics
  const specificTopics = Object.entries(wordCounts)
    .filter(([word, count]) => count >= 2 && word.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({
      type: 'specific',
      name: word,
      relevance: count / words.length,
      category: 'specific',
    }));
  
  // Convert category scores to topics
  const categoryTopics = Object.entries(topicScores)
    .filter(([, score]) => score >= minRelevance)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTopics - specificTopics.length)
    .map(([category, score]) => ({
      type: 'category',
      name: category,
      relevance: score,
      category,
    }));
  
  return [...specificTopics, ...categoryTopics].slice(0, maxTopics);
}

/**
 * Analyze conversation sentiment and mood
 */
export function analyzeConversationMood(messages) {
  if (!messages || messages.length === 0) {
    return { overall: 'neutral', progression: [], confidence: 0 };
  }
  
  const sentimentProgression = messages.map((message, index) => {
    const sentiment = analyzeSentiment(message.content);
    return {
      messageIndex: index,
      sentiment: sentiment.label,
      confidence: sentiment.confidence,
      timestamp: message.created_at,
    };
  });
  
  // Calculate overall mood
  const sentiments = sentimentProgression.map(s => s.sentiment);
  const moodCounts = sentiments.reduce((acc, mood) => {
    acc[mood] = (acc[mood] || 0) + 1;
    return acc;
  }, {});
  
  const overall = Object.entries(moodCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
  
  return {
    overall,
    progression: sentimentProgression,
    confidence: sentimentProgression.reduce((sum, s) => sum + s.confidence, 0) / sentimentProgression.length,
  };
}

/**
 * Simple sentiment analysis
 */
function analyzeSentiment(text) {
  const positive = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'awesome', 'perfect', 'love', 'like', 'enjoy', 'happy', 'excited', 'thrilled'];
  const negative = ['bad', 'terrible', 'awful', 'horrible', 'disappointing', 'hate', 'dislike', 'sad', 'angry', 'frustrated', 'annoyed', 'worried'];
  const neutral = ['okay', 'fine', 'alright', 'normal', 'average', 'standard'];
  
  const lowerText = text.toLowerCase();
  
  let positiveScore = 0;
  let negativeScore = 0;
  let neutralScore = 0;
  
  positive.forEach(word => {
    if (lowerText.includes(word)) positiveScore++;
  });
  negative.forEach(word => {
    if (lowerText.includes(word)) negativeScore++;
  });
  neutral.forEach(word => {
    if (lowerText.includes(word)) neutralScore++;
  });
  
  const total = positiveScore + negativeScore + neutralScore;
  if (total === 0) {
    return { label: 'neutral', confidence: 0.5 };
  }
  
  if (positiveScore > negativeScore && positiveScore > neutralScore) {
    return { label: 'positive', confidence: positiveScore / total };
  }
  if (negativeScore > positiveScore && negativeScore > neutralScore) {
    return { label: 'negative', confidence: negativeScore / total };
  }
  
  return { label: 'neutral', confidence: Math.max(neutralScore / total, 0.3) };
}

/**
 * Find relationships between conversations
 */
export function findConversationRelationships(conversations) {
  const relationships = [];
  
  for (let i = 0; i < conversations.length; i++) {
    for (let j = i + 1; j < conversations.length; j++) {
      const conv1 = conversations[i];
      const conv2 = conversations[j];
      
      const similarity = calculateTopicSimilarity(conv1.topics, conv2.topics);
      
      if (similarity > 0.3) {
        relationships.push({
          id: `${conv1.id}-${conv2.id}`,
          source: conv1.id,
          target: conv2.id,
          strength: similarity,
          type: similarity > 0.7 ? 'strong' : similarity > 0.5 ? 'medium' : 'weak',
          sharedTopics: findSharedTopics(conv1.topics, conv2.topics),
        });
      }
    }
  }
  
  return relationships;
}

function calculateTopicSimilarity(topics1, topics2) {
  if (!topics1 || !topics2 || topics1.length === 0 || topics2.length === 0) {
    return 0;
  }
  
  const set1 = new Set(topics1.map(t => t.name || t));
  const set2 = new Set(topics2.map(t => t.name || t));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size; // Jaccard similarity
}

function findSharedTopics(topics1, topics2) {
  const names1 = topics1.map(t => t.name || t);
  const names2 = topics2.map(t => t.name || t);
  
  return names1.filter(name => names2.includes(name));
}

/**
 * Generate conversation summary
 */
export function generateConversationSummary(messages, options = {}) {
  const { maxLength = 100 } = options;
  
  if (!messages || messages.length === 0) {
    return 'Empty conversation';
  }
  
  // Extract key points from user messages
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  
  if (userMessages.length === 0) {
    return 'No user messages';
  }
  
  // Use first user message as primary topic
  const primaryTopic = userMessages[0].content.substring(0, 50);
  
  // Count follow-up questions
  const followUps = userMessages.length - 1;
  
  let summary = primaryTopic;
  if (followUps > 0) {
    summary += ` (${followUps} follow-up${followUps > 1 ? 's' : ''})`;
  }
  
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength - 3) + '...';
  }
  
  return summary;
}

/**
 * Build conversation timeline events
 */
export function buildTimelineEvents(messages) {
  const events = [];
  let currentTopic = null;
  let topicStartIndex = 0;
  
  messages.forEach((message, index) => {
    // Detect topic changes (simplified)
    if (message.role === 'user') {
      // End previous topic if exists
      if (currentTopic && index > topicStartIndex) {
        events.push({
          id: `topic-${topicStartIndex}`,
          type: 'topic',
          title: currentTopic,
          startIndex: topicStartIndex,
          endIndex: index - 1,
          duration: calculateEventDuration(messages, topicStartIndex, index - 1),
          messageCount: index - topicStartIndex,
        });
      }
      
      // Start new topic
      currentTopic = message.content.substring(0, 30) + '...';
      topicStartIndex = index;
    }
    
    // Add message event
    events.push({
      id: message.id,
      type: 'message',
      role: message.role,
      content: message.content,
      timestamp: message.created_at,
      index,
    });
  });
  
  // Add final topic if exists
  if (currentTopic && messages.length > topicStartIndex) {
    events.push({
      id: `topic-${topicStartIndex}`,
      type: 'topic',
      title: currentTopic,
      startIndex: topicStartIndex,
      endIndex: messages.length - 1,
      duration: calculateEventDuration(messages, topicStartIndex, messages.length - 1),
      messageCount: messages.length - topicStartIndex,
    });
  }
  
  return events;
}

function calculateEventDuration(messages, startIndex, endIndex) {
  if (startIndex >= endIndex || !messages[startIndex] || !messages[endIndex]) {
    return 0;
  }
  
  const start = new Date(messages[startIndex].created_at);
  const end = new Date(messages[endIndex].created_at);
  
  return Math.max(0, end - start);
}

// Common words to filter out
const COMMON_WORDS = [
  'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'within', 'without', 'under', 'over',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'can', 'could', 'may', 'might', 'will', 'would', 'shall', 'should', 'must', 'ought',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'done', 'be', 'am', 'is', 'are', 'was', 'were', 'being', 'been',
  'get', 'got', 'getting', 'give', 'gave', 'given', 'giving', 'go', 'goes', 'went', 'going', 'gone',
  'make', 'made', 'making', 'take', 'took', 'taken', 'taking', 'come', 'came', 'coming', 'see', 'saw', 'seen', 'seeing',
  'know', 'knew', 'known', 'knowing', 'think', 'thought', 'thinking', 'want', 'wanted', 'wanting', 'need', 'needed', 'needing',
  'say', 'said', 'saying', 'tell', 'told', 'telling', 'ask', 'asked', 'asking', 'work', 'worked', 'working',
  'try', 'tried', 'trying', 'use', 'used', 'using', 'find', 'found', 'finding', 'look', 'looked', 'looking',
  'feel', 'felt', 'feeling', 'seem', 'seemed', 'seeming', 'keep', 'kept', 'keeping', 'let', 'lets', 'letting',
  'put', 'puts', 'putting', 'end', 'ends', 'ended', 'ending', 'turn', 'turned', 'turning', 'start', 'started', 'starting',
  'show', 'showed', 'shown', 'showing', 'hear', 'heard', 'hearing', 'play', 'played', 'playing', 'run', 'ran', 'running',
  'move', 'moved', 'moving', 'live', 'lived', 'living', 'believe', 'believed', 'believing', 'hold', 'held', 'holding',
  'bring', 'brought', 'bringing', 'happen', 'happened', 'happening', 'write', 'wrote', 'written', 'writing',
  'provide', 'provided', 'providing', 'sit', 'sat', 'sitting', 'stand', 'stood', 'standing', 'lose', 'lost', 'losing',
  'add', 'added', 'adding', 'win', 'won', 'winning', 'offer', 'offered', 'offering', 'remember', 'remembered', 'remembering',
  'love', 'loved', 'loving', 'consider', 'considered', 'considering', 'appear', 'appeared', 'appearing', 'buy', 'bought', 'buying',
  'wait', 'waited', 'waiting', 'serve', 'served', 'serving', 'die', 'died', 'dying', 'send', 'sent', 'sending',
  'expect', 'expected', 'expecting', 'build', 'built', 'building', 'stay', 'stayed', 'staying', 'fall', 'fell', 'fallen', 'falling',
  'cut', 'cuts', 'cutting', 'reach', 'reached', 'reaching', 'kill', 'killed', 'killing', 'remain', 'remained', 'remaining'
];

/**
 * Generate conversation insights
 */
export function generateConversationInsights(conversations) {
  if (!conversations || conversations.length === 0) {
    return {
      totalConversations: 0,
      averageLength: 0,
      topTopics: [],
      moodTrends: [],
      learningProgress: [],
      patterns: [],
    };
  }
  
  // Calculate basic stats
  const totalMessages = conversations.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);
  const averageLength = Math.round(totalMessages / conversations.length);
  
  // Aggregate all topics
  const allTopics = conversations.flatMap(conv => conv.topics || []);
  const topicCounts = {};
  
  allTopics.forEach(topic => {
    const name = topic.name || topic;
    topicCounts[name] = (topicCounts[name] || 0) + (topic.relevance || 1);
  });
  
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, score]) => ({ name, score }));
  
  // Analyze mood trends over time
  const moodTrends = conversations
    .filter(conv => conv.sentiment)
    .sort((a, b) => new Date(a.lastUpdated || 0) - new Date(b.lastUpdated || 0))
    .map((conv, index) => ({
      conversation: index + 1,
      mood: conv.sentiment,
      timestamp: conv.lastUpdated,
    }));
  
  // Identify learning patterns
  const learningProgress = identifyLearningPatterns(conversations);
  
  return {
    totalConversations: conversations.length,
    averageLength,
    topTopics,
    moodTrends,
    learningProgress,
    patterns: identifyConversationPatterns(conversations),
  };
}

function identifyLearningPatterns(conversations) {
  // Identify questions vs explanations ratio over time
  const patterns = conversations.map((conv, index) => {
    const messages = conv.messages || [];
    const userQuestions = messages.filter(m => 
      m.role === 'user' && m.content.includes('?')
    ).length;
    const totalUserMessages = messages.filter(m => m.role === 'user').length;
    
    const questionRatio = totalUserMessages > 0 ? userQuestions / totalUserMessages : 0;
    
    return {
      conversation: index + 1,
      questionRatio,
      explorationLevel: questionRatio > 0.5 ? 'high' : questionRatio > 0.2 ? 'medium' : 'low',
      timestamp: conv.lastUpdated,
    };
  });
  
  return patterns;
}

function identifyConversationPatterns(conversations) {
  const patterns = [];
  
  // Pattern: Question chains (conversations with lots of follow-up questions)
  const questionChains = conversations.filter(conv => {
    const messages = conv.messages || [];
    const userMessages = messages.filter(m => m.role === 'user');
    return userMessages.length > 3;
  });
  
  if (questionChains.length > 0) {
    patterns.push({
      type: 'question_chains',
      name: 'Deep Exploration',
      description: `You tend to ask follow-up questions in ${questionChains.length} conversations`,
      conversations: questionChains.map(c => c.id),
    });
  }
  
  // Pattern: Topic clustering
  const topicGroups = groupConversationsByTopic(conversations);
  Object.entries(topicGroups).forEach(([topic, convs]) => {
    if (convs.length > 2) {
      patterns.push({
        type: 'topic_cluster',
        name: `${topic} Focus`,
        description: `${convs.length} conversations about ${topic}`,
        conversations: convs.map(c => c.id),
        topic,
      });
    }
  });
  
  return patterns;
}

function groupConversationsByTopic(conversations) {
  const groups = {};
  
  conversations.forEach(conv => {
    (conv.topics || []).forEach(topic => {
      const name = topic.name || topic;
      if (!groups[name]) groups[name] = [];
      groups[name].push(conv);
    });
  });
  
  return groups;
}

/**
 * Generate ambient suggestions based on conversation context
 */
export function generateAmbientSuggestions(currentMessages, conversationHistory) {
  const suggestions = [];
  
  if (!currentMessages || currentMessages.length === 0) {
    // No current conversation - suggest based on history
    suggestions.push({
      id: 'start-conversation',
      type: 'starter',
      text: "What's on your mind today?",
      action: 'send',
      icon: 'MessageSquare',
    });
    
    return suggestions;
  }
  
  // Analyze current conversation
  const lastMessage = currentMessages[currentMessages.length - 1];
  const topics = extractTopics(currentMessages, { maxTopics: 3 });
  
  // Generate contextual suggestions
  if (lastMessage?.role === 'assistant') {
    suggestions.push({
      id: 'follow-up',
      type: 'follow_up',
      text: 'Ask a follow-up question',
      action: 'suggest_followup',
      icon: 'ArrowRight',
    });
    
    suggestions.push({
      id: 'explore-deeper',
      type: 'explore',
      text: 'Explore this topic deeper',
      action: 'explore_topic',
      icon: 'Search',
    });
  }
  
  // Topic-based suggestions
  if (topics.length > 0) {
    suggestions.push({
      id: 'related-topic',
      type: 'related',
      text: `Explore related: ${topics[0].name}`,
      action: 'explore_related',
      data: { topic: topics[0].name },
      icon: 'Lightbulb',
    });
  }
  
  // Conversation management suggestions
  if (currentMessages.length > 5) {
    suggestions.push({
      id: 'summarize',
      type: 'summarize',
      text: 'Summarize this conversation',
      action: 'summarize',
      icon: 'FileText',
    });
  }
  
  return suggestions.slice(0, 4); // Limit to 4 suggestions
}

/**
 * Process conversation for canvas view
 */
export function buildConversationGraph(messages) {
  const nodes = [];
  const edges = [];
  
  if (!messages || messages.length === 0) {
    return { nodes, edges };
  }
  
  // Create nodes for each message cluster
  let currentCluster = [];
  let clusterIndex = 0;
  
  messages.forEach((message, index) => {
    if (message.role === 'user' && currentCluster.length > 0) {
      // End current cluster, start new one
      const clusterNode = createClusterNode(currentCluster, clusterIndex);
      if (clusterNode) nodes.push(clusterNode);
      
      // Create edge to previous cluster
      if (nodes.length > 0) {
        edges.push({
          id: `edge-${nodes.length - 1}-${clusterIndex}`,
          source: nodes[nodes.length - 1].id,
          target: clusterNode.id,
          type: 'conversation_flow',
        });
      }
      
      currentCluster = [message];
      clusterIndex++;
    } else {
      currentCluster.push(message);
    }
  });
  
  // Add final cluster
  if (currentCluster.length > 0) {
    const clusterNode = createClusterNode(currentCluster, clusterIndex);
    if (clusterNode) {
      nodes.push(clusterNode);
      
      if (nodes.length > 1) {
        edges.push({
          id: `edge-${nodes.length - 2}-${clusterIndex}`,
          source: nodes[nodes.length - 2].id,
          target: clusterNode.id,
          type: 'conversation_flow',
        });
      }
    }
  }
  
  return { nodes, edges };
}

function createClusterNode(messages, index) {
  if (!messages || messages.length === 0) return null;
  
  const userMessage = messages.find(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  
  if (!userMessage) return null;
  
  return {
    id: `cluster-${index}`,
    type: 'conversation_cluster',
    data: {
      label: userMessage.content.substring(0, 50) + '...',
      question: userMessage.content,
      responses: assistantMessages.map(m => m.content),
      messageCount: messages.length,
      timestamp: userMessage.created_at,
    },
    position: { x: index * 300, y: Math.sin(index * 0.5) * 100 },
  };
}

export default {
  extractTopics,
  analyzeConversationMood,
  findConversationRelationships,
  generateConversationSummary,
  buildTimelineEvents,
  generateAmbientSuggestions,
  buildConversationGraph,
  generateConversationInsights,
};











