/**
 * Web Search IPC Handlers
 * 
 * Provides web search functionality to the renderer process.
 * Uses DuckDuckGo HTML API for real-time web search without API keys.
 */

const { 
  searchWeb, 
  fetchPageContent, 
  formatResultsForContext 
} = require('../services/web-search-service');

/**
 * Setup web search IPC handlers
 * @param {Electron.IpcMain} ipcMain - Electron IPC main
 */
function setupWebSearchHandlers(ipcMain) {
  console.log('[IPC] Setting up web search handlers...');
  
  /**
   * Search the web using DuckDuckGo
   * @param {string} query - Search query
   * @param {Object} options - Optional: { maxResults, timeout }
   * @returns {Promise<{results: Array, query: string, took: number}>}
   */
  ipcMain.handle('webSearch:search', async (_, query, options = {}) => {
    try {
      const result = await searchWeb(query, options);
      return result;
    } catch (error) {
      console.error('[WebSearch] Search error:', error);
      return { 
        results: [], 
        query, 
        error: error.message,
        took: 0 
      };
    }
  });
  
  /**
   * Fetch and extract content from a URL
   * @param {string} url - URL to fetch
   * @param {Object} options - Optional: { maxLength, timeout }
   * @returns {Promise<{content: string, title: string, url: string}>}
   */
  ipcMain.handle('webSearch:fetchPage', async (_, url, options = {}) => {
    try {
      const result = await fetchPageContent(url, options);
      return result;
    } catch (error) {
      console.error('[WebSearch] Fetch error:', error);
      return { 
        content: '', 
        title: '', 
        url, 
        error: error.message 
      };
    }
  });
  
  /**
   * Format search results for AI context
   * @param {Array} results - Search results
   * @returns {string} - Formatted text
   */
  ipcMain.handle('webSearch:formatResults', async (_, results) => {
    return formatResultsForContext(results);
  });
  
  /**
   * Combined search and format for convenience
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<{formatted: string, results: Array, query: string, took: number}>}
   */
  ipcMain.handle('webSearch:searchAndFormat', async (_, query, options = {}) => {
    try {
      const result = await searchWeb(query, options);
      const formatted = formatResultsForContext(result.results);
      return {
        ...result,
        formatted,
      };
    } catch (error) {
      console.error('[WebSearch] SearchAndFormat error:', error);
      return { 
        results: [], 
        formatted: 'Search failed: ' + error.message,
        query, 
        error: error.message,
        took: 0 
      };
    }
  });
  
  console.log('[IPC] Web search handlers setup complete');
}

module.exports = {
  setupWebSearchHandlers,
};
