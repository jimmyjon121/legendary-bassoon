import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  X, 
  Clock, 
  MessageSquare,
  Star,
  Filter,
  ChevronDown
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
  const inputRef = useRef(null);
  
  const debouncedQuery = useDebounce(query, 200);
  
  // Filter conversations based on search query
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
  
  // Check if conversation was updated in last 24h
  function isRecent(date) {
    if (!date) return false;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return new Date(date).getTime() > dayAgo;
  }
  
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
                    placeholder="Search in conversations..."
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
                <div className="max-h-80 overflow-y-auto">
                  {filteredConversations.length > 0 ? (
                    <div className="p-2">
                      {filteredConversations.slice(0, 10).map((conv, i) => (
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
                          className="w-full flex items-start gap-3 p-3 rounded-lg
                                   hover:bg-white/5 transition-colors text-left group"
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
                  ) : (
                    <div className="p-8 text-center">
                      <Search className="w-8 h-8 text-white/20 mx-auto mb-3" />
                      <p className="text-sm text-white/40">
                        {query ? 'No matching conversations' : 'Type to search...'}
                      </p>
                    </div>
                  )}
                </div>
                
                {/* Footer hint */}
                <div className="flex items-center justify-between px-4 py-2 
                              border-t border-white/5 text-[10px] text-white/30">
                  <span>↵ to select</span>
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






