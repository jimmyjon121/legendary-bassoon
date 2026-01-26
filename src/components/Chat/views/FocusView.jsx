import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  Focus, 
  Eye, 
  Minimize,
  Maximize2,
  Bot,
  User,
  Sparkles,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  Settings,
  Keyboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { SmartInput } from '../SmartInput';

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
  
  const [focusMode, setFocusMode] = useState('zen'); // 'zen' | 'typewriter' | 'reader'
  const [showControls, setShowControls] = useState(false);
  const [fontSize, setFontSize] = useState('medium'); // 'small' | 'medium' | 'large'
  const [ambientSound, setAmbientSound] = useState(false);
  const [dimOldMessages, setDimOldMessages] = useState(true);
  
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Hide controls after inactivity
  useEffect(() => {
    let timeout;
    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(timeout);
    };
  }, []);

  // Font size classes
  const fontSizeClass = {
    small: 'text-sm leading-relaxed',
    medium: 'text-base leading-relaxed',
    large: 'text-lg leading-loose'
  }[fontSize];

  // Get the last few messages for focused display
  const focusedMessages = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    
    if (focusMode === 'typewriter') {
      // Show only the last exchange
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      return [lastUser, lastAssistant].filter(Boolean);
    }
    
    if (focusMode === 'reader') {
      // Show all messages but optimize for reading
      return messages;
    }
    
    // Zen mode - show last 4 messages
    return messages.slice(-4);
  }, [messages, focusMode]);

  const handleSubmit = async (message, options = {}) => {
    try {
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-full bg-surface-base relative overflow-hidden"
    >
      {/* Ambient background gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-cyan-500/5" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Floating Controls - appear on mouse move */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
          >
            <div className="flex items-center gap-2 px-4 py-2 bg-surface-1/90 backdrop-blur-xl border border-border-subtle rounded-2xl shadow-2xl">
              {/* Focus Mode Selector */}
              <div className="flex items-center gap-1 pr-3 border-r border-border-subtle">
                {[
                  { id: 'zen', label: 'Zen', icon: Moon },
                  { id: 'typewriter', label: 'Typewriter', icon: Keyboard },
                  { id: 'reader', label: 'Reader', icon: Eye }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setFocusMode(mode.id)}
                    className={`p-2 rounded-lg transition-colors ${
                      focusMode === mode.id
                        ? 'bg-cyan-500/20 text-cyan-400'
                        : 'text-text-muted hover:text-text-primary hover:bg-glass-3'
                    }`}
                    title={mode.label}
                  >
                    <mode.icon size={16} />
                  </button>
                ))}
              </div>

              {/* Font Size */}
              <div className="flex items-center gap-1 px-3 border-r border-border-subtle">
                {['small', 'medium', 'large'].map((size) => (
                  <button
                    key={size}
                    onClick={() => setFontSize(size)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      fontSize === size
                        ? 'bg-glass-4 text-text-primary'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {size === 'small' ? 'A' : size === 'medium' ? 'A' : 'A'}
                    <span className="sr-only">{size}</span>
                  </button>
                ))}
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-1 pl-1">
                <button
                  onClick={() => setDimOldMessages(!dimOldMessages)}
                  className={`p-2 rounded-lg transition-colors ${
                    dimOldMessages
                      ? 'bg-glass-4 text-text-primary'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                  title="Dim older messages"
                >
                  <Eye size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Focus Mode Label */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-4 left-4 z-10"
          >
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-1/80 backdrop-blur-sm rounded-lg border border-border-subtle">
              <Focus size={14} className="text-cyan-400" />
              <span className="text-xs font-medium text-text-primary">Focus Mode</span>
              <span className="text-xs text-text-muted capitalize">• {focusMode}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide relative z-10">
        <div className="min-h-full flex flex-col justify-center">
          <div className="max-w-2xl mx-auto w-full px-8 py-20">
            {focusedMessages.length === 0 ? (
              // Empty state - zen welcome
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-20"
              >
                <div className="w-24 h-24 rounded-3xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-8 border border-cyan-500/20">
                  <Focus size={40} className="text-cyan-400" />
                </div>
                <h2 className="text-2xl font-light text-text-primary mb-3 tracking-wide">
                  Focus Mode
                </h2>
                <p className="text-text-muted text-base max-w-md mx-auto leading-relaxed mb-8">
                  A distraction-free space for deep conversation.
                  Just you and your thoughts.
                </p>
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs text-text-muted">Try asking...</p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                    {[
                      'Help me think through a problem',
                      'Explain something complex simply',
                      'Let\'s brainstorm ideas'
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSubmit(prompt)}
                        className="px-4 py-2 text-sm text-text-secondary bg-glass-2 hover:bg-glass-3 rounded-xl transition-colors border border-border-subtle"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : (
              // Messages display
              <div className="space-y-8">
                {focusedMessages.map((message, idx) => {
                  const isUser = message.role === 'user';
                  const isLatest = idx === focusedMessages.length - 1;
                  const shouldDim = dimOldMessages && !isLatest && focusedMessages.length > 2;
                  
                  return (
                    <motion.div
                      key={message.id || idx}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ 
                        opacity: shouldDim ? 0.4 : 1, 
                        y: 0,
                        scale: isLatest ? 1 : 0.98
                      }}
                      transition={{ delay: idx * 0.1 }}
                      className={`${shouldDim ? 'pointer-events-none' : ''}`}
                    >
                      {/* Role indicator */}
                      <div className={`flex items-center gap-2 mb-3 ${isUser ? 'justify-end' : ''}`}>
                        <div className={`
                          w-8 h-8 rounded-xl flex items-center justify-center
                          ${isUser 
                            ? 'bg-workspace-casual/20 order-2' 
                            : 'bg-accent-primary/20'
                          }
                        `}>
                          {isUser 
                            ? <User size={16} className="text-workspace-casual" />
                            : <Bot size={16} className="text-accent-primary" />
                          }
                        </div>
                        <span className={`text-xs text-text-muted ${isUser ? 'order-1' : ''}`}>
                          {isUser ? 'You' : message.model || 'Assistant'}
                        </span>
                      </div>
                      
                      {/* Message content */}
                      <div className={`${isUser ? 'text-right' : ''}`}>
                        <p className={`
                          ${fontSizeClass}
                          ${isUser 
                            ? 'text-text-primary font-medium' 
                            : 'text-text-secondary'
                          }
                          whitespace-pre-wrap
                        `}>
                          {message.content}
                        </p>
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
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-xl bg-accent-primary/20 flex items-center justify-center">
                        <Sparkles size={16} className="text-accent-primary animate-pulse" />
                      </div>
                      <span className="text-xs text-accent-primary">Thinking...</span>
                    </div>
                    <p className={`${fontSizeClass} text-text-secondary whitespace-pre-wrap`}>
                      {streamingContent}
                    </p>
                  </motion.div>
                )}

                {/* Typing indicator */}
                {isGenerating && !streamingContent && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-2"
                  >
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 bg-cyan-400 rounded-full"
                          animate={{ 
                            scale: [1, 1.3, 1],
                            opacity: [0.5, 1, 0.5]
                          }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: i * 0.2
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

      {/* Input Area - minimal design */}
      <div className="relative z-10 p-4 pt-0">
        <div className="max-w-2xl mx-auto">
          <div className="bg-surface-1/80 backdrop-blur-xl border border-border-subtle rounded-2xl p-2">
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
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center text-[10px] text-text-muted mt-2"
              >
                Press <kbd className="px-1.5 py-0.5 bg-glass-3 rounded text-[9px] border border-border-subtle">Enter</kbd> to send
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default FocusView;
