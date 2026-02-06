/**
 * Web Search Service - Provides web search capability for the AI
 * 
 * Uses DuckDuckGo HTML API (no API key required) to search the web
 * and return relevant results with titles, URLs, and snippets.
 * 
 * This gives the AI "eyes on the web" - ability to look up current information,
 * documentation, news, etc.
 */

const https = require('https');
const http = require('http');

// Search configuration
const SEARCH_CONFIG = {
  maxResults: 8,
  timeout: 10000, // 10 seconds
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * Make an HTTP/HTTPS request
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': SEARCH_CONFIG.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...options.headers,
      },
      timeout: options.timeout || SEARCH_CONFIG.timeout,
    };
    
    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return makeRequest(res.headers.location, options)
          .then(resolve)
          .catch(reject);
      }
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

/**
 * Parse DuckDuckGo HTML search results
 * Extracts titles, URLs, and snippets from the HTML response
 */
function parseDuckDuckGoResults(html) {
  const results = [];
  
  // DuckDuckGo HTML results are in divs with class "result"
  // Each result has a title in <a class="result__a">, snippet in <a class="result__snippet">
  
  // Simple regex-based parsing (more robust than DOM parsing in Node)
  const resultPattern = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
  const titlePattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  
  let match;
  while ((match = resultPattern.exec(html)) !== null) {
    const resultHtml = match[1];
    
    // Extract title and URL
    const titleMatch = titlePattern.exec(resultHtml);
    if (!titleMatch) continue;
    
    let url = titleMatch[1];
    const title = stripHtml(titleMatch[2]);
    
    // DuckDuckGo wraps URLs in a redirect - extract the actual URL
    if (url.includes('uddg=')) {
      const uddgMatch = url.match(/uddg=([^&]*)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }
    }
    
    // Extract snippet
    const snippetMatch = snippetPattern.exec(resultHtml);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    
    // Skip if no valid URL or title
    if (!url || !title || url.startsWith('/')) continue;
    
    results.push({
      title: title.trim(),
      url: url,
      snippet: snippet.trim(),
    });
    
    // Limit results
    if (results.length >= SEARCH_CONFIG.maxResults) break;
  }
  
  return results;
}

/**
 * Strip HTML tags and decode entities
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search the web using DuckDuckGo
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<{results: Array, query: string, took: number}>}
 */
async function searchWeb(query, options = {}) {
  const startTime = Date.now();
  const maxResults = options.maxResults || SEARCH_CONFIG.maxResults;
  
  if (!query || typeof query !== 'string') {
    return { results: [], query: '', took: 0, error: 'Invalid query' };
  }
  
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    console.log(`[WebSearch] Searching: "${query}"`);
    
    const response = await makeRequest(searchUrl, {
      timeout: options.timeout || SEARCH_CONFIG.timeout,
    });
    
    if (response.statusCode !== 200) {
      console.warn(`[WebSearch] Non-200 response: ${response.statusCode}`);
      return { 
        results: [], 
        query, 
        took: Date.now() - startTime,
        error: `Search returned status ${response.statusCode}` 
      };
    }
    
    // Parse results from HTML
    const results = parseDuckDuckGoResults(response.body);
    
    console.log(`[WebSearch] Found ${results.length} results in ${Date.now() - startTime}ms`);
    
    return {
      results: results.slice(0, maxResults),
      query,
      took: Date.now() - startTime,
    };
  } catch (error) {
    console.error('[WebSearch] Error:', error.message);
    return {
      results: [],
      query,
      took: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Fetch and extract text content from a URL
 * Useful for the AI to read the content of a search result
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<{content: string, title: string, url: string}>}
 */
async function fetchPageContent(url, options = {}) {
  const maxLength = options.maxLength || 8000; // Limit content to ~2K tokens
  
  try {
    console.log(`[WebSearch] Fetching: ${url}`);
    
    const response = await makeRequest(url, {
      timeout: options.timeout || SEARCH_CONFIG.timeout,
    });
    
    if (response.statusCode !== 200) {
      return { content: '', title: '', url, error: `HTTP ${response.statusCode}` };
    }
    
    const html = response.body;
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '';
    
    // Try to extract main content
    // Look for common content containers
    let content = '';
    
    // Try <article> tag first
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      content = stripHtml(articleMatch[1]);
    }
    
    // Try <main> tag
    if (!content) {
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
      if (mainMatch) {
        content = stripHtml(mainMatch[1]);
      }
    }
    
    // Try common content divs
    if (!content) {
      const contentPatterns = [
        /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];
      
      for (const pattern of contentPatterns) {
        const match = html.match(pattern);
        if (match) {
          content = stripHtml(match[1]);
          break;
        }
      }
    }
    
    // Fallback: extract all text from body
    if (!content) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        // Remove scripts and styles
        let bodyContent = bodyMatch[1]
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
        content = stripHtml(bodyContent);
      }
    }
    
    // Clean up and truncate
    content = content
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, maxLength);
    
    return { content, title, url };
  } catch (error) {
    console.error('[WebSearch] Fetch error:', error.message);
    return { content: '', title: '', url, error: error.message };
  }
}

/**
 * Format search results for inclusion in AI context
 * @param {Array} results - Search results from searchWeb
 * @returns {string} - Formatted text for AI context
 */
function formatResultsForContext(results) {
  if (!results || results.length === 0) {
    return 'No search results found.';
  }
  
  return results.map((r, i) => {
    return `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`;
  }).join('\n\n');
}

/**
 * Parse [SEARCH: query] tool calls from AI output
 * @param {string} content - AI output text
 * @returns {Array} - Array of search queries found
 */
function parseSearchToolCalls(content) {
  if (!content) return [];
  
  const pattern = /\[SEARCH:\s*([^\]]+)\]/gi;
  const queries = [];
  let match;
  
  while ((match = pattern.exec(content)) !== null) {
    queries.push(match[1].trim());
  }
  
  return queries;
}

/**
 * Check if content contains a search tool call
 * @param {string} content - AI output text
 * @returns {boolean}
 */
function hasSearchToolCall(content) {
  return /\[SEARCH:\s*[^\]]+\]/i.test(content);
}

module.exports = {
  searchWeb,
  fetchPageContent,
  formatResultsForContext,
  parseSearchToolCalls,
  hasSearchToolCall,
  SEARCH_CONFIG,
};
