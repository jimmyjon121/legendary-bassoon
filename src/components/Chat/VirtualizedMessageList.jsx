/**
 * VirtualizedMessageList
 * 
 * High-performance message list using TanStack Virtual.
 * Only renders messages that are visible in the viewport,
 * dramatically reducing memory usage for long conversations.
 */

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { FluidMessageBubble } from './FluidMessageBubble';
import { EnhancedMessageBubble } from './EnhancedMessageBubble';
import { BranchIndicator } from './BranchIndicator';

// Map of available message components
const MESSAGE_COMPONENTS = {
  default: MessageBubble,
  fluid: FluidMessageBubble,
  enhanced: EnhancedMessageBubble,
};

// Memoized message row component
const MessageRow = memo(function MessageRow({ 
  message, 
  style, 
  isStreaming,
  showBranchIndicator,
  enableActions,
  useFluidBubble,
  variant = 'default'
}) {
  // Support legacy useFluidBubble prop or new variant prop
  const componentKey = useFluidBubble ? 'fluid' : variant;
  const MessageComponent = MESSAGE_COMPONENTS[componentKey] || MessageBubble;
  
  return (
    <div style={style} className="px-4">
      <MessageComponent 
        message={message} 
        isStreaming={isStreaming}
        enableActions={enableActions}
      />
      {showBranchIndicator && message.role === 'assistant' && (
        <BranchIndicator message={message} />
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.isStreaming === next.isStreaming &&
    prev.style.transform === next.style.transform
  );
});

export function VirtualizedMessageList({
  messages,
  streamingMessageId,
  streamingContent,
  streamingModel,
  showBranchIndicators = true,
  enableActions = false,
  useFluidBubble = false,
  variant = 'default', // 'default' | 'fluid' | 'enhanced'
  className = '',
  onScrollToBottom,
}) {
  const parentRef = useRef(null);
  const isNearBottomRef = useRef(true);

  // Estimate message height based on content length
  const estimateSize = useCallback((index) => {
    const isTail = hasStreamingTail && index === messages.length;
    const message = isTail
      ? { content: streamingContent }
      : messages[index];
    if (!message) return 100;
    
    const contentLength = message.content?.length || 0;
    // Rough estimate: ~50 chars per line, ~24px per line, plus padding
    const estimatedLines = Math.ceil(contentLength / 50);
    const baseHeight = 80; // Avatar + padding
    const lineHeight = 24;
    const maxHeight = 600; // Cap for very long messages
    
    return Math.min(baseHeight + (estimatedLines * lineHeight), maxHeight);
  }, [messages, hasStreamingTail, streamingContent]);

  const hasStreamingTail = Boolean(streamingContent && String(streamingContent).length > 0);
  const itemCount = messages.length + (hasStreamingTail ? 1 : 0);

  // Set up virtualizer
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5, // Render 5 extra items above/below viewport
    getItemKey: (index) => {
      if (hasStreamingTail && index === messages.length) return '__streaming__';
      return messages[index]?.id || index;
    },
  });

  const items = virtualizer.getVirtualItems();

  // Track if user is near bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom < 100;
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isNearBottomRef.current && parentRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
    }
  }, [itemCount, virtualizer]);

  // Scroll to bottom on streaming content update
  useEffect(() => {
    if (streamingContent && isNearBottomRef.current && parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  }, [streamingContent]);

  // Expose scroll to bottom function
  useEffect(() => {
    if (onScrollToBottom) {
      onScrollToBottom(() => {
        virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
      });
    }
  }, [virtualizer, itemCount, onScrollToBottom]);

  if (messages.length === 0 && !hasStreamingTail) {
    return null;
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className={`h-full overflow-y-auto ${className}`}
      style={{ contain: 'strict' }}
    >
      <div
        className="relative w-full max-w-4xl mx-auto"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {items.map((virtualRow) => {
          const isTail = hasStreamingTail && virtualRow.index === messages.length;
          const message = isTail
            ? { id: 'streaming', role: 'assistant', content: streamingContent, model: streamingModel }
            : messages[virtualRow.index];
          const isStreaming = isTail || (message?.id === streamingMessageId);
          
          return (
            <MessageRow
              key={virtualRow.key}
              message={message}
              isStreaming={isStreaming}
              showBranchIndicator={showBranchIndicators}
              enableActions={enableActions}
              useFluidBubble={useFluidBubble}
              variant={variant}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                paddingTop: '8px',
                paddingBottom: '8px',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedMessageList;

