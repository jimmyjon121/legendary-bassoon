import React, { useState, useEffect, memo } from 'react';
import { Brain, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ThinkingBlock - Displays model's reasoning process in a collapsible block
 * 
 * Similar to Claude's "Thought for X seconds" UI or DeepSeek R1's thinking display.
 * Shows the chain-of-thought reasoning that models output in <think> tags.
 */
export const ThinkingBlock = memo(function ThinkingBlock({ 
  content, 
  isStreaming = false,
  startTime = null,
  className = '' 
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  // Track elapsed time during streaming
  useEffect(() => {
    if (!isStreaming || !startTime) {
      return;
    }
    
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isStreaming, startTime]);
  
  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming && content) {
      setIsExpanded(false);
    }
  }, [isStreaming, content]);
  
  // Format thinking content for display
  const formattedContent = content?.trim() || '';
  const lineCount = formattedContent.split('\n').length;
  const wordCount = formattedContent.split(/\s+/).filter(Boolean).length;
  
  // Determine display mode
  const hasContent = formattedContent.length > 0;
  
  if (!hasContent && !isStreaming) {
    return null;
  }
  
  return (
    <div className={`thinking-block mb-3 ${className}`}>
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all
          ${isStreaming 
            ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' 
            : 'bg-forge-elevated/50 border border-forge-border/50 text-text-muted hover:text-text-secondary hover:bg-forge-elevated'
          }
        `}
      >
        {/* Icon with animation during streaming */}
        <div className={`flex-shrink-0 ${isStreaming ? 'animate-pulse' : ''}`}>
          <Brain size={16} className={isStreaming ? 'text-amber-400' : 'text-text-muted'} />
        </div>
        
        {/* Status text */}
        <div className="flex-1 text-sm">
          {isStreaming ? (
            <span className="flex items-center gap-2">
              <span className="font-medium">Thinking</span>
              <span className="thinking-dots">
                <span className="dot">.</span>
                <span className="dot">.</span>
                <span className="dot">.</span>
              </span>
              {elapsedSeconds > 0 && (
                <span className="text-xs text-amber-400/70 flex items-center gap-1">
                  <Clock size={12} />
                  {elapsedSeconds}s
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span>Thought process</span>
              <span className="text-xs text-text-muted/70">
                ({wordCount} words, {lineCount} lines)
              </span>
            </span>
          )}
        </div>
        
        {/* Expand/collapse indicator */}
        {hasContent && (
          <div className="flex-shrink-0">
            {isExpanded ? (
              <ChevronUp size={16} className="text-text-muted" />
            ) : (
              <ChevronDown size={16} className="text-text-muted" />
            )}
          </div>
        )}
      </button>
      
      {/* Expandable content */}
      <AnimatePresence>
        {isExpanded && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 rounded-lg bg-forge-bg/50 border border-forge-border/30">
              <pre className="text-xs text-text-muted whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                {formattedContent}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* CSS for thinking dots animation */}
      <style>{`
        .thinking-dots .dot {
          animation: thinking-dot 1.4s infinite;
          opacity: 0;
        }
        .thinking-dots .dot:nth-child(1) { animation-delay: 0s; }
        .thinking-dots .dot:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dots .dot:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes thinking-dot {
          0%, 20% { opacity: 0; }
          50% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
});

/**
 * Parse thinking content from a message
 * Extracts content between <think> tags
 */
export function parseThinkTags(content) {
  if (!content || typeof content !== 'string') {
    return { thinkingContent: null, mainContent: content || '' };
  }
  
  // Match <think>...</think> tags (case insensitive, multiline)
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  const matches = [];
  let match;
  
  while ((match = thinkRegex.exec(content)) !== null) {
    matches.push(match[1].trim());
  }
  
  // Combine all thinking blocks
  const thinkingContent = matches.length > 0 ? matches.join('\n\n---\n\n') : null;
  
  // Remove thinking tags from main content
  const mainContent = content.replace(thinkRegex, '').trim();
  
  return { thinkingContent, mainContent };
}

/**
 * Check if content is currently in a thinking block (streaming)
 * Returns true if we have an opening <think> tag without a closing one
 */
export function isInThinkingBlock(content) {
  if (!content) return false;
  
  const openCount = (content.match(/<think>/gi) || []).length;
  const closeCount = (content.match(/<\/think>/gi) || []).length;
  
  return openCount > closeCount;
}

/**
 * Extract partial thinking content during streaming
 * Gets content after the last <think> tag that doesn't have a closing tag yet
 */
export function getPartialThinking(content) {
  if (!content) return null;
  
  // Find the last <think> tag
  const lastOpenIndex = content.toLowerCase().lastIndexOf('<think>');
  if (lastOpenIndex === -1) return null;
  
  // Check if there's a closing tag after it
  const afterOpen = content.substring(lastOpenIndex + 7);
  const hasClose = afterOpen.toLowerCase().includes('</think>');
  
  if (hasClose) return null;
  
  return afterOpen.trim();
}

export default ThinkingBlock;
