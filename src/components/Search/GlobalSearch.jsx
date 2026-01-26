import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  X, 
  MessageSquare, 
  FileText,
  Clock,
  ChevronRight,
  Loader2,
  Star,
  Pin
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAppStore } from '../../stores/appStore';

// Debounce hook
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  return debouncedValue;
}

// Highlight matching text
function highlightMatch(text, query) {
  if (!query || !text) return text;
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="bg-accent-primary/30 text-accent-primary rounded px-0.5">
        {part}
      </mark>
    ) : part
  );
}

// Conversation result item
function ConversationResult({ conv, query, isSelected, onClick }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`
        w-full flex items-start gap-3 p-3 rounded-lg text-left
        transition-colors
        ${isSelected ? 'bg-accent-primary/10' : 'hover:bg-glass-2'}
      `}
    >
      <div className="w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center flex-shrink-0">
        <MessageSquare size={16} className="text-accent-primary" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary font-medium truncate">
            {highlightMatch(conv.title || 'Untitled', query)}
          </span>
          {conv.starred === 1 && (
            <Star size={12} className="text-amber-400 flex-shrink-0" fill="currentColor" />
          )}
          {conv.pinned === 1 && (
            <Pin size={12} className="text-accent-primary flex-shrink-0" style={{ transform: 'rotate(45deg)' }} />
          )}
        </div>
        
        {conv.preview && (
          <p className="text-xs text-text-muted truncate mt-0.5">
            {highlightMatch(conv.preview, query)}
          </p>
        )}
        
        <div className="flex items-center gap-2 mt-1">
          <Clock size={10} className="text-text-muted" />
          <span className="text-[10px] text-text-muted">
            {formatDistanceToNow(new Date(conv.updatedAt || conv.updated_at), { addSuffix: true })}
          </span>
        </div>
      </div>
      
      <ChevronRight size={16} className="text-text-muted flex-shrink-0 mt-1" />
    </motion.button>
  );
}

// Message result item
function MessageResult({ message, query, isSelected, onClick }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`
        w-full flex items-start gap-3 p-3 rounded-lg text-left
        transition-colors
        ${isSelected ? 'bg-accent-primary/10' : 'hover:bg-glass-2'}
      `}
    >
      <div className="w-8 h-8 rounded-lg bg-glass-3 flex items-center justify-center flex-shrink-0">
        <FileText size={16} className="text-text-secondary" />
      </div>
      
      <div className="flex-1 min-w-0">
        <span className="text-xs text-text-muted uppercase tracking-wide">
          {message.role === 'user' ? 'You' : 'Assistant'}
        </span>
        
        {/* Show highlight snippet */}
        {message.highlights?.content?.[0] ? (
          <p className="text-sm text-text-secondary mt-0.5">
            {highlightMatch(message.highlights.content[0], query)}
          </p>
        ) : (
          <p className="text-sm text-text-secondary truncate mt-0.5">
            {highlightMatch(message.content?.substring(0, 100), query)}
          </p>
        )}
        
        <div className="flex items-center gap-2 mt-1">
          <Clock size={10} className="text-text-muted" />
          <span className="text-[10px] text-text-muted">
            {message.createdAt && formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>
      
      <ChevronRight size={16} className="text-text-muted flex-shrink-0 mt-1" />
    </motion.button>
  );
}

