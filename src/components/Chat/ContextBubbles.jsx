import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Lightbulb, 
  ArrowRight, 
  Plus, 
  X, 
  Sparkles, 
  MessageCircle,
  Search,
  Brain,
  Zap
} from 'lucide-react';
import { useCasualStore } from '../../stores/casualStore';
import { useAppStore } from '../../stores/appStore';
import conversationEngine from '../../services/conversationEngine';

/**
 * Floating context bubbles that provide intelligent suggestions
 * and topic exploration around the current conversation
 */
export function ContextBubbles({ messages = [], isVisible = true }) {
  // Use selective subscriptions for optimal re-render performance
  const showContextBubbles = useCasualStore(s => s.showContextBubbles);
  const ambientSuggestions = useCasualStore(s => s.ambientSuggestions);
  const addAmbientSuggestion = useCasualStore(s => s.addAmbientSuggestion);
  const clearAmbientSuggestions = useCasualStore(s => s.clearAmbientSuggestions);
  const sendMessage = useAppStore(s => s.sendMessage);
  
  const [activeBubble, setActiveBubble] = useState(null);
  const [bubblePositions, setBubblePositions] = useState({});

  // Generate context suggestions based on current conversation
  const contextSuggestions = useMemo(() => {
    if (!messages || messages.length < 3) return [];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.content || lastMessage.content.length < 60) return [];
    
    const topics = conversationEngine.extractTopics(messages, { maxTopics: 5 });
    
    const suggestions = [];
    
    // Topic exploration bubbles
    topics.forEach((topic, index) => {
      suggestions.push({
        id: `topic-${topic.name}`,
        type: 'topic',
        title: topic.name,
        subtitle: `Explore this topic`,
        icon: Search,
        action: () => handleTopicExploration(topic.name),
        priority: topic.relevance,
        position: generateBubblePosition(index, topics.length),
      });
    });
    
    // Follow-up question suggestions (only if last assistant message is substantial)
    if (lastMessage?.role === 'assistant' && lastMessage.content.length > 120) {
      suggestions.push({
        id: 'follow-up',
        type: 'follow-up',
        title: 'Ask follow-up',
        subtitle: 'Dig deeper into this response',
        icon: ArrowRight,
        action: () => handleFollowUp(lastMessage.content),
        priority: 0.8,
        position: { x: 70, y: 30 },
      });
    }
    
    // Creative expansion (only when we have enough context)
    if (messages.length > 4) {
      suggestions.push({
        id: 'expand',
        type: 'expand',
        title: 'Expand ideas',
        subtitle: 'Generate related concepts',
        icon: Plus,
        action: () => handleIdeaExpansion(messages),
        priority: 0.6,
        position: { x: 20, y: 70 },
      });
    }
    
    // Summarization for longer conversations
    if (messages.length > 6) {
      suggestions.push({
        id: 'summarize',
        type: 'summarize',
        title: 'Summarize',
        subtitle: 'Create a summary of this chat',
        icon: MessageCircle,
        action: () => handleSummarization(messages),
        priority: 0.7,
        position: { x: 80, y: 80 },
      });
    }
    
    // Keep only top 2 suggestions to avoid clutter
    return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 2);
  }, [messages]);

  // Generate bubble positions in a pleasing arrangement
  function generateBubblePosition(index, total) {
    const angle = (index / total) * Math.PI * 2;
    const radius = 25 + (index % 2) * 15; // Vary radius for visual interest
    
    return {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
    };
  }

  // Action handlers
  const handleTopicExploration = (topic) => {
    const prompt = `Let's explore the topic of "${topic}" in more depth. What are some interesting aspects or questions we could discuss about this?`;
    sendMessage(prompt);
    setActiveBubble(null);
  };

  const handleFollowUp = (lastResponse) => {
    const prompt = `I'd like to ask a follow-up question about your last response. Can you elaborate on the most interesting point you made?`;
    sendMessage(prompt);
    setActiveBubble(null);
  };

  const handleIdeaExpansion = (messages) => {
    const topics = conversationEngine.extractTopics(messages, { maxTopics: 3 });
    const topicNames = topics.map(t => t.name).join(', ');
    const prompt = `Based on our conversation about ${topicNames}, what are 3 related ideas or concepts we could explore next?`;
    sendMessage(prompt);
    setActiveBubble(null);
  };

  const handleSummarization = (messages) => {
    const prompt = `Please provide a concise summary of our conversation so far, highlighting the key points and any insights we've discovered.`;
    sendMessage(prompt);
    setActiveBubble(null);
  };

  const handleCustomAction = (suggestion) => {
    if (suggestion.action) {
      suggestion.action();
    }
  };

  if (!isVisible || !showContextBubbles || contextSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      <AnimatePresence>
        {contextSuggestions.map((suggestion, index) => {
          const Icon = suggestion.icon;
          const isActive = activeBubble === suggestion.id;
          
          return (
            <motion.div
              key={suggestion.id}
              initial={{ opacity: 0, scale: 0, rotate: -180 }}
              animate={{ 
                opacity: 1, 
                scale: 1, 
                rotate: 0,
                x: `${suggestion.position.x}%`,
                y: `${suggestion.position.y}%`,
              }}
              exit={{ opacity: 0, scale: 0, rotate: 180 }}
              transition={{ 
                delay: index * 0.1,
                type: 'spring',
                stiffness: 200,
                damping: 20,
              }}
              className="absolute pointer-events-auto"
              style={{
                transform: `translate(-50%, -50%)`,
              }}
            >
              <div
                className={`relative group cursor-pointer transition-all duration-300 ${
                  isActive ? 'scale-110' : 'hover:scale-105'
                }`}
                onClick={() => {
                  if (isActive) {
                    handleCustomAction(suggestion);
                  } else {
                    setActiveBubble(suggestion.id);
                  }
                }}
                onMouseLeave={() => {
                  if (!isActive) return;
                  setTimeout(() => setActiveBubble(null), 500);
                }}
              >
                {/* Main bubble */}
                <div
                  className={`
                    w-12 h-12 rounded-full border-2 border-workspace-casual/30 
                    bg-gradient-to-br from-workspace-casual/20 to-workspace-casual/5
                    backdrop-blur-sm shadow-lg flex items-center justify-center
                    transition-all duration-300 group-hover:shadow-xl
                    ${isActive ? 'border-workspace-casual/60 shadow-workspace-casual/20' : ''}
                  `}
                >
                  <Icon size={18} className="text-workspace-casual" />
                </div>

                {/* Expanded info panel */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8, y: 10 }}
                      className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 w-48 bg-forge-surface border border-forge-border rounded-lg shadow-xl p-3 z-10"
                    >
                      <div className="text-center">
                        <h4 className="text-sm font-medium text-text-primary mb-1">
                          {suggestion.title}
                        </h4>
                        <p className="text-xs text-text-muted mb-3">
                          {suggestion.subtitle}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCustomAction(suggestion);
                            }}
                            className="flex-1 px-3 py-1.5 bg-workspace-casual/20 hover:bg-workspace-casual/30 text-workspace-casual rounded text-xs transition-colors"
                          >
                            Try it
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveBubble(null);
                            }}
                            className="px-2 py-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      
                      {/* Arrow pointing to bubble */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-3 h-3 bg-forge-surface border-l border-t border-forge-border rotate-45 translate-y-1.5" />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Pulse animation for new suggestions */}
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-workspace-casual/40"
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 0, 0.5],
                  }}
                  transition={{
                    duration: 2,
                    repeat: 9999,
                    ease: 'easeInOut',
                  }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Ambient suggestion notifications */}
      <AnimatePresence>
        {ambientSuggestions.map((suggestion, index) => (
          <motion.div
            key={suggestion.id}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="absolute top-4 right-4 pointer-events-auto"
            style={{ top: `${1 + index * 4}rem` }}
          >
            <div className="bg-forge-surface/95 border border-forge-border rounded-lg p-3 shadow-lg backdrop-blur-sm max-w-xs">
              <div className="flex items-start gap-2">
                <Brain size={14} className="text-workspace-casual mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary mb-1">{suggestion.text}</p>
                  {suggestion.action && (
                    <button
                      onClick={() => {
                        if (suggestion.action === 'send') {
                          sendMessage(suggestion.text);
                        }
                        // Handle other action types
                      }}
                      className="text-xs text-workspace-casual hover:underline"
                    >
                      Try this →
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    // Remove this suggestion
                    clearAmbientSuggestions();
                  }}
                  className="text-text-muted hover:text-text-primary"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Context bubble for a specific topic or concept
 */
export function TopicBubble({ 
  topic, 
  position, 
  size = 'md', 
  onClick, 
  onExplore,
  className = '' 
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  return (
    <motion.div
      className={`absolute cursor-pointer ${className}`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
      }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      <div
        className={`
          ${sizeClasses[size]} rounded-full border-2 border-workspace-casual/40
          bg-gradient-to-br from-workspace-casual/20 to-workspace-casual/5
          backdrop-blur-sm shadow-lg flex items-center justify-center
          transition-all duration-300
          ${isHovered ? 'border-workspace-casual/80 shadow-workspace-casual/30' : ''}
        `}
      >
        <Lightbulb size={size === 'sm' ? 12 : size === 'md' ? 16 : 20} className="text-workspace-casual" />
      </div>
      
      {/* Topic label */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-forge-surface border border-forge-border rounded text-xs text-text-primary whitespace-nowrap shadow-lg z-10"
          >
            {topic.name || topic}
            {onExplore && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExplore(topic);
                }}
                className="ml-2 text-workspace-casual hover:underline"
              >
                explore →
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Ambient intelligence suggestions that appear contextually
 */
export function AmbientSuggestion({ 
  suggestion, 
  onAccept, 
  onDismiss,
  delay = 0 
}) {
  const Icon = getIconForSuggestionType(suggestion.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ delay }}
      className="bg-forge-surface/95 border border-workspace-casual/30 rounded-lg p-3 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-start gap-2">
        <div className="p-1 rounded bg-workspace-casual/20">
          <Icon size={14} className="text-workspace-casual" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary mb-1">{suggestion.title}</p>
          {suggestion.description && (
            <p className="text-xs text-text-muted mb-2">{suggestion.description}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onAccept(suggestion)}
              className="px-2 py-1 bg-workspace-casual/20 hover:bg-workspace-casual/30 text-workspace-casual rounded text-xs transition-colors"
            >
              {suggestion.actionLabel || 'Try it'}
            </button>
            <button
              onClick={() => onDismiss(suggestion)}
              className="px-2 py-1 text-text-muted hover:text-text-primary rounded text-xs transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function getIconForSuggestionType(type) {
  const icons = {
    topic: Search,
    follow_up: ArrowRight,
    expand: Plus,
    summarize: MessageCircle,
    creative: Sparkles,
    analytical: Brain,
    quick: Zap,
    default: Lightbulb,
  };
  
  return icons[type] || icons.default;
}

export default ContextBubbles;








