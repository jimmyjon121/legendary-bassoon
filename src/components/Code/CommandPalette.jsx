import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Search, FileText, Terminal, GitBranch, Bot,
  Save, FolderOpen, RefreshCw, Zap, Code, Bug,
  FileSearch, Replace, Palette, Keyboard, HelpCircle
} from 'lucide-react';

const COMMANDS = [
  // File commands
  { id: 'file.open', label: 'Open File', icon: FileText, category: 'File', shortcut: 'Ctrl+O' },
  { id: 'file.save', label: 'Save File', icon: Save, category: 'File', shortcut: 'Ctrl+S' },
  { id: 'file.openProject', label: 'Open Project Folder', icon: FolderOpen, category: 'File', shortcut: 'Ctrl+Shift+O' },
  
  // Editor commands
  { id: 'editor.find', label: 'Find in File', icon: Search, category: 'Editor', shortcut: 'Ctrl+F' },
  { id: 'editor.replace', label: 'Find and Replace', icon: Replace, category: 'Editor', shortcut: 'Ctrl+H' },
  { id: 'editor.findInFiles', label: 'Find in All Files', icon: FileSearch, category: 'Editor', shortcut: 'Ctrl+Shift+F' },
  
  // Agent commands
  { id: 'agent.suggest', label: 'Get AI Suggestions', icon: Zap, category: 'Agent', shortcut: 'Ctrl+.' },
  { id: 'agent.explain', label: 'Explain Code', icon: HelpCircle, category: 'Agent' },
  { id: 'agent.refactor', label: 'Refactor Code', icon: Code, category: 'Agent' },
  { id: 'agent.findBugs', label: 'Find Bugs', icon: Bug, category: 'Agent' },
  { id: 'agent.plan', label: 'Plan Feature', icon: Bot, category: 'Agent' },
  
  // Project commands
  { id: 'project.refresh', label: 'Refresh Project', icon: RefreshCw, category: 'Project' },
  { id: 'project.index', label: 'Re-index Code', icon: FileSearch, category: 'Project' },
  { id: 'project.terminal', label: 'Toggle Terminal', icon: Terminal, category: 'Project', shortcut: 'Ctrl+`' },
  
  // Git commands
  { id: 'git.status', label: 'Git Status', icon: GitBranch, category: 'Git' },
  { id: 'git.commit', label: 'Git Commit', icon: GitBranch, category: 'Git' },
  { id: 'git.push', label: 'Git Push', icon: GitBranch, category: 'Git' },
  
  // Settings
  { id: 'settings.models', label: 'Manage Models', icon: Bot, category: 'Settings' },
  { id: 'settings.theme', label: 'Change Theme', icon: Palette, category: 'Settings' },
  { id: 'settings.shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard, category: 'Settings' },
];

export function CommandPalette({ isOpen, onClose, onCommand }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filteredCommands = COMMANDS.filter(cmd => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q)
    );
  });

  // Group by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {});

  // Flatten for navigation
  const flatCommands = Object.values(groupedCommands).flat();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatCommands[selectedIndex]) {
        onCommand(flatCommands[selectedIndex].id);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [flatCommands, selectedIndex, onCommand, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedEl = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  let commandIndex = 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50" onClick={onClose}>
      <div 
        className="bg-forge-surface border border-forge-border rounded-xl w-[550px] max-h-[60vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 p-3 border-b border-forge-border">
          <Search size={18} className="text-forge-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-forge-text placeholder:text-forge-text-muted/50 focus:outline-none"
            autoFocus
          />
          <kbd className="px-1.5 py-0.5 bg-forge-bg rounded text-xs text-forge-text-muted">ESC</kbd>
        </div>

        {/* Commands list */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {flatCommands.length === 0 ? (
            <p className="text-center text-forge-text-muted py-8">No commands found</p>
          ) : (
            Object.entries(groupedCommands).map(([category, commands]) => (
              <div key={category} className="mb-2">
                <p className="text-xs text-forge-text-muted px-2 py-1 uppercase tracking-wider">{category}</p>
                {commands.map((cmd) => {
                  const index = commandIndex++;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      data-index={index}
                      onClick={() => {
                        onCommand(cmd.id);
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left ${
                        index === selectedIndex 
                          ? 'bg-workspace-code/20 text-workspace-code' 
                          : 'text-forge-text hover:bg-forge-bg/50'
                      }`}
                    >
                      <Icon size={16} className={index === selectedIndex ? 'text-workspace-code' : 'text-forge-text-muted'} />
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="px-1.5 py-0.5 bg-forge-bg rounded text-xs text-forge-text-muted">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="p-2 border-t border-forge-border bg-forge-bg/30">
          <p className="text-xs text-forge-text-muted text-center">
            <kbd className="px-1 bg-forge-bg rounded">↑↓</kbd> navigate • 
            <kbd className="px-1 bg-forge-bg rounded ml-2">Enter</kbd> select • 
            <kbd className="px-1 bg-forge-bg rounded ml-2">Esc</kbd> close
          </p>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;












