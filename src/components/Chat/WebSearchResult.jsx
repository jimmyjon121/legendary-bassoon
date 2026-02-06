import React, { memo, useState } from 'react';
import { Search, ExternalLink, Globe, ChevronDown, ChevronUp, Clock, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * WebSearchResult - Displays web search results in the chat
 * 
 * Shows search query, results with clickable links, and timing info.
 * Results are collapsible to save space.
 */
export const WebSearchResult = memo(function WebSearchResult({
  query,
  results = [],
  took = 0,
  error = null,
  isLoading = false,
  className = '',
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  const hasResults = results && results.length > 0;
  
  return (
    <div className={`web-search-result rounded-lg border border-forge-border/50 bg-forge-elevated/30 overflow-hidden ${className}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-forge-hover/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Loader2 size={14} className="text-workspace-casual animate-spin" />
          ) : (
            <Search size={14} className="text-workspace-casual" />
          )}
          <span className="text-sm text-text-secondary">
            {isLoading ? 'Searching...' : `Web Search: "${query}"`}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {!isLoading && took > 0 && (
            <span className="text-[10px] text-text-muted flex items-center gap-1">
              <Clock size={10} />
              {took}ms
            </span>
          )}
          {hasResults && (
            <span className="text-[10px] text-text-muted">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp size={14} className="text-text-muted" />
          ) : (
            <ChevronDown size={14} className="text-text-muted" />
          )}
        </div>
      </button>
      
      {/* Results */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {/* Error state */}
              {error && (
                <div className="text-xs text-status-error p-2 rounded bg-status-error/10">
                  Search failed: {error}
                </div>
              )}
              
              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-workspace-casual" />
                </div>
              )}
              
              {/* No results */}
              {!isLoading && !error && !hasResults && (
                <div className="text-xs text-text-muted p-2 text-center">
                  No results found for this query.
                </div>
              )}
              
              {/* Results list */}
              {hasResults && results.map((result, idx) => (
                <SearchResultItem key={idx} result={result} index={idx} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/**
 * Individual search result item
 */
const SearchResultItem = memo(function SearchResultItem({ result, index }) {
  const [showPreview, setShowPreview] = useState(false);
  
  // Extract domain from URL for display
  const domain = (() => {
    try {
      return new URL(result.url).hostname.replace('www.', '');
    } catch {
      return result.url;
    }
  })();
  
  return (
    <div className="search-result-item group">
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-2 rounded hover:bg-forge-hover/50 transition-colors"
      >
        {/* Title and source */}
        <div className="flex items-start gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded bg-workspace-casual/20 flex items-center justify-center text-[10px] text-workspace-casual font-medium">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-text-primary group-hover:text-workspace-casual transition-colors line-clamp-1">
              {result.title}
            </h4>
            <div className="flex items-center gap-1 text-[10px] text-text-muted mt-0.5">
              <Globe size={10} />
              <span className="truncate">{domain}</span>
              <ExternalLink size={10} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
        
        {/* Snippet */}
        {result.snippet && (
          <p className="text-xs text-text-muted mt-1 ml-7 line-clamp-2">
            {result.snippet}
          </p>
        )}
      </a>
    </div>
  );
});

/**
 * Parse [SEARCH: query] tool calls from AI output
 * Returns array of { query, startIndex, endIndex }
 */
export function parseSearchCalls(content) {
  if (!content) return [];
  
  const pattern = /\[SEARCH:\s*([^\]]+)\]/gi;
  const calls = [];
  let match;
  
  while ((match = pattern.exec(content)) !== null) {
    calls.push({
      query: match[1].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      raw: match[0],
    });
  }
  
  return calls;
}

/**
 * Check if content has any search tool calls
 */
export function hasSearchCalls(content) {
  return /\[SEARCH:\s*[^\]]+\]/i.test(content);
}

/**
 * Remove search tool calls from content (for display after executing)
 */
export function removeSearchCalls(content) {
  if (!content) return content;
  return content.replace(/\[SEARCH:\s*[^\]]+\]\s*/gi, '').trim();
}

/**
 * Web search tool definition for system prompt
 */
export const WEB_SEARCH_TOOL_PROMPT = `
## Web Search Tool

You have access to a web search tool. When you need current information, documentation, news, or facts you're not certain about, you can search the web.

To search, use this syntax (on its own line):
[SEARCH: your search query here]

Example:
[SEARCH: Next.js 14 new features 2024]

After you issue a search, the results will be provided to you, and you should incorporate them into your response with citations.

Guidelines:
- Use search when asked about current events, recent releases, or real-time information
- Use search when you need to verify facts or provide accurate documentation links
- Be specific with search queries for better results
- You can search multiple times if needed
- Always cite your sources when using search results
`;

export default WebSearchResult;
