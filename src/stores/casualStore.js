import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Casual workspace store - manages the innovative conversation experience
 */
export const useCasualStore = create(
  subscribeWithSelector((set, get) => ({
    // View state
    currentView: 'stream', // 'stream' | 'canvas' | 'document' | 'timeline' | 'focus'
    previousView: null,
    viewHistory: ['stream'],
    
    // Conversation organization
    conversationIndex: {}, // id -> metadata
    topicClusters: [], // grouped conversations by topic
    conversationConnections: [], // relationships between conversations
    
    // Context and intelligence
    activeContexts: [], // current conversation contexts
    ambientSuggestions: [], // AI-generated suggestions
    ambientMode: true, // whether ambient intelligence is active
    
    // Conversation metadata
    conversationMetadata: null, // current conversation stats
    
    // Canvas view state
    canvasNodes: [], // conversation nodes for canvas view
    canvasEdges: [], // connections between nodes
    canvasViewport: { x: 0, y: 0, zoom: 1 },
    
    // Document view state
    documentSections: [], // structured sections built from conversation
    documentOutline: [], // hierarchical outline
    
    // Timeline view state
    timelineEvents: [], // chronological events with context
    timelineFilters: { topics: [], timeRange: null, participants: [] },
    
    // Focus view state
    focusMode: false,
    focusTarget: null, // specific message or topic
    focusContext: [], // related messages/topics
    
    // Personality and customization
    currentPersonality: 'default',
    personalitySettings: {
      default: {
        name: 'Default Assistant',
        traits: { creativity: 0.7, formality: 0.3, enthusiasm: 0.6 },
        conversationStyle: 'balanced',
        memory: 'standard',
      },
    },
    
    // Analytics and insights
    conversationInsights: {
      totalConversations: 0,
      averageLength: 0,
      topTopics: [],
      moodTrends: [],
      learningProgress: [],
    },
    
    // UI state (context bubbles off by default to avoid noise)
    showContextBubbles: false,
    showAmbientSuggestions: false,
    sidebarExpanded: false,
    
    // Actions
    setCurrentView: (viewId) => {
      const current = get().currentView;
      if (current === viewId) return;
      
      set((state) => ({
        previousView: current,
        currentView: viewId,
        viewHistory: [viewId, ...state.viewHistory.filter(v => v !== viewId)].slice(0, 10),
      }));
    },
    
    toggleAmbientMode: () => {
      set((state) => ({ ambientMode: !state.ambientMode }));
    },
    
    setFocusMode: (enabled, target = null) => {
      set({ focusMode: enabled, focusTarget: target });
    },
    
    // Conversation indexing
    indexConversation: (conversationId, messages) => {
      // Extract topics, analyze sentiment, build metadata
      const topics = extractTopics(messages);
      const sentiment = analyzeSentiment(messages);
      const duration = calculateDuration(messages);
      
      set((state) => ({
        conversationIndex: {
          ...state.conversationIndex,
          [conversationId]: {
            id: conversationId,
            topics,
            sentiment,
            duration,
            messageCount: messages.length,
            lastUpdated: Date.now(),
          },
        },
      }));
    },
    
    // Context management
    updateActiveContexts: (contexts) => {
      set({ activeContexts: contexts });
    },
    
    addAmbientSuggestion: (suggestion) => {
      set((state) => ({
        ambientSuggestions: [suggestion, ...state.ambientSuggestions].slice(0, 5),
      }));
    },
    
    clearAmbientSuggestions: () => {
      set({ ambientSuggestions: [] });
    },
    
    // Canvas management
    updateCanvasNodes: (nodes) => {
      set({ canvasNodes: nodes });
    },
    
    updateCanvasEdges: (edges) => {
      set({ canvasEdges: edges });
    },
    
    setCanvasViewport: (viewport) => {
      set({ canvasViewport: viewport });
    },
    
    // Document building
    updateDocumentSections: (sections) => {
      set({ documentSections: sections });
    },
    
    generateDocumentFromConversation: (messages) => {
      // AI-powered document generation from conversation
      const sections = buildDocumentSections(messages);
      set({ documentSections: sections });
    },
    
    // Timeline management
    updateTimelineEvents: (events) => {
      set({ timelineEvents: events });
    },
    
    setTimelineFilters: (filters) => {
      set((state) => ({
        timelineFilters: { ...state.timelineFilters, ...filters },
      }));
    },
    
    // Personality management
    setPersonality: (personalityId) => {
      set({ currentPersonality: personalityId });
    },
    
    updatePersonalitySettings: (personalityId, settings) => {
      set((state) => ({
        personalitySettings: {
          ...state.personalitySettings,
          [personalityId]: { ...state.personalitySettings[personalityId], ...settings },
        },
      }));
    },
    
    // Analytics
    updateInsights: (insights) => {
      set((state) => ({
        conversationInsights: { ...state.conversationInsights, ...insights },
      }));
    },
  }))
);

// Helper functions for conversation analysis
function extractTopics(messages) {
  // Simple topic extraction - in a real implementation, this would use NLP
  const topics = new Set();
  
  messages.forEach((message) => {
    const content = message.content.toLowerCase();
    // Extract potential topics (this is a simplified version)
    const words = content.split(/\s+/).filter(word => word.length > 4);
    words.forEach(word => {
      if (word.match(/^[a-zA-Z]+$/)) {
        topics.add(word);
      }
    });
  });
  
  return Array.from(topics).slice(0, 10); // Top 10 topics
}

function analyzeSentiment(messages) {
  // Simple sentiment analysis - positive words vs negative words
  const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic'];
  const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'disappointing'];
  
  let positiveScore = 0;
  let negativeScore = 0;
  
  messages.forEach((message) => {
    const content = message.content.toLowerCase();
    positiveWords.forEach(word => {
      if (content.includes(word)) positiveScore++;
    });
    negativeWords.forEach(word => {
      if (content.includes(word)) negativeScore++;
    });
  });
  
  const total = positiveScore + negativeScore;
  if (total === 0) return 'neutral';
  
  const ratio = positiveScore / total;
  if (ratio > 0.6) return 'positive';
  if (ratio < 0.4) return 'negative';
  return 'neutral';
}

function calculateDuration(messages) {
  if (messages.length < 2) return '< 1 min';
  
  const first = new Date(messages[0].created_at);
  const last = new Date(messages[messages.length - 1].created_at);
  const diffMs = last - first;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins < 1) return '< 1 min';
  if (diffMins < 60) return `${diffMins} min`;
  
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  
  if (diffHours < 24) {
    return remainingMins > 0 ? `${diffHours}h ${remainingMins}m` : `${diffHours}h`;
  }
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
}

function buildDocumentSections(messages) {
  // AI-powered document section building (simplified)
  const sections = [];
  let currentSection = null;
  
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      // Start new section for user questions
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        id: `section-${index}`,
        title: message.content.substring(0, 50) + '...',
        type: 'question',
        messages: [message],
        summary: '',
      };
    } else if (currentSection) {
      // Add assistant response to current section
      currentSection.messages.push(message);
      currentSection.summary = message.content.substring(0, 100) + '...';
    }
  });
  
  if (currentSection) {
    sections.push(currentSection);
  }
  
  return sections;
}

export default useCasualStore;








