import React, { useMemo, memo, useState, useEffect } from 'react';
import { User, Bot, Copy, Check, RefreshCw, Paperclip, Image as ImageIcon, Hash, Pin, PinOff } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { motion } from 'framer-motion';
import { ReceiptPill, ReceiptsDrawer } from '../Receipts/ReceiptsDrawer';
import { useCurrentConversationId } from '../../stores/appStore';

// Configure marked
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch { /* ignore highlight error */ }
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

export const MessageBubble = memo(function MessageBubble({ message, isStreaming = false }) {
  const [copied, setCopied] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const conversationId = useCurrentConversationId();
  
  const isUser = message.role === 'user';

  // Check if message is pinned on mount
  useEffect(() => {
    if (message.id && window.electronAPI?.memoryIsMessagePinned) {
      window.electronAPI.memoryIsMessagePinned({ messageId: message.id })
        .then(pinned => setIsPinned(pinned))
        .catch(() => {});
    }
  }, [message.id]);

  const handleTogglePin = async () => {
    if (!message.id || !conversationId) return;
    setPinLoading(true);
    try {
      if (isPinned) {
        await window.electronAPI?.memoryUnpinMessage({ messageId: message.id });
        setIsPinned(false);
      } else {
        await window.electronAPI?.memoryPinMessage({ 
          messageId: message.id, 
          conversationId,
          reason: 'User pinned'
        });
        setIsPinned(true);
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
    setPinLoading(false);
  };
  
  // Check if message has receipts/evidence
  const receiptsCount = message.evidence?.length || message.receipts?.length || 0;
  const hasReceipts = receiptsCount > 0;
  
  // Parse markdown content (sanitized to prevent XSS)
  const htmlContent = useMemo(() => {
    if (!message.content) return '';
    return DOMPurify.sanitize(marked.parse(message.content));
  }, [message.content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {/* Avatar - Assistant */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-forge-elevated border border-forge-border flex items-center justify-center">
          <Bot size={16} className="text-text-secondary" />
        </div>
      )}

      {/* Message Content */}
      <div className={`flex flex-col max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`
            relative rounded-2xl px-4 py-3
            ${isUser 
              ? 'message-user rounded-tr-sm' 
              : 'message-assistant rounded-tl-sm'
            }
            ${isStreaming ? 'shimmer' : ''}
          `}
        >
          {/* Content */}
          {isUser ? (
            <p className="text-sm text-text-primary whitespace-pre-wrap">
              {message.content}
            </p>
          ) : (
            <div 
              className="prose text-sm"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          )}

          {/* Streaming cursor */}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-text-primary/60 animate-pulse ml-1" />
          )}
        </div>

        {/* Attachments (persisted assets) */}
        {Array.isArray(message.attachments) && message.attachments.length > 0 && (
          <div className="mt-1 px-1 w-full flex flex-wrap gap-2">
            {message.attachments.map((att) => {
              const isImage =
                att.kind === 'image' ||
                (att.mimeType && String(att.mimeType).startsWith('image/'));
              const label = att.name || att.originalPath || att.id;
              return (
                <button
                  key={att.id}
                  type="button"
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-forge-border bg-forge-bg text-[11px] text-text-muted hover:text-text-secondary hover:border-forge-hover hover:bg-forge-hover transition-colors"
                  title={label}
                  onClick={() => {
                    if (att.originalPath && window.electronAPI?.openInExplorer) {
                      window.electronAPI.openInExplorer(att.originalPath);
                    }
                  }}
                >
                  {isImage ? (
                    <ImageIcon size={12} className="text-text-muted" />
                  ) : (
                    <Paperclip size={12} className="text-text-muted" />
                  )}
                  <span className="line-clamp-1 max-w-[140px]">{label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Actions & Meta */}
        {!isStreaming && (
          <div className="flex flex-col gap-1 mt-1.5 px-1 w-full">
            <div className="flex items-center gap-2">
              {/* Pin Button - available on all messages */}
              <button
                onClick={handleTogglePin}
                disabled={pinLoading}
                className={`p-1 rounded transition-colors ${
                  isPinned 
                    ? 'text-amber-500 hover:text-amber-400' 
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                title={isPinned ? 'Unpin (AI will forget)' : 'Pin (AI will always remember)'}
              >
                {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              
              {!isUser && (
                <button
                  onClick={handleCopy}
                  className="p-1 rounded text-text-muted hover:text-text-secondary transition-colors"
                  title="Copy"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}

              {/* Receipts Pill */}
              {hasReceipts && (
                <ReceiptPill
                  count={receiptsCount}
                  onClick={() => setShowReceipts(true)}
                  isVerified={true}
                />
              )}

              {!isUser && message.model && (
                <span className="text-xs text-text-muted">
                  {message.model}
                </span>
              )}
              
              {/* Pinned indicator */}
              {isPinned && (
                <span className="text-[10px] text-amber-500/80 bg-amber-500/10 px-1.5 py-0.5 rounded">
                  📌 Pinned
                </span>
              )}

              {!isUser && message.meta && (
                <button
                  type="button"
                  onClick={() => setShowMeta((v) => !v)}
                  className="ml-auto text-[11px] text-text-muted hover:text-text-secondary underline-offset-2 hover:underline"
                >
                  {showMeta ? 'Hide thinking' : 'Show thinking'}
                </button>
              )}
            </div>

            {showMeta && message.meta && (
              <div className="text-[11px] text-text-muted bg-forge-bg border border-forge-border rounded px-2 py-1">
                <div>
                  Tokens: <span className="text-text-secondary">{message.meta.tokensEstimated ?? '—'}</span>
                  {message.meta.tokensPerSecond != null && (
                    <>
                      {' '}• Speed:{' '}
                      <span className="text-text-secondary">
                        {message.meta.tokensPerSecond} tok/s
                      </span>
                    </>
                  )}
                </div>
                {message.meta.durationSeconds != null && (
                  <div>
                    Duration:{' '}
                    <span className="text-text-secondary">
                      {Math.round(message.meta.durationSeconds * 10) / 10}s
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Avatar - User */}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-workspace-casual/20 border border-workspace-casual/30 flex items-center justify-center">
          <User size={16} className="text-workspace-casual" />
        </div>
      )}
      
      {/* Receipts Drawer */}
      <ReceiptsDrawer
        isOpen={showReceipts}
        onClose={() => setShowReceipts(false)}
        evidenceItems={message.evidence || message.receipts || []}
        messageId={message.id}
      />
    </motion.div>
  );
});
