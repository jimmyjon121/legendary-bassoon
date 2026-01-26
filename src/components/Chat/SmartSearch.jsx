import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Clock, 
  MessageSquare, 
  Lightbulb, 
  Heart,
  Calendar,
  Tag,
  User,
  Bot,
  Star,
  ArrowRight,
  X,
  Sparkles,
  TrendingUp,
  Eye,
  Bookmark,
  Brain,
  Target
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow, subDays } from 'date-fns';
import { useAppStore } from '../../stores/appStore';
import { useCasualStore } from '../../stores/casualStore';
import conversationEngine from '../../services/conversationEngine';

const SEARCH_MODES = [
  { id: 'semantic', name: 'Semantic', description: 'Understand meaning and context', icon: Brain },
  { id: 'keyword', name: 'Keyword', description: 'Exact word matching', icon: Search },
  { id: 'topic', name: 'Topic', description: 'Search by conversation topics', icon: Lightbulb },
  { id: 'mood', name: 'Mood', description: 'Find conversations by emotional tone', icon: Heart },
  { id: 'timeline', name: 'Timeline', description: 'Search by date and time', icon: Clock },
];

const QUICK_SEARCHES = [
  { query: 'creative ideas', icon: Sparkles, color: 'text-purple-400' },
  { query: 'technical questions', icon: MessageSquare, color: 'text-blue-400' },
  { query: 'personal insights', icon: Heart, color: 'text-pink-400' },
  { query: 'problem solving', icon: Target, color: 'text-green-400' },
  { query: 'recent discussions', icon: Clock, color: 'text-orange-400' },
];

