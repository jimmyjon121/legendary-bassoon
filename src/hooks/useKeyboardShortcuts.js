import { useEffect } from 'react';
import { useShortcutsStore, getNormalizedShortcuts } from '../stores/shortcutsStore';

// Build a combo string like "Ctrl+Shift+X" from a KeyboardEvent
function eventToCombo(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key[0].toUpperCase() + e.key.slice(1);

  // Ignore pure modifier presses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null;
  }

  parts.push(key);
  return parts.join('+');
}

/**
 * Register global keyboard shortcuts mapped to high-level actions.
 *
 * @param {Object} actions - Map of shortcut id -> function
 */
export function useKeyboardShortcuts(actions) {
  const initialize = useShortcutsStore((s) => s.initialize);
  const shortcutsState = useShortcutsStore((s) => s.shortcuts);

  useEffect(() => {
    // Ensure shortcuts are loaded from settings
    initialize();
  }, [initialize]);

  useEffect(() => {
    const shortcuts = getNormalizedShortcuts();

    function handler(e) {
      // Don't intercept when typing in inputs/textareas unless Ctrl/Meta is held
      const target = e.target;
      const tag = target?.tagName;
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        target?.isContentEditable;

      if (isEditable && !e.ctrlKey && !e.metaKey) {
        return;
      }

      const combo = eventToCombo(e);
      if (!combo) return;

      // Find matching shortcut
      const entry = Object.values(shortcuts).find((s) => s.combo === combo);
      if (!entry) return;

      const action = actions?.[entry.id];
      if (!action) return;

      e.preventDefault();
      try {
        action();
      } catch (error) {
        console.error('Shortcut action failed:', error);
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutsState, actions]);
}


