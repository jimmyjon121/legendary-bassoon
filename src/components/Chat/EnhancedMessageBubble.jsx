import React, { useMemo, useState, useRef, memo, useCallback } from 'react';
import { 
  User, Bot, Copy, Check, RefreshCw, MoreHorizontal, 
  GitBranch, Trash2, Sparkles, Clock, Cpu,
  ThumbsUp, ThumbsDown, Bookmark, Share2, Code2, Eye,
  Zap, MessageSquare, BookOpen, Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { parseModelName, getOptimalSettings } from '../../services/modelOptimizer';
import { ThinkingBlock, parseThinkTags, isInThinkingBlock, getPartialThinking } from './ThinkingBlock';
import { ArtifactButton } from './ArtifactPanel';
import { hasArtifacts } from './ArtifactDetector';
import { WebSearchResult } from './WebSearchResult';
import { StreamingMarkdown } from './StreamingMarkdown';

// Bubble entrance animation variants
const bubbleVariants = {
  hidden: (isUser) => ({
    opacity: 0,
    y: 12,
    x: isUser ? 12 : -12,
    scale: 0.97,
  }),
  visible: {
    opacity: 1,
    y: 0,
    x: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 380,
      damping: 28,
      mass: 0.8,
    },
  },
};

const actionBarVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { 
      staggerChildren: 0.03,
      delayChildren: 0.05,
    }
  },
};

const actionItemVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 },
};

/**
 * EnhancedMessageBubble - Supreme, modern chat bubble design
 */
