import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { 
  Focus, 
  Eye, 
  Bot,
  User,
  Sparkles,
  Moon,
  Keyboard,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { SmartInput } from '../SmartInput';
import { StreamingMarkdown } from '../StreamingMarkdown';

const FOCUS_MODES = [
  { id: 'zen', label: 'Zen', desc: 'Last few messages, minimal distraction', icon: Moon },
  { id: 'typewriter', label: 'Typewriter', desc: 'Only the latest exchange', icon: Keyboard },
  { id: 'reader', label: 'Reader', desc: 'All messages, optimized for reading', icon: BookOpen },
];

const FONT_SIZES = [
  { id: 'small', label: 'S', size: 'text-sm leading-relaxed', messageGap: 'space-y-6' },
  { id: 'medium', label: 'M', size: 'text-base leading-relaxed', messageGap: 'space-y-8' },
  { id: 'large', label: 'L', size: 'text-lg leading-loose', messageGap: 'space-y-10' },
];

/**
 * Focus View - Distraction-free, zen-like conversation mode
 * Minimal UI, centered content, ambient mode, large typography
 */
export function FocusView() {
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const sendMessage = useAppStore(s => s.sendMessage);
  
  const [focusMode, setFocusMode] = useState('zen');
  const [showControls, setShowControls] = useState(true);
  const [fontSize, setFontSize] = useState('medium');
  const [dimOldMessages, setDimOldMessages] = useState(true);
  
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimeoutRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Hide controls after inactivity
  useEffect(() => {
    const handleActivity = () => {
      setShowControls(true);
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = setTimeout(() => setShowControls(false), 4000);
    };
    
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    
    // Initially show controls then hide
    hideTimeoutRef.current = setTimeout(() => setShowControls(false), 4000);
    
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  // Get font size config
  const fontConfig = FONT_SIZES.find(f => f.id === fontSize) || FONT_SIZES[1];

  // Get the messages to display based on focus mode
  const focusedMessages = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    
    if (focusMode === 'typewriter') {
      // Show only the last exchange (last user + last assistant)
      const result = [];
      for (let i = messages.length - 1; i >= 0; i--) {
        result.unshift(messages[i]);
        if (messages[i].role === 'user') break;
      }
      return result;
    }
    
    if (focusMode === 'reader') {
      return messages;
    }
    
    // Zen mode - show last 4-6 messages
    return messages.slice(-6);
  }, [messages, focusMode]);

  const handleSubmit = useCallback(async (message, options = {}) => {
    try {
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }, [sendMessage]);

  const currentModeConfig = FOCUS_MODES.find(m => m.id === focusMode) || FOCUS_MODES[0];

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-full bg-surface-base relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/3 via-transparent to-cyan-500/3" />
        <motion.div 
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-cyan-500/4 rounded-full blur-3xl"
          animate={{ 
            x: [0, 30, -20, 0], 
            y: [0, -20, 30, 0],
            scale: [1, 1.05, 0.95, 1] 
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div 
          className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-accent-primary/4 rounded-full blur-3xl"
          animate={{ 
            x: [0, -30, 20, 0], 
            y: [0, 20, -30, 0],
            scale: [1, 0.95, 1.05, 1] 
          }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Floating Controls - appear on mouse move */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
          >
            <div className="flex items-center gap-1 px-3 py-2 bg-surface-1/90 backdrop-blur-xl border border-border-subtle rounded-2xl shadow-2xl">
              {/* Focus Mode Selector */}
              <div className="flex items-center gap-0.5 pr-2 border-r border-border-subtle">
                {FOCUS_MODES.map((mode) => {
                  const ModeIcon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setFocusMode(mode.id)}
                      className={`p-2 rounded-xl transition-all ${
                        focusMode === mode.id
                          ? 'bg-cyan-500/20 text-cyan-400 shadow-sm'
                          : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                      }`}
                      title={`${mode.label}: ${mode.desc}`}
                    >
                      <ModeIcon size={16} />
                    </button>
                  );
                })}
              </div>

              {/* Font Size */}
              <div className="flex items-center gap-0.5 px-2 border-r border-border-subtle">
                {FONT_SIZES.map((size) => (
                  <button
                    key={size.id}
                    onClick={() => setFontSize(size.id)}
                    className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${
                      fontSize === size.id
                        ? 'bg-surface-3 text-text-primary font-bold'
                        : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                    }`}
                    title={`${size.id.charAt(0).toUpperCase() + size.id.slice(1)} text`}
                  >
                    <span className={`${
                      size.id === 'small' ? 'text-[10px]' : 
                      size.id === 'medium' ? 'text-xs' : 
                      'text-sm'
                    } font-semibold`}>
                      {size.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Dim toggle */}
              <div className="flex items-center gap-1 pl-1">
                <button
                  onClick={() => setDimOldMessages(!dimOldMessages)}
                  className={`p-2 rounded-xl transition-all ${
                    dimOldMessages
                      ? 'bg-cyan-500/20 text-cyan-400 shadow-sm'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                  }`}
                  title={dimOldMessages ? 'Dimming old messages (click to disable)' : 'Not dimming old messages (click to enable)'}
                >
                  <Eye size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mode Label */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute top-4 left-4 z-10"
          >
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-1/80 backdrop-blur-sm rounded-xl border border-border-subtle">
              <Focus size={14} className="text-cyan-400" />
              <span className="text-xs font-medium text-text-primary">Focus</span>
              <span className="text-xs text-cyan-400 capitalize">{currentModeConfig.label}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Message count indicator */}
      <AnimatePresence>
        {showControls && messages.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-4 right-4 z-10"
          >
            <div className="px-3 py-1.5 bg-surface-1/80 backdrop-blur-sm rounded-xl border border-border-subtle text-xs text-text-muted">
              {focusedMessages.length} of {messages.length} messages
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide relative z-10">
        <div className="min-h-full flex flex-col justify-center">
          <div className="max-w-2xl mx-auto w-full px-8 py-20">
            {focusedMessages.length === 0 ? (
              <FocusEmptyState onSendMessage={handleSubmit} />
            ) : (
              <div className={fontConfig.messageGap}>
                {focusedMessages.map((message, idx) => {
                  const isUser = message.role === 'user';
                  const isLatest = idx === focusedMessages.length - 1;
                  const shouldDim = dimOldMessages && !isLatest && focusedMessages.length > 2;
                  
                  return (
                    <motion.div
                      key={message.id || idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ 
                        opacity: shouldDim ? 0.35 : 1, 
                        y: 0,
                        scale: isLatest ? 1 : 0.98
                      }}
                      transition={{ delay: idx * 0.08, duration: 0.4 }}
                      className={shouldDim ? 'pointer-events-none' : ''}
                    >
                      {/* Role indicator */}
                      <div className={`flex items-center gap-2.5 mb-3 ${isUser ? 'justify-end' : ''}`}>
                        <div className={`
                          w-8 h-8 rounded-xl flex items-center justify-center
                          ${isUser 
                            ? 'bg-workspace-casual/15 order-2' 
                            : 'bg-accent-primary/15'
                          }
                        `}>
                          {isUser 
                            ? <User size={15} className="text-workspace-casual" />
                            : <Bot size={15} className="text-accent-primary" />
                          }
                        </div>
                        <span className={`text-xs text-text-muted ${isUser ? 'order-1' : ''}`}>
                          {isUser ? 'You' : message.model || 'Assistant'}
                        </span>
                      </div>
                      
                      {/* Message content with markdown rendering */}
                      <div className={`${isUser ? 'text-right' : ''}`}>
                        {isUser ? (
                          <p className={`${fontConfig.size} text-text-primary font-medium whitespace-pre-wrap`}>
                            {message.content}
                          </p>
                        ) : (
                          <div className={`prose prose-invert max-w-none ${
                            fontConfig.id === 'small' ? 'prose-sm' : 
                            fontConfig.id === 'large' ? 'prose-lg' : 
                            'prose-base'
                          }`}>
                            <StreamingMarkdown content={message.content} isStreaming={false} />
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}

                {/* Streaming response */}
                {isGenerating && streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-8 h-8 rounded-xl bg-accent-primary/15 flex items-center justify-center">
                        <Sparkles size={15} className="text-accent-primary animate-pulse" />
                      </div>
                      <span className="text-xs text-accent-primary">Thinking...</span>
                    </div>
                    <div className={`prose prose-invert max-w-none ${
                      fontConfig.id === 'small' ? 'prose-sm' : 
                      fontConfig.id === 'large' ? 'prose-lg' : 
                      'prose-base'
                    }`}>
                      <StreamingMarkdown content={streamingContent} isStreaming={true} />
                    </div>
                  </motion.div>
                )}

                {/* Typing indicator */}
                {isGenerating && !streamingContent && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 bg-cyan-400/80 rounded-full"
                          animate={{ 
                            scale: [1, 1.4, 1],
                            opacity: [0.4, 1, 0.4]
                          }}
                          transition={{
                            duration: 1.2,
                            repeat: Infinity,
                            delay: i * 0.2,
                            ease: 'easeInOut'
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-text-muted">Processing</span>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Input Area - minimal, elegant design */}
      <div className="relative z-10 p-4 pt-0">
        <div className="max-w-2xl mx-auto">
          <div className="bg-surface-1/80 backdrop-blur-xl border border-border-subtle rounded-2xl p-2 shadow-lg">
            <SmartInput 
              onSubmit={handleSubmit} 
              disabled={isGenerating}
              placeholder="Type your thoughts..."
              minimal
            />
          </div>
          
          {/* Keyboard hint */}
          <AnimatePresence>
            {showControls && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-4 mt-2"
              >
                <p className="text-[10px] text-text-muted/60">
                  <kbd className="px-1.5 py-0.5 bg-surface-2/50 rounded text-[9px] border border-border-subtle/50">Enter</kbd>
                  <span className="ml-1">send</span>
                </p>
                <p className="text-[10px] text-text-muted/60">
                  <kbd className="px-1.5 py-0.5 bg-surface-2/50 rounded text-[9px] border border-border-subtle/50">Alt</kbd>
                  <span className="mx-0.5">+</span>
                  <kbd className="px-1.5 py-0.5 bg-surface-2/50 rounded text-[9px] border border-border-subtle/50">1-5</kbd>
                  <span className="ml-1">switch view</span>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state for focus view
 */
function FocusEmptyState({ onSendMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="text-center py-12"
    >
      <motion.div 
        className="w-24 h-24 rounded-3xl bg-cyan-500/8 flex items-center justify-center mx-auto mb-8 border border-cyan-500/15"
        animate={{ 
          boxShadow: [
            '0 0 0 0 rgba(6, 182, 212, 0)',
            '0 0 30px 10px rgba(6, 182, 212, 0.05)',
            '0 0 0 0 rgba(6, 182, 212, 0)',
          ]
        }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Focus size={40} className="text-cyan-400/70" />
      </motion.div>
      
      <h2 className="text-2xl font-light text-text-primary mb-3 tracking-wide">
        Focus Mode
      </h2>
      <p className="text-text-muted text-base max-w-md mx-auto leading-relaxed mb-10">
        A distraction-free space for deep conversation.
        Just you and your thoughts.
      </p>
      
      <div className="flex flex-col items-center gap-3">
        <p className="text-xs text-text-muted/60 uppercase tracking-widest">Try asking...</p>
        <div className="flex flex-wrap gap-2 justify-center max-w-lg">
          {[
            'Help me think through a complex problem',
            'Explain something I find confusing',
            'Let\'s brainstorm creative ideas'
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSendMessage(prompt)}
              className="px-5 py-2.5 text-sm text-text-secondary bg-surface-1/50 hover:bg-surface-1 rounded-xl transition-all border border-border-subtle/50 hover:border-cyan-500/20"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default FocusView;
