import React, { memo, useState } from 'react';
import { Brain, ChevronDown, ChevronUp, MessageSquare, BookOpen, Pin, User, FolderOpen, FileText } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/**
 * Context Utilization Indicator
 * 
 * Shows how much of the model's context window is being used.
 * This helps users understand:
 * - Why they can have long conversations without losing context
 * - What information the AI has access to
 * - When they might be approaching context limits
 */
export const ContextUtilizationIndicator = memo(function ContextUtilizationIndicator({ 
  compact = false,
  className = '' 
}) {
  const contextUtilization = useAppStore(s => s.contextUtilization);
  const [expanded, setExpanded] = useState(false);
  
  const {
    tokensUsed = 0,
    maxTokens = 0,
    utilizationPercent = 0,
    messagesIncluded = 0,
    totalMessages = 0,
    breakdown = [],
  } = contextUtilization || {};
  
  // Don't show if no context data yet
  if (!maxTokens || maxTokens === 0) {
    return null;
  }
  
  // Format token counts for display
  const formatTokens = (tokens) => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };
  
  // Get color based on utilization
  const getUtilizationColor = (percent) => {
    if (percent < 50) return 'text-status-success';
    if (percent < 75) return 'text-status-warning';
    return 'text-status-error';
  };
  
  const getProgressColor = (percent) => {
    if (percent < 50) return 'bg-status-success';
    if (percent < 75) return 'bg-status-warning';
    return 'bg-status-error';
  };
  
  // Icon mapping for context types
  const getTypeIcon = (type) => {
    switch (type) {
      case 'userProfile': return <User size={12} />;
      case 'memories': return <Brain size={12} />;
      case 'pinnedMessages': return <Pin size={12} />;
      case 'conversationSummary': return <BookOpen size={12} />;
      case 'projectContext': return <FolderOpen size={12} />;
      case 'ragContext': return <FileText size={12} />;
      case 'recentMessages': return <MessageSquare size={12} />;
      default: return <Brain size={12} />;
    }
  };
  
  const getTypeName = (type) => {
    switch (type) {
      case 'userProfile': return 'Your Profile';
      case 'memories': return 'Memories';
      case 'pinnedMessages': return 'Pinned';
      case 'conversationSummary': return 'Summary';
      case 'projectContext': return 'Project';
      case 'ragContext': return 'Documents';
      case 'recentMessages': return 'Messages';
      default: return type;
    }
  };
  
  // Compact mode - just show a small indicator
  if (compact) {
    return (
      <div 
        className={`flex items-center gap-1.5 text-xs text-text-muted cursor-pointer hover:text-text-secondary transition-colors ${className}`}
        onClick={() => setExpanded(!expanded)}
        title={`Context: ${utilizationPercent}% used (${formatTokens(tokensUsed)}/${formatTokens(maxTokens)} tokens)`}
      >
        <Brain size={12} className={getUtilizationColor(utilizationPercent)} />
        <span className={getUtilizationColor(utilizationPercent)}>{utilizationPercent}%</span>
        <span className="text-text-muted/60">·</span>
        <span>{messagesIncluded}/{totalMessages} msgs</span>
      </div>
    );
  }
  
  return (
    <div className={`rounded-lg bg-forge-elevated/50 border border-forge-border/50 ${className}`}>
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2 hover:bg-forge-hover/30 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <Brain size={14} className={getUtilizationColor(utilizationPercent)} />
          <span className="text-xs text-text-secondary">Context Window</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${getUtilizationColor(utilizationPercent)}`}>
            {utilizationPercent}%
          </span>
          <span className="text-xs text-text-muted">
            {formatTokens(tokensUsed)}/{formatTokens(maxTokens)}
          </span>
          {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </div>
      </button>
      
      {/* Progress bar */}
      <div className="px-2 pb-2">
        <div className="h-1.5 bg-forge-bg rounded-full overflow-hidden">
          <div 
            className={`h-full ${getProgressColor(utilizationPercent)} transition-all duration-300`}
            style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
          />
        </div>
      </div>
      
      {/* Expanded details */}
      {expanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-forge-border/30 pt-2">
          {/* Messages included */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted flex items-center gap-1.5">
              <MessageSquare size={12} />
              Messages in context
            </span>
            <span className="text-text-secondary">
              {messagesIncluded} / {totalMessages}
              {messagesIncluded === totalMessages && (
                <span className="ml-1 text-status-success">✓ All</span>
              )}
            </span>
          </div>
          
          {/* Breakdown by type */}
          {breakdown.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Context Breakdown</span>
              {breakdown.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-text-muted flex items-center gap-1.5">
                    {getTypeIcon(item.type)}
                    {getTypeName(item.type)}
                    {item.priority === 'high' && (
                      <span className="text-[9px] px-1 py-0.5 bg-workspace-casual/20 text-workspace-casual rounded">
                        priority
                      </span>
                    )}
                  </span>
                  <span className="text-text-secondary font-mono text-[11px]">
                    {formatTokens(item.tokens)}
                  </span>
                </div>
              ))}
            </div>
          )}
          
          {/* Helpful tip */}
          <div className="text-[10px] text-text-muted/70 pt-1 border-t border-forge-border/20">
            {utilizationPercent < 30 && '💡 Plenty of room for more conversation!'}
            {utilizationPercent >= 30 && utilizationPercent < 70 && '💡 Good context utilization. Keep chatting!'}
            {utilizationPercent >= 70 && utilizationPercent < 90 && '⚡ Getting full! Older messages may be summarized.'}
            {utilizationPercent >= 90 && '⚠️ Near limit. Consider starting a new chat for new topics.'}
          </div>
        </div>
      )}
    </div>
  );
});

export default ContextUtilizationIndicator;