export function SmartSearch({ isOpen, onClose, onSelectResult }) {
  const { conversations } = useAppStore();
  const { conversationIndex } = useCasualStore();
  
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState('semantic');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [filters, setFilters] = useState({
    timeRange: 'all',
    mood: 'all',
    minLength: 0,
    hasTopics: false,
  });
  const [selectedResult, setSelectedResult] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);

  const inputRef = useRef(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Perform search
  const performSearch = useCallback(async (searchQuery = query) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);

    try {
      // Process all conversations for search
      const searchableConversations = conversations.map(conv => {
        const metadata = conversationIndex[conv.id] || {};
        const topics = metadata.topics || conversationEngine.extractTopics(conv.messages || [], { maxTopics: 5 });
        const mood = metadata.mood || conversationEngine.analyzeConversationMood(conv.messages || []).overall;
        const summary = conversationEngine.generateConversationSummary(conv.messages || []);
        
        return {
          ...conv,
          topics,
          mood,
          summary,
          messageCount: (conv.messages || []).length,
          allText: (conv.messages || []).map(m => m.content).join(' ').toLowerCase(),
        };
      });

      // Apply filters
      let filtered = searchableConversations;

      // Time filter
      if (filters.timeRange !== 'all') {
        const cutoff = getTimeRangeCutoff(filters.timeRange);
        filtered = filtered.filter(conv => 
          new Date(conv.updated_at || conv.created_at || 0) >= cutoff
        );
      }

      // Mood filter
      if (filters.mood !== 'all') {
        filtered = filtered.filter(conv => conv.mood === filters.mood);
      }

      // Length filter
      if (filters.minLength > 0) {
        filtered = filtered.filter(conv => conv.messageCount >= filters.minLength);
      }

      // Topics filter
      if (filters.hasTopics) {
        filtered = filtered.filter(conv => conv.topics && conv.topics.length > 0);
      }

      // Perform search based on mode
      const searchResults = await searchByMode(searchQuery, filtered, searchMode);

      setResults(searchResults);
      
      // Add to search history
      if (searchQuery.trim() && !searchHistory.includes(searchQuery.trim())) {
        setSearchHistory(prev => [searchQuery.trim(), ...prev].slice(0, 10));
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [query, conversations, conversationIndex, filters, searchMode, searchHistory]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        performSearch();
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const handleQuickSearch = (quickQuery) => {
    setQuery(quickQuery);
    performSearch(quickQuery);
  };

  const handleResultClick = (result) => {
    setSelectedResult(result);
    onSelectResult?.(result);
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-4xl h-[80vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-forge-border">
          <div className="flex items-center gap-3">
            <Search size={20} className="text-workspace-casual" />
            <h2 className="text-lg font-semibold text-text-primary">Smart Search</h2>
            <span className="text-sm text-text-muted">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Search Input */}
        <div className="p-4 border-b border-forge-border/50 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  performSearch();
                } else if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="Search your conversations..."
              className="w-full pl-10 pr-4 py-2 bg-forge-bg border border-forge-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-workspace-casual/50"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: 9999, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-workspace-casual border-t-transparent rounded-full"
                />
              </div>
            )}
          </div>

          {/* Search modes */}
          <div className="flex gap-2 overflow-x-auto">
            {SEARCH_MODES.map((mode) => {
              const Icon = mode.icon;
              const isActive = searchMode === mode.id;
              
              return (
                <button
                  key={mode.id}
                  onClick={() => setSearchMode(mode.id)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-workspace-casual/20 text-workspace-casual border border-workspace-casual/30'
                      : 'bg-forge-bg hover:bg-forge-elevated text-text-muted hover:text-text-primary border border-forge-border/30'
                  }`}
                  title={mode.description}
                >
                  <Icon size={12} />
                  {mode.name}
                </button>
              );
            })}
          </div>

          {/* Quick searches */}
          {!query && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-text-muted">Quick searches:</span>
              {QUICK_SEARCHES.map((quick) => {
                const Icon = quick.icon;
                
                return (
                  <button
                    key={quick.query}
                    onClick={() => handleQuickSearch(quick.query)}
                    className="flex items-center gap-1 px-2 py-1 bg-forge-elevated hover:bg-forge-hover rounded text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    <Icon size={10} className={quick.color} />
                    {quick.query}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {query && results.length === 0 && !isSearching ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Search size={48} className="text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No results found</h3>
              <p className="text-sm text-text-muted max-w-md">
                Try adjusting your search query or switching to a different search mode.
              </p>
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              {results.map((result) => (
                <SearchResultCard
                  key={result.id}
                  result={result}
                  query={query}
                  onClick={() => handleResultClick(result)}
                  onBookmark={() => {
                    // Bookmark conversation
                  }}
                />
              ))}
            </div>
          ) : !query ? (
            <div className="space-y-4">
              {/* Recent searches */}
              {searchHistory.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                    <Clock size={14} />
                    Recent Searches
                  </h3>
                  <div className="space-y-1">
                    {searchHistory.map((historyQuery, index) => (
                      <button
                        key={index}
                        onClick={() => setQuery(historyQuery)}
                        className="w-full text-left px-3 py-2 bg-forge-bg/50 hover:bg-forge-elevated rounded text-sm text-text-muted hover:text-text-primary transition-colors"
                      >
                        {historyQuery}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Search tips */}
              <div>
                <h3 className="text-sm font-medium text-text-primary mb-2">Search Tips</h3>
                <div className="space-y-2 text-xs text-text-muted">
                  <p>• Use <strong>semantic search</strong> to find conversations by meaning</p>
                  <p>• Try <strong>topic search</strong> to explore specific subjects</p>
                  <p>• Use <strong>mood search</strong> to find conversations by emotional tone</p>
                  <p>• <strong>Timeline search</strong> helps you find conversations from specific periods</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SearchResultCard({ result, query, onClick, onBookmark }) {
  const [isHovered, setIsHovered] = useState(false);

  // Highlight search terms in text
  const highlightText = (text, searchQuery) => {
    if (!searchQuery || !text) return text;
    
    const regex = new RegExp(`(${searchQuery})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <mark key={index} className="bg-workspace-casual/30 text-workspace-casual rounded px-0.5">
          {part}
        </mark>
      ) : part
    );
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="p-4 bg-forge-bg/50 border border-forge-border hover:border-forge-hover rounded-lg cursor-pointer transition-all"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start gap-3">
        {/* Result icon */}
        <div className="p-2 rounded bg-forge-elevated flex-shrink-0">
          <MessageSquare size={16} className="text-workspace-casual" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="text-sm font-medium text-text-primary line-clamp-2">
              {highlightText(result.title || result.summary, query)}
            </h3>
            <div className="flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
              <Clock size={10} />
              <span>{formatDistanceToNow(new Date(result.lastActivity || result.updated_at || 0), { addSuffix: true })}</span>
            </div>
          </div>

          {/* Excerpt */}
          {result.excerpt && (
            <p className="text-sm text-text-secondary mb-2 line-clamp-2">
              {highlightText(result.excerpt, query)}
            </p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <MessageSquare size={10} />
              {result.messageCount} messages
            </span>
            
            {result.topics && result.topics.length > 0 && (
              <span className="flex items-center gap-1">
                <Lightbulb size={10} />
                {result.topics.slice(0, 2).map(t => t.name || t).join(', ')}
              </span>
            )}
            
            {result.mood && result.mood !== 'neutral' && (
              <span className={`flex items-center gap-1 ${
                result.mood === 'positive' ? 'text-green-400' : 'text-red-400'
              }`}>
                <Heart size={10} />
                {result.mood}
              </span>
            )}

            {result.relevance && (
              <span className="flex items-center gap-1 text-workspace-casual">
                <TrendingUp size={10} />
                {Math.round(result.relevance * 100)}% match
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-1"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onBookmark(result);
                }}
                className="p-1 rounded text-text-muted hover:text-yellow-400 transition-colors"
                title="Bookmark"
              >
                <Bookmark size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(result);
                }}
                className="p-1 rounded text-text-muted hover:text-workspace-casual transition-colors"
                title="Open conversation"
              >
                <ArrowRight size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Search implementation by mode
async function searchByMode(query, conversations, mode) {
  const results = [];
  const searchQuery = query.toLowerCase().trim();

  switch (mode) {
    case 'semantic':
      // Semantic search - find conversations by meaning
      results.push(...semanticSearch(searchQuery, conversations));
      break;
      
    case 'keyword':
      // Keyword search - exact matches
      results.push(...keywordSearch(searchQuery, conversations));
      break;
      
    case 'topic':
      // Topic search - search within extracted topics
      results.push(...topicSearch(searchQuery, conversations));
      break;
      
    case 'mood':
      // Mood search - find by emotional tone
      results.push(...moodSearch(searchQuery, conversations));
      break;
      
    case 'timeline':
      // Timeline search - date/time based
      results.push(...timelineSearch(searchQuery, conversations));
      break;
  }

  return results.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
}

function semanticSearch(query, conversations) {
  // Simple semantic search using topic similarity and content analysis
  return conversations
    .map(conv => {
      let relevance = 0;
      
      // Check topic similarity
      const queryTopics = conversationEngine.extractTopics([{ content: query }], { maxTopics: 3 });
      const convTopics = conv.topics || [];
      
      queryTopics.forEach(qTopic => {
        convTopics.forEach(cTopic => {
          if ((qTopic.name || qTopic).includes(cTopic.name || cTopic) || 
              (cTopic.name || cTopic).includes(qTopic.name || qTopic)) {
            relevance += 0.3;
          }
        });
      });
      
      // Check content similarity
      if (conv.allText.includes(query)) {
        relevance += 0.5;
      }
      
      // Check summary similarity
      if ((conv.summary || '').toLowerCase().includes(query)) {
        relevance += 0.4;
      }
      
      return { ...conv, relevance, searchType: 'semantic' };
    })
    .filter(conv => conv.relevance > 0.1);
}

function keywordSearch(query, conversations) {
  return conversations
    .filter(conv => conv.allText.includes(query) || (conv.summary || '').toLowerCase().includes(query))
    .map(conv => {
      // Calculate relevance based on frequency and position
      const matches = (conv.allText.match(new RegExp(query, 'g')) || []).length;
      const relevance = Math.min(1, matches / 10);
      
      return { 
        ...conv, 
        relevance,
        searchType: 'keyword',
        excerpt: extractExcerpt(conv.allText, query),
      };
    });
}

function topicSearch(query, conversations) {
  return conversations
    .filter(conv => 
      (conv.topics || []).some(topic => 
        (topic.name || topic).toLowerCase().includes(query)
      )
    )
    .map(conv => {
      const matchingTopics = (conv.topics || []).filter(topic => 
        (topic.name || topic).toLowerCase().includes(query)
      );
      
      const relevance = matchingTopics.length / Math.max(1, (conv.topics || []).length);
      
      return { 
        ...conv, 
        relevance,
        searchType: 'topic',
        matchingTopics: matchingTopics.map(t => t.name || t),
      };
    });
}

function moodSearch(query, conversations) {
  const moodQuery = query.toLowerCase();
  const moodKeywords = {
    positive: ['happy', 'good', 'great', 'positive', 'excited', 'joy'],
    negative: ['sad', 'bad', 'negative', 'frustrated', 'angry', 'disappointed'],
    neutral: ['neutral', 'calm', 'balanced', 'objective'],
  };
  
  let targetMood = null;
  Object.entries(moodKeywords).forEach(([mood, keywords]) => {
    if (keywords.some(keyword => moodQuery.includes(keyword))) {
      targetMood = mood;
    }
  });
  
  if (!targetMood) return [];
  
  return conversations
    .filter(conv => conv.mood === targetMood)
    .map(conv => ({ 
      ...conv, 
      relevance: 0.8,
      searchType: 'mood',
    }));
}

function timelineSearch(query, conversations) {
  // Simple date parsing for timeline search
  const dateKeywords = {
    today: () => new Date(),
    yesterday: () => subDays(new Date(), 1),
    'last week': () => subDays(new Date(), 7),
    'last month': () => subDays(new Date(), 30),
  };
  
  let targetDate = null;
  Object.entries(dateKeywords).forEach(([keyword, dateFunc]) => {
    if (query.toLowerCase().includes(keyword)) {
      targetDate = dateFunc();
    }
  });
  
  if (!targetDate) return [];
  
  const dayMs = 24 * 60 * 60 * 1000;
  
  return conversations
    .filter(conv => {
      const convDate = new Date(conv.updated_at || conv.created_at || 0);
      return Math.abs(convDate - targetDate) < dayMs;
    })
    .map(conv => ({ 
      ...conv, 
      relevance: 0.9,
      searchType: 'timeline',
    }));
}

function extractExcerpt(text, query, contextLength = 80) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text.substring(0, contextLength) + '...';
  
  const start = Math.max(0, index - contextLength / 2);
  const end = Math.min(text.length, index + query.length + contextLength / 2);
  
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt = excerpt + '...';
  
  return excerpt;
}

function getTimeRangeCutoff(range) {
  const now = new Date();
  switch (range) {
    case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week': return subDays(now, 7);
    case 'month': return subDays(now, 30);
    case 'quarter': return subDays(now, 90);
    default: return new Date(0);
  }
}

export default SmartSearch;
