import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';

const shortcuts = [
  {
    category: 'General',
    items: [
      { keys: ['Ctrl/Cmd', 'K'], description: 'Open command palette' },
      { keys: ['Ctrl/Cmd', 'N'], description: 'New conversation' },
      { keys: ['Ctrl/Cmd', ','], description: 'Open settings' },
      { keys: ['Ctrl/Cmd', 'M'], description: 'Switch model' },
      { keys: ['Esc'], description: 'Stop generation / Close modal' },
    ],
  },
  {
    category: 'Navigation',
    items: [
      { keys: ['Ctrl/Cmd', '1'], description: 'Casual workspace' },
      { keys: ['Ctrl/Cmd', '2'], description: 'Work workspace' },
      { keys: ['Ctrl/Cmd', '3'], description: 'Code workspace' },
      { keys: ['Ctrl/Cmd', '4'], description: 'Research workspace' },
      { keys: ['Ctrl/Cmd', 'F'], description: 'Search conversations' },
    ],
  },
  {
    category: 'Chat',
    items: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line' },
      { keys: ['Ctrl/Cmd', 'Up'], description: 'Edit last message' },
      { keys: ['Ctrl/Cmd', 'E'], description: 'Export conversation' },
    ],
  },
  {
    category: 'Emergency',
    items: [
      { keys: ['Ctrl/Cmd', 'Shift', 'P'], description: 'Panic mode (hide app)' },
    ],
  },
];

const KeyBadge = ({ children }) => (
  <span
    className="inline-flex items-center justify-center min-w-6 h-6 px-1.5
                   bg-white/10 border border-white/20 rounded-md
                   text-xs font-mono text-white/80 shadow-sm"
  >
    {children}
  </span>
);

export const KeyboardShortcutsModal = ({ isOpen, onClose }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                       w-full max-w-2xl z-50"
          >
            <div
              className="bg-[#0a0a14]/95 backdrop-blur-xl rounded-2xl
                          border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl bg-indigo-500/20
                                flex items-center justify-center"
                  >
                    <Keyboard className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
                    <p className="text-sm text-white/40">Quick actions at your fingertips</p>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/50" />
                </motion.button>
              </div>

              <div className="p-6 grid grid-cols-2 gap-6 max-h-[60vh] overflow-y-auto">
                {shortcuts.map((section, index) => (
                  <motion.div
                    key={section.category}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <h3 className="text-sm font-medium text-indigo-400 mb-3">
                      {section.category}
                    </h3>
                    <div className="space-y-2">
                      {section.items.map((shortcut) => (
                        <div
                          key={`${section.category}:${shortcut.description}`}
                          className="flex items-center justify-between py-2 px-3
                                   rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <span className="text-sm text-white/70">
                            {shortcut.description}
                          </span>
                          <div className="flex items-center gap-1">
                            {shortcut.keys.map((key, keyIndex) => (
                              <React.Fragment key={`${shortcut.description}:${key}`}>
                                <KeyBadge>{key}</KeyBadge>
                                {keyIndex < shortcut.keys.length - 1 && (
                                  <span className="text-white/30 text-xs mx-0.5">+</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div
                className="flex items-center justify-center gap-4 p-4
                            border-t border-white/10 bg-white/2"
              >
                <span className="text-xs text-white/30">
                  Press <KeyBadge>?</KeyBadge> anywhere to show this
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export const useKeyboardShortcutsModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        setIsOpen(true);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
};

export default KeyboardShortcutsModal;
