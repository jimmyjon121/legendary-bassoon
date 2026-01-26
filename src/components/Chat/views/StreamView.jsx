import React, { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../../stores/appStore';
import { EnhancedMessageBubble, TypingBubble, WelcomeMessage } from '../EnhancedMessageBubble';
import { ContextBubbles } from '../ContextBubbles';
import { SmartInput } from '../SmartInput';
import { VirtualizedMessageList } from '../VirtualizedMessageList';

// Threshold for using virtualization (small conversations don't need it)
const VIRTUALIZATION_THRESHOLD = 20;

/**
 * Stream View - Enhanced traditional chat timeline
 * Uses virtualization for conversations with 20+ messages for optimal performance
 * Auto-scrolls to new messages for smooth chat experience
 */
export function StreamView() {
  // Use selective subscriptions for optimal re-render performance
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const sendMessage = useAppStore(s => s.sendMessage);
  
  // Refs for auto-scroll
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  // Check if user is near bottom (within 150px)
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Smooth scroll to bottom
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messagesEndRef.current && !isUserScrollingRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior, 
        block: 'end' 
      });
    }
  }, []);

  // Auto-scroll when messages change or streaming content updates
  useEffect(() => {
    // Only auto-scroll if user is near the bottom
    if (isNearBottom()) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        scrollToBottom('smooth');
      });
    }
  }, [messages, streamingContent, isGenerating, isNearBottom, scrollToBottom]);

  // Immediate scroll for new user messages
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      // Instant scroll for user's own messages
      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    }
  }, [messages.length, scrollToBottom]);

  // Track user scrolling to avoid interrupting manual scroll
  const handleScroll = useCallback(() => {
    // Clear any existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // Mark as user scrolling
    isUserScrollingRef.current = true;
    
    // Reset after user stops scrolling
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 1000);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (message, options = {}) => {
    try {
      // Reset scroll lock when user sends a message
      isUserScrollingRef.current = false;
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  // Determine if we should use virtualization
  const useVirtualization = messages.length >= VIRTUALIZATION_THRESHOLD;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages area - relative container for context bubbles */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {useVirtualization ? (
          // Virtualized list for long conversations
          <VirtualizedMessageList
            messages={messages}
            streamingContent={isGenerating ? streamingContent : ''}
            streamingModel={currentModel}
            showBranchIndicators={false}
            enableActions={true}
            variant="enhanced"
            className="h-full py-4"
          />
        ) : (
          // Standard list for short conversations
          <div 
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto px-4 py-4 scroll-smooth"
          >
            <div className="max-w-4xl mx-auto space-y-4 enhanced-chat-container">
              {messages.length === 0 && !isGenerating && (
                <WelcomeMessage modelName={currentModel} />
              )}
              
              {messages.map((message, index) => (
                <div 
                  key={message.id}
                  className="message-appear"
                  style={{ 
                    animationDelay: index === messages.length - 1 ? '0ms' : '0ms',
                  }}
                >
                  <EnhancedMessageBubble 
                    message={message}
                    showTimestamp={true}
                    enableActions={message.role === 'assistant'}
                  />
                </div>
              ))}
              
              {/* Streaming response */}
              {isGenerating && streamingContent && (
                <div className="message-appear">
                  <EnhancedMessageBubble 
                    message={{
                      id: 'streaming',
                      role: 'assistant',
                      content: streamingContent,
                      model: currentModel
                    }}
                    isStreaming
                  />
                </div>
              )}
              
              {/* Typing indicator - now inside scroll container */}
              {isGenerating && !streamingContent && (
                <div className="message-appear">
                  <TypingBubble model={currentModel} />
                </div>
              )}
              
              {/* Scroll anchor */}
              <div ref={messagesEndRef} className="h-1" />
            </div>
          </div>
        )}

        {/* Context bubbles overlay - now inside messages container only */}
        <ContextBubbles messages={messages} isVisible={messages.length > 0} />
      </div>

      {/* Smart input - z-30 ensures it's above all overlays */}
      <div className="border-t border-forge-border/40 bg-forge-surface/50 backdrop-blur-sm relative z-30 pointer-events-auto">
        {/* Input area */}
        <div className="p-4">
          <div className="max-w-4xl mx-auto">
            <SmartInput onSubmit={handleSubmit} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default StreamView;



