/**
 * Web Search Tool Service
 * 
 * Handles web search tool calls from AI responses.
 * Detects [SEARCH: query] syntax, executes searches, and formats results.
 */

import { api } from '../utils/electronAPI';

const SIMULATED_SEARCH_BLOCK_PATTERN = /<\|search_result\|>[\s\S]*?<\|end_search_result\|>/gi;
const CURRENT_INFO_PATTERN = /\b(today|today's|todays|current|currently|latest|recent|news|headline|headlines|happ\w*|updates?|develop\w*|right now|date|time|weather|forecast|price|prices|score|scores|stock|stocks)\b/i;
const DATE_OR_TIME_PATTERN = /\b(today(?:'s)?\s+date|current\s+date|current\s+time|what(?:'s| is)\s+(?:the\s+)?date|what(?:'s| is)\s+(?:the\s+)?time|what\s+day\s+is\s+it|time\s+is\s+it)\b/i;
const NEWS_PATTERN = /\b(news|headline|headlines|happ\w*|updates?|develop\w*)\b/i;
const GRAMMAR_TANGENT_PATTERN = /\b(grammar|spelling|misspelling|typo|translate|translation|dictionary|define|definition|difference between|meaning of|versus|vs\.?)\b/i;
const LOW_SIGNAL_RESULT_PATTERN = /\b(hinative|wiktionary|wordreference|spanishdict|translate|translation|dictionary|grammar|spelling|difference between|japanese explanation|chinese explanation|spanish explanation)\b/i;
const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'at', 'be', 'but', 'by', 'for', 'from', 'get', 'give',
  'happening', 'happenings', 'headlines', 'how', 'i', 'in', 'is', 'it', 'latest', 'me',
  'my', 'news', 'of', 'on', 'or', 'please', 'recent', 'right', 'show', 'tell',
  'the', 'this', 'time', 'to', 'today', 'todays', 'up', 'updates', 'was', 'what',
  'whats', 'when', 'where', 'which', 'who', 'why',
]);

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = 700) {
  const normalized = compactWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function formatResultsForSynthesis(results = []) {
  if (!Array.isArray(results) || results.length === 0) return 'No search results found.';
  return results
    .slice(0, 8)
    .map((item, index) => {
      const title = truncateText(item?.title || 'Untitled result', 180);
      const url = compactWhitespace(item?.url || '');
      const snippet = truncateText(item?.snippet || '', 320);
      return `[${index + 1}] ${title}\nURL: ${url}\nSnippet: ${snippet}`;
    })
    .join('\n\n');
}

function formatOpenedSourcesForSynthesis(openedSources = []) {
  if (!Array.isArray(openedSources) || openedSources.length === 0) {
    return 'No pages were opened for deeper reading.';
  }
  return openedSources
    .map((source) => {
      const title = truncateText(source?.title || 'Untitled page', 180);
      const url = compactWhitespace(source?.url || '');
      const excerpt = truncateText(source?.excerpt || '', 1200);
      return `[${source.rank}] ${title}\nURL: ${url}\nExcerpt: ${excerpt}`;
    })
    .join('\n\n');
}

function parseNumericOption(options, key, fallback, min, max) {
  const raw = Number(options?.[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function looksLikeGrammarIntent(value = '') {
  return GRAMMAR_TANGENT_PATTERN.test(String(value || '').toLowerCase());
}

function tokenizeSearchText(value = '') {
  return new Set(
    compactWhitespace(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !SEARCH_STOP_WORDS.has(token))
  );
}

function getTokenOverlapCount(left = '', right = '') {
  const leftTokens = tokenizeSearchText(left);
  const rightTokens = tokenizeSearchText(right);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function trimPromptFraming(value = '') {
  let text = compactWhitespace(value).replace(/[?!.]+$/g, '');
  text = text.replace(/^(?:please\s+)?(?:can you|could you|would you|tell me|show me|give me|find|look up|search(?: for)?|search)\s+/i, '');
  return compactWhitespace(text);
}

function stripRealtimeLead(value = '') {
  let text = trimPromptFraming(value);
  text = text
    .replace(/\b(?:what(?:'s| is)|whats)\s+today(?:'s)?\s+date\b/gi, ' ')
    .replace(/\b(?:today(?:'s)?\s+date|current\s+date)\b/gi, ' ')
    .replace(/\b(?:what\s+day\s+is\s+it|what(?:'s| is)\s+(?:the\s+)?time|current\s+time|time\s+is\s+it)\b/gi, ' ')
    .replace(/\b(?:right now|currently|current|today)\b/gi, ' ')
    .replace(/\b(?:and then|and|plus)\b/gi, ' ');
  return compactWhitespace(text);
}

function buildPromptDerivedSearch(userPrompt = '') {
  const prompt = compactWhitespace(userPrompt);
  if (!prompt) return '';

  const stripped = stripRealtimeLead(prompt);
  if (!stripped) {
    if (DATE_OR_TIME_PATTERN.test(prompt)) return '';
    return trimPromptFraming(prompt);
  }

  if (NEWS_PATTERN.test(prompt)) {
    let topic = stripped
      .replace(/\b(?:latest|recent|news|headline|headlines|updates?|develop\w*|happ\w*|going on)\b/gi, ' ')
      .replace(/\b(?:in|on|about|regarding|around|for)\b/gi, ' ');
    topic = compactWhitespace(topic);
    return topic ? `latest news ${topic}` : 'latest news';
  }

  return stripped;
}

function looksOffTopicForPrompt(results = [], prompt = '') {
  if (!Array.isArray(results) || results.length === 0) return true;
  const topText = results
    .slice(0, 3)
    .map((item) => `${item?.title || ''} ${item?.url || ''} ${item?.snippet || ''}`)
    .join(' ')
    .toLowerCase();

  if (LOW_SIGNAL_RESULT_PATTERN.test(topText) && isFreshInfoPrompt(prompt)) {
    return true;
  }

  const targetQuery = buildPromptDerivedSearch(prompt);
  if (!targetQuery) return false;

  const overlap = getTokenOverlapCount(targetQuery, topText);
  return overlap === 0 && isFreshInfoPrompt(prompt);
}

export function isFreshInfoPrompt(prompt = '') {
  const normalized = compactWhitespace(prompt);
  if (!normalized) return false;
  return CURRENT_INFO_PATTERN.test(normalized) && !looksLikeGrammarIntent(normalized);
}

export function isDirectDateOrTimePrompt(prompt = '') {
  const normalized = compactWhitespace(prompt);
  if (!normalized) return false;
  return DATE_OR_TIME_PATTERN.test(normalized) && !NEWS_PATTERN.test(normalized);
}

export function buildSearchQueryFromPrompt(userPrompt = '', proposedQuery = '') {
  const normalizedPrompt = compactWhitespace(userPrompt);
  const normalizedQuery = compactWhitespace(proposedQuery);
  const promptDerived = buildPromptDerivedSearch(normalizedPrompt);

  if (!normalizedQuery) {
    return promptDerived || normalizedPrompt;
  }
  if (!promptDerived) {
    return normalizedQuery;
  }

  if (looksLikeGrammarIntent(normalizedQuery) && !looksLikeGrammarIntent(normalizedPrompt)) {
    return promptDerived;
  }

  if (isFreshInfoPrompt(normalizedPrompt) && getTokenOverlapCount(promptDerived, normalizedQuery) === 0) {
    return promptDerived;
  }

  return normalizedQuery;
}

export function shouldForceWebSearch(prompt = '') {
  return isFreshInfoPrompt(prompt) && !isDirectDateOrTimePrompt(prompt);
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
[SEARCH: Next.js 14 new features]

After you issue a search, the results will be provided to you, and you should incorporate them into your response with proper citations.

Guidelines:
- Use search when asked about current events, recent releases, or real-time information
- Use search when you need to verify facts or provide accurate documentation links
- Search the substance of the user's request, not their spelling or grammar, unless they explicitly asked for language help
- For mixed "today/date/time + news" questions, answer the date/time from the provided clock context and search only the news/topic portion
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

  const calls = [];
  const seen = new Set();

  const addCall = (query, startIndex, endIndex, raw) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return;
    const key = `${startIndex}:${endIndex}:${normalizedQuery.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({
      query: normalizedQuery,
      startIndex,
      endIndex,
      raw,
    });
  };

  // 1) Canonical syntax: [SEARCH: query]
  const bracketPattern = /\[SEARCH:\s*([^\]]+)\]/gi;
  let match;
  while ((match = bracketPattern.exec(content)) !== null) {
    addCall(
      match[1],
      match.index,
      match.index + match[0].length,
      match[0]
    );
  }

  // 2) JSON fenced code blocks, e.g. ```json { "search": "current time in Hong Kong" } ```
  const fencedJsonPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  while ((match = fencedJsonPattern.exec(content)) !== null) {
    const block = String(match[1] || '').trim();
    if (!block) continue;

    let query = '';
    try {
      const parsed = JSON.parse(block);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.search === 'string') {
          query = parsed.search;
        } else if (
          typeof parsed.tool === 'string'
          && parsed.tool.toLowerCase() === 'search'
          && typeof parsed.query === 'string'
        ) {
          query = parsed.query;
        }
      }
    } catch {
      const searchFieldMatch = block.match(/"search"\s*:\s*"([^"]{1,500})"/i);
      if (searchFieldMatch) {
        query = searchFieldMatch[1];
      }
    }

    if (query) {
      addCall(
        query,
        match.index,
        match.index + match[0].length,
        match[0]
      );
    }
  }

  // 3) Inline JSON object fallback: {"search":"..."}
  const inlineJsonSearchPattern = /\{\s*"search"\s*:\s*"([^"]{1,500})"\s*\}/gi;
  while ((match = inlineJsonSearchPattern.exec(content)) !== null) {
    addCall(
      match[1],
      match.index,
      match.index + match[0].length,
      match[0]
    );
  }

  return calls.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Check if content contains any search tool calls
 * @param {string} content 
 * @returns {boolean}
 */
export function hasSearchCalls(content) {
  return parseSearchCalls(content).length > 0;
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
 * Fetch and extract page text for a result URL
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<{content: string, title: string, url: string, error?: string}>}
 */
export async function fetchPage(url, options = {}) {
  try {
    if (!api.webFetchPage) {
      return { content: '', title: '', url, error: 'Web page fetch not available' };
    }
    const result = await api.webFetchPage(url, options);
    return result || { content: '', title: '', url, error: 'Empty page fetch response' };
  } catch (error) {
    return { content: '', title: '', url, error: error?.message || 'Page fetch failed' };
  }
}

/**
 * Format web search actions for renderer timeline
 * Uses JSON lines for robust parsing in UI.
 * @param {string} query
 * @param {Array<Object>} actions
 * @returns {string}
 */
export function formatActionsForContext(query, actions = []) {
  if (!Array.isArray(actions) || actions.length === 0) return '';
  const lines = actions
    .map((action) => {
      try {
        return JSON.stringify(action);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .join('\n');
  if (!lines) return '';
  return `\n\n[Web Search Actions for "${query}"]\n${lines}\n[End of Web Search Actions]\n`;
}

/**
 * Format search results for injection into AI context
 * @param {Array} results - Search results
 * @param {string} query - Original query
 * @returns {string}
 */
export function formatResultsForContext(results, query) {
  if (!results || results.length === 0) {
    return `\n\n[Web Search Results for "${query}"]\nNo results found.\n\n[End of Search Results]\n`;
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
 * @returns {Promise<{content: string, searchResults: Array, actionTraces: Array, synthesisContext: string}>}
 */
export async function processSearchCalls(content, options = {}) {
  let workingContent = String(content || '');
  const userPrompt = String(options?.userPrompt || '').trim();
  const searchCalls = parseSearchCalls(workingContent);
  const maxResults = parseNumericOption(options, 'maxResults', 8, 1, 12);
  const fetchTopResults = parseNumericOption(options, 'fetchTopResults', 2, 0, 4);
  const fetchTimeout = parseNumericOption(options, 'fetchTimeout', 7000, 2500, 20000);
  const fetchMaxLength = parseNumericOption(options, 'fetchMaxLength', 2800, 800, 12000);
  const excerptLength = parseNumericOption(options, 'excerptLength', 900, 200, 2000);

  if (searchCalls.length === 0) {
    return { content: workingContent, searchResults: [], actionTraces: [], synthesisContext: '' };
  }

  const searchResults = [];
  const actionTraces = [];
  const synthesisBlocks = [];
  let processedContent = workingContent;

  // Process searches in reverse order to maintain indices
  for (let i = searchCalls.length - 1; i >= 0; i--) {
    const call = searchCalls[i];
    const effectiveQuery = buildSearchQueryFromPrompt(userPrompt, call.query) || call.query;
    let result = await executeSearch(effectiveQuery, { ...options, maxResults });
    let normalizedResults = Array.isArray(result?.results) ? result.results : [];
    const actions = [{
      type: 'search',
      query: effectiveQuery,
      originalQuery: call.query,
      results: normalizedResults.length,
      tookMs: Number(result?.took || 0),
      provider: compactWhitespace(result?.provider || ''),
      error: result?.error ? String(result.error) : null,
    }];

    const repairedQuery = buildPromptDerivedSearch(userPrompt);
    const shouldRetry =
      repairedQuery &&
      repairedQuery.toLowerCase() !== effectiveQuery.toLowerCase() &&
      looksOffTopicForPrompt(normalizedResults, userPrompt);

    if (shouldRetry) {
      const retryResult = await executeSearch(repairedQuery, { ...options, maxResults });
      const retryResults = Array.isArray(retryResult?.results) ? retryResult.results : [];
      const retryLooksBetter = retryResults.length > 0 && !looksOffTopicForPrompt(retryResults, userPrompt);

      actions.push({
        type: 'search_retry',
        query: repairedQuery,
        replacedQuery: effectiveQuery,
        results: retryResults.length,
        tookMs: Number(retryResult?.took || 0),
        provider: compactWhitespace(retryResult?.provider || ''),
        error: retryResult?.error ? String(retryResult.error) : null,
        adopted: retryLooksBetter,
      });

      if (retryLooksBetter) {
        result = retryResult;
        normalizedResults = retryResults;
      }
    }

    const openedSources = [];

    if (fetchTopResults > 0 && normalizedResults.length > 0) {
      const candidates = normalizedResults.slice(0, fetchTopResults);
      for (let rank = 0; rank < candidates.length; rank++) {
        const candidate = candidates[rank];
        const url = compactWhitespace(candidate?.url || '');
        if (!url) continue;

        const startedAt = Date.now();
        const page = await fetchPage(url, { timeout: fetchTimeout, maxLength: fetchMaxLength });
        const elapsedMs = Date.now() - startedAt;
        const pageText = compactWhitespace(page?.content || '');
        const pageTitle = truncateText(page?.title || candidate?.title || 'Untitled page', 180);
        const status = page?.error || !pageText ? 'error' : 'ok';

        actions.push({
          type: 'open',
          rank: rank + 1,
          title: pageTitle,
          url,
          status,
          tookMs: elapsedMs,
          chars: pageText.length,
          error: page?.error ? String(page.error) : null,
        });

        if (status === 'ok') {
          openedSources.push({
            rank: rank + 1,
            title: pageTitle,
            url,
            excerpt: truncateText(pageText, excerptLength),
          });
        }
      }
    }

    searchResults.unshift({
      query: effectiveQuery,
      originalQuery: call.query,
      ...result,
      actions,
      openedSources,
    });

    actionTraces.unshift({ query: effectiveQuery, originalQuery: call.query, actions });
    synthesisBlocks.unshift([
      `[Web Research for "${effectiveQuery}"]`,
      'Search Results:',
      formatResultsForSynthesis(normalizedResults),
      '',
      'Opened Source Excerpts:',
      formatOpenedSourcesForSynthesis(openedSources),
      '[End of Web Research]',
    ].join('\n'));

    // Replace the search call with a structured action trace + result block.
    const actionBlock = formatActionsForContext(effectiveQuery, actions);
    const formattedResults = formatResultsForContext(normalizedResults, effectiveQuery);
    processedContent =
      processedContent.substring(0, call.startIndex) +
      actionBlock +
      formattedResults +
      processedContent.substring(call.endIndex);
  }

  // Remove model-simulated placeholder result blocks if present.
  // We already inserted real tool-backed search results above.
  processedContent = processedContent.replace(
    SIMULATED_SEARCH_BLOCK_PATTERN,
    ''
  );

  return {
    content: processedContent,
    searchResults,
    actionTraces,
    synthesisContext: synthesisBlocks.join('\n\n').trim(),
  };
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
  isFreshInfoPrompt,
  isDirectDateOrTimePrompt,
  buildSearchQueryFromPrompt,
  shouldForceWebSearch,
  parseSearchCalls,
  hasSearchCalls,
  executeSearch,
  fetchPage,
  formatActionsForContext,
  formatResultsForContext,
  processSearchCalls,
  isWebSearchAvailable,
  enhancePromptWithWebSearch,
};
