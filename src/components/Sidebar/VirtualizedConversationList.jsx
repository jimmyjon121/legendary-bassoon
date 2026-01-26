/**
 * VirtualizedConversationList
 * 
 * High-performance conversation list using TanStack Virtual.
 * Only renders items visible in the viewport for optimal performance.
 */

import React, { useRef, useCallback, memo, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// Memoized conversation item
const ConversationItem = memo(function ConversationItem({ 
  conv, 
  isActive, 
  onSelect, 
  onDelete, 
  accentColor,
  style 
}) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <div
      style={style}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect(conv.id)}
      className={`relative group mx-2 rounded-lg cursor-pointer transition-colors
        ${isActive ? 'bg-glass-4' : 'hover:bg-glass-2'}`}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
              {conv.title || 'New conversation'}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true })}
            </p>
          </div>
          
          {isHovered && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              className="p-1.5 rounded-lg hover:bg-accent-error/20 text-text-muted hover:text-accent-error transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      
      {isActive && (
        <div 
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
          style={{ background: accentColor }}
        />
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.conv.id === next.conv.id &&
    prev.conv.title === next.conv.title &&
    prev.conv.updated_at === next.conv.updated_at &&
    prev.isActive === next.isActive &&
    prev.accentColor === next.accentColor
  );
});

export function VirtualizedConversationList({
  conversations,
  currentConversationId,
  onSelect,
  onDelete,
  accentColor,
  className = '',
}) {
  const parentRef = useRef(null);

  // Stabilize functions/options passed into useVirtualizer.
  // This prevents tanstack virtual from treating every render as a full re-init,
  // which can cause internal sync updates (and "Too many re-renders" in dev).
  const getScrollElement = useCallback(() => parentRef.current, []);
  const estimateSize = useCallback(() => 60, []); // Fixed height per conversation item
  const getItemKey = useCallback((index) => conversations[index]?.id || index, [conversations]);

  const virtualizerOptions = useMemo(() => ({
    count: conversations.length,
    getScrollElement,
    estimateSize,
    overscan: 5,
    getItemKey,
  }), [conversations.length, getScrollElement, estimateSize, getItemKey]);

  const virtualizer = useVirtualizer(virtualizerOptions);

  const items = virtualizer.getVirtualItems();

  if (conversations.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <p className="text-text-secondary text-sm">No conversations yet</p>
        <p className="text-text-muted text-xs mt-1">Start a new chat</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`h-full overflow-y-auto scrollbar-premium ${className}`}
      style={{ contain: 'strict' }}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {items.map((virtualRow) => {
          const conv = conversations[virtualRow.index];
          
          return (
            <ConversationItem
              key={virtualRow.key}
              conv={conv}
              isActive={currentConversationId === conv.id}
              onSelect={onSelect}
              onDelete={onDelete}
              accentColor={accentColor}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedConversationList;


