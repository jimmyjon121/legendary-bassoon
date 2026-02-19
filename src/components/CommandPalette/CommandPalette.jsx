import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, Command, MessageSquare, Settings, Plus, 
  Folder, Star, Moon, Sun, Trash2, Archive, Copy,
  Download, Upload, Keyboard, Palette, Zap, Brain,
  Code, FileText, Image, Terminal, RefreshCw, X,
  ChevronRight, Clock, Hash
} from 'lucide-react';

/**
 * Fuzzy match function for search
 */
function fuzzyMatch(query, text) {
  if (!query) return { match: true, score: 0, indices: [] };
  
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  // Exact match gets highest score
  if (textLower.includes(queryLower)) {
    const index = textLower.indexOf(queryLower);
    const indices = Array.from({ length: query.length }, (_, i) => index + i);
    return { match: true, score: 100 - index, indices };
  }
  
  // Fuzzy match
  let queryIndex = 0;
  let score = 0;
  const indices = [];
  
  for (let i = 0; i < text.length && queryIndex < query.length; i++) {
    if (textLower[i] === queryLower[queryIndex]) {
      indices.push(i);
      score += 10 - Math.min(i, 9); // Higher score for earlier matches
      queryIndex++;
    }
  }
  
  const match = queryIndex === query.length;
  return { match, score: match ? score : 0, indices };
}

/**
 * Default command definitions
 */
