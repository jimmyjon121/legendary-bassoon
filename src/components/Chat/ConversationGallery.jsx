import React, { useState, useMemo, useEffect } from 'react';
import { 
  Grid, 
  List, 
  Search, 
  Filter, 
  Clock, 
  MessageSquare, 
  Star,
  Trash2,
  MoreHorizontal,
  Calendar,
  Tag,
  Brain,
  Heart,
  Lightbulb,
  Zap,
  Archive,
  Pin,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow, format } from 'date-fns';
import { useAppStore } from '../../stores/appStore';
import { useCasualStore } from '../../stores/casualStore';
import conversationEngine from '../../services/conversationEngine';

const VIEW_MODES = [
  { id: 'grid', icon: Grid, label: 'Grid' },
  { id: 'list', icon: List, label: 'List' },
];

const SORT_OPTIONS = [
  { id: 'recent', label: 'Most Recent', icon: Clock },
  { id: 'activity', label: 'Most Active', icon: MessageSquare },
  { id: 'bookmarked', label: 'Bookmarked', icon: Star },
  { id: 'alphabetical', label: 'Alphabetical', icon: Tag },
];

const FILTER_OPTIONS = [
  { id: 'all', label: 'All Conversations', count: 0 },
  { id: 'today', label: 'Today', count: 0 },
  { id: 'week', label: 'This Week', count: 0 },
  { id: 'month', label: 'This Month', count: 0 },
  { id: 'bookmarked', label: 'Bookmarked', count: 0 },
  { id: 'archived', label: 'Archived', count: 0 },
];

