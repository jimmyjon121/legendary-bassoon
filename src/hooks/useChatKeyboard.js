/**
 * useChatKeyboard - Global keyboard shortcuts for the chat experience.
 * 
 * Shortcuts:
 *   Escape            - Stop generation if running
 *   Ctrl+Shift+C      - Copy last assistant response
 *   Ctrl+Shift+R      - Regenerate last response
 *   Ctrl+/            - Focus the input textarea
 *   Ctrl+Shift+Delete - Delete last message pair
 */

import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

export function useChatKeyboard({ textareaRef }) {
  const lastCopyFeedbackRef = useRef(null);

  const handleKeyDown = useCallback((e) => {
    const state = useAppStore.getState();

    // Escape → Stop generation
    if (e.key === 'Escape') {
      if (state.isGenerating) {
        e.preventDefault();
        state.stopGeneration?.();
        return;
      }
    }

    // Ctrl+Shift+C → Copy last assistant message to clipboard
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      const messages = state.messages || [];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          navigator.clipboard.writeText(messages[i].content).catch(() => {});
          // Flash a subtle toast (store-level if available, or just console)
          if (lastCopyFeedbackRef.current) clearTimeout(lastCopyFeedbackRef.current);
          useAppStore.setState({ _copyToast: 'Response copied to clipboard' });
          lastCopyFeedbackRef.current = setTimeout(() => {
            useAppStore.setState({ _copyToast: null });
          }, 2000);
          return;
        }
      }
      return;
    }

    // Ctrl+Shift+R → Regenerate last response
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      if (!state.isGenerating && state.regenerateLastResponse) {
        state.regenerateLastResponse();
      }
      return;
    }

    // Ctrl+/ → Focus the input textarea
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      textareaRef?.current?.focus();
      return;
    }

    // Ctrl+Shift+Delete → Delete last message pair
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Delete') {
      e.preventDefault();
      const msgs = state.messages || [];
      if (msgs.length > 0 && !state.isGenerating) {
        const last = msgs[msgs.length - 1];
        state.deleteMessage?.(last.id);
      }
      return;
    }
  }, [textareaRef]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Return copy toast state for UI
  return {
    copyToast: useAppStore(s => s._copyToast),
  };
}

export default useChatKeyboard;
