/**
 * Web Search Tool Service
 * 
 * Handles web search tool calls from AI responses.
 * Detects [SEARCH: query] syntax, executes searches, and formats results.
 */

import { api } from '../utils/electronAPI';

/**
 * Web search tool definition for system prompt
 */
export const WEB_SEARCH_TOOL_PROMPT = `
## Web Search Tool

You have access to a web search tool. When you need current information, documentation, news, or facts you're not certain about, you can search the web.

To search, use this syntax (on its own line):
[SEARCH: your search query here]

Example:
[SEARCH: Next.js 14 new features]

After you issue a search, the results will be provided to you, and you should incorporate them into your response with proper citations.

Guidelines:
- Use search when asked about current events, recent releases, or real-time information
- Use search when you need to verify facts or provide accurate documentation links
- Be specific with search queries for better results
- You can search multiple times if needed
- Always cite your sources when using search results
`;

/**
 * Parse [SEARCH: query] tool calls from content
 * @param {string} content - AI output content
 * @returns {Array<{query: string, startIndex: number, endIndex: number, raw: string}>}
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
 * Check if content contains any search tool calls
 * @param {string} content 
 * @returns {boolean}
 */
export function hasSearchCalls(content) {
  return /\[SEARCH:\s*[^\]]+\]/i.test(content);
}

/**
 * Execute a web search
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<{results: Array, query: string, took: number, error?: string}>}
 */
export async function executeSearch(query, options = {}) {
  try {
    if (!api.webSearch) {
      console.warn('[WebSearchTool] Web search not available');
      return { results: [], query, took: 0, error: 'Web search not available' };
    }
    
    console.log(`[WebSearchTool] Executing search: "${query}"`);
    const result = await api.webSearch(query, options);
    console.log(`[WebSearchTool] Got ${result.results?.length || 0} results in ${result.took}ms`);
    
    return result;
  } catch (error) {
    console.error('[WebSearchTool] Search error:', error);
    return { results: [], query, took: 0, error: error.message };
  }
}

/**
 * Format search results for injection into AI context
 * @param {Array} results - Search results
 * @param {string} query - Original query
 * @returns {string}
 */
export function formatResultsForContext(results, query) {
  if (!results || results.length === 0) {
    return `\n\n[Web Search Results for "${query}"]\nNo results found.\n`;
  }
  
  const formatted = results.map((r, i) => {
    return `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet || ''}`;
  }).join('\n\n');
  
  return `\n\n[Web Search Results for "${query}"]\n${formatted}\n\n[End of Search Results]\n`;
}

/**
 * Process content and execute any search tool calls
 * Returns the content with search results injected
 * @param {string} content - AI output content
 * @returns {Promise<{content: string, searchResults: Array}>}
 */
export async function processSearchCalls(content) {
  const searchCalls = parseSearchCalls(content);
  
  if (searchCalls.length === 0) {
    return { content, searchResults: [] };
  }
  
  const searchResults = [];
  let processedContent = content;
  
  // Process searches in reverse order to maintain indices
  for (let i = searchCalls.length - 1; i >= 0; i--) {
    const call = searchCalls[i];
    const result = await executeSearch(call.query);
    
    searchResults.unshift({
      query: call.query,
      ...result,
    });
    
    // Replace the search call with results
    const formattedResults = formatResultsForContext(result.results, call.query);
    processedContent = 
      processedContent.substring(0, call.startIndex) + 
      formattedResults + 
      processedContent.substring(call.endIndex);
  }
  
  return { content: processedContent, searchResults };
}

/**
 * Check if web search is enabled/available
 * @returns {boolean}
 */
export function isWebSearchAvailable() {
  return typeof api.webSearch === 'function';
}

/**
 * Create enhanced system prompt with web search tool
 * @param {string} basePrompt - Base system prompt
 * @param {boolean} enableWebSearch - Whether to enable web search
 * @returns {string}
 */
export function enhancePromptWithWebSearch(basePrompt, enableWebSearch = true) {
  if (!enableWebSearch || !isWebSearchAvailable()) {
    return basePrompt;
  }
  
  return basePrompt + '\n\n' + WEB_SEARCH_TOOL_PROMPT;
}

export default {
  WEB_SEARCH_TOOL_PROMPT,
  parseSearchCalls,
  hasSearchCalls,
  executeSearch,
  formatResultsForContext,
  processSearchCalls,
  isWebSearchAvailable,
  enhancePromptWithWebSearch,
};
