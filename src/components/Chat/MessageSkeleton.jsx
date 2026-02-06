import React, { memo } from 'react';

/**
 * MessageSkeleton - Loading skeleton for messages during conversation switch.
 * Shows a realistic-looking placeholder that matches the EnhancedMessageBubble layout.
 */
export const MessageSkeleton = memo(function MessageSkeleton({ count = 4 }) {
  return (
    <div className="max-w-3xl mx-auto space-y-5 py-4 animate-in fade-in duration-300">
      {Array.from({ length: count }).map((_, i) => {
        const isUser = i % 2 === 0;
        return (
          <div
            key={i}
            className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar skeleton */}
            <div className="flex-shrink-0">
              <div
                className={`w-9 h-9 rounded-xl skeleton-pulse ${
                  isUser ? 'bg-violet-500/20' : 'bg-slate-700/30'
                }`}
              />
            </div>

            {/* Content skeleton */}
            <div className={`flex flex-col max-w-[65%] ${isUser ? 'items-end' : 'items-start'}`}>
              {/* Name + timestamp */}
              <div className={`flex items-center gap-2 mb-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className="w-12 h-3 rounded bg-white/[0.06] skeleton-pulse" />
                <div className="w-10 h-2.5 rounded bg-white/[0.04] skeleton-pulse" />
              </div>

              {/* Message bubble */}
              <div
                className={`rounded-2xl px-4 py-3 w-full ${
                  isUser
                    ? 'rounded-tr-sm bg-violet-500/10 border border-violet-500/10'
                    : 'rounded-tl-sm bg-white/[0.02] border border-white/[0.04]'
                }`}
              >
                {isUser ? (
                  // User messages: shorter, 1-2 lines
                  <div className="space-y-2">
                    <div className="h-3 rounded bg-white/[0.08] skeleton-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
                    {Math.random() > 0.5 && (
                      <div className="h-3 rounded bg-white/[0.06] skeleton-pulse" style={{ width: `${30 + Math.random() * 40}%` }} />
                    )}
                  </div>
                ) : (
                  // Assistant messages: longer, 3-6 lines
                  <div className="space-y-2">
                    <div className="h-3 rounded bg-white/[0.06] skeleton-pulse w-full" />
                    <div className="h-3 rounded bg-white/[0.05] skeleton-pulse" style={{ width: `${80 + Math.random() * 20}%` }} />
                    <div className="h-3 rounded bg-white/[0.05] skeleton-pulse" style={{ width: `${60 + Math.random() * 35}%` }} />
                    {Math.random() > 0.3 && (
                      <>
                        <div className="h-3 rounded bg-white/[0.04] skeleton-pulse" style={{ width: `${70 + Math.random() * 25}%` }} />
                        <div className="h-3 rounded bg-white/[0.04] skeleton-pulse" style={{ width: `${40 + Math.random() * 30}%` }} />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* CSS for skeleton animation */}
      <style>{`
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        .skeleton-pulse {
          animation: skeleton-pulse 1.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
});

/**
 * ConversationLoadingOverlay - Shows when switching between conversations
 */
export const ConversationLoadingOverlay = memo(function ConversationLoadingOverlay({ isLoading }) {
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 bg-forge-bg/80 backdrop-blur-sm z-10 flex items-center justify-center animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
        <p className="text-xs text-white/50">Loading conversation...</p>
      </div>
    </div>
  );
});

export default MessageSkeleton;
