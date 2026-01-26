import React, { useMemo, useState, useRef, memo, useCallback } from 'react';
import { 
  User, Bot, Copy, Check, RefreshCw, MoreHorizontal, 
  GitBranch, Trash2, Sparkles, Clock, Cpu,
  ThumbsUp, ThumbsDown, Bookmark, Share2, Code2, Eye,
  Zap, MessageSquare, BookOpen
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { useAppStore } from '../../stores/appStore';
import { parseModelName, getOptimalSettings } from '../../services/modelOptimizer';

// Configure marked
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch { /* ignore */ }
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

/**
 * EnhancedMessageBubble - Premium, luxurious message display
 */
export const EnhancedMessageBubble = memo(function EnhancedMessageBubble({ 
  message, 
  isStreaming = false, 
  showTimestamp = true,
  enableActions = true,
  onRegenerate,
  onBranch,
  onDelete,
  onFeedback
}) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const contentRef = useRef(null);
  
  const { createBranchFromMessage, currentConversationId } = useAppStore();
  
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  // Parse markdown - memoized
  const htmlContent = useMemo(() => {
    if (!message.content) return '';
    
    if (isStreaming) {
      const escaped = message.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      
      const formatted = escaped
        .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => 
          `<pre class="code-block" data-lang="${lang || 'text'}"><code>${code}</code></pre>`)
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
        .replace(/\n/g, '<br/>');
      
      return DOMPurify.sanitize(formatted);
    }
    
    return DOMPurify.sanitize(marked.parse(message.content));
  }, [message.content, isStreaming]);

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
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  return (
    <div className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar - simplified, no heavy animations */}
      <div className="flex-shrink-0 relative">
        <div 
          className={`
            w-9 h-9 rounded-xl flex items-center justify-center
            transition-transform duration-150 ease-out hover:scale-105
            ${isUser 
              ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
              : 'bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10'
            }
          `}
        >
          {isUser ? (
            <User size={16} className="text-white" />
          ) : (
            <Bot size={16} className="text-cyan-400" />
          )}
        </div>
        
        {/* Status indicator - simplified */}
        {isAssistant && (
          <div 
            className={`
              absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full 
              border-2 border-[#0a0a14]
              ${isStreaming ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-500'}
            `}
          />
        )}
      </div>

      {/* Message Content */}
      <div className={`flex flex-col max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Header */}
        <div className={`flex items-center gap-2 mb-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-xs font-semibold text-white/90">
            {isUser ? 'You' : (message.model?.split(':')[0] || 'Assistant')}
          </span>
          {showTimestamp && message.timestamp && (
            <span className="text-[10px] text-white/40 flex items-center gap-1">
              <Clock size={10} />
              {formatTimestamp(message.timestamp)}
            </span>
          )}
          {isAssistant && message.model && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400/80 flex items-center gap-1">
              <Cpu size={9} />
              {message.model.split(':')[0]}
            </span>
          )}
        </div>

        {/* Bubble - optimized with simpler styling */}
        <div
          className={`
            relative rounded-2xl px-4 py-3 
            ${isUser 
              ? 'rounded-tr-sm bg-gradient-to-br from-violet-500/90 to-purple-600/90 border border-white/10' 
              : 'rounded-tl-sm bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm'
            }
          `}
        >
          {/* Streaming indicator - simple top border glow */}
          {isStreaming && (
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent animate-pulse" />
          )}

          {/* Content */}
          <div ref={contentRef}>
            {showRaw ? (
              <pre className="text-sm text-white/90 whitespace-pre-wrap font-mono bg-black/30 p-3 rounded-xl overflow-x-auto">
                {message.content}
              </pre>
            ) : isUser ? (
              <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
                {message.content}
              </p>
            ) : (
              <div 
                className="prose prose-sm prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            )}
          </div>

          {/* Streaming cursor - simplified */}
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 ml-0.5 bg-cyan-400 rounded-full animate-pulse" />
          )}
        </div>

        {/* Actions Bar */}
        {enableActions && isAssistant && !isStreaming && (
          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <ActionButton 
              icon={copied ? Check : Copy}
              label={copied ? 'Copied!' : 'Copy'}
              onClick={handleCopy}
              active={copied}
              activeColor="emerald"
            />

            <ActionButton 
              icon={showRaw ? Eye : Code2}
              label={showRaw ? 'Formatted' : 'Raw'}
              onClick={() => setShowRaw(!showRaw)}
              active={showRaw}
              activeColor="amber"
            />

            <ActionButton 
              icon={ThumbsUp}
              label="Good"
              onClick={() => handleFeedbackClick('positive')}
              active={feedback === 'positive'}
              activeColor="emerald"
            />
            <ActionButton 
              icon={ThumbsDown}
              label="Bad"
              onClick={() => handleFeedbackClick('negative')}
              active={feedback === 'negative'}
              activeColor="rose"
            />

            {onRegenerate && (
              <ActionButton 
                icon={RefreshCw}
                label="Regenerate"
                onClick={onRegenerate}
              />
            )}

            {/* More Actions */}
            <div className="relative">
              <ActionButton 
                icon={MoreHorizontal}
                label="More"
                onClick={() => setShowActions(!showActions)}
              />
              
              {showActions && (
                <div className="absolute bottom-full left-0 mb-2 py-1.5 min-w-[160px] rounded-xl bg-surface-2 border border-border-emphasis shadow-2xl z-20 anim-scale-in">
                  <DropdownItem icon={GitBranch} label="Branch from here" onClick={() => {
                    if (currentConversationId && message.id) {
                      createBranchFromMessage(currentConversationId, message.id);
                    }
                    setShowActions(false);
                  }} />
                  <DropdownItem icon={Bookmark} label="Bookmark" onClick={() => setShowActions(false)} />
                  <DropdownItem icon={Share2} label="Share" onClick={() => setShowActions(false)} />
                  <div className="h-px bg-border-muted my-1 mx-2" />
                  <DropdownItem icon={Trash2} label="Delete" onClick={() => {
                    onDelete?.();
                    setShowActions(false);
                  }} danger />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        {isAssistant && message.tokens && (
          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-white/30">
            <span>{message.tokens} tokens</span>
            {message.duration && <span>• {message.duration}ms</span>}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * ActionButton - Premium micro-interaction button
 */
const ActionButton = memo(function ActionButton({ icon: Icon, label, onClick, active, activeColor = 'cyan' }) {
  const colorMap = {
    cyan: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', shadow: 'shadow-cyan-500/20' },
    emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', shadow: 'shadow-emerald-500/20' },
    amber: { bg: 'bg-amber-500/15', text: 'text-amber-400', shadow: 'shadow-amber-500/20' },
    rose: { bg: 'bg-rose-500/15', text: 'text-rose-400', shadow: 'shadow-rose-500/20' },
  };
  const colors = colorMap[activeColor] || colorMap.cyan;
  
  return (
    <button
      onClick={onClick}
      className={`
        p-1.5 rounded-lg transition-all duration-150
        hover:scale-110 active:scale-95
        ${active 
          ? `${colors.bg} ${colors.text} shadow-sm ${colors.shadow}` 
          : 'text-white/40 hover:text-white/70 hover:bg-white/5'
        }
      `}
      title={label}
    >
      <Icon size={14} />
    </button>
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
        w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors
        ${danger 
          ? 'text-rose-400 hover:bg-rose-500/10' 
          : 'text-white/70 hover:text-white hover:bg-white/5'
        }
      `}
    >
      <Icon size={13} />
      <span>{label}</span>
    </button>
  );
});

/**
 * TypingBubble - Performant typing indicator
 */
export const TypingBubble = memo(function TypingBubble({ model }) {
  return (
    <div className="flex gap-3">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 flex items-center justify-center">
        <Bot size={16} className="text-cyan-400" />
      </div>
      
      <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce"
                style={{ animationDelay: `${i * 150}ms`, animationDuration: '1s' }}
              />
            ))}
          </div>
          <span className="text-xs text-white/40">{model?.split(':')[0] || 'AI'} is thinking...</span>
        </div>
      </div>
    </div>
  );
});

/**
 * WelcomeMessage - Clean empty state with model optimization info
 */
export const WelcomeMessage = memo(function WelcomeMessage({ modelName }) {
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  
  // Get model optimization info
  const modelInfo = useMemo(() => {
    if (!modelName) return null;
    const parsed = parseModelName(modelName);
    const settings = getOptimalSettings(modelName, currentWorkspace);
    
    // Determine model type display
    const typeConfig = {
      code: { icon: Code2, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Code Model', desc: 'Optimized for programming tasks' },
      chat: { icon: MessageSquare, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Chat Model', desc: 'Balanced for general conversation' },
      creative: { icon: Sparkles, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Creative Model', desc: 'Enhanced for creative writing' },
      instruct: { icon: BookOpen, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Instruct Model', desc: 'Focused instruction following' },
    };
    
    const type = settings._modelType || 'chat';
    return { parsed, settings, typeConfig: typeConfig[type] };
  }, [modelName, currentWorkspace]);
  
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 bg-gradient-to-br from-violet-500/20 to-cyan-500/10 border border-violet-500/20">
        <Sparkles size={28} className="text-violet-400" />
      </div>
      
      <h3 className="text-xl font-semibold text-white mb-2">Ready to Chat</h3>
      <p className="text-sm text-white/50 max-w-md">
        {modelName 
          ? `${modelName.split(':')[0]} is loaded and ready. Start a conversation!`
          : 'Select a model to begin your conversation.'
        }
      </p>
      
      {/* Model Optimization Info */}
      {modelInfo && (
        <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] max-w-sm">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Zap size={14} className="text-yellow-400" />
            <span className="text-xs font-medium text-white/70">Auto-Optimized Settings</span>
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-left">
            {/* Model Type */}
            <div className="col-span-2 flex items-center gap-2 p-2 rounded-lg bg-white/[0.03]">
              {modelInfo.typeConfig && (
                <>
                  <div className={`p-1.5 rounded ${modelInfo.typeConfig.bg}`}>
                    <modelInfo.typeConfig.icon size={14} className={modelInfo.typeConfig.color} />
                  </div>
                  <div>
                    <p className={`text-xs font-medium ${modelInfo.typeConfig.color}`}>{modelInfo.typeConfig.label}</p>
                    <p className="text-[10px] text-white/40">{modelInfo.typeConfig.desc}</p>
                  </div>
                </>
              )}
            </div>
            
            {/* Settings Grid */}
            <div className="p-2 rounded-lg bg-white/[0.03]">
              <p className="text-[10px] text-white/40 uppercase">Temperature</p>
              <p className="text-xs font-medium text-white/80">{modelInfo.settings.temperature}</p>
            </div>
            <div className="p-2 rounded-lg bg-white/[0.03]">
              <p className="text-[10px] text-white/40 uppercase">Context</p>
              <p className="text-xs font-medium text-white/80">{(modelInfo.settings.num_ctx || 4096).toLocaleString()}</p>
            </div>
            
            {modelInfo.parsed.size && (
              <div className="p-2 rounded-lg bg-white/[0.03]">
                <p className="text-[10px] text-white/40 uppercase">Size</p>
                <p className="text-xs font-medium text-white/80">{modelInfo.parsed.size}</p>
              </div>
            )}
            {modelInfo.parsed.quantization && (
              <div className="p-2 rounded-lg bg-white/[0.03]">
                <p className="text-[10px] text-white/40 uppercase">Quant</p>
                <p className="text-xs font-medium text-white/80">{modelInfo.parsed.quantization}</p>
              </div>
            )}
          </div>
          
          <p className="text-[10px] text-white/30 mt-3">
            Settings auto-detected from model name • Override in Settings
          </p>
        </div>
      )}
      
      <div className="flex gap-2 mt-6">
        {['Explain something', 'Write code', 'Brainstorm'].map((suggestion) => (
          <button
            key={suggestion}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white/60 
              bg-white/[0.03] border border-white/[0.08]
              hover:text-white hover:bg-white/[0.06] hover:border-white/[0.12]
              transition-colors duration-150"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
});

export default EnhancedMessageBubble;
