import React, { useMemo, useState } from 'react';
import { 
  Clock, 
  Calendar, 
  TrendingUp,
  MessageSquare,
  Bot,
  User,
  Sparkles,
  Filter,
  ChevronLeft,
  ChevronRight,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { SmartInput } from '../SmartInput';

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
  const [timeFilter, setTimeFilter] = useState('all'); // 'all' | 'today' | 'hour'

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

  // Group messages by time periods
  const timelineGroups = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    
    const groups = new Map();
    const now = new Date();
    
    messages.forEach((message) => {
      const msgDate = new Date(message.created_at || now);
      const dateKey = msgDate.toDateString();
      
      // Apply time filter
      if (timeFilter === 'today') {
        if (msgDate.toDateString() !== now.toDateString()) return;
      } else if (timeFilter === 'hour') {
        const hourAgo = new Date(now - 3600000);
        if (msgDate < hourAgo) return;
      }
      
      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          date: msgDate,
          dateKey,
          messages: []
        });
      }
      
      groups.get(dateKey).messages.push(message);
    });
    
    return Array.from(groups.values()).sort((a, b) => b.date - a.date);
  }, [messages, timeFilter]);

  // Calculate conversation stats
  const stats = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;
    const totalWords = messages.reduce((acc, m) => acc + (m.content?.split(/\s+/).length || 0), 0);
    
    return {
      total: messages.length,
      user: userMessages,
      assistant: assistantMessages,
      words: totalWords
    };
  }, [messages]);

  const handleSubmit = async (message, options = {}) => {
    try {
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-pink-500/20 flex items-center justify-center">
            <Clock size={20} className="text-pink-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">Timeline View</h2>
            <p className="text-xs text-text-muted">
              {stats 
                ? `${stats.total} messages • ${stats.words.toLocaleString()} words`
                : 'Start chatting to see your timeline'
              }
            </p>
          </div>
        </div>
        
        {/* Time Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-text-muted" />
          <div className="flex bg-glass-2 rounded-lg p-0.5">
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
      {stats && (
        <div className="px-6 py-2 border-b border-border-subtle bg-surface-0/50 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <User size={12} className="text-workspace-casual" />
            <span className="text-xs text-text-muted">You: <span className="text-text-primary font-medium">{stats.user}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Bot size={12} className="text-accent-primary" />
            <span className="text-xs text-text-muted">AI: <span className="text-text-primary font-medium">{stats.assistant}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp size={12} className="text-accent-success" />
            <span className="text-xs text-text-muted">
              Avg: <span className="text-text-primary font-medium">{Math.round(stats.words / stats.total)}</span> words/msg
            </span>
          </div>
        </div>
      )}

      {/* Timeline Content */}
      <div className="flex-1 overflow-y-auto scrollbar-premium">
        <div className="max-w-4xl mx-auto px-6 py-4">
          {timelineGroups.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-pink-500/10 flex items-center justify-center mb-6">
                <Calendar size={32} className="text-pink-400" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                Your Conversation Timeline
              </h3>
              <p className="text-sm text-text-muted text-center max-w-md mb-6">
                Watch your conversation unfold chronologically.
                Each message is timestamped and grouped by time.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['What time is it in Tokyo?', 'Plan my day', 'Remind me about deadlines'].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSubmit(prompt)}
                    className="px-3 py-2 text-xs text-text-secondary bg-glass-3 hover:bg-glass-4 rounded-lg transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Timeline groups
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-6 top-0 bottom-0 w-px bg-border-subtle" />
              
              {timelineGroups.map((group, groupIdx) => (
                <div key={group.dateKey} className="mb-8">
                  {/* Date header */}
                  <div className="relative flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-pink-500/20 flex items-center justify-center z-10 border-2 border-surface-base">
                      <Calendar size={18} className="text-pink-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{formatDate(group.date)}</h3>
                      <p className="text-xs text-text-muted">{group.messages.length} messages</p>
                    </div>
                  </div>
                  
                  {/* Messages for this date */}
                  <div className="ml-6 pl-10 border-l border-border-subtle space-y-3">
                    {group.messages.map((message, msgIdx) => {
                      const isUser = message.role === 'user';
                      const isSelected = selectedMessage === message.id;
                      
                      return (
                        <motion.div
                          key={message.id || msgIdx}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: msgIdx * 0.03 }}
                          onClick={() => setSelectedMessage(isSelected ? null : message.id)}
                          className={`relative group cursor-pointer ${isSelected ? 'z-10' : ''}`}
                        >
                          {/* Timeline dot */}
                          <div 
                            className={`absolute -left-[2.65rem] top-3 w-3 h-3 rounded-full border-2 border-surface-base transition-colors ${
                              isUser ? 'bg-workspace-casual' : 'bg-accent-primary'
                            }`}
                          />
                          
                          {/* Time label */}
                          <div className="absolute -left-[5.5rem] top-2.5 text-[10px] text-text-muted font-mono">
                            {formatTime(message.created_at)}
                          </div>
                          
                          {/* Message card */}
                          <div className={`
                            p-3 rounded-xl transition-all
                            ${isUser 
                              ? 'bg-workspace-casual/10 border border-workspace-casual/20' 
                              : 'bg-glass-2 border border-border-subtle'
                            }
                            ${isSelected ? 'ring-2 ring-pink-400/50' : 'hover:bg-glass-3'}
                          `}>
                            <div className="flex items-start gap-3">
                              <div className={`
                                w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0
                                ${isUser ? 'bg-workspace-casual/20' : 'bg-accent-primary/20'}
                              `}>
                                {isUser 
                                  ? <User size={14} className="text-workspace-casual" />
                                  : <Bot size={14} className="text-accent-primary" />
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-text-primary">
                                    {isUser ? 'You' : message.model || 'Assistant'}
                                  </span>
                                </div>
                                <p className={`text-sm whitespace-pre-wrap ${
                                  isSelected ? 'text-text-primary' : 'text-text-secondary line-clamp-3'
                                }`}>
                                  {message.content}
                                </p>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Streaming indicator */}
          {isGenerating && streamingContent && (
            <div className="relative ml-6 pl-10 border-l border-border-subtle">
              <div className="absolute -left-[2.65rem] top-3 w-3 h-3 rounded-full bg-accent-primary animate-pulse" />
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-glass-2 border border-accent-primary/30"
              >
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={14} className="text-accent-primary animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-medium text-accent-primary">Generating...</span>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap mt-1">
                      {streamingContent}
                    </p>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-border-subtle bg-surface-0/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto p-4">
          <SmartInput onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}

export default TimelineView;