// Main GlobalSearch component
export function GlobalSearch({ isOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'conversations' | 'messages'
  const inputRef = useRef(null);
  
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const selectConversation = useAppStore(s => s.selectConversation);
  const search = useAppStore(s => s.search);
  const searchResults = useAppStore(s => s.searchResults);
  const isSearching = useAppStore(s => s.isSearching);
  const clearSearch = useAppStore(s => s.clearSearch);
  
  const debouncedQuery = useDebounce(query, 300);
  
  // Perform search when query changes
  useEffect(() => {
    if (debouncedQuery.trim().length >= 2) {
      search(debouncedQuery);
    }
  }, [debouncedQuery, search]);
  
  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setSelectedIndex(0);
      clearSearch();
    }
  }, [isOpen, clearSearch]);
  
  // Get combined results
  const allResults = React.useMemo(() => {
    if (!searchResults) return [];
    
    const results = [];
    
    if (activeTab === 'all' || activeTab === 'conversations') {
      (searchResults.conversations?.results || []).forEach(conv => {
        results.push({ type: 'conversation', data: conv });
      });
    }
    
    if (activeTab === 'all' || activeTab === 'messages') {
      (searchResults.messages?.results || []).forEach(msg => {
        results.push({ type: 'message', data: msg });
      });
    }
    
    return results;
  }, [searchResults, activeTab]);
  
  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, allResults.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (allResults[selectedIndex]) {
            handleSelectResult(allResults[selectedIndex]);
          }
          break;
        case 'Escape':
          onClose();
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, allResults, onClose]);
  
  const handleSelectResult = useCallback((result) => {
    if (result.type === 'conversation') {
      selectConversation(result.data.id);
    } else if (result.type === 'message') {
      // Navigate to the conversation containing this message
      selectConversation(result.data.conversationId);
    }
    onClose();
  }, [selectConversation, onClose]);
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-[15vh]"
      >
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 400 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 p-4 border-b border-forge-border">
            <Search size={20} className="text-accent-primary flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${currentWorkspace}...`}
              className="flex-1 bg-transparent text-text-primary placeholder-text-muted/60 outline-none text-base"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-1 hover:bg-glass-2 rounded-full transition-colors"
              >
                <X size={16} className="text-text-muted" />
              </button>
            )}
            {isSearching && (
              <Loader2 size={16} className="text-accent-primary animate-spin" />
            )}
          </div>
          
          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-forge-border/50">
            {[
              { id: 'all', label: 'All' },
              { id: 'conversations', label: 'Conversations' },
              { id: 'messages', label: 'Messages' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSelectedIndex(0); }}
                className={`
                  px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${activeTab === tab.id 
                    ? 'bg-accent-primary/20 text-accent-primary' 
                    : 'text-text-muted hover:text-text-secondary hover:bg-glass-2'
                  }
                `}
              >
                {tab.label}
                {searchResults && tab.id === 'conversations' && (
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {searchResults.conversations?.total || 0}
                  </span>
                )}
                {searchResults && tab.id === 'messages' && (
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {searchResults.messages?.total || 0}
                  </span>
                )}
              </button>
            ))}
          </div>
          
          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto p-2">
            {allResults.length > 0 ? (
              <div className="space-y-1">
                {allResults.map((result, index) => (
                  result.type === 'conversation' ? (
                    <ConversationResult
                      key={`conv-${result.data.id}`}
                      conv={result.data}
                      query={debouncedQuery}
                      isSelected={index === selectedIndex}
                      onClick={() => handleSelectResult(result)}
                    />
                  ) : (
                    <MessageResult
                      key={`msg-${result.data.id}`}
                      message={result.data}
                      query={debouncedQuery}
                      isSelected={index === selectedIndex}
                      onClick={() => handleSelectResult(result)}
                    />
                  )
                ))}
              </div>
            ) : query.length >= 2 && !isSearching ? (
              <div className="py-12 text-center">
                <Search size={32} className="mx-auto text-text-muted/30 mb-3" />
                <p className="text-sm text-text-muted">No results found</p>
                <p className="text-xs text-text-muted/70 mt-1">
                  Try different keywords or check another workspace
                </p>
              </div>
            ) : (
              <div className="py-12 text-center">
                <Search size={32} className="mx-auto text-text-muted/30 mb-3" />
                <p className="text-sm text-text-muted">
                  {query.length < 2 ? 'Type at least 2 characters to search' : 'Searching...'}
                </p>
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-forge-border/50 text-[10px] text-text-muted">
            <div className="flex items-center gap-3">
              <span><kbd className="px-1 py-0.5 bg-glass-2 rounded">↑↓</kbd> to navigate</span>
              <span><kbd className="px-1 py-0.5 bg-glass-2 rounded">↵</kbd> to select</span>
            </div>
            <span><kbd className="px-1 py-0.5 bg-glass-2 rounded">esc</kbd> to close</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default GlobalSearch;