const DEFAULT_COMMANDS = [
  // Conversations
  { id: 'new-conversation', name: 'New Conversation', icon: Plus, category: 'Conversations', shortcut: 'Ctrl+N', action: 'newConversation' },
  { id: 'search-conversations', name: 'Search Conversations', icon: Search, category: 'Conversations', shortcut: 'Ctrl+F', action: 'searchConversations' },
  { id: 'starred-conversations', name: 'Show Starred', icon: Star, category: 'Conversations', action: 'showStarred' },
  { id: 'archived-conversations', name: 'Show Archived', icon: Archive, category: 'Conversations', action: 'showArchived' },
  
  // Workspaces
  { id: 'switch-casual', name: 'Switch to Casual', icon: MessageSquare, category: 'Workspaces', shortcut: 'Ctrl+1', action: 'switchWorkspace', params: { workspace: 'casual' } },
  { id: 'switch-work', name: 'Switch to Work', icon: Folder, category: 'Workspaces', shortcut: 'Ctrl+2', action: 'switchWorkspace', params: { workspace: 'work' } },
  { id: 'switch-code', name: 'Switch to Code', icon: Code, category: 'Workspaces', shortcut: 'Ctrl+3', action: 'switchWorkspace', params: { workspace: 'code' } },
  { id: 'switch-private', name: 'Switch to Private', icon: FileText, category: 'Workspaces', shortcut: 'Ctrl+4', action: 'switchWorkspace', params: { workspace: 'nsfw' } },
  
  // Models
  { id: 'switch-model', name: 'Switch Model', icon: Brain, category: 'Models', shortcut: 'Ctrl+M', action: 'switchModel' },
  { id: 'model-settings', name: 'Model Settings', icon: Settings, category: 'Models', action: 'modelSettings' },
  { id: 'download-model', name: 'Download New Model', icon: Download, category: 'Models', action: 'downloadModel' },
  
  // View
  { id: 'toggle-theme', name: 'Toggle Dark/Light', icon: Moon, category: 'View', shortcut: 'Ctrl+Shift+T', action: 'toggleTheme' },
  { id: 'toggle-sidebar', name: 'Toggle Sidebar', icon: ChevronRight, category: 'View', shortcut: 'Ctrl+B', action: 'toggleSidebar' },
  { id: 'focus-mode', name: 'Focus Mode', icon: Zap, category: 'View', shortcut: 'Ctrl+Shift+F', action: 'focusMode' },
  
  // Tools
  { id: 'export-chat', name: 'Export Conversation', icon: Download, category: 'Tools', action: 'exportConversation' },
  { id: 'import-chat', name: 'Import Conversation', icon: Upload, category: 'Tools', action: 'importConversation' },
  { id: 'prompt-library', name: 'Prompt Library', icon: FileText, category: 'Tools', shortcut: 'Ctrl+Shift+L', action: 'promptLibrary' },
  { id: 'terminal', name: 'Open Terminal', icon: Terminal, category: 'Tools', shortcut: 'Ctrl+`', action: 'openTerminal' },
  
  // Settings
  { id: 'open-settings', name: 'Open Settings', icon: Settings, category: 'Settings', shortcut: 'Ctrl+,', action: 'openSettings' },
  { id: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', icon: Keyboard, category: 'Settings', shortcut: '?', action: 'showShortcuts' },
  { id: 'appearance', name: 'Appearance Settings', icon: Palette, category: 'Settings', action: 'appearanceSettings' },
  { id: 'animation-demo', name: 'Animation Showcase', icon: Zap, category: 'Settings', shortcut: 'Ctrl+Shift+A', action: 'animationShowcase' },
  
  // System
  { id: 'reload', name: 'Reload App', icon: RefreshCw, category: 'System', shortcut: 'Ctrl+R', action: 'reload' },
  { id: 'clear-cache', name: 'Clear Cache', icon: Trash2, category: 'System', action: 'clearCache' },
];

/**
 * CommandPalette - Global command launcher with fuzzy search
 */
export function CommandPalette({ 
  isOpen, 
  onClose, 
  onCommand,
  customCommands = [],
  recentCommands = []
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Combine default and custom commands
  const allCommands = useMemo(() => {
    return [...DEFAULT_COMMANDS, ...customCommands];
  }, [customCommands]);

  // Filter and sort commands based on query
  const filteredCommands = useMemo(() => {
    if (!query) {
      // Show recent commands first, then all commands
      const recent = recentCommands
        .map(id => allCommands.find(c => c.id === id))
        .filter(Boolean)
        .slice(0, 5);
      
      const rest = allCommands.filter(c => !recentCommands.includes(c.id));
      
      return [
        ...(recent.length > 0 ? [{ type: 'section', name: 'Recent' }] : []),
        ...recent,
        { type: 'section', name: 'All Commands' },
        ...rest
      ];
    }

    // Fuzzy search
    const results = allCommands
      .map(cmd => {
        const nameMatch = fuzzyMatch(query, cmd.name);
        const categoryMatch = fuzzyMatch(query, cmd.category);
        const score = Math.max(nameMatch.score * 2, categoryMatch.score);
        return { ...cmd, match: nameMatch.match || categoryMatch.match, score, indices: nameMatch.indices };
      })
      .filter(cmd => cmd.match)
      .sort((a, b) => b.score - a.score);

    return results;
  }, [query, allCommands, recentCommands]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector('[data-selected="true"]');
      selectedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    const commandItems = filteredCommands.filter(c => c.type !== 'section');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, commandItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter': {
        e.preventDefault();
        const selected = commandItems[selectedIndex];
        if (selected) {
          executeCommand(selected);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filteredCommands, selectedIndex, onClose]);

  // Execute a command
  const executeCommand = useCallback((command) => {
    onClose();
    onCommand?.(command.action, command.params, command);
  }, [onClose, onCommand]);

  // Highlight matching characters
  const highlightMatch = (text, indices) => {
    if (!indices || indices.length === 0) return text;
    
    return text.split('').map((char, i) => (
      indices.includes(i) 
        ? <span key={i} className="text-[var(--ws-primary)] font-semibold">{char}</span>
        : char
    ));
  };

  if (!isOpen) return null;

  // Separate sections from commands
  let commandIndex = -1;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-xl bg-[#0a0a14] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ scale: 0.95, opacity: 0, y: -20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: -20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
            <Command size={20} className="text-[var(--ws-primary)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent text-white placeholder-white/40 outline-none text-lg"
            />
            <kbd className="px-2 py-1 bg-white/5 rounded text-xs text-white/40 border border-white/10">
              esc
            </kbd>
          </div>

          {/* Command List */}
          <div 
            ref={listRef}
            className="max-h-[400px] overflow-y-auto py-2"
          >
            {filteredCommands.length === 0 ? (
              <div className="px-4 py-8 text-center text-white/40">
                <Search size={32} className="mx-auto mb-2 opacity-50" />
                <p>No commands found</p>
              </div>
            ) : (
              filteredCommands.map((item, index) => {
                if (item.type === 'section') {
                  return (
                    <div 
                      key={`section-${item.name}`}
                      className="px-4 py-2 text-xs text-white/40 uppercase tracking-wider"
                    >
                      {item.name}
                    </div>
                  );
                }

                commandIndex++;
                const isSelected = commandIndex === selectedIndex;
                const Icon = item.icon || Command;

                return (
                  <motion.button
                    key={item.id}
                    data-selected={isSelected}
                    onClick={() => executeCommand(item)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isSelected 
                        ? 'bg-[var(--ws-primary)]/20 text-white' 
                        : 'text-white/70 hover:bg-white/5'
                    }`}
                    initial={false}
                    animate={{ x: isSelected ? 4 : 0 }}
                  >
                    <Icon size={18} className={isSelected ? 'text-[var(--ws-primary)]' : 'text-white/50'} />
                    
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {highlightMatch(item.name, item.indices)}
                      </div>
                      <div className="text-xs text-white/40 truncate">
                        {item.category}
                      </div>
                    </div>

                    {item.shortcut && (
                      <kbd className="px-2 py-1 bg-white/5 rounded text-xs text-white/50 border border-white/10 whitespace-nowrap">
                        {item.shortcut}
                      </kbd>
                    )}
                  </motion.button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 bg-white/5 text-xs text-white/40">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded">↵</kbd>
                select
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Hash size={12} />
              <span>{filteredCommands.filter(c => c.type !== 'section').length} commands</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Hook to manage command palette state
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [recentCommands, setRecentCommands] = useState([]);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  const recordCommand = useCallback((commandId) => {
    setRecentCommands(prev => {
      const filtered = prev.filter(id => id !== commandId);
      return [commandId, ...filtered].slice(0, 10);
    });
  }, []);

  return {
    isOpen,
    open,
    close,
    toggle,
    recentCommands,
    recordCommand
  };
}

export default CommandPalette;
