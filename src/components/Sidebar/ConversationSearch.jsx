import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  X, 
  Clock, 
  MessageSquare,
  Star,
  Filter,
  ChevronDown,
  FileText,
  Loader2
} from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';

export const ConversationSearch = ({ 
  conversations = [],
  onSelect,
  onFilter,
  className = ''
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [deepResults, setDeepResults] = useState([]); // Results from deep message content search
  const [isDeepSearching, setIsDeepSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  
  const debouncedQuery = useDebounce(query, 200);
  
  // Deep search: search actual message content across all conversations via DB
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 3) {
      setDeepResults([]);
      return;
    }

    let cancelled = false;
    const doDeepSearch = async () => {
      setIsDeepSearching(true);
      try {
        const results = await window.electronAPI?.dbQuery(
          `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, 
                  c.title as conversation_title
           FROM messages m
           JOIN conversations c ON m.conversation_id = c.id
           WHERE m.content LIKE ? 
           ORDER BY m.created_at DESC
           LIMIT 20`,
          [`%${debouncedQuery}%`]
        );
        
        if (!cancelled && results) {
          // Group by conversation and extract snippets
          const grouped = {};
          for (const row of results) {
            if (!grouped[row.conversation_id]) {
              grouped[row.conversation_id] = {
                conversationId: row.conversation_id,
                conversationTitle: row.conversation_title || 'Untitled',
                matches: [],
              };
            }
            // Extract a snippet around the match
            const idx = row.content.toLowerCase().indexOf(debouncedQuery.toLowerCase());
            const start = Math.max(0, idx - 40);
            const end = Math.min(row.content.length, idx + debouncedQuery.length + 60);
            const snippet = (start > 0 ? '...' : '') + row.content.substring(start, end) + (end < row.content.length ? '...' : '');
            
            grouped[row.conversation_id].matches.push({
              id: row.id,
              role: row.role,
              snippet,
              createdAt: row.created_at,
            });
          }
          setDeepResults(Object.values(grouped));
        }
      } catch (e) {
        console.warn('[DeepSearch] Failed:', e);
      }
      if (!cancelled) setIsDeepSearching(false);
    };

    doDeepSearch();
    return () => { cancelled = true; };
  }, [debouncedQuery]);
  
  // Filter conversations based on search query (title/preview search - instant)
  const filteredConversations = conversations.filter(conv => {
    const matchesQuery = !debouncedQuery || 
      conv.title?.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
      conv.preview?.toLowerCase().includes(debouncedQuery.toLowerCase());
    
    const matchesFilter = 
      activeFilter === 'all' ||
      (activeFilter === 'starred' && conv.starred) ||
      (activeFilter === 'recent' && isRecent(conv.updatedAt));
    
    return matchesQuery && matchesFilter;
  });
  
  // Combine title matches + deep matches
  const hasDeepMatches = deepResults.length > 0 && debouncedQuery.length >= 3;
  
  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery, activeFilter]);
  
  // Check if conversation was updated in last 24h
  function isRecent(date) {
    if (!date) return false;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return new Date(date).getTime() > dayAgo;
  }

  // Keyboard navigation within results
  const handleResultKeyDown = useCallback((e) => {
    const totalResults = filteredConversations.length + (hasDeepMatches ? deepResults.length : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, totalResults - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Select the highlighted result
      if (selectedIndex < filteredConversations.length) {
        onSelect?.(filteredConversations[selectedIndex]);
      } else {
        const deepIdx = selectedIndex - filteredConversations.length;
        if (deepResults[deepIdx]) {
          onSelect?.({ id: deepResults[deepIdx].conversationId });
        }
      }
      setIsOpen(false);
      setQuery('');
    }
  }, [filteredConversations, deepResults, hasDeepMatches, selectedIndex, onSelect]);
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsOpen(true);
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setQuery('');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);
  
  const filters = [
    { id: 'all', label: 'All', icon: MessageSquare },
    { id: 'recent', label: 'Recent', icon: Clock },
    { id: 'starred', label: 'Starred', icon: Star },
  ];
  
  return (
    <div className={`relative ${className}`}>
      {/* Search trigger button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        className="w-full flex items-center gap-2 px-3 py-2
                   bg-white/5 hover:bg-white/8 
                   border border-white/10 hover:border-white/20
                   rounded-lg transition-all
                   text-white/50 text-sm"
      >
        <Search className="w-4 h-4" />
        <span className="flex-1 text-left">Search conversations...</span>
        <kbd className="px-1.5 py-0.5 text-[10px] bg-white/5 rounded border border-white/10">
          ⌘F
        </kbd>
      </motion.button>
      
      {/* Search modal */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsOpen(false);
                setQuery('');
              }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            />
            
            {/* Search panel */}
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 w-full max-w-lg z-50"
            >
              <div className="bg-[#0a0a14]/95 backdrop-blur-xl rounded-xl border border-white/10 
                            shadow-2xl shadow-black/50 overflow-hidden">
                {/* Search input */}
                <div className="flex items-center gap-3 p-4 border-b border-white/10">
                  <Search className="w-5 h-5 text-indigo-400" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleResultKeyDown}
                    placeholder="Search conversations and messages..."
                    className="flex-1 bg-transparent text-white placeholder-white/30
                             outline-none text-sm"
                  />
                  {query && (
                    <motion.button
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setQuery('')}
                      className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    >
                      <X className="w-4 h-4 text-white/50" />
                    </motion.button>
                  )}
                </div>
                
                {/* Filters */}
                <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5">
                  {filters.map((filter) => {
                    const Icon = filter.icon;
                    const isActive = activeFilter === filter.id;
                    return (
                      <motion.button
                        key={filter.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setActiveFilter(filter.id)}
                        className={`
                          flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                          transition-all
                          ${isActive 
                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' 
                            : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                          }
                        `}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {filter.label}
                      </motion.button>
                    );
                  })}
                </div>
                
                {/* Results */}
                <div className="max-h-96 overflow-y-auto" ref={resultsRef}>
                  {/* Title/preview matches */}
                  {filteredConversations.length > 0 && (
                    <div className="p-2">
                      {debouncedQuery && (
                        <p className="text-[10px] text-white/30 uppercase tracking-wider px-3 py-1 font-medium">
                          Title matches
                        </p>
                      )}
                      {filteredConversations.slice(0, 8).map((conv, i) => (
                        <motion.button
                          key={conv.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          onClick={() => {
                            onSelect?.(conv);
                            setIsOpen(false);
                            setQuery('');
                          }}
                          className={`w-full flex items-start gap-3 p-3 rounded-lg
                                   transition-colors text-left group
                                   ${selectedIndex === i ? 'bg-indigo-500/15 border border-indigo-500/30' : 'hover:bg-white/5'}`}
                        >
                          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 
                                        flex items-center justify-center flex-shrink-0">
                            <MessageSquare className="w-4 h-4 text-indigo-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white/90 font-medium truncate">
                                {highlightMatch(conv.title || 'Untitled', debouncedQuery)}
                              </span>
                              {conv.starred && (
                                <Star className="w-3 h-3 text-amber-400" fill="currentColor" />
                              )}
                            </div>
                            <p className="text-xs text-white/40 truncate mt-0.5">
                              {conv.preview || 'No messages yet'}
                            </p>
                            <p className="text-[10px] text-white/30 mt-1">
                              {formatDate(conv.updatedAt)}
                            </p>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  )}

                  {/* Deep search results (message content) */}
                  {hasDeepMatches && (
                    <div className="p-2 border-t border-white/5">
                      <p className="text-[10px] text-white/30 uppercase tracking-wider px-3 py-1 font-medium flex items-center gap-1.5">
                        <FileText className="w-3 h-3" />
                        Message content matches
                      </p>
                      {deepResults.map((group, gi) => {
                        const resultIdx = filteredConversations.length + gi;
                        return (
                          <motion.button
                            key={group.conversationId}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: gi * 0.03 + 0.1 }}
                            onClick={() => {
                              onSelect?.({ id: group.conversationId });
                              setIsOpen(false);
                              setQuery('');
                            }}
                            className={`w-full flex items-start gap-3 p-3 rounded-lg
                                     transition-colors text-left group
                                     ${selectedIndex === resultIdx ? 'bg-cyan-500/15 border border-cyan-500/30' : 'hover:bg-white/5'}`}
                          >
                            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 
                                          flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-cyan-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-white/90 font-medium truncate block">
                                {group.conversationTitle}
                              </span>
                              {group.matches.slice(0, 2).map((match, mi) => (
                                <p key={match.id} className="text-xs text-white/40 mt-1 line-clamp-1">
                                  <span className={`text-[10px] px-1 py-0.5 rounded mr-1 ${
                                    match.role === 'user' ? 'bg-violet-500/20 text-violet-300' : 'bg-cyan-500/20 text-cyan-300'
                                  }`}>
                                    {match.role === 'user' ? 'You' : 'AI'}
                                  </span>
                                  {highlightMatch(match.snippet, debouncedQuery)}
                                </p>
                              ))}
                              {group.matches.length > 2 && (
                                <p className="text-[10px] text-white/30 mt-1">
                                  +{group.matches.length - 2} more matches
                                </p>
                              )}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}

                  {/* Deep search loading indicator */}
                  {isDeepSearching && debouncedQuery.length >= 3 && (
                    <div className="flex items-center justify-center gap-2 p-3 border-t border-white/5">
                      <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                      <span className="text-xs text-white/40">Searching message content...</span>
                    </div>
                  )}

                  {/* Empty state */}
                  {filteredConversations.length === 0 && !hasDeepMatches && !isDeepSearching && (
                    <div className="p-8 text-center">
                      <Search className="w-8 h-8 text-white/20 mx-auto mb-3" />
                      <p className="text-sm text-white/40">
                        {query ? 'No matching conversations' : 'Type to search...'}
                      </p>
                      {query && query.length < 3 && (
                        <p className="text-xs text-white/30 mt-1">
                          Type 3+ characters to search message content
                        </p>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Footer hint */}
                <div className="flex items-center justify-between px-4 py-2 
                              border-t border-white/5 text-[10px] text-white/30">
                  <div className="flex items-center gap-3">
                    <span>↑↓ navigate</span>
                    <span>↵ select</span>
                  </div>
                  <span>esc to close</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// Helper to highlight matching text
function highlightMatch(text, query) {
  if (!query) return text;
  
  const regex = new RegExp(`(${query})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="bg-indigo-500/30 text-indigo-300 rounded px-0.5">
        {part}
      </mark>
    ) : part
  );
}

// Format relative date
function formatDate(date) {
  if (!date) return '';
  
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return d.toLocaleDateString();
}

export default ConversationSearch;