export function ConversationGallery({ 
  conversations = [], 
  onSelectConversation,
  onDeleteConversation,
  onArchiveConversation,
  className = ''
}) {
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('recent');
  const [filterBy, setFilterBy] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedConversations, setSelectedConversations] = useState(new Set());
  const [hoveredConversation, setHoveredConversation] = useState(null);

  // Process conversations with metadata
  const processedConversations = useMemo(() => {
    return conversations.map(conv => {
      const topics = conversationEngine.extractTopics(conv.messages || [], { maxTopics: 3 });
      const summary = conversationEngine.generateConversationSummary(conv.messages || []);
      const mood = conversationEngine.analyzeConversationMood(conv.messages || []);
      
      return {
        ...conv,
        topics,
        summary,
        mood: mood.overall,
        messageCount: (conv.messages || []).length,
        lastActivity: conv.updated_at || conv.created_at,
        thumbnail: generateThumbnail(conv, topics, mood),
      };
    });
  }, [conversations]);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    let filtered = processedConversations;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(conv => 
        conv.title?.toLowerCase().includes(query) ||
        conv.summary?.toLowerCase().includes(query) ||
        conv.topics?.some(topic => topic.name?.toLowerCase().includes(query))
      );
    }

    // Apply time filter
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    switch (filterBy) {
      case 'today':
        filtered = filtered.filter(conv => new Date(conv.lastActivity) >= today);
        break;
      case 'week':
        filtered = filtered.filter(conv => new Date(conv.lastActivity) >= weekAgo);
        break;
      case 'month':
        filtered = filtered.filter(conv => new Date(conv.lastActivity) >= monthAgo);
        break;
      case 'bookmarked':
        filtered = filtered.filter(conv => conv.bookmarked);
        break;
      case 'archived':
        filtered = filtered.filter(conv => conv.archived);
        break;
    }

    // Apply sorting
    switch (sortBy) {
      case 'recent':
        filtered.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
        break;
      case 'activity':
        filtered.sort((a, b) => b.messageCount - a.messageCount);
        break;
      case 'alphabetical':
        filtered.sort((a, b) => (a.title || a.summary).localeCompare(b.title || b.summary));
        break;
      case 'bookmarked':
        filtered.sort((a, b) => (b.bookmarked ? 1 : 0) - (a.bookmarked ? 1 : 0));
        break;
    }

    return filtered;
  }, [processedConversations, searchQuery, filterBy, sortBy]);

  // Update filter counts
  const filterCounts = useMemo(() => {
    const counts = { ...FILTER_OPTIONS.reduce((acc, opt) => ({ ...acc, [opt.id]: 0 }), {}) };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    processedConversations.forEach(conv => {
      counts.all++;
      if (new Date(conv.lastActivity) >= today) counts.today++;
      if (new Date(conv.lastActivity) >= weekAgo) counts.week++;
      if (new Date(conv.lastActivity) >= monthAgo) counts.month++;
      if (conv.bookmarked) counts.bookmarked++;
      if (conv.archived) counts.archived++;
    });

    return counts;
  }, [processedConversations]);

  function generateThumbnail(conversation, topics, mood) {
    // Generate a visual representation of the conversation
    const colors = {
      positive: 'from-green-400/20 to-blue-400/20',
      negative: 'from-red-400/20 to-orange-400/20',
      neutral: 'from-gray-400/20 to-gray-600/20',
    };
    
    const topicIcons = {
      technology: Brain,
      creative: Lightbulb,
      personal: Heart,
      analytical: Zap,
    };
    
    const primaryTopic = topics[0];
    const TopicIcon = primaryTopic ? topicIcons[primaryTopic.category] || MessageSquare : MessageSquare;
    
    return {
      gradient: colors[mood.overall] || colors.neutral,
      icon: TopicIcon,
      pattern: Math.floor(Math.random() * 5), // Random pattern for visual variety
    };
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with controls */}
      <div className="flex items-center justify-between p-4 border-b border-forge-border/30 bg-forge-surface/50">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Conversations</h2>
          <span className="text-sm text-text-muted">
            {filteredConversations.length} of {processedConversations.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-forge-bg/50 border border-forge-border/30 rounded-lg p-0.5">
            {VIEW_MODES.map((mode) => {
              const Icon = mode.icon;
              const isActive = viewMode === mode.id;
              
              return (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id)}
                  className={`p-1.5 rounded transition-colors ${
                    isActive 
                      ? 'bg-workspace-casual/20 text-workspace-casual' 
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                  title={mode.label}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>

          {/* Sort selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 bg-forge-bg border border-forge-border/30 rounded text-xs text-text-primary focus:outline-none"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded transition-colors ${
              showFilters || filterBy !== 'all'
                ? 'bg-workspace-casual/20 text-workspace-casual' 
                : 'text-text-muted hover:text-text-primary bg-forge-bg/50 border border-forge-border/30'
            }`}
            title="Filters"
          >
            <Filter size={14} />
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="p-4 space-y-3 border-b border-forge-border/20">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations, topics, or content..."
            className="w-full pl-10 pr-4 py-2 bg-forge-bg border border-forge-border/30 rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-workspace-casual/50 transition-colors"
          />
        </div>

        {/* Filter chips */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2"
            >
              {FILTER_OPTIONS.map((filter) => {
                const isActive = filterBy === filter.id;
                const count = filterCounts[filter.id] || 0;
                
                return (
                  <button
                    key={filter.id}
                    onClick={() => setFilterBy(filter.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                      isActive 
                        ? 'bg-workspace-casual/20 text-workspace-casual border border-workspace-casual/30' 
                        : 'bg-forge-bg/50 text-text-muted hover:text-text-primary border border-forge-border/30'
                    }`}
                  >
                    {filter.label}
                    {count > 0 && (
                      <span className="px-1 py-0.5 bg-forge-border/50 rounded-full text-[10px]">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Conversation grid/list */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare size={48} className="text-text-muted mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </h3>
            <p className="text-sm text-text-muted max-w-md">
              {searchQuery 
                ? 'Try adjusting your search or filters to find what you\'re looking for.'
                : 'Start a new conversation to begin building your knowledge base.'
              }
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredConversations.map((conversation) => (
              <ConversationCard
                key={conversation.id}
                conversation={conversation}
                onSelect={onSelectConversation}
                onDelete={onDeleteConversation}
                onArchive={onArchiveConversation}
                isSelected={selectedConversations.has(conversation.id)}
                onToggleSelect={(id) => {
                  const newSelected = new Set(selectedConversations);
                  if (newSelected.has(id)) {
                    newSelected.delete(id);
                  } else {
                    newSelected.add(id);
                  }
                  setSelectedConversations(newSelected);
                }}
                onHover={setHoveredConversation}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredConversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                onSelect={onSelectConversation}
                onDelete={onDeleteConversation}
                onArchive={onArchiveConversation}
                isSelected={selectedConversations.has(conversation.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bulk actions */}
      {selectedConversations.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-forge-surface border border-forge-border rounded-lg shadow-xl p-2 flex items-center gap-2"
        >
          <span className="text-xs text-text-muted px-2">
            {selectedConversations.size} selected
          </span>
          <button
            onClick={() => {
              selectedConversations.forEach(id => onArchiveConversation?.(id));
              setSelectedConversations(new Set());
            }}
            className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <Archive size={12} className="mr-1" />
            Archive
          </button>
          <button
            onClick={() => {
              selectedConversations.forEach(id => onDeleteConversation?.(id));
              setSelectedConversations(new Set());
            }}
            className="px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            <Trash2 size={12} className="mr-1" />
            Delete
          </button>
        </motion.div>
      )}
    </div>
  );
}

function ConversationCard({ 
  conversation, 
  onSelect, 
  onDelete, 
  onArchive,
  isSelected,
  onToggleSelect,
  onHover 
}) {
  const [showActions, setShowActions] = useState(false);
  const thumbnail = conversation.thumbnail || {};
  const ThumbnailIcon = thumbnail.icon || MessageSquare;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative p-4 rounded-xl border cursor-pointer transition-all duration-200
        ${isSelected 
          ? 'border-workspace-casual bg-workspace-casual/10' 
          : 'border-forge-border bg-forge-bg hover:border-forge-hover hover:bg-forge-elevated'
        }
      `}
      onClick={() => onSelect(conversation)}
      onMouseEnter={() => {
        setShowActions(true);
        onHover?.(conversation.id);
      }}
      onMouseLeave={() => {
        setShowActions(false);
        onHover?.(null);
      }}
    >
      {/* Thumbnail/Visual */}
      <div className={`w-full h-24 rounded-lg bg-gradient-to-br ${thumbnail.gradient} mb-3 flex items-center justify-center relative overflow-hidden`}>
        <ThumbnailIcon size={24} className="text-text-primary/60" />
        
        {/* Pattern overlay */}
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000' fill-opacity='0.1'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content */}
      <div className="space-y-2">
        <h3 className="font-medium text-text-primary line-clamp-2 text-sm">
          {conversation.title || conversation.summary}
        </h3>
        
        {/* Topics */}
        {conversation.topics && conversation.topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {conversation.topics.slice(0, 3).map((topic, index) => (
              <span
                key={index}
                className="px-1.5 py-0.5 bg-workspace-casual/10 text-workspace-casual rounded text-[10px] font-medium"
              >
                {topic.name}
              </span>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <MessageSquare size={10} />
              {conversation.messageCount}
            </span>
            {conversation.mood && (
              <span className={`flex items-center gap-1 ${
                conversation.mood === 'positive' ? 'text-green-400' :
                conversation.mood === 'negative' ? 'text-red-400' :
                'text-text-muted'
              }`}>
                <Heart size={10} />
                {conversation.mood}
              </span>
            )}
          </div>
          <span title={format(new Date(conversation.lastActivity), 'PPpp')}>
            {formatDistanceToNow(new Date(conversation.lastActivity), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Actions overlay */}
      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-2 right-2 flex items-center gap-1"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(conversation.id);
              }}
              className={`p-1 rounded transition-colors ${
                isSelected 
                  ? 'bg-workspace-casual text-white' 
                  : 'bg-forge-surface/80 text-text-muted hover:text-text-primary'
              }`}
              title="Select"
            >
              <Check size={12} />
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Toggle bookmark
              }}
              className="p-1 rounded bg-forge-surface/80 text-text-muted hover:text-yellow-400 transition-colors"
              title="Bookmark"
            >
              <Star size={12} />
            </button>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowActions(false);
                // Show more actions menu
              }}
              className="p-1 rounded bg-forge-surface/80 text-text-muted hover:text-text-primary transition-colors"
              title="More actions"
            >
              <MoreHorizontal size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute inset-0 border-2 border-workspace-casual rounded-xl pointer-events-none" />
      )}
    </motion.div>
  );
}

function ConversationListItem({ conversation, onSelect, onDelete, onArchive, isSelected }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`
        flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
        ${isSelected 
          ? 'border-workspace-casual bg-workspace-casual/10' 
          : 'border-forge-border bg-forge-bg hover:bg-forge-elevated'
        }
      `}
      onClick={() => onSelect(conversation)}
    >
      {/* Thumbnail */}
      <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${conversation.thumbnail?.gradient} flex items-center justify-center flex-shrink-0`}>
        <conversation.thumbnail.icon size={16} className="text-text-primary/60" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-text-primary truncate">
          {conversation.title || conversation.summary}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-text-muted">
            {conversation.messageCount} messages
          </span>
          <span className="text-xs text-text-muted">
            {formatDistanceToNow(new Date(conversation.lastActivity), { addSuffix: true })}
          </span>
          {conversation.topics && conversation.topics.length > 0 && (
            <span className="text-xs text-workspace-casual">
              {conversation.topics[0].name}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Bookmark action
          }}
          className="p-1 rounded text-text-muted hover:text-yellow-400 transition-colors"
          title="Bookmark"
        >
          <Star size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive?.(conversation.id);
          }}
          className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
          title="Archive"
        >
          <Archive size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(conversation.id);
          }}
          className="p-1 rounded text-text-muted hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}

export default ConversationGallery;











