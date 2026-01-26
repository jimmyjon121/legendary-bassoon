/**
 * StreamingMessage - Optimized component for displaying streaming LLM output
 * 
 * Key optimizations:
 * - Uses requestAnimationFrame for smooth updates
 * - Skips markdown parsing during streaming
 * - Only parses markdown when streaming completes
 * - Minimal DOM updates during stream
 */

import React, { memo, useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Bot } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

// Configure marked for post-stream parsing
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch { /* ignore */ }
    }
    return code;
  },
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

// Simple pre-processing for streaming (no heavy markdown parsing)
function preprocessStreamContent(content) {
  if (!content) return '';
  
  // Escape HTML
  let processed = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Handle code blocks with simple regex
  processed = processed.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => 
    `<pre class="streaming-code"><code class="language-${lang || 'text'}">${code}</code></pre>`
  );
  
  // Handle inline code
  processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  
  // Convert newlines to breaks
  processed = processed.replace(/\n/g, '<br/>');
  
  return processed;
}

// Full markdown parsing (post-stream)
function parseMarkdown(content) {
  if (!content) return '';
  return DOMPurify.sanitize(marked.parse(content));
}

export const StreamingMessage = memo(function StreamingMessage({ 
  content, 
  model,
  isStreaming = true,
  generationMetadata = null
}) {
  const contentRef = useRef(null);
  const rafRef = useRef(null);
  const lastContentRef = useRef('');
  const [displayContent, setDisplayContent] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  
  // Handle streaming updates with requestAnimationFrame
  useEffect(() => {
    if (!isStreaming || content === lastContentRef.current) return;
    
    // Cancel any pending animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    // Schedule update on next frame for smooth rendering
    rafRef.current = requestAnimationFrame(() => {
      lastContentRef.current = content;
      setDisplayContent(preprocessStreamContent(content));
    });
    
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [content, isStreaming]);
  
  // When streaming completes, parse full markdown
  useEffect(() => {
    if (!isStreaming && content && !isComplete) {
      // Small delay to ensure final content is received
      const timer = setTimeout(() => {
        setDisplayContent(parseMarkdown(content));
        setIsComplete(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, content, isComplete]);
  
  // Reset when streaming starts again
  useEffect(() => {
    if (isStreaming) {
      setIsComplete(false);
    }
  }, [isStreaming]);

  // Auto-scroll to keep cursor visible
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      const parent = contentRef.current.closest('.overflow-y-auto');
      if (parent) {
        parent.scrollTop = parent.scrollHeight;
      }
    }
  }, [displayContent, isStreaming]);

  const tokensPerSec = generationMetadata?.tokensPerSecond;

  return (
    <div className="flex gap-4 anim-fade-in">
      {/* Avatar */}
      <div className="flex-shrink-0 relative">
        <div className="w-9 h-9 rounded-xl bg-glass-3 border border-border-muted flex items-center justify-center">
          <Bot size={17} className="text-text-secondary" />
        </div>
        {isStreaming && (
          <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-accent-primary status-dot loading" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-medium text-text-primary">
            {model?.split(':')[0] || 'Assistant'}
          </span>
          {tokensPerSec > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-glass-2 text-text-muted font-mono">
              {tokensPerSec} tok/s
            </span>
          )}
        </div>
        
        <div 
          ref={contentRef}
          className="prose prose-sm text-sm text-text-secondary relative"
          dangerouslySetInnerHTML={{ __html: displayContent }}
        />
        
        {/* Streaming cursor */}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-accent-primary/70 animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // Only re-render if content actually changed
  return (
    prev.content === next.content &&
    prev.isStreaming === next.isStreaming &&
    prev.model === next.model
  );
});

// Typing indicator for when waiting for response
export const TypingIndicator = memo(function TypingIndicator({ model }) {
  return (
    <div className="flex gap-4 anim-fade-in">
      <div className="flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-glass-3 border border-border-muted flex items-center justify-center">
          <Bot size={17} className="text-text-secondary" />
        </div>
      </div>
      
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-medium text-text-primary">
            {model?.split(':')[0] || 'Assistant'}
          </span>
        </div>
        
        <div className="flex items-center gap-1 h-6">
          <div className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
});

export default StreamingMessage;



