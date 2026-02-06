import React, { useMemo, useState, useRef } from 'react';
import { 
  Clock, 
  Calendar, 
  TrendingUp,
  MessageSquare,
  Bot,
  User,
  Sparkles,
  Filter,
  Zap,
  Search,
  ArrowDown,
  Timer,
  BarChart3,
  X,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { SmartInput } from '../SmartInput';
import { StreamingMarkdown } from '../StreamingMarkdown';

/**
 * Timeline View - Chronological conversation with time-based grouping
 * Shows conversations grouped by time periods with visual timeline
 */
export function TimelineView() {
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const sendMessage = useAppStore(s => s.sendMessage);
  
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [timeFilter, setTimeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showStats, setShowStats] = useState(true);

  const contentRef = useRef(null);

  // Format timestamp for display
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = new Date(now - 86400000).toDateString() === date.toDateString();
    
    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Calculate response time between user and next assistant message
  const getResponseTime = (userMsgIdx) => {
    if (!messages[userMsgIdx] || messages[userMsgIdx].role !== 'user') return null;
    const nextMsg = messages[userMsgIdx + 1];
    if (!nextMsg || nextMsg.role !== 'assistant') return null;
    
    const userTime = new Date(messages[userMsgIdx].created_at);
    const aiTime = new Date(nextMsg.created_at);
    const diffMs = aiTime - userTime;
    
    if (isNaN(diffMs) || diffMs < 0) return null;
    
    if (diffMs < 1000) return '<1s';
    if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;
    if (diffMs < 3600000) return `${Math.round(diffMs / 60000)}m`;
    return `${Math.round(diffMs / 3600000)}h`;
  };

  // Group messages by time periods
  const timelineGroups = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    
    const groups = new Map();
    const now = new Date();
    
    messages.forEach((message, idx) => {
      const msgDate = new Date(message.created_at || now);
      const dateKey = msgDate.toDateString();
      
      // Apply time filter
      if (timeFilter === 'today') {
        if (msgDate.toDateString() !== now.toDateString()) return;
      } else if (timeFilter === 'hour') {
        const hourAgo = new Date(now - 3600000);
        if (msgDate < hourAgo) return;
      }

      // Apply search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!message.content?.toLowerCase().includes(q)) return;
      }
      
      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          date: msgDate,
          dateKey,
          messages: []
        });
      }
      
      groups.get(dateKey).messages.push({ ...message, _originalIndex: idx });
    });
    
    return Array.from(groups.values()).sort((a, b) => b.date - a.date);
  }, [messages, timeFilter, searchQuery]);

  // Calculate conversation stats
  const stats = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const totalWords = messages.reduce((acc, m) => acc + (m.content?.split(/\s+/).length || 0), 0);
    const userWords = userMessages.reduce((acc, m) => acc + (m.content?.split(/\s+/).length || 0), 0);
    const aiWords = assistantMessages.reduce((acc, m) => acc + (m.content?.split(/\s+/).length || 0), 0);
    
    // Calculate conversation duration
    let duration = '';
    if (messages.length >= 2) {
      const first = new Date(messages[0].created_at);
      const last = new Date(messages[messages.length - 1].created_at);
      const diffMs = last - first;
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) duration = '<1 min';
      else if (diffMins < 60) duration = `${diffMins} min`;
      else duration = `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
    }

    // Longest message
    const longestMsg = messages.reduce((max, m) => 
      (m.content?.length || 0) > (max?.content?.length || 0) ? m : max
    , messages[0]);

    return {
      total: messages.length,
      user: userMessages.length,
      assistant: assistantMessages.length,
      totalWords,
      userWords,
      aiWords,
      avgUserWords: userMessages.length > 0 ? Math.round(userWords / userMessages.length) : 0,
      avgAiWords: assistantMessages.length > 0 ? Math.round(aiWords / assistantMessages.length) : 0,
      duration,
      longestMsgWords: longestMsg?.content?.split(/\s+/).length || 0,
    };
  }, [messages]);

  const handleSubmit = async (message, options = {}) => {
    try {
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const scrollToBottom = () => {
    contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center">
            <Clock size={20} className="text-pink-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">Timeline View</h2>
            <p className="text-xs text-text-muted">
              {stats 
                ? `${stats.total} messages • ${stats.totalWords.toLocaleString()} words${stats.duration ? ` • ${stats.duration}` : ''}`
                : 'Start chatting to see your timeline'
              }
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="pl-8 pr-3 py-1.5 w-40 bg-surface-2 border border-border-subtle rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-pink-400/50 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Stats toggle */}
          <button
            onClick={() => setShowStats(!showStats)}
            className={`p-2 rounded-lg transition-colors ${showStats ? 'bg-pink-500/20 text-pink-400' : 'text-text-muted hover:text-text-primary hover:bg-surface-2'}`}
            title="Toggle statistics"
          >
            <BarChart3 size={16} />
          </button>

          <div className="w-px h-5 bg-border-subtle" />

          {/* Time Filter */}
          <div className="flex bg-surface-2 rounded-lg p-0.5">
            {[
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: 'hour', label: 'Last Hour' }
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setTimeFilter(filter.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  timeFilter === filter.id
                    ? 'bg-pink-500/20 text-pink-400'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <AnimatePresence>
        {stats && showStats && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-6 py-2.5 border-b border-border-subtle bg-surface-0/50">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <User size={12} className="text-workspace-casual" />
                  <span className="text-xs text-text-muted">You: <span className="text-text-primary font-medium">{stats.user}</span> msgs</span>
                  <span className="text-[10px] text-text-muted">({stats.avgUserWords} avg words)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Bot size={12} className="text-accent-primary" />
                  <span className="text-xs text-text-muted">AI: <span className="text-text-primary font-medium">{stats.assistant}</span> msgs</span>
                  <span className="text-[10px] text-text-muted">({stats.avgAiWords} avg words)</span>
                </div>
                {stats.duration && (
                  <div className="flex items-center gap-2">
                    <Timer size={12} className="text-pink-400" />
                    <span className="text-xs text-text-muted">Duration: <span className="text-text-primary font-medium">{stats.duration}</span></span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <TrendingUp size={12} className="text-emerald-400" />
                  <span className="text-xs text-text-muted">Longest: <span className="text-text-primary font-medium">{stats.longestMsgWords}</span> words</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto scrollbar-premium">
        <div className="max-w-3xl mx-auto px-8 py-6">
          {timelineGroups.length === 0 ? (
            <TimelineEmptyState onSendMessage={handleSubmit} hasMessages={messages.length > 0} searchQuery={searchQuery} />
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-pink-500/30 via-border-subtle to-transparent" />
              
              {timelineGroups.map((group, groupIdx) => (
                <div key={group.dateKey} className="mb-8">
                  {/* Date header */}
                  <div className="relative flex items-center gap-4 mb-5 ml-1">
                    <div className="w-14 h-14 rounded-xl bg-pink-500/20 flex items-center justify-center z-10 border-2 border-surface-base shadow-lg">
                      <Calendar size={20} className="text-pink-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{formatDate(group.date)}</h3>
                      <p className="text-xs text-text-muted">{group.messages.length} messages</p>
                    </div>
                  </div>
                  
                  {/* Messages for this date */}
                  <div className="ml-[2.1rem] pl-8 space-y-3">
                    {group.messages.map((message, msgIdx) => {
                      const isUser = message.role === 'user';
                      const isSelected = selectedMessage === message.id;
                      const responseTime = isUser ? getResponseTime(message._originalIndex) : null;
                      
                      return (
                        <div key={message.id || msgIdx}>
                          <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: msgIdx * 0.02 }}
                            onClick={() => setSelectedMessage(isSelected ? null : message.id)}
                            className={`relative group cursor-pointer ${isSelected ? 'z-10' : ''}`}
                          >
                            {/* Timeline dot */}
                            <div 
                              className={`absolute -left-[2.35rem] top-3.5 w-2.5 h-2.5 rounded-full border-2 border-surface-base transition-all ${
                                isUser ? 'bg-workspace-casual' : 'bg-accent-primary'
                              } ${isSelected ? 'scale-150' : ''}`}
                            />
                            
                            {/* Message card */}
                            <div className={`
                              p-3.5 rounded-xl transition-all
                              ${isUser 
                                ? 'bg-workspace-casual/8 border border-workspace-casual/15' 
                                : 'bg-surface-1 border border-border-subtle'
                              }
                              ${isSelected ? 'ring-2 ring-pink-400/40 shadow-lg' : 'hover:shadow-md'}
                            `}>
                              <div className="flex items-start gap-3">
                                <div className={`
                                  w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                                  ${isUser ? 'bg-workspace-casual/20' : 'bg-accent-primary/20'}
                                `}>
                                  {isUser 
                                    ? <User size={14} className="text-workspace-casual" />
                                    : <Bot size={14} className="text-accent-primary" />
                                  }
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-xs font-medium text-text-primary">
                                      {isUser ? 'You' : message.model || 'Assistant'}
                                    </span>
                                    <span className="text-[10px] text-text-muted font-mono">
                                      {formatTime(message.created_at)}
                                    </span>
                                    <span className="text-[10px] text-text-muted">
                                      {message.content?.split(/\s+/).length || 0} words
                                    </span>
                                  </div>
                                  
                                  {isSelected ? (
                                    <div className="prose prose-sm prose-invert max-w-none text-text-secondary">
                                      <StreamingMarkdown content={message.content} isStreaming={false} />
                                    </div>
                                  ) : (
                                    <p className="text-sm text-text-secondary line-clamp-3 leading-relaxed whitespace-pre-wrap">
                                      {message.content}
                                    </p>
                                  )}
                                </div>

                                {/* Expand/collapse indicator */}
                                <div className="flex-shrink-0 mt-1 text-text-muted">
                                  {isSelected ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </div>
                              </div>
                            </div>
                          </motion.div>

                          {/* Response time indicator */}
                          {responseTime && (
                            <div className="relative ml-4 my-1.5 flex items-center gap-2">
                              <div className="absolute -left-[2.6rem] top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-pink-400/50" />
                              <Zap size={10} className="text-pink-400" />
                              <span className="text-[10px] text-pink-400/80 font-mono">
                                Response in {responseTime}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Streaming indicator */}
          {isGenerating && streamingContent && (
            <div className="relative ml-[2.1rem] pl-8">
              <div className="absolute -left-[0.2rem] top-3.5 w-2.5 h-2.5 rounded-full bg-accent-primary animate-pulse" />
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 rounded-xl bg-surface-1 border border-accent-primary/30"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={14} className="text-accent-primary animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-medium text-accent-primary">Generating...</span>
                    <div className="mt-1 prose prose-sm prose-invert max-w-none text-text-secondary">
                      <StreamingMarkdown content={streamingContent} isStreaming={true} />
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-border-subtle bg-surface-0/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <SmartInput onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state for timeline view
 */
function TimelineEmptyState({ onSendMessage, hasMessages, searchQuery }) {
  if (hasMessages && searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Search size={32} className="text-text-muted mb-4" />
        <p className="text-sm text-text-muted">No messages match "{searchQuery}"</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="w-20 h-20 rounded-2xl bg-pink-500/10 flex items-center justify-center mb-6 mx-auto border border-pink-500/20">
          <Calendar size={32} className="text-pink-400" />
        </div>
        <h3 className="text-xl font-semibold text-text-primary mb-3">
          Your Conversation Timeline
        </h3>
        <p className="text-sm text-text-muted text-center max-w-md mb-6 leading-relaxed">
          Watch your conversation unfold chronologically.
          Each message is timestamped with response times and detailed stats.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {['Tell me about the history of AI', 'Plan my week for me', 'What are the latest tech trends?'].map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSendMessage(prompt)}
              className="px-4 py-2 text-xs text-text-secondary bg-surface-1 border border-border-subtle hover:border-pink-500/30 rounded-xl transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default TimelineView;
