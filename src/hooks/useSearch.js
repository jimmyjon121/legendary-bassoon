import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * Custom hook for search functionality
 * Provides search state and actions with workspace isolation
 */
export function useSearch() {
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const searchResults = useAppStore(s => s.searchResults);
  const isSearching = useAppStore(s => s.isSearching);
  const search = useAppStore(s => s.search);
  const clearSearch = useAppStore(s => s.clearSearch);
  
  const [query, setQuery] = useState('');
  
  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      clearSearch();
      return;
    }
    
    const timer = setTimeout(() => {
      search(query);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [query, search, clearSearch]);
  
  // Reset when workspace changes
  useEffect(() => {
    setQuery('');
    clearSearch();
  }, [currentWorkspace, clearSearch]);
  
  const handleSearch = useCallback((newQuery) => {
    setQuery(newQuery);
  }, []);
  
  const handleClear = useCallback(() => {
    setQuery('');
    clearSearch();
  }, [clearSearch]);
  
  return {
    query,
    setQuery: handleSearch,
    clearQuery: handleClear,
    results: searchResults,
    isSearching,
    hasResults: searchResults && (
      (searchResults.conversations?.total || 0) > 0 || 
      (searchResults.messages?.total || 0) > 0
    ),
    conversationCount: searchResults?.conversations?.total || 0,
    messageCount: searchResults?.messages?.total || 0,
  };
}

/**
 * Hook for managing global search modal state
 */
export function useGlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  
  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);
  
  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(prev => !prev),
  };
}

export default useSearch;



