import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send } from 'lucide-react';

export function CharacterChat({ character, isOpen, onClose }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !character) return;

    let cancelled = false;

    const init = async () => {
      try {
        setError(null);
        setMessages([]);
        setConversationId(null);
        const startRes = await window.electronAPI?.startCharacterConversation(character.id);
        if (!startRes?.success) {
          throw new Error(startRes?.error || 'Failed to start character conversation');
        }
        if (cancelled) return;
        setConversationId(startRes.id);
        const loaded = await window.electronAPI?.getCharacterMessages(startRes.id);
        if (!cancelled) {
          setMessages(Array.isArray(loaded) ? loaded : []);
        }
      } catch (e) {
        console.error('Character chat init failed:', e);
        if (!cancelled) setError(e.message || String(e));
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [isOpen, character]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sending]);

  if (!isOpen || !character) return null;

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || sending || !conversationId) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setError(null);
    try {
      const res = await window.electronAPI?.characterChatTurn({
        characterId: character.id,
        conversationId,
        message: text,
      });
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to send message');
      }
      setConversationId(res.conversationId || conversationId);
      const updated = [
        ...(messages || []),
        res.userMessage,
        res.characterMessage,
      ];
      setMessages(updated);
    } catch (err) {
      console.error('Character chat turn failed:', err);
      setError(err.message || String(err));
    } finally {
      setSending(false);
    }
  };

  const renderMessage = (msg) => {
    const isUser = msg.role === 'user';
    return (
      <div
        key={msg.id}
        className={`flex mb-2 ${isUser ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
            isUser
              ? 'bg-workspace-nsfw text-white rounded-tr-sm'
              : 'bg-forge-bg text-text-primary rounded-tl-sm'
          }`}
        >
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-3xl h-[70vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Chat with {character.display_name || character.name}
              </h2>
              <p className="text-[11px] text-text-muted">
                Local, vault-only character conversation (uses current LLM model).
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messages && messages.length > 0 ? (
              messages.map(renderMessage)
            ) : (
              <div className="h-full flex items-center justify-center text-center text-xs text-text-muted">
                Say hello to start the conversation.
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-2 text-[11px] text-status-error bg-status-error/10 border-t border-status-error/30">
              {error}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSend} className="border-t border-forge-border px-4 py-3">
            <div className="flex items-center gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={1}
                placeholder={`Message ${character.display_name || character.name}…`}
                className="flex-1 input-area text-sm resize-none max-h-24"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="btn btn-primary px-3 py-2"
              >
                {sending ? (
                  'Sending…'
                ) : (
                  <span className="flex items-center gap-1 text-sm">
                    <Send size={14} />
                    Send
                  </span>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default CharacterChat;

