export const EnhancedMessageBubble = memo(function EnhancedMessageBubble({ 
  message, 
  isStreaming = false, 
  showTimestamp = true,
  enableActions = true,
  onRegenerate,
  onBranch,
  onDelete,
  onEdit,
  onFeedback,
  onShowArtifact
}) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const contentRef = useRef(null);
  
  const { createBranchFromMessage, currentConversationId } = useAppStore();
  
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  
  const streamingStartRef = useRef(null);
  if (isStreaming && !streamingStartRef.current) {
    streamingStartRef.current = Date.now();
  } else if (!isStreaming) {
    streamingStartRef.current = null;
  }

  // Parse think tags
  const { thinkingContent, mainContent, isCurrentlyThinking, partialThinking } = useMemo(() => {
    if (!message.content || isUser) {
      return { thinkingContent: null, mainContent: message.content || '', isCurrentlyThinking: false, partialThinking: null };
    }
    if (isStreaming) {
      const currentlyThinking = isInThinkingBlock(message.content);
      const partial = currentlyThinking ? getPartialThinking(message.content) : null;
      const { thinkingContent: completed, mainContent: main } = parseThinkTags(message.content);
      return { thinkingContent: completed, mainContent: main, isCurrentlyThinking: currentlyThinking, partialThinking: partial };
    }
    const { thinkingContent, mainContent } = parseThinkTags(message.content);
    return { thinkingContent, mainContent, isCurrentlyThinking: false, partialThinking: null };
  }, [message.content, isUser, isStreaming]);
  
  // Parse web search results
  const webSearchResults = useMemo(() => {
    if (!mainContent || isUser) return [];
    const pattern = /\[Web Search Results for "([^"]+)"\]([\s\S]*?)\[End of Search Results\]/gi;
    const results = [];
    let match;
    while ((match = pattern.exec(mainContent)) !== null) {
      const resultItems = [];
      const resultPattern = /\[(\d+)\]\s+([^\n]+)\n\s+URL:\s+([^\n]+)\n\s+([^\n]*)/g;
      let resultMatch;
      while ((resultMatch = resultPattern.exec(match[2])) !== null) {
        resultItems.push({ title: resultMatch[2].trim(), url: resultMatch[3].trim(), snippet: resultMatch[4].trim() });
      }
      results.push({ query: match[1], results: resultItems });
    }
    return results;
  }, [mainContent, isUser]);
  
  const cleanedContent = useMemo(() => {
    if (!mainContent || webSearchResults.length === 0) return mainContent;
    return mainContent.replace(/\[Web Search Results for "[^"]+"\][\s\S]*?\[End of Search Results\]\n*/gi, '').trim();
  }, [mainContent, webSearchResults]);

  const contentToRender = useMemo(() => {
    return webSearchResults.length > 0 ? cleanedContent : mainContent;
  }, [mainContent, cleanedContent, webSearchResults]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const handleFeedbackClick = useCallback((type) => {
    const newFeedback = feedback === type ? null : type;
    setFeedback(newFeedback);
    onFeedback?.(message.id, type);
  }, [feedback, message.id, onFeedback]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Model display name
  const modelDisplayName = message.model?.split(':')[0]?.split('/').pop() || 'Assistant';

  return (
    <motion.div
      custom={isUser}
      variants={bubbleVariants}
      initial="hidden"
      animate="visible"
      className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-1`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setShowActions(false); }}
    >
      {/* Avatar */}
      <div className="flex-shrink-0 relative mt-1">
        <motion.div 
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className={`
            w-8 h-8 rounded-xl flex items-center justify-center
            ${isUser 
              ? 'bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20' 
              : 'bg-gradient-to-br from-slate-700/80 to-slate-800/80 border border-white/[0.08] shadow-lg shadow-black/20'
            }
          `}
        >
          {isUser ? (
            <User size={14} className="text-white" />
          ) : (
            <Sparkles size={14} className="text-cyan-400" />
          )}
        </motion.div>
        
        {/* Online/streaming status dot */}
        {isAssistant && (
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`
              absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full 
              border-[1.5px] border-[var(--color-surface-0,#0c0c1a)]
              ${isStreaming ? 'bg-cyan-400' : 'bg-emerald-500'}
            `}
          >
            {isStreaming && (
              <motion.div
                animate={{ scale: [1, 1.8, 1], opacity: [0.8, 0, 0.8] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full bg-cyan-400"
              />
            )}
          </motion.div>
        )}
      </div>

      {/* Message Content Area */}
      <div className={`flex flex-col min-w-0 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Header row */}
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-[12px] font-semibold text-text-primary/80">
            {isUser ? 'You' : modelDisplayName}
          </span>
          {showTimestamp && (message.timestamp || message.created_at) && (
            <span className="text-[10px] text-text-muted/50">
              {formatTimestamp(message.timestamp || message.created_at)}
            </span>
          )}
        </div>

        {/* Main Bubble */}
        <div
          className={`
            relative rounded-2xl overflow-hidden transition-shadow duration-300
            ${isUser 
              ? 'rounded-tr-md bg-gradient-to-br from-violet-500/95 to-indigo-600/90 text-white shadow-md shadow-violet-500/10 hover:shadow-lg hover:shadow-violet-500/15' 
              : `rounded-tl-md bg-white/[0.025] border border-white/[0.06] backdrop-blur-sm
                 ${isStreaming ? 'shadow-lg shadow-cyan-500/5 border-cyan-500/10' : 'shadow-sm hover:shadow-md hover:border-white/[0.09]'}`
            }
          `}
        >
          {/* Streaming shimmer bar */}
          {isStreaming && (
            <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden">
              <motion.div
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                className="h-full w-1/2 bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent"
              />
            </div>
          )}

          {/* Inner padding */}
          <div className="px-4 py-3">
            {/* Thinking Block */}
            {isAssistant && (thinkingContent || isCurrentlyThinking) && (
              <ThinkingBlock
                content={thinkingContent || partialThinking}
                isStreaming={isCurrentlyThinking}
                startTime={streamingStartRef.current}
                className="mb-3"
              />
            )}

            {/* Web Search Results */}
            {isAssistant && webSearchResults.length > 0 && (
              <div className="mb-3 space-y-2">
                {webSearchResults.map((searchResult, idx) => (
                  <WebSearchResult
                    key={`search-${idx}-${searchResult.query}`}
                    query={searchResult.query}
                    results={searchResult.results}
                  />
                ))}
              </div>
            )}

            {/* Content */}
            <div ref={contentRef}>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-black/20 text-sm text-white rounded-xl p-3 border border-white/15 focus:border-violet-400/50 focus:outline-none focus:ring-1 focus:ring-violet-400/20 resize-none min-h-[60px] transition-all"
                    rows={Math.min(10, editContent.split('\n').length + 1)}
                    autoFocus
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        if (editContent.trim() && editContent.trim() !== message.content) {
                          onEdit?.(message.id, editContent.trim());
                        }
                        setIsEditing(false);
                      }
                      if (e.key === 'Escape') { e.preventDefault(); setIsEditing(false); }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (editContent.trim() && editContent.trim() !== message.content) {
                          onEdit?.(message.id, editContent.trim());
                        }
                        setIsEditing(false);
                      }}
                      className="px-3.5 py-1.5 text-xs rounded-lg bg-violet-500 text-white hover:bg-violet-400 transition-colors font-medium shadow-sm"
                    >
                      Save & Regenerate
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="px-3 py-1.5 text-xs rounded-lg bg-white/8 text-white/70 hover:bg-white/12 transition-colors"
                    >
                      Cancel
                    </button>
                    <span className="text-[10px] text-white/25 ml-auto">Ctrl+Enter to save</span>
                  </div>
                </div>
              ) : showRaw ? (
                <pre className="text-[13px] text-white/85 whitespace-pre-wrap font-mono bg-black/25 p-3 rounded-xl overflow-x-auto leading-relaxed">
                  {message.content}
                </pre>
              ) : isUser ? (
                <p className="text-[14px] text-white whitespace-pre-wrap leading-relaxed">
                  {message.content}
                </p>
              ) : (
                <StreamingMarkdown
                  content={contentToRender}
                  isStreaming={isStreaming}
                />
              )}
            </div>

            {/* Streaming cursor */}
            {isStreaming && !isCurrentlyThinking && (
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
                className="inline-block w-[3px] h-[18px] ml-0.5 bg-cyan-400 rounded-full align-text-bottom"
              />
            )}
          </div>
          
          {/* Artifact Preview */}
          {isAssistant && !isStreaming && hasArtifacts(mainContent) && (
            <div className="mx-4 mb-3 pt-2 border-t border-white/[0.05]">
              <ArtifactButton 
                content={mainContent} 
                onClick={() => onShowArtifact?.(message.id, mainContent)}
              />
            </div>
          )}
        </div>

        {/* Action Bar - User Messages */}
        <AnimatePresence>
          {enableActions && isUser && !isStreaming && !isEditing && isHovered && (
            <motion.div 
              variants={actionBarVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="flex items-center gap-0.5 mt-1.5"
            >
              <ActionButton icon={copied ? Check : Copy} label={copied ? 'Copied!' : 'Copy'} onClick={handleCopy} active={copied} activeColor="emerald" />
              {onEdit && (
                <ActionButton icon={Pencil} label="Edit" onClick={() => { setEditContent(message.content); setIsEditing(true); }} />
              )}
              {onDelete && (
                <ActionButton icon={Trash2} label="Delete" onClick={() => onDelete()} />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Bar - Assistant Messages */}
        <AnimatePresence>
          {enableActions && isAssistant && !isStreaming && isHovered && (
            <motion.div 
              variants={actionBarVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="flex items-center gap-0.5 mt-1.5"
            >
              <ActionButton icon={copied ? Check : Copy} label={copied ? 'Copied!' : 'Copy'} onClick={handleCopy} active={copied} activeColor="emerald" />
              <ActionButton icon={showRaw ? Eye : Code2} label={showRaw ? 'Formatted' : 'Raw'} onClick={() => setShowRaw(!showRaw)} active={showRaw} activeColor="amber" />
              
              <div className="w-px h-3.5 bg-white/[0.06] mx-0.5" />
              
              <ActionButton icon={ThumbsUp} label="Good" onClick={() => handleFeedbackClick('positive')} active={feedback === 'positive'} activeColor="emerald" />
              <ActionButton icon={ThumbsDown} label="Bad" onClick={() => handleFeedbackClick('negative')} active={feedback === 'negative'} activeColor="rose" />

              <div className="w-px h-3.5 bg-white/[0.06] mx-0.5" />

              {onRegenerate && (
                <ActionButton icon={RefreshCw} label="Regenerate" onClick={onRegenerate} />
              )}

              {/* More Actions Dropdown */}
              <div className="relative">
                <ActionButton icon={MoreHorizontal} label="More" onClick={() => setShowActions(!showActions)} active={showActions} />
                
                <AnimatePresence>
                  {showActions && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.95 }}
                      transition={{ duration: 0.12 }}
                      className="absolute bottom-full left-0 mb-2 py-1 min-w-[180px] rounded-xl bg-surface-1 border border-border-subtle shadow-2xl shadow-black/40 z-20 overflow-hidden"
                    >
                      <DropdownItem icon={GitBranch} label="Branch from here" onClick={() => {
                        if (currentConversationId && message.id) {
                          createBranchFromMessage(currentConversationId, message.id);
                        }
                        setShowActions(false);
                      }} />
                      <DropdownItem icon={Bookmark} label="Pin message" onClick={async () => {
                        try {
                          await window.electronAPI?.memoryPinMessage?.({ messageId: message.id, content: message.content, role: message.role });
                        } catch (e) { console.error('Failed to pin:', e); }
                        setShowActions(false);
                      }} />
                      <DropdownItem icon={Share2} label="Share" onClick={() => setShowActions(false)} />
                      <div className="h-px bg-white/[0.04] my-1 mx-3" />
                      <DropdownItem icon={Trash2} label="Delete" onClick={() => { onDelete?.(); setShowActions(false); }} danger />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Response stats */}
        {isAssistant && !isStreaming && (message.tokens || message.meta?.tokensEstimated || message.meta?.durationSeconds) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center gap-2 mt-1.5 text-[10px] text-text-muted/40"
          >
            {(message.tokens || message.meta?.tokensEstimated) ? (
              <span className="flex items-center gap-1">
                <Sparkles size={9} className="text-cyan-400/40" />
                {message.tokens || message.meta?.tokensEstimated} tokens
              </span>
            ) : null}
            {message.meta?.durationSeconds != null && (
              <span className="flex items-center gap-1">
                <Clock size={9} />
                {message.meta.durationSeconds.toFixed(1)}s
              </span>
            )}
            {message.meta?.tokensPerSecond ? (
              <span className="flex items-center gap-1">
                <Zap size={9} className="text-amber-400/40" />
                {message.meta.tokensPerSecond} tok/s
              </span>
            ) : null}
            {message.meta?.partial && (
              <span className="text-amber-400/50">partial</span>
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});

/**
 * ActionButton - Micro-interaction button with spring animation
 */
const ActionButton = memo(function ActionButton({ icon: Icon, label, onClick, active, activeColor = 'cyan' }) {
  const colorMap = {
    cyan: { bg: 'bg-cyan-500/12', text: 'text-cyan-400', ring: 'ring-cyan-400/20' },
    emerald: { bg: 'bg-emerald-500/12', text: 'text-emerald-400', ring: 'ring-emerald-400/20' },
    amber: { bg: 'bg-amber-500/12', text: 'text-amber-400', ring: 'ring-amber-400/20' },
    rose: { bg: 'bg-rose-500/12', text: 'text-rose-400', ring: 'ring-rose-400/20' },
  };
  const colors = colorMap[activeColor] || colorMap.cyan;
  
  return (
    <motion.button
      variants={actionItemVariants}
      onClick={onClick}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.9 }}
      className={`
        p-1.5 rounded-lg transition-colors duration-100
        ${active 
          ? `${colors.bg} ${colors.text} ring-1 ${colors.ring}` 
          : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]'
        }
      `}
      title={label}
    >
      <Icon size={13} />
    </motion.button>
  );
});

/**
 * DropdownItem
 */
const DropdownItem = memo(function DropdownItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] transition-colors
        ${danger 
          ? 'text-rose-400 hover:bg-rose-500/8' 
          : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }
      `}
    >
      <Icon size={13} />
      <span>{label}</span>
    </button>
  );
});

/**
 * TypingBubble - Premium thinking indicator with animated shimmer
 */
export const TypingBubble = memo(function TypingBubble({ model }) {
  const modelName = model?.split(':')[0]?.split('/').pop() || 'AI';
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, x: -12 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className="flex gap-3 mb-1"
    >
      {/* Avatar */}
      <div className="flex-shrink-0 relative mt-1">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700/80 to-slate-800/80 border border-white/[0.08] flex items-center justify-center shadow-lg shadow-black/20">
          <Sparkles size={14} className="text-cyan-400" />
        </div>
        <motion.div
          animate={{ scale: [1, 1.6, 1], opacity: [0.8, 0, 0.8] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan-400 border-[1.5px] border-[var(--color-surface-0,#0c0c1a)]"
        />
      </div>
      
      {/* Thinking bubble */}
      <div className="flex flex-col items-start">
        <span className="text-[12px] font-semibold text-text-primary/80 mb-1">{modelName}</span>
        <div className="relative rounded-2xl rounded-tl-md px-5 py-3.5 bg-white/[0.025] border border-white/[0.06] overflow-hidden shadow-sm">
          {/* Shimmer bar */}
          <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden">
            <motion.div
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              className="h-full w-1/2 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent"
            />
          </div>
          
          <div className="flex items-center gap-3">
            {/* Animated dots */}
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  animate={{ 
                    y: [0, -6, 0],
                    opacity: [0.4, 1, 0.4],
                  }}
                  transition={{ 
                    duration: 0.8,
                    delay: i * 0.15,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="w-2 h-2 rounded-full bg-cyan-400"
                />
              ))}
            </div>
            <span className="text-[12px] text-text-muted/60">Thinking...</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

/**
 * WelcomeMessage - Clean empty state with model optimization info
 */
export const WelcomeMessage = memo(function WelcomeMessage({ modelName }) {
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  
  const modelInfo = useMemo(() => {
    if (!modelName) return null;
    const parsed = parseModelName(modelName);
    const settings = getOptimalSettings(modelName, currentWorkspace);
    const typeConfig = {
      code: { icon: Code2, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Code Model', desc: 'Optimized for programming' },
      chat: { icon: MessageSquare, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Chat Model', desc: 'Balanced for conversation' },
      creative: { icon: Sparkles, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Creative Model', desc: 'Enhanced for creative writing' },
      instruct: { icon: BookOpen, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Instruct Model', desc: 'Focused instruction following' },
    };
    const type = settings._modelType || 'chat';
    return { parsed, settings, typeConfig: typeConfig[type] };
  }, [modelName, currentWorkspace]);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-violet-500/20 to-cyan-500/10 border border-violet-500/20"
      >
        <Sparkles size={28} className="text-violet-400" />
      </motion.div>
      
      <h3 className="text-xl font-semibold text-text-primary mb-2">Ready to Chat</h3>
      <p className="text-sm text-text-muted max-w-md">
        {modelName 
          ? `${modelName.split(':')[0]} is loaded and ready. Start a conversation!`
          : 'Select a model to begin your conversation.'
        }
      </p>
      
      {modelInfo && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] max-w-sm"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap size={14} className="text-yellow-400" />
            <span className="text-xs font-medium text-text-secondary">Auto-Optimized Settings</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-left">
            {modelInfo.typeConfig && (
              <div className="col-span-2 flex items-center gap-2 p-2 rounded-lg bg-white/[0.03]">
                <div className={`p-1.5 rounded ${modelInfo.typeConfig.bg}`}>
                  <modelInfo.typeConfig.icon size={14} className={modelInfo.typeConfig.color} />
                </div>
                <div>
                  <p className={`text-xs font-medium ${modelInfo.typeConfig.color}`}>{modelInfo.typeConfig.label}</p>
                  <p className="text-[10px] text-text-muted">{modelInfo.typeConfig.desc}</p>
                </div>
              </div>
            )}
            <div className="p-2 rounded-lg bg-white/[0.03]">
              <p className="text-[10px] text-text-muted uppercase">Temp</p>
              <p className="text-xs font-medium text-text-secondary">{modelInfo.settings.temperature}</p>
            </div>
            <div className="p-2 rounded-lg bg-white/[0.03]">
              <p className="text-[10px] text-text-muted uppercase">Context</p>
              <p className="text-xs font-medium text-text-secondary">{(modelInfo.settings.num_ctx || 4096).toLocaleString()}</p>
            </div>
          </div>
        </motion.div>
      )}
      
      <div className="flex gap-2 mt-6">
        {['Explain something', 'Write code', 'Brainstorm ideas'].map((suggestion, i) => (
          <motion.button
            key={suggestion}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.08 }}
            onClick={() => useAppStore.getState().sendMessage(suggestion)}
            className="px-4 py-2 rounded-xl text-xs font-medium text-text-muted 
              bg-white/[0.03] border border-white/[0.08]
              hover:text-text-primary hover:bg-white/[0.06] hover:border-white/[0.12]
              transition-all duration-150 cursor-pointer"
          >
            {suggestion}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
});

export default EnhancedMessageBubble;
