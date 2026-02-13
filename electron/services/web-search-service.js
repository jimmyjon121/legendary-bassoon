/**
 * Web Search Service - resilient multi-provider search and page fetch.
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SEARCH_CONFIG = {
  maxResults: 50,
  timeout: 10000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  defaultProviderOrder: ['brave', 'serper', 'searxng', 'bing', 'duckduckgo'],
  minIntervalMs: Math.max(20, Number(process.env.RESEARCH_WEB_MIN_INTERVAL_MS || 180)),
  maxConcurrent: Math.max(1, Math.min(12, Number(process.env.RESEARCH_WEB_MAX_CONCURRENT || 4))),
  circuitFailureThreshold: Math.max(2, Number(process.env.RESEARCH_WEB_CIRCUIT_FAILS || 3)),
  circuitCooldownMs: Math.max(5000, Number(process.env.RESEARCH_WEB_CIRCUIT_COOLDOWN_MS || 60000)),
};

const REQUEST_RATE_STATE = {
  active: 0,
  waiting: [],
  nextAllowedAt: 0,
  timer: null,
};

const PROVIDER_CIRCUIT_STATE = new Map();

function clearRateTimer() {
  if (REQUEST_RATE_STATE.timer) {
    clearTimeout(REQUEST_RATE_STATE.timer);
    REQUEST_RATE_STATE.timer = null;
  }
}

function pumpRequestQueue() {
  if (REQUEST_RATE_STATE.active >= SEARCH_CONFIG.maxConcurrent) return;
  if (REQUEST_RATE_STATE.waiting.length === 0) return;

  const now = Date.now();
  if (now < REQUEST_RATE_STATE.nextAllowedAt) {
    clearRateTimer();
    REQUEST_RATE_STATE.timer = setTimeout(
      () => {
        REQUEST_RATE_STATE.timer = null;
        pumpRequestQueue();
      },
      REQUEST_RATE_STATE.nextAllowedAt - now
    );
    return;
  }

  const next = REQUEST_RATE_STATE.waiting.shift();
  if (!next) return;

  REQUEST_RATE_STATE.active += 1;
  REQUEST_RATE_STATE.nextAllowedAt = Date.now() + SEARCH_CONFIG.minIntervalMs;
  next();

  if (REQUEST_RATE_STATE.active < SEARCH_CONFIG.maxConcurrent && REQUEST_RATE_STATE.waiting.length > 0) {
    setImmediate(pumpRequestQueue);
  }
}

function acquireRequestSlot() {
  return new Promise((resolve) => {
    REQUEST_RATE_STATE.waiting.push(resolve);
    pumpRequestQueue();
  });
}

function releaseRequestSlot() {
  REQUEST_RATE_STATE.active = Math.max(0, REQUEST_RATE_STATE.active - 1);
  pumpRequestQueue();
}

async function withRequestRateLimit(task) {
  await acquireRequestSlot();
  try {
    return await task();
  } finally {
    releaseRequestSlot();
  }
}

function decodeResponseBody(buffer, encoding = '') {
  const normalized = String(encoding || '').toLowerCase();
  try {
    if (normalized.includes('gzip')) return zlib.gunzipSync(buffer).toString('utf8');
    if (normalized.includes('deflate')) return zlib.inflateSync(buffer).toString('utf8');
    if (normalized.includes('br') && typeof zlib.brotliDecompressSync === 'function') {
      return zlib.brotliDecompressSync(buffer).toString('utf8');
    }
  } catch (_error) {
    // Fall back to direct UTF-8 decode below.
  }
  return buffer.toString('utf8');
}

function parseMaybeJson(text = '', fallback = null) {
  try {
    return JSON.parse(String(text || ''));
  } catch (_error) {
    return fallback;
  }
}

function compactWhitespace(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchItem(item = {}) {
  const title = compactWhitespace(item.title || item.name || '');
  const url = compactWhitespace(item.url || item.link || '');
  const snippet = compactWhitespace(item.snippet || item.description || item.content || '');
  if (!url || !title) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return { title, url, snippet };
}

function dedupeResults(items = [], limit = SEARCH_CONFIG.maxResults) {
  const output = [];
  const seen = new Set();
  const safeLimit = Math.max(1, Math.min(200, Number(limit || SEARCH_CONFIG.maxResults)));
  for (const raw of items) {
    const normalized = normalizeSearchItem(raw);
    if (!normalized) continue;
    const key = normalized.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= safeLimit) break;
  }
  return output;
}

function getProviderCircuit(provider) {
  const key = String(provider || '').toLowerCase();
  const existing = PROVIDER_CIRCUIT_STATE.get(key);
  if (existing) return existing;
  const seeded = { failures: 0, cooldownUntil: 0, lastError: '' };
  PROVIDER_CIRCUIT_STATE.set(key, seeded);
  return seeded;
}

function isProviderAvailable(provider) {
  const circuit = getProviderCircuit(provider);
  return Date.now() >= Number(circuit.cooldownUntil || 0);
}

function markProviderFailure(provider, errorMessage = '') {
  const circuit = getProviderCircuit(provider);
  circuit.failures = Number(circuit.failures || 0) + 1;
  circuit.lastError = String(errorMessage || '').trim();
  if (circuit.failures >= SEARCH_CONFIG.circuitFailureThreshold) {
    circuit.cooldownUntil = Date.now() + SEARCH_CONFIG.circuitCooldownMs;
  }
}

function markProviderSuccess(provider) {
  const circuit = getProviderCircuit(provider);
  circuit.failures = 0;
  circuit.cooldownUntil = 0;
  circuit.lastError = '';
}

function resolveProviderOrder(options = {}) {
  const explicitOrder = options?.providerOrder;
  const envOrder = process.env.RESEARCH_SEARCH_PROVIDER_ORDER;
  const raw = Array.isArray(explicitOrder)
    ? explicitOrder.join(',')
    : String(explicitOrder || envOrder || '').trim();
  const requested = raw
    ? raw
        .split(/[,|]/)
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    : [...SEARCH_CONFIG.defaultProviderOrder];

  const normalized = [];
  const seen = new Set();
  for (const provider of requested) {
    if (!['duckduckgo', 'brave', 'serper', 'searxng', 'bing'].includes(provider)) continue;
    if (seen.has(provider)) continue;
    seen.add(provider);
    normalized.push(provider);
  }

  if (!seen.has('duckduckgo')) normalized.push('duckduckgo');
  return normalized;
}

function resolveSearchTimeout(options = {}, startedAt = Date.now()) {
  const requested = Number(options.timeout || SEARCH_CONFIG.timeout);
  const base = Math.max(2500, Math.min(20000, requested));
  const budget = Math.max(5000, Math.min(22000, requested + 4000));
  const remaining = Math.max(1200, budget - (Date.now() - startedAt));
  return Math.min(base, remaining);
}

function makeRequest(url, options = {}) {
  return withRequestRateLimit(
    () =>
      new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const reqOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: {
            'User-Agent': SEARCH_CONFIG.userAgent,
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.8',
            'Accept-Encoding': 'gzip,deflate,br',
            Connection: 'keep-alive',
            ...options.headers,
          },
          timeout: options.timeout || SEARCH_CONFIG.timeout,
        };

        const req = protocol.request(reqOptions, (res) => {
          const chunks = [];

          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, urlObj).toString();
            return makeRequest(redirectUrl, options).then(resolve).catch(reject);
          }

          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const bodyBuffer = Buffer.concat(chunks);
            const body = decodeResponseBody(bodyBuffer, String(res.headers['content-encoding'] || ''));
            resolve({
              statusCode: Number(res.statusCode || 0),
              headers: res.headers,
              body,
            });
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        if (options.body) {
          req.write(options.body);
        }
        req.end();
      })
  );
}

function parseDuckDuckGoResults(html, maxResults = SEARCH_CONFIG.maxResults) {
  const results = [];
  const safeLimit = Math.max(1, Math.min(200, Number(maxResults || SEARCH_CONFIG.maxResults)));
  const resultPattern = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;
  const titlePattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

  let match;
  while ((match = resultPattern.exec(String(html || ''))) !== null) {
    const resultHtml = match[1];
    const titleMatch = titlePattern.exec(resultHtml);
    if (!titleMatch) continue;

    let url = compactWhitespace(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    if (url.includes('uddg=')) {
      const wrapped = url.match(/uddg=([^&]*)/);
      if (wrapped) url = decodeURIComponent(wrapped[1]);
    }

    const snippetMatch = snippetPattern.exec(resultHtml);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    const normalized = normalizeSearchItem({ title, url, snippet });
    if (!normalized) continue;
    results.push(normalized);
    if (results.length >= safeLimit) break;
  }

  return results;
}

function parseBingRssResults(xml, maxResults = SEARCH_CONFIG.maxResults) {
  const source = String(xml || '');
  const safeLimit = Math.max(1, Math.min(200, Number(maxResults || SEARCH_CONFIG.maxResults)));
  const results = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(source)) !== null) {
    const block = itemMatch[1];
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i);

    const title = stripHtml(titleMatch ? titleMatch[1] : '');
    const url = stripHtml(linkMatch ? linkMatch[1] : '');
    const snippet = stripHtml(descMatch ? descMatch[1] : '');
    const normalized = normalizeSearchItem({ title, url, snippet });
    if (!normalized) continue;
    results.push(normalized);
    if (results.length >= safeLimit) break;
  }
  return results;
}

async function searchViaDuckDuckGo(query, options = {}, startedAt = Date.now()) {
  const maxResults = Math.max(1, Math.min(200, Number(options.maxResults || SEARCH_CONFIG.maxResults)));
  const encoded = encodeURIComponent(query);
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encoded}&kl=us-en`,
  ];

  let lastError = '';
  let lastStatusCode = 0;
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 1; attempt += 1) {
      try {
        const timeout = resolveSearchTimeout(options, startedAt);
        const response = await makeRequest(endpoint, {
          timeout,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://duckduckgo.com/',
            DNT: '1',
          },
        });
        lastStatusCode = Number(response.statusCode || 0);
        if (response.statusCode !== 200) {
          lastError = `duckduckgo status ${response.statusCode}`;
          if (response.statusCode === 403 || response.statusCode === 429) break;
          continue;
        }

        const results = parseDuckDuckGoResults(response.body, maxResults);
        if (
          results.length === 0 &&
          /unusual traffic|automated requests|captcha|verify you are human/i.test(String(response.body || ''))
        ) {
          lastError = 'duckduckgo_rate_limited';
          lastStatusCode = 429;
          break;
        }

        return { provider: 'duckduckgo', statusCode: response.statusCode, results };
      } catch (error) {
        lastError = String(error?.message || error || 'duckduckgo_error');
        if (attempt === 0) await sleep(450);
      }
    }
  }
  return { provider: 'duckduckgo', statusCode: lastStatusCode || 0, results: [], error: lastError || 'duckduckgo_failed' };
}

async function searchViaBrave(query, options = {}, startedAt = Date.now()) {
  const apiKey = String(options.braveApiKey || process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!apiKey) {
    return { provider: 'brave', statusCode: 0, results: [], skipped: true, error: 'missing_brave_api_key' };
  }

  const count = Math.max(1, Math.min(20, Number(options.maxResults || SEARCH_CONFIG.maxResults)));
  const requestUrl =
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=us&search_lang=en`;
  const response = await makeRequest(requestUrl, {
    timeout: resolveSearchTimeout(options, startedAt),
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });
  if (response.statusCode !== 200) {
    return { provider: 'brave', statusCode: response.statusCode, results: [], error: `brave status ${response.statusCode}` };
  }
  const payload = parseMaybeJson(response.body, {});
  const list = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  const results = dedupeResults(
    list.map((item) => ({
      title: item?.title,
      url: item?.url,
      snippet: item?.description || item?.snippet || '',
    })),
    count
  );
  return { provider: 'brave', statusCode: response.statusCode, results };
}

async function searchViaSerper(query, options = {}, startedAt = Date.now()) {
  const apiKey = String(options.serperApiKey || process.env.SERPER_API_KEY || '').trim();
  if (!apiKey) {
    return { provider: 'serper', statusCode: 0, results: [], skipped: true, error: 'missing_serper_api_key' };
  }

  const count = Math.max(1, Math.min(20, Number(options.maxResults || SEARCH_CONFIG.maxResults)));
  const response = await makeRequest('https://google.serper.dev/search', {
    method: 'POST',
    timeout: resolveSearchTimeout(options, startedAt),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: count,
      gl: 'us',
      hl: 'en',
      autocorrect: false,
    }),
  });
  if (response.statusCode !== 200) {
    return { provider: 'serper', statusCode: response.statusCode, results: [], error: `serper status ${response.statusCode}` };
  }
  const payload = parseMaybeJson(response.body, {});
  const list = Array.isArray(payload?.organic) ? payload.organic : [];
  const results = dedupeResults(
    list.map((item) => ({
      title: item?.title,
      url: item?.link,
      snippet: item?.snippet || '',
    })),
    count
  );
  return { provider: 'serper', statusCode: response.statusCode, results };
}

async function searchViaSearxng(query, options = {}, startedAt = Date.now()) {
  const baseUrl = String(options.searxngUrl || process.env.SEARXNG_URL || process.env.RESEARCH_SEARXNG_URL || '').trim();
  if (!baseUrl) {
    return { provider: 'searxng', statusCode: 0, results: [], skipped: true, error: 'missing_searxng_url' };
  }

  const count = Math.max(1, Math.min(30, Number(options.maxResults || SEARCH_CONFIG.maxResults)));
  const requestUrl = `${baseUrl.replace(/\/+$/, '')}/search?format=json&q=${encodeURIComponent(query)}&language=en-US`;
  const response = await makeRequest(requestUrl, {
    timeout: resolveSearchTimeout(options, startedAt),
    headers: {
      Accept: 'application/json',
    },
  });
  if (response.statusCode !== 200) {
    return { provider: 'searxng', statusCode: response.statusCode, results: [], error: `searxng status ${response.statusCode}` };
  }
  const payload = parseMaybeJson(response.body, {});
  const list = Array.isArray(payload?.results) ? payload.results : [];
  const results = dedupeResults(
    list.map((item) => ({
      title: item?.title,
      url: item?.url,
      snippet: item?.content || item?.snippet || '',
    })),
    count
  );
  return { provider: 'searxng', statusCode: response.statusCode, results };
}

async function searchViaBingRss(query, options = {}, startedAt = Date.now()) {
  const count = Math.max(1, Math.min(30, Number(options.maxResults || SEARCH_CONFIG.maxResults)));
  const requestUrl = `https://www.bing.com/search?format=rss&setlang=en-us&q=${encodeURIComponent(query)}`;
  const response = await makeRequest(requestUrl, {
    timeout: resolveSearchTimeout(options, startedAt),
    headers: {
      Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      Referer: 'https://www.bing.com/',
      DNT: '1',
    },
  });
  if (response.statusCode !== 200) {
    return { provider: 'bing', statusCode: response.statusCode, results: [], error: `bing status ${response.statusCode}` };
  }
  const results = dedupeResults(parseBingRssResults(response.body, count), count);
  return { provider: 'bing', statusCode: response.statusCode, results };
}

const PROVIDER_HANDLERS = {
  brave: searchViaBrave,
  serper: searchViaSerper,
  searxng: searchViaSearxng,
  bing: searchViaBingRss,
  duckduckgo: searchViaDuckDuckGo,
};

async function searchWeb(query, options = {}) {
  const startedAt = Date.now();
  const maxResults = Math.max(1, Math.min(200, Number(options.maxResults || SEARCH_CONFIG.maxResults)));

  if (!query || typeof query !== 'string') {
    return { results: [], query: '', took: 0, error: 'Invalid query', provider: null, statusCode: 0 };
  }

  const normalizedQuery = compactWhitespace(query);
  if (!normalizedQuery) {
    return { results: [], query: '', took: 0, error: 'Invalid query', provider: null, statusCode: 0 };
  }

  console.log(`[WebSearch] Searching: "${normalizedQuery}"`);
  const providers = resolveProviderOrder(options);
  const providerErrors = [];
  for (const provider of providers) {
    const handler = PROVIDER_HANDLERS[provider];
    if (!handler) continue;
    if (!isProviderAvailable(provider)) {
      const state = getProviderCircuit(provider);
      providerErrors.push(`${provider}:cooldown`);
      console.warn(`[WebSearch] Provider ${provider} is cooling down (${Math.max(0, Math.round((state.cooldownUntil - Date.now()) / 1000))}s left)`);
      continue;
    }

    try {
      const result = await handler(normalizedQuery, { ...options, maxResults }, startedAt);
      const deduped = dedupeResults(result?.results || [], maxResults);
      if (deduped.length > 0) {
        markProviderSuccess(provider);
        console.log(`[WebSearch] ${provider} returned ${deduped.length} results in ${Date.now() - startedAt}ms`);
        return {
          results: deduped,
          query: normalizedQuery,
          took: Date.now() - startedAt,
          provider,
          statusCode: Number(result?.statusCode || 200),
          providerErrors,
        };
      }

      if (!result?.skipped) {
        const errorText = String(result?.error || `${provider}_no_results`).trim();
        markProviderFailure(provider, errorText);
        providerErrors.push(`${provider}:${errorText}`);
      }
    } catch (error) {
      const errorText = String(error?.message || error || `${provider}_failed`);
      markProviderFailure(provider, errorText);
      providerErrors.push(`${provider}:${errorText}`);
    }
  }

  return {
    results: [],
    query: normalizedQuery,
    took: Date.now() - startedAt,
    provider: null,
    statusCode: 0,
    error: providerErrors.length > 0 ? providerErrors.join(' | ') : 'Search unavailable',
    providerErrors,
  };
}

function extractTextFromHtml(html = '', maxLength = 8000) {
  const source = String(html || '');
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';
  let content = '';

  const articleMatch = source.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) content = stripHtml(articleMatch[1]);

  if (!content) {
    const mainMatch = source.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) content = stripHtml(mainMatch[1]);
  }

  if (!content) {
    const contentPatterns = [
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
      /<section[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
      /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ];
    for (const pattern of contentPatterns) {
      const match = source.match(pattern);
      if (match) {
        content = stripHtml(match[1]);
        break;
      }
    }
  }

  if (!content) {
    const bodyMatch = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const body = String(bodyMatch[1] || '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
      content = stripHtml(body);
    }
  }

  return {
    title: compactWhitespace(title),
    content: compactWhitespace(content).slice(0, Math.max(200, Number(maxLength || 8000))),
  };
}

function resolveBrowserExecutable() {
  const fromEnv = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.BROWSER_EXECUTABLE_PATH,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  for (const candidate of fromEnv) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const windowsCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const candidate of windowsCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

async function fetchRenderedPageContent(url, options = {}) {
  const enableHeadless = String(options.enableHeadless ?? process.env.RESEARCH_ENABLE_HEADLESS_FETCH ?? 'true')
    .trim()
    .toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(enableHeadless)) return null;

  let puppeteer = null;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    puppeteer = require('puppeteer-core');
  } catch (_error) {
    return null;
  }

  const executablePath = resolveBrowserExecutable();
  if (!executablePath) return null;

  const timeout = Math.max(5000, Math.min(25000, Number(options.timeout || SEARCH_CONFIG.timeout) + 7000));
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout,
    });
    const page = await browser.newPage();
    await page.setUserAgent(SEARCH_CONFIG.userAgent);
    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    const payload = await page.evaluate(() => {
      const title = document?.title || '';
      const source =
        document.querySelector('article')?.innerText
        || document.querySelector('main')?.innerText
        || document.body?.innerText
        || '';
      return {
        title: String(title || '').trim(),
        content: String(source || '').replace(/\s+/g, ' ').trim(),
      };
    });
    return {
      title: compactWhitespace(payload?.title || ''),
      content: compactWhitespace(payload?.content || ''),
    };
  } catch (_error) {
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_error) {
        // ignore
      }
    }
  }
}

async function fetchPageContent(url, options = {}) {
  const maxLength = Math.max(1000, Math.min(60000, Number(options.maxLength || 8000)));
  const timeout = Math.max(2500, Math.min(20000, Number(options.timeout || SEARCH_CONFIG.timeout)));
  const minUsefulTextLength = Math.max(180, Math.min(3000, Number(options.minUsefulTextLength || 650)));

  try {
    console.log(`[WebSearch] Fetching: ${url}`);
    const response = await makeRequest(url, { timeout });
    if (response.statusCode !== 200) {
      return { content: '', title: '', url, error: `HTTP ${response.statusCode}`, statusCode: response.statusCode };
    }

    const staticExtract = extractTextFromHtml(response.body, maxLength);
    let best = {
      content: staticExtract.content,
      title: staticExtract.title,
      url,
      statusCode: response.statusCode,
      rendered: false,
    };

    if ((best.content || '').length < minUsefulTextLength) {
      const rendered = await fetchRenderedPageContent(url, { ...options, timeout });
      if (rendered && (rendered.content || '').length > (best.content || '').length) {
        best = {
          content: rendered.content.slice(0, maxLength),
          title: rendered.title || best.title,
          url,
          statusCode: response.statusCode,
          rendered: true,
        };
      }
    }

    best.content = compactWhitespace(best.content).slice(0, maxLength);
    best.title = compactWhitespace(best.title);
    return best;
  } catch (error) {
    console.error('[WebSearch] Fetch error:', error.message);
    return { content: '', title: '', url, error: error.message, statusCode: 0 };
  }
}

function formatResultsForContext(results) {
  if (!results || results.length === 0) return 'No search results found.';
  return results
    .map((item, index) => `[${index + 1}] ${item.title}\n    URL: ${item.url}\n    ${item.snippet || ''}`.trim())
    .join('\n\n');
}

function parseSearchToolCalls(content) {
  if (!content) return [];
  const pattern = /\[SEARCH:\s*([^\]]+)\]/gi;
  const queries = [];
  let match;
  while ((match = pattern.exec(String(content || ''))) !== null) {
    queries.push(compactWhitespace(match[1]));
  }
  return queries.filter(Boolean);
}

function hasSearchToolCall(content) {
  return /\[SEARCH:\s*[^\]]+\]/i.test(String(content || ''));
}

module.exports = {
  searchWeb,
  fetchPageContent,
  formatResultsForContext,
  parseSearchToolCalls,
  hasSearchToolCall,
  SEARCH_CONFIG,
};
