import React, { useRef, useEffect, useCallback, useState } from 'react';
import { ArrowDown, Sparkles, MessageSquare, Code2, Lightbulb, BookOpen, Zap, Globe, Timer, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { EnhancedMessageBubble, TypingBubble, WelcomeMessage } from '../EnhancedMessageBubble';
import { ContextBubbles } from '../ContextBubbles';
import { SmartInput } from '../SmartInput';
import { VirtualizedMessageList } from '../VirtualizedMessageList';

const VIRTUALIZATION_THRESHOLD = 20;

const STARTER_PROMPTS = [
  { icon: MessageSquare, label: 'Explain something', prompt: 'Can you explain how neural networks work in simple terms?', color: '#818cf8' },
  { icon: Code2, label: 'Write code', prompt: 'Write a Python function that sorts a list using quicksort', color: '#10b981' },
  { icon: Lightbulb, label: 'Brainstorm ideas', prompt: 'Help me brainstorm creative project ideas for a weekend hackathon', color: '#f59e0b' },
  { icon: BookOpen, label: 'Summarize a topic', prompt: 'Give me a comprehensive summary of quantum computing', color: '#ec4899' },
  { icon: Zap, label: 'Solve a problem', prompt: 'Help me debug a common issue with async JavaScript', color: '#06b6d4' },
];

/**
 * Stream View - Enhanced traditional chat timeline
 */
export function StreamView() {
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const sendMessage = useAppStore(s => s.sendMessage);
  const suggestedFollowUps = useAppStore(s => s.suggestedFollowUps);
  const generationMetadata = useAppStore(s => s.generationMetadata);
  
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messagesEndRef.current && !isUserScrollingRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  const forceScrollToBottom = useCallback(() => {
    isUserScrollingRef.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    if (isNearBottom()) {
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages, streamingContent, isGenerating, isNearBottom, scrollToBottom]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      requestAnimationFrame(() => scrollToBottom('instant'));
    }
  }, [messages.length, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    isUserScrollingRef.current = true;
    setShowScrollButton(!isNearBottom() && messages.length > 3);
    scrollTimeoutRef.current = setTimeout(() => { isUserScrollingRef.current = false; }, 1000);
  }, [isNearBottom, messages.length]);

  useEffect(() => {
    return () => { if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current); };
  }, []);

  const handleSubmit = async (message, options = {}) => {
    try {
      isUserScrollingRef.current = false;
      setShowScrollButton(false);
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const useVirtualization = messages.length >= VIRTUALIZATION_THRESHOLD;

  // Last completed response stats
  const lastAssistantMsg = !isGenerating ? [...messages].reverse().find(m => m.role === 'assistant') : null;
  const lastMeta = lastAssistantMsg?.meta;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages area */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {useVirtualization ? (
          <VirtualizedMessageList
            messages={messages}
            streamingContent={isGenerating ? streamingContent : ''}
            streamingModel={currentModel}
            showBranchIndicators={false}
            enableActions={true}
            variant="enhanced"
            className="h-full py-4"
          />
        ) : (
          <div 
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto px-4 py-4 scroll-smooth"
          >
            <div className="max-w-3xl mx-auto space-y-1 enhanced-chat-container">
              {messages.length === 0 && !isGenerating && (
                <StreamWelcome onPromptClick={handleSubmit} modelName={currentModel} />
              )}
              
              {messages.map((message) => (
                <EnhancedMessageBubble 
                  key={message.id}
                  message={message}
                  showTimestamp={true}
                  enableActions={message.role === 'assistant'}
                />
              ))}
              
              {/* Streaming response */}
              {isGenerating && streamingContent && (
                <EnhancedMessageBubble 
                  message={{ id: 'streaming', role: 'assistant', content: streamingContent, model: currentModel }}
                  isStreaming
                />
              )}
              
              {/* Typing indicator */}
              {isGenerating && !streamingContent && (
                <TypingBubble model={currentModel} />
              )}
              
              {/* Follow-up suggestions */}
              {!isGenerating && suggestedFollowUps && suggestedFollowUps.length > 0 && messages.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="flex flex-wrap gap-2 py-2"
                >
                  {suggestedFollowUps.map((followUp, idx) => (
                    <motion.button
                      key={followUp}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35 + idx * 0.08 }}
                      onClick={() => handleSubmit(followUp)}
                      className="group flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border-subtle bg-surface-1 hover:bg-surface-2 hover:border-accent-primary/30 text-text-secondary hover:text-text-primary text-sm transition-all"
                    >
                      <ArrowRight size={13} className="text-text-muted group-hover:text-accent-primary transition-colors" />
                      {followUp}
                    </motion.button>
                  ))}
                </motion.div>
              )}
              
              <div ref={messagesEndRef} className="h-1" />
            </div>
          </div>
        )}

        {/* Context bubbles overlay */}
        <ContextBubbles messages={messages} isVisible={messages.length > 0} />

        {/* Scroll to bottom FAB */}
        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              onClick={forceScrollToBottom}
              className="absolute bottom-4 right-6 z-20 w-10 h-10 rounded-full bg-accent-primary/90 text-white shadow-lg shadow-accent-primary/30 flex items-center justify-center hover:bg-accent-primary transition-colors backdrop-blur-sm"
              title="Scroll to bottom"
            >
              <ArrowDown size={18} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Smart input */}
      <div className="border-t border-border-subtle/40 bg-surface-1/50 backdrop-blur-sm relative z-30 pointer-events-auto">
        <div className="p-4">
          <div className="max-w-4xl mx-auto">
            <SmartInput onSubmit={handleSubmit} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Enhanced welcome screen with starter prompts
 */
function StreamWelcome({ onPromptClick, modelName }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative mb-8"
      >
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 flex items-center justify-center border border-accent-primary/20">
          <Sparkles size={32} className="text-accent-primary" />
        </div>
        <div className="absolute -inset-2 rounded-3xl bg-accent-primary/5 blur-xl -z-10" />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="text-xl font-semibold text-text-primary mb-2"
      >
        Ready to Chat
      </motion.h2>
      
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="text-sm text-text-muted mb-8 text-center max-w-md"
      >
        {modelName 
          ? `${modelName} is loaded and ready. Start a conversation or pick a prompt below.`
          : 'Select a model and start chatting. Pick a prompt below to get started.'
        }
      </motion.p>

      {/* Starter Prompts Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg"
      >
        {STARTER_PROMPTS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <motion.button
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + idx * 0.05 }}
              onClick={() => onPromptClick(item.prompt)}
              className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-1 border border-border-subtle hover:border-border-emphasis transition-all text-left hover:shadow-md"
            >
              <div 
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                style={{ background: `${item.color}20`, color: item.color }}
              >
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{item.label}</p>
                <p className="text-xs text-text-muted truncate">{item.prompt}</p>
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Feature hints */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-10 flex items-center gap-4 text-[11px] text-text-muted/60"
      >
        <span className="flex items-center gap-1"><Globe size={11} />Web search</span>
        <span className="flex items-center gap-1"><Sparkles size={11} />Voice input</span>
        <span className="flex items-center gap-1"><Zap size={11} />File attachments</span>
      </motion.div>
    </div>
  );
}

export default StreamView;
