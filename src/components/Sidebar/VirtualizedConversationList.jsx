/**
 * VirtualizedConversationList
 *
 * High-performance conversation list using TanStack Virtual.
 * Only renders items visible in the viewport for optimal performance.
 */

import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ConversationCard } from './ConversationCard';

export function VirtualizedConversationList({
  conversations,
  currentConversationId,
  onSelect,
  onDelete,
  accentColor,
  maskPrivateMeta = false,
  className = '',
}) {
  const parentRef = useRef(null);

  const getScrollElement = useCallback(() => parentRef.current, []);
  const estimateSize = useCallback(() => 92, []);
  const getItemKey = useCallback((index) => conversations[index]?.id || index, [conversations]);
  const measureElement = useCallback((element) => element?.getBoundingClientRect().height ?? 92, []);

  const virtualizerOptions = useMemo(() => ({
    count: conversations.length,
    getScrollElement,
    estimateSize,
    overscan: 6,
    getItemKey,
    measureElement,
  }), [conversations.length, estimateSize, getItemKey, getScrollElement, measureElement]);

  const virtualizer = useVirtualizer(virtualizerOptions);
  const items = virtualizer.getVirtualItems();

  if (conversations.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-text-secondary">No conversations yet</p>
        <p className="mt-1 text-xs text-text-muted">Start a new chat</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`h-full overflow-y-auto scrollbar-premium ${className}`}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {items.map((virtualRow) => {
          const conv = conversations[virtualRow.index];
          if (!conv) return null;

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full px-2 pb-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <ConversationCard
                conv={conv}
                isActive={currentConversationId === conv.id}
                onSelect={onSelect}
                onDelete={onDelete}
                accentColor={accentColor}
                maskPrivateMeta={maskPrivateMeta}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedConversationList;
