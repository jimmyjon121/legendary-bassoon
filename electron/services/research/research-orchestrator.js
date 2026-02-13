const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { searchWeb, fetchPageContent } = require('../web-search-service');
const {
  classifySource,
  mergeSourcePolicy,
  normalizeUrl,
  normalizeDomain,
} = require('./research-source-policy');
const {
  DEFAULT_STARTER_SCHEMA,
  normalizeSchema,
  validateRecordAgainstSchema,
  extractRecordFromOfficialPage,
  validateInstructionCompliance,
} = require('./research-schema');

const PHASES = ['discover', 'official_verify', 'extract_fields', 'evidence_validate', 'persist'];
const PRIORITY_ORDER = ['persist', 'evidence_validate', 'extract_fields', 'official_verify', 'discover'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function safeParseJson(input, fallback) {
  if (!input || typeof input !== 'string') return fallback;
  try {
    return JSON.parse(input);
  } catch (_error) {
    return fallback;
  }
}

function safeStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? {});
  } catch (_error) {
    return fallback;
  }
}

function normalizeTaskPayload(task = {}) {
  return {
    id: task.id || uuidv4(),
    phase: task.phase || 'discover',
    payload: task.payload || {},
    retries: Number(task.retries || 0),
    createdAt: task.createdAt || Date.now(),
  };
}

const TOKEN_CORRECTIONS = new Map([
  ['adoelscent', 'adolescent'],
  ['adolesent', 'adolescent'],
  ['adolescant', 'adolescent'],
  ['residental', 'residential'],
  ['resdiential', 'residential'],
  ['theraphy', 'therapy'],
  ['behavorial', 'behavioral'],
]);

const QUERY_NOISE_TERMS = new Set([
  'conversational',
  'criteria',
  'constraint',
  'constraints',
  'clarification',
  'clarifications',
  'question',
  'questions',
  'instruction',
  'instructions',
  'follow',
  'follows',
  'following',
  'prompt',
  'prompts',
  'scope',
  'statewide',
  'coverage',
  'find',
  'all',
  'need',
  'needs',
  'please',
  'show',
  'list',
  'helper',
  'assistant',
  'chat',
  'setup',
  'project',
  'research',
  'discovery',
  'broad',
  'ambiguous',
  'short',
  'before',
  'after',
  'claims',
  'pages',
  'websites',
]);

const FOLLOW_UP_TITLE_BLOCKLIST = [
  'best',
  'top',
  'directory',
  'directories',
  'review',
  'reviews',
  'pricing',
  'compare',
  'comparison',
  'troubled teen',
  'psychology today',
  'mytroubledteen',
  'rehab centers',
];

function normalizeTopicToken(token = '') {
  const cleaned = String(token || '').toLowerCase().trim();
  if (!cleaned) return '';
  return TOKEN_CORRECTIONS.get(cleaned) || cleaned;
}

function extractKeywords(text = '', limit = 8) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => normalizeTopicToken(word))
    .filter((word) => word.length >= 5)
    .filter((word) => !['about', 'their', 'there', 'which', 'where', 'official', 'program', 'service', 'information', 'website'].includes(word))
    .filter((word) => !QUERY_NOISE_TERMS.has(word));
  const seen = new Set();
  const picked = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    picked.push(word);
    if (picked.length >= limit) break;
  }
  return picked;
}

function extractLocationHint(text = '') {
  const raw = String(text || '');
  const lowered = raw.toLowerCase();
  const explicitCodes = new Set(extractExplicitStateCodes(raw));
  const matchedStates = [];

  for (const [stateName, code] of US_STATE_ALIASES) {
    const codeToken = String(code || '').toLowerCase();
    if (containsToken(lowered, stateName) || explicitCodes.has(codeToken)) {
      matchedStates.push(stateName);
    }
  }
  if (matchedStates.length > 0) {
    return matchedStates[matchedStates.length - 1];
  }

  const match = raw.match(/\b(?:in|across|within|near)\s+([A-Za-z][A-Za-z\s-]{2,40})(?:[,.]|$)/i);
  if (!match) return '';
  return String(match[1] || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(the\s+state\s+of\s+)/i, '');
}

const GENERIC_DISCOVERY_TERMS = [
  'official source',
  'primary source',
  'documentation',
  'reference page',
  'technical report',
];

function pickCareLevelSearchTerms(text = '') {
  const keywords = extractKeywords(text, 8);
  if (keywords.length === 0) {
    return GENERIC_DISCOVERY_TERMS;
  }
  return Array.from(new Set(
    keywords
      .slice(0, 5)
      .map((keyword) => `${keyword} overview`)
  ));
}

function normalizeSearchQuery(query = '') {
  const tokens = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => normalizeTopicToken(token))
    .filter(Boolean);
  if (tokens.length === 0) return '';
  const words = [];
  for (const token of tokens) {
    if (QUERY_NOISE_TERMS.has(token)) continue;
    words.push(token);
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

function extractScopedInstructionHints(runInstructions = '') {
  const lines = String(runInstructions || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const scopedLines = lines.filter((line) => {
    const lowered = line.toLowerCase();
    return lowered.startsWith('- geography:')
      || lowered.startsWith('- timeframe:')
      || lowered.startsWith('- entity focus:')
      || lowered.startsWith('- constraints:')
      || lowered.startsWith('- additional notes:')
      || lowered.startsWith('- topic:')
      || lowered.startsWith('- include:')
      || lowered.startsWith('- exclude:');
  });
  return scopedLines.join(' ');
}

function cleanFollowUpTitle(title = '') {
  let cleaned = String(title || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.includes(' - ')) cleaned = cleaned.split(' - ')[0].trim();
  if (cleaned.includes(' | ')) cleaned = cleaned.split(' | ')[0].trim();

  const lowered = cleaned.toLowerCase();
  if (FOLLOW_UP_TITLE_BLOCKLIST.some((term) => lowered.includes(term))) return '';
  if (/\b\d{2,}\b/.test(lowered) && /\b(best|top)\b/.test(lowered)) return '';

  const words = cleaned.split(/\s+/);
  if (words.length < 2 || words.length > 10) return '';
  if (/\b(in|near)\s+[A-Za-z][A-Za-z\s-]{2,40}$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\b(in|near)\s+[A-Za-z][A-Za-z\s-]{2,40}$/i, '').trim();
  }
  return cleaned;
}

function buildOfficialFollowUpQuery({ title = '', objective = '', locationHint = '' } = {}) {
  const entity = cleanFollowUpTitle(title);
  if (!entity) return '';
  const location = String(locationHint || extractLocationHint(objective) || '').trim();
  const parts = [entity];
  if (location) parts.push(`in ${location}`);
  parts.push('official website');
  return normalizeSearchQuery(parts.join(' '));
}

function buildDomainProgramPhrase(term = '') {
  const token = normalizeTopicToken(term);
  if (!token) return '';
  if (token.length < 3) return '';
  if (['official', 'source', 'website', 'websites', 'page', 'pages'].includes(token)) return '';
  return `${token} topic`;
}

const RESEARCH_DEPTH_PRESETS = {
  standard: {
    minRuntimeMinutes: 6,
    minDiscoveredCandidates: 80,
    minSearchesIssued: 10,
    minVerifiedRecords: 3,
    maxSearchResultsPerQuery: 16,
    maxDiscoverDepth: 2,
    maxFollowUpsPerQuery: 2,
    seedQueryLimit: 16,
    convergenceThreshold: 6,
    strictTopicMatching: true,
    minTopicRelevanceScore: 4.5,
  },
  deep: {
    minRuntimeMinutes: 20,
    minDiscoveredCandidates: 300,
    minSearchesIssued: 30,
    minVerifiedRecords: 6,
    maxSearchResultsPerQuery: 24,
    maxDiscoverDepth: 4,
    maxFollowUpsPerQuery: 4,
    seedQueryLimit: 30,
    convergenceThreshold: 10,
    strictTopicMatching: true,
    minTopicRelevanceScore: 5.2,
  },
  exhaustive: {
    minRuntimeMinutes: 45,
    minDiscoveredCandidates: 800,
    minSearchesIssued: 60,
    minVerifiedRecords: 10,
    maxSearchResultsPerQuery: 32,
    maxDiscoverDepth: 5,
    maxFollowUpsPerQuery: 6,
    seedQueryLimit: 48,
    convergenceThreshold: 14,
    strictTopicMatching: true,
    minTopicRelevanceScore: 5.6,
  },
};

const DEFAULT_DEPTH_PRESET = 'deep';

const TOPIC_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'all', 'also', 'among', 'and', 'any', 'are', 'because', 'been',
  'being', 'between', 'both', 'build', 'can', 'cannot', 'care', 'collect', 'create', 'data', 'database',
  'details', 'does', 'each', 'every', 'find', 'for', 'from', 'have', 'help', 'into', 'just', 'like', 'many',
  'more', 'most', 'need', 'official', 'only', 'options', 'other', 'our', 'please', 'program', 'programs',
  'project', 'record', 'records', 'research', 'services', 'should', 'that', 'the', 'their', 'them', 'there',
  'these', 'they', 'this', 'those', 'through', 'what', 'when', 'where', 'which', 'with', 'within', 'without',
  'would', 'your', 'website', 'websites', 'page', 'pages', 'instruction', 'instructions', 'constraint',
  'constraints', 'criteria', 'clarify', 'clarification', 'question', 'questions', 'conversation',
  'conversational', 'assistant', 'setup', 'scope', 'statewide', 'coverage', 'broad', 'short', 'ambiguous',
  'before', 'afterward', 'follow', 'following', 'prompt', 'prompts', 'claim', 'claims',
]);

const TOPIC_DOMAIN_TERMS = [
  'api',
  'documentation',
  'specification',
  'framework',
  'platform',
  'policy',
  'regulation',
  'guideline',
  'report',
  'dataset',
  'announcement',
  'release',
  'pricing',
  'roadmap',
  'standard',
  'benchmark',
  'whitepaper',
];

const TOPIC_EXCLUDE_TERMS = [];

const US_STATE_ALIASES = [
  ['alabama', 'al'],
  ['alaska', 'ak'],
  ['arizona', 'az'],
  ['arkansas', 'ar'],
  ['california', 'ca'],
  ['colorado', 'co'],
  ['connecticut', 'ct'],
  ['delaware', 'de'],
  ['florida', 'fl'],
  ['georgia', 'ga'],
  ['hawaii', 'hi'],
  ['idaho', 'id'],
  ['illinois', 'il'],
  ['indiana', 'in'],
  ['iowa', 'ia'],
  ['kansas', 'ks'],
  ['kentucky', 'ky'],
  ['louisiana', 'la'],
  ['maine', 'me'],
  ['maryland', 'md'],
  ['massachusetts', 'ma'],
  ['michigan', 'mi'],
  ['minnesota', 'mn'],
  ['mississippi', 'ms'],
  ['missouri', 'mo'],
  ['montana', 'mt'],
  ['nebraska', 'ne'],
  ['nevada', 'nv'],
  ['new hampshire', 'nh'],
  ['new jersey', 'nj'],
  ['new mexico', 'nm'],
  ['new york', 'ny'],
  ['north carolina', 'nc'],
  ['north dakota', 'nd'],
  ['ohio', 'oh'],
  ['oklahoma', 'ok'],
  ['oregon', 'or'],
  ['pennsylvania', 'pa'],
  ['rhode island', 'ri'],
  ['south carolina', 'sc'],
  ['south dakota', 'sd'],
  ['tennessee', 'tn'],
  ['texas', 'tx'],
  ['utah', 'ut'],
  ['vermont', 'vt'],
  ['virginia', 'va'],
  ['washington', 'wa'],
  ['west virginia', 'wv'],
  ['wisconsin', 'wi'],
  ['wyoming', 'wy'],
  ['district of columbia', 'dc'],
];

function extractExplicitStateCodes(text = '') {
  return (String(text || '').match(/\b[A-Z]{2}\b/g) || [])
    .map((code) => code.toLowerCase());
}

function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeDepthPreset(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value && RESEARCH_DEPTH_PRESETS[value]) return value;
  return DEFAULT_DEPTH_PRESET;
}

function normalizeResearchSettings(rawSettings = {}) {
  const preset = normalizeDepthPreset(rawSettings?.depthPreset);
  const base = RESEARCH_DEPTH_PRESETS[preset];
  const providerOrder = Array.isArray(rawSettings?.searchProviderOrder)
    ? rawSettings.searchProviderOrder
    : String(rawSettings?.searchProviderOrder || '')
      .split(/[,|]/)
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  return {
    ...base,
    depthPreset: preset,
    strictTopicMatching: rawSettings?.strictTopicMatching !== false,
    minRuntimeMinutes: clampInt(rawSettings?.minRuntimeMinutes, base.minRuntimeMinutes, 1, 720),
    minDiscoveredCandidates: clampInt(rawSettings?.minDiscoveredCandidates, base.minDiscoveredCandidates, 10, 50000),
    minSearchesIssued: clampInt(rawSettings?.minSearchesIssued, base.minSearchesIssued, 1, 20000),
    minVerifiedRecords: clampInt(rawSettings?.minVerifiedRecords, base.minVerifiedRecords, 0, 10000),
    maxSearchResultsPerQuery: clampInt(rawSettings?.maxSearchResultsPerQuery, base.maxSearchResultsPerQuery, 5, 120),
    maxDiscoverDepth: clampInt(rawSettings?.maxDiscoverDepth, base.maxDiscoverDepth, 1, 12),
    maxFollowUpsPerQuery: clampInt(rawSettings?.maxFollowUpsPerQuery, base.maxFollowUpsPerQuery, 0, 12),
    seedQueryLimit: clampInt(rawSettings?.seedQueryLimit, base.seedQueryLimit, 5, 80),
    convergenceThreshold: clampInt(rawSettings?.convergenceThreshold, base.convergenceThreshold, 3, 40),
    minTopicRelevanceScore: Math.max(1, Math.min(20, Number(rawSettings?.minTopicRelevanceScore || base.minTopicRelevanceScore))),
    enableFinalSynthesis: rawSettings?.enableFinalSynthesis !== false,
    synthesisRecordLimit: clampInt(rawSettings?.synthesisRecordLimit, 120, 20, 400),
    searchProviderOrder: Array.from(new Set(providerOrder)).filter((provider) =>
      ['brave', 'serper', 'searxng', 'bing', 'duckduckgo'].includes(provider)
    ),
    searxngUrl: String(rawSettings?.searxngUrl || '').trim(),
  };
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeText(input = '', { minLen = 3, limit = 40 } = {}) {
  const words = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => normalizeTopicToken(word.trim()))
    .filter((word) => word.length >= minLen)
    .filter((word) => !TOPIC_STOPWORDS.has(word))
    .filter((word) => !QUERY_NOISE_TERMS.has(word));
  const seen = new Set();
  const output = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    output.push(word);
    if (output.length >= limit) break;
  }
  return output;
}

function containsToken(haystack = '', token = '') {
  const text = String(haystack || '').toLowerCase();
  const needle = String(token || '').toLowerCase().trim();
  if (!text || !needle) return false;
  const parts = needle
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.length === 1) {
    return new RegExp(`\\b${escapeRegex(parts[0])}\\b`, 'i').test(text);
  }
  const pattern = parts.map((part) => escapeRegex(part)).join('[\\s\\-_\\/]+');
  return new RegExp(`\\b${pattern}\\b`, 'i').test(text);
}

function extractStateTokens(text = '') {
  const raw = String(text || '');
  const haystack = raw.toLowerCase();
  const explicitCodes = new Set(extractExplicitStateCodes(raw));
  const tokens = new Set();
  for (const [stateName, code] of US_STATE_ALIASES) {
    const codeToken = String(code || '').toLowerCase();
    if (containsToken(haystack, stateName) || explicitCodes.has(codeToken)) {
      tokens.add(stateName);
      tokens.add(codeToken);
    }
  }
  return Array.from(tokens);
}

function buildTopicProfile({ objective = '', runInstructions = '', promptSnapshot = {} } = {}) {
  const objectiveText = String(objective || '').trim();
  const instructionsText = [
    String(runInstructions || ''),
    String(promptSnapshot?.permanentInstructions || ''),
  ].join(' ');
  const locationHint = extractLocationHint(objectiveText) || extractLocationHint(instructionsText);
  const objectiveTokens = tokenizeText(objectiveText, { minLen: 3, limit: 26 });
  const instructionTokens = tokenizeText(instructionsText, { minLen: 4, limit: 16 });
  const combinedTokens = Array.from(new Set([...objectiveTokens, ...instructionTokens]));
  const seededDomainTerms = Array.from(new Set(
    TOPIC_DOMAIN_TERMS.filter((term) => containsToken(combinedTokens.join(' '), term))
  ));
  const inferredDomainTerms = Array.from(new Set(
    [...objectiveTokens, ...instructionTokens]
      .map((token) => normalizeTopicToken(token))
      .filter((token) => token.length >= 4)
      .filter((token) => !QUERY_NOISE_TERMS.has(token))
  ));
  const effectiveDomainTerms = Array.from(new Set([...seededDomainTerms, ...inferredDomainTerms])).slice(0, 20);
  const locationTokens = Array.from(new Set([
    ...extractStateTokens(`${objectiveText} ${instructionsText}`),
    ...tokenizeText(locationHint, { minLen: 2, limit: 8 }),
  ]));

  return {
    objectiveText,
    locationHint: locationHint || '',
    objectiveTokens,
    instructionTokens,
    locationTokens,
    domainTerms: effectiveDomainTerms,
    broadTerms: combinedTokens,
    excludeTerms: TOPIC_EXCLUDE_TERMS,
  };
}

function scoreTopicRelevance(candidate = {}, topicProfile = {}, settings = {}) {
  const title = String(candidate.title || '').trim();
  const snippet = String(candidate.snippet || '').trim();
  const url = String(candidate.url || '').trim();
  const content = String(candidate.content || '').trim();
  const haystack = [title, snippet, url, content].filter(Boolean).join(' ').toLowerCase();

  const objectiveMatches = (topicProfile.objectiveTokens || []).filter((token) => containsToken(haystack, token));
  const domainMatches = (topicProfile.domainTerms || []).filter((token) => containsToken(haystack, token));
  const locationMatches = (topicProfile.locationTokens || []).filter((token) => containsToken(haystack, token));
  const excludeMatches = (topicProfile.excludeTerms || []).filter((token) => containsToken(haystack, token));

  let score = 0;
  score += Math.min(objectiveMatches.length, 10) * 1.2;
  score += Math.min(domainMatches.length, 8) * 2.4;
  score += Math.min(locationMatches.length, 4) * 1.8;
  score -= Math.min(excludeMatches.length, 4) * 3.5;

  const hasDomainIntent = domainMatches.length > 0;
  const hasObjectiveSignal = objectiveMatches.length > 0 || locationMatches.length > 0;
  const strictTopicMatching = settings?.strictTopicMatching !== false;
  const domainTermCount = Array.isArray(topicProfile?.domainTerms) ? topicProfile.domainTerms.length : 0;
  const requireDomainIntent = strictTopicMatching && domainTermCount > 0;
  const minScore = Number(settings?.minTopicRelevanceScore || 4.5);

  let isRelevant = score >= minScore;
  if (strictTopicMatching) {
    if (requireDomainIntent && !hasDomainIntent) isRelevant = false;
    if (!hasObjectiveSignal) isRelevant = false;
  }
  if (excludeMatches.length > 0 && (!requireDomainIntent || !hasDomainIntent)) {
    isRelevant = false;
  }

  return {
    isRelevant,
    score: Number(score.toFixed(2)),
    objectiveMatches,
    domainMatches,
    locationMatches,
    excludeMatches,
    reason: isRelevant
      ? 'topic_relevant'
      : excludeMatches.length > 0
        ? 'excluded_off_topic'
        : 'insufficient_topic_relevance',
  };
}

function humanizeReason(reason = '') {
  const text = String(reason || '').trim();
  if (!text) return '';
  return text
    .replace(/^retry_\d+:/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPhaseLabel(phase = '') {
  const value = String(phase || '').trim();
  if (!value) return 'Task';
  if (value === 'official_verify') return 'Official Verify';
  if (value === 'extract_fields') return 'Extract Fields';
  if (value === 'evidence_validate') return 'Evidence Validate';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildStatsSkeleton() {
  return {
    searchesIssued: 0,
    discoveredCandidates: 0,
    verifiedOfficialCandidates: 0,
    pagesFetched: 0,
    extractedRecords: 0,
    validatedRecords: 0,
    verifiedSaved: 0,
    rejectedBlocked: 0,
    rejectedNonOfficial: 0,
    rejectedIrrelevant: 0,
    deduped: 0,
    errors: 0,
    lastError: null,
  };
}

function truncateText(input = '', maxLen = 240) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function firstDefinedField(record = {}, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item || '').trim()).filter(Boolean).join(', ');
      if (joined) return joined;
      continue;
    }
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function buildFallbackSynthesisMarkdown({ runState, records = [], goals = null } = {}) {
  const stats = runState?.stats || {};
  const goalProgress = goals || runState?.goalProgress || null;
  const lines = [];
  lines.push('# Final Research Synthesis');
  lines.push('');
  lines.push('## Objective');
  lines.push(String(runState?.objective || 'Not provided'));
  lines.push('');
  lines.push('## Coverage Metrics');
  lines.push(`- Discovered candidates: ${Number(stats.discoveredCandidates || 0)}`);
  lines.push(`- Searches issued: ${Number(stats.searchesIssued || 0)}`);
  lines.push(`- Verified records saved: ${Number(stats.verifiedSaved || 0)}`);
  lines.push(`- Rejected (non-official): ${Number(stats.rejectedNonOfficial || 0)}`);
  lines.push(`- Rejected (blocked): ${Number(stats.rejectedBlocked || 0)}`);
  lines.push(`- Rejected (irrelevant): ${Number(stats.rejectedIrrelevant || 0)}`);
  if (goalProgress?.current?.elapsedMinutes !== undefined) {
    lines.push(`- Runtime minutes: ${Math.floor(Number(goalProgress.current.elapsedMinutes || 0))}`);
  }
  lines.push('');
  lines.push(`## Verified Records (${records.length})`);
  if (records.length === 0) {
    lines.push('- None');
  } else {
    for (const item of records) {
      const record = item.record || {};
      const name = String(record.name || item.canonicalKey || item.canonical_key || item.id || 'Unnamed record').trim();
      const url = String(record.official_url || item.verifiedOfficialUrl || item.verified_official_url || '').trim() || 'Not stated on official site';
      const location = firstDefinedField(record, ['city_state', 'location', 'city']) || [
        String(record.city || '').trim(),
        String(record.state || '').trim(),
      ].filter(Boolean).join(', ') || 'Not stated on official site';
      const summary = firstDefinedField(record, ['summary', 'description', 'focus', 'program_description']) || 'Unknown from provided sources';
      const keyDetails = firstDefinedField(record, ['category', 'status', 'services', 'level_of_care', 'notes']);
      lines.push(`- **${name}**`);
      lines.push(`  - Source URL: ${url}`);
      lines.push(`  - Location: ${location}`);
      lines.push(`  - Summary: ${truncateText(summary, 220)}`);
      if (keyDetails) lines.push(`  - Key details: ${truncateText(keyDetails, 180)}`);
    }
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('- This synthesis was generated from verified record rows and official-source evidence gates.');
  lines.push('- For missing fields, use "Unknown from provided sources" and do not infer beyond source data.');
  return lines.join('\n');
}

function buildIntermediateSummaryText({ runState, recentRecords = [] } = {}) {
  const stats = runState?.stats || {};
  const goal = runState?.goalProgress || null;
  const lines = [];
  lines.push('Progress update');
  lines.push(`- Searches issued: ${Number(stats.searchesIssued || 0)}`);
  lines.push(`- Candidates discovered: ${Number(stats.discoveredCandidates || 0)}`);
  lines.push(`- Official pages fetched: ${Number(stats.pagesFetched || 0)}`);
  lines.push(`- Verified records saved: ${Number(stats.verifiedSaved || 0)}`);
  if (goal?.current?.elapsedMinutes !== undefined) {
    lines.push(`- Runtime: ${Math.floor(Number(goal.current.elapsedMinutes || 0))} minutes`);
  }
  if (Array.isArray(recentRecords) && recentRecords.length > 0) {
    lines.push('- Most recent verified records:');
    for (const row of recentRecords.slice(0, 4)) {
      const record = row.record || {};
      const name = String(record.name || row.canonicalKey || row.canonical_key || '').trim() || 'Unnamed record';
      const location = [String(record.city || '').trim(), String(record.state || '').trim()].filter(Boolean).join(', ');
      const url = String(record.official_url || row.verifiedOfficialUrl || row.verified_official_url || '').trim();
      const parts = [name];
      if (location) parts.push(location);
      if (url) parts.push(url);
      lines.push(`  - ${parts.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

class ResearchOrchestrator extends EventEmitter {
  constructor({ db, saveDatabase, progressSink, synthesisGenerator, extractionGenerator, progressSummaryGenerator } = {}) {
    super();
    this.db = db;
    this.saveDatabase = typeof saveDatabase === 'function' ? saveDatabase : () => {};
    this.progressSink = typeof progressSink === 'function' ? progressSink : null;
    this.synthesisGenerator = typeof synthesisGenerator === 'function' ? synthesisGenerator : null;
    this.extractionGenerator = typeof extractionGenerator === 'function' ? extractionGenerator : null;
    this.progressSummaryGenerator = typeof progressSummaryGenerator === 'function' ? progressSummaryGenerator : null;
    this.defaultWorkerCount = 4;
    this.maxTaskRetries = 3;
    this.convergenceThreshold = 5;
    this.monitorIntervalMs = 4000;
    this.checkpointIntervalMs = 30000;
    this.stallTimeoutMs = 120000;
    this.maxStallRecoveries = 3;
    this.runs = new Map();
  }

  query(sql, params = []) {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  queryOne(sql, params = []) {
    const rows = this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  run(sql, params = []) {
    if (!this.db) return;
    this.db.run(sql, params);
  }

  buildSeedQueries({
    objective = '',
    runInstructions = '',
    promptSnapshot = {},
    researchSettings = normalizeResearchSettings(),
    topicProfile = null,
  }) {
    const objectiveText = String(objective || '').trim();
    const normalizedObjective = normalizeSearchQuery(objectiveText);
    const queries = [];
    const settings = normalizeResearchSettings(researchSettings);
    const profile = topicProfile || buildTopicProfile({
      objective,
      runInstructions,
      promptSnapshot,
    });
    const scopedHintText = extractScopedInstructionHints(runInstructions);
    const searchContext = `${objective} ${scopedHintText}`.trim();
    const locationHint = String(profile.locationHint || extractLocationHint(objectiveText) || '').trim();
    const locationTokenSet = new Set(
      (profile.locationTokens || []).map((token) => normalizeTopicToken(token))
    );
    const objectiveTokens = (profile.objectiveTokens || [])
      .map((token) => normalizeTopicToken(token))
      .filter((token) => !locationTokenSet.has(token))
      .filter((token) => !QUERY_NOISE_TERMS.has(token))
      .slice(0, 10);
    const domainTerms = (profile.domainTerms || [])
      .map((token) => normalizeTopicToken(token))
      .filter((token) => !QUERY_NOISE_TERMS.has(token))
      .slice(0, 8);

    const focusPhrases = [];
    if (objectiveTokens.length >= 2) {
      focusPhrases.push(objectiveTokens.slice(0, 2).join(' '));
    }
    if (objectiveTokens.length >= 4) {
      focusPhrases.push(objectiveTokens.slice(0, 4).join(' '));
    }
    for (const term of pickCareLevelSearchTerms(searchContext).slice(0, 4)) {
      focusPhrases.push(term);
    }
    const intents = ['official source', 'primary source', 'documentation', 'overview', 'contact'];
    const objectiveAlreadyScoped = locationHint
      ? containsToken(normalizedObjective, locationHint)
      : false;

    const objectiveWordCount = normalizedObjective.split(/\s+/).filter(Boolean).length;
    if (normalizedObjective && objectiveWordCount >= 3 && objectiveWordCount <= 30) {
      queries.push(normalizedObjective);
      for (const intent of intents) {
        queries.push(`${normalizedObjective} ${intent}`);
      }
      if (locationHint && !objectiveAlreadyScoped) {
        queries.push(`${normalizedObjective} in ${locationHint}`);
        queries.push(`${normalizedObjective} in ${locationHint} official source`);
      }
    }

    for (const phrase of Array.from(new Set(focusPhrases))) {
      for (const intent of intents) {
        queries.push(`${phrase} ${intent}`);
        if (locationHint) {
          queries.push(`${phrase} in ${locationHint} ${intent}`);
        }
      }
    }

    for (const domainTerm of domainTerms) {
      const domainPhrase = buildDomainProgramPhrase(domainTerm);
      if (!domainPhrase) continue;
      for (const intent of intents) {
        queries.push(`${domainPhrase} ${intent}`);
        if (locationHint) {
          queries.push(`${domainPhrase} in ${locationHint} ${intent}`);
        }
      }
    }

    if (locationHint && objectiveTokens.length > 0 && !objectiveAlreadyScoped) {
      const focusPhrase = objectiveTokens.slice(0, 5).join(' ');
      queries.push(`${focusPhrase} in ${locationHint}`);
      queries.push(`${focusPhrase} in ${locationHint} official source`);
    }

    const hardSeedCap = Math.min(48, Math.max(8, Number(settings.seedQueryLimit || 24)));
    return Array.from(new Set(
      queries
        .map((item) => normalizeSearchQuery(item))
        .filter(Boolean)
        .filter((query) => query.split(/\s+/).length >= 3)
    )).slice(0, hardSeedCap);
  }

  buildConvergenceQuery(runState) {
    const objective = String(runState.objective || '').trim();
    if (!objective) return '';

    const profile = runState.topicProfile || {};
    const locationHint = String(profile.locationHint || extractLocationHint(objective) || '').trim();
    const seen = runState.discoverQueriesSeen || new Set();
    const settings = runState.researchSettings || normalizeResearchSettings();
    const domainTerms = Array.isArray(profile.domainTerms) && profile.domainTerms.length > 0
      ? profile.domainTerms.map((term) => normalizeTopicToken(term))
      : (profile.objectiveTokens || []).map((term) => normalizeTopicToken(term)).slice(0, 6);

    const seededCandidates = this.buildSeedQueries({
      objective,
      runInstructions: runState.runInstructions || '',
      promptSnapshot: runState.promptSnapshot || {},
      researchSettings: {
        ...settings,
        seedQueryLimit: Math.min(64, Math.max(12, Number(settings.seedQueryLimit || 24))),
      },
      topicProfile: profile,
    }).filter((query) => !seen.has(String(query).trim().toLowerCase()));

    const cursor = Number(runState.queryCursor || 0);
    if (seededCandidates.length > 0) {
      const query = seededCandidates[cursor % seededCandidates.length];
      runState.queryCursor = cursor + 1;
      return query;
    }

    const refreshIntents = ['official source', 'primary source', 'documentation', 'overview', 'contact'];
    const scopedHintText = extractScopedInstructionHints(runState.runInstructions || '');
    const searchContext = `${objective} ${scopedHintText}`.trim();
    const focusTerms = Array.from(new Set([
      ...pickCareLevelSearchTerms(searchContext).slice(0, 4),
      ...(profile.objectiveTokens || [])
        .map((token) => normalizeTopicToken(token))
        .filter((token) => token.length >= 3)
        .slice(0, 6),
    ]));
    const fallbackCandidates = [];

    const normalizedObjective = normalizeSearchQuery(objective);
    const objectiveAlreadyScoped = locationHint
      ? containsToken(normalizedObjective, locationHint)
      : false;
    if (normalizedObjective) {
      fallbackCandidates.push(`${normalizedObjective} official source`);
      fallbackCandidates.push(`${normalizedObjective} primary source`);
      fallbackCandidates.push(`${normalizedObjective} documentation`);
      fallbackCandidates.push(`${normalizedObjective} contact`);
      if (locationHint && !objectiveAlreadyScoped) {
        fallbackCandidates.push(`${normalizedObjective} in ${locationHint} official source`);
      }
    }

    for (const careTerm of focusTerms) {
      for (const intent of refreshIntents) {
        fallbackCandidates.push(`${careTerm} ${intent}`);
        if (locationHint) fallbackCandidates.push(`${careTerm} in ${locationHint} ${intent}`);
      }
    }

    for (const domainTerm of domainTerms.slice(0, 5)) {
      const domainPhrase = buildDomainProgramPhrase(domainTerm);
      if (!domainPhrase) continue;
      fallbackCandidates.push(`${domainPhrase} official source`);
      fallbackCandidates.push(`${domainPhrase} documentation`);
      if (locationHint) fallbackCandidates.push(`${domainPhrase} in ${locationHint} official source`);
    }

    const uniqueFallback = Array.from(new Set(
      fallbackCandidates
        .map((query) => normalizeSearchQuery(query))
        .filter(Boolean)
        .filter((query) => query.split(/\s+/).length >= 3)
    ));

    for (let offset = 0; offset < uniqueFallback.length; offset += 1) {
      const candidate = uniqueFallback[(cursor + offset) % uniqueFallback.length];
      if (!seen.has(String(candidate).toLowerCase())) {
        runState.queryCursor = cursor + offset + 1;
        return candidate;
      }
    }

    runState.queryCursor = cursor + 1;
    return normalizeSearchQuery(`${objective} primary source`);
  }

  getGoalProgress(runState) {
    const settings = runState.researchSettings || normalizeResearchSettings();
    const elapsedMs = Math.max(0, Date.now() - Number(runState.runStartedAtMs || Date.now()));
    const elapsedMinutes = elapsedMs / 60000;
    const stats = runState.stats || buildStatsSkeleton();
    const goals = {
      minRuntimeMinutes: Number(settings.minRuntimeMinutes || 0),
      minDiscoveredCandidates: Number(settings.minDiscoveredCandidates || 0),
      minSearchesIssued: Number(settings.minSearchesIssued || 0),
      minVerifiedRecords: Number(settings.minVerifiedRecords || 0),
    };
    const current = {
      elapsedMinutes,
      discoveredCandidates: Number(stats.discoveredCandidates || 0),
      searchesIssued: Number(stats.searchesIssued || 0),
      verifiedRecords: Number(stats.verifiedSaved || 0),
    };
    const reached = {
      runtime: current.elapsedMinutes >= goals.minRuntimeMinutes,
      discovered: current.discoveredCandidates >= goals.minDiscoveredCandidates,
      searches: current.searchesIssued >= goals.minSearchesIssued,
      verified: current.verifiedRecords >= goals.minVerifiedRecords,
    };
    return {
      goals,
      current,
      reached,
      allReached: reached.runtime && reached.discovered && reached.searches && reached.verified,
    };
  }

  runMeetsCompletionGoals(runState) {
    const progress = this.getGoalProgress(runState);
    return progress.allReached;
  }

  ensureRunState(runState) {
    if (!runState.queues) {
      runState.queues = {
        discover: [],
        official_verify: [],
        extract_fields: [],
        evidence_validate: [],
        persist: [],
      };
    }
    if (!runState.workerStatus) runState.workerStatus = new Map();
    if (!runState.discoverQueriesSeen) runState.discoverQueriesSeen = new Set();
    if (!runState.candidateUrlsSeen) runState.candidateUrlsSeen = new Set();
    if (!runState.convergenceCount) runState.convergenceCount = 0;
    if (!runState.stats) runState.stats = buildStatsSkeleton();
    if (!runState.researchSettings) {
      runState.researchSettings = normalizeResearchSettings(
        runState?.promptSnapshot?.researchSettings || {}
      );
    } else {
      runState.researchSettings = normalizeResearchSettings(runState.researchSettings);
    }
    if (!runState.topicProfile) {
      runState.topicProfile = buildTopicProfile({
        objective: runState.objective,
        runInstructions: runState.runInstructions,
        promptSnapshot: runState.promptSnapshot || {},
      });
    }
    if (!Number.isFinite(Number(runState.queryCursor))) runState.queryCursor = 0;
    if (!Number.isFinite(Number(runState.runStartedAtMs))) runState.runStartedAtMs = Date.now();
    if (!Number.isFinite(Number(runState.searchFailureStreak))) runState.searchFailureStreak = 0;
    if (!Number.isFinite(Number(runState.searchBackoffUntil))) runState.searchBackoffUntil = 0;
    if (!Number.isFinite(Number(runState.lastProgressSummaryAt))) runState.lastProgressSummaryAt = 0;
    if (!Number.isFinite(Number(runState.lastProgressSummarySearches))) runState.lastProgressSummarySearches = 0;
    if (!Number.isFinite(Number(runState.lastProgressSummaryVerified))) runState.lastProgressSummaryVerified = 0;
    if (!runState.intermediateSummary) {
      runState.intermediateSummary = runState?.promptSnapshot?.intermediateSummary || null;
    }
    if (!runState.lastSavedCount) runState.lastSavedCount = Number(runState.stats.verifiedSaved || 0);
    if (!runState.lastActivityAt) runState.lastActivityAt = Date.now();
    if (!runState.lastCheckpointAt) runState.lastCheckpointAt = 0;
    if (!runState.stallRecoveries) runState.stallRecoveries = 0;
    if (!runState.workerLoops) runState.workerLoops = [];
    if (!Array.isArray(runState.activityLog)) runState.activityLog = [];
    if (!Number.isFinite(Number(runState.activitySeq))) runState.activitySeq = Number(runState.activityLog.length || 0);
    if (!runState.finalSynthesis) {
      runState.finalSynthesis = runState?.promptSnapshot?.finalSynthesis || null;
    }
    if (runState.domainTally instanceof Map) {
      // Keep as-is.
    } else if (runState.domainTally && typeof runState.domainTally === 'object') {
      runState.domainTally = new Map(Object.entries(runState.domainTally));
    } else {
      runState.domainTally = new Map();
    }
    return runState;
  }

  isTaskPayloadCompliant(phase, payload = {}) {
    if (phase === 'discover') {
      const query = String(payload.query || '').toLowerCase();
      if (!query.trim()) return false;
      const blockedPhrases = [
        'ignore previous instructions',
        'ignore all instructions',
        'system prompt',
        'jailbreak',
      ];
      return !blockedPhrases.some((phrase) => query.includes(phrase));
    }
    if (phase === 'persist') {
      return payload && typeof payload.record === 'object' && String(payload.canonicalKey || '').trim().length > 0;
    }
    return true;
  }

  enqueueTask(runState, phase, payload = {}, dedupeKey = '') {
    if (!PHASES.includes(phase)) return false;
    if (!this.isTaskPayloadCompliant(phase, payload)) return false;
    const state = this.ensureRunState(runState);
    if (phase === 'discover') {
      const normalizedQuery = normalizeSearchQuery(payload.query || '');
      payload.query = normalizedQuery || String(payload.query || '').replace(/\s+/g, ' ').trim();
      const queryKey = String(payload.query || '').trim().toLowerCase();
      if (!queryKey) return false;
      if (state.discoverQueriesSeen.has(queryKey)) return false;
      state.discoverQueriesSeen.add(queryKey);
    }
    if (phase === 'official_verify') {
      const urlKey = normalizeUrl(payload?.candidate?.url || payload?.url || '');
      if (!urlKey) return false;
      if (state.candidateUrlsSeen.has(urlKey)) return false;
      state.candidateUrlsSeen.add(urlKey);
    }
    if (dedupeKey) {
      const key = `${phase}:${dedupeKey}`;
      state.taskKeys = state.taskKeys || new Set();
      if (state.taskKeys.has(key)) return false;
      state.taskKeys.add(key);
    }

    state.queues[phase].push(normalizeTaskPayload({
      phase,
      payload,
    }));
    state.lastActivityAt = Date.now();
    return true;
  }

  dequeueTask(runState) {
    for (const phase of PRIORITY_ORDER) {
      const queue = runState.queues[phase];
      if (Array.isArray(queue) && queue.length > 0) {
        return queue.shift();
      }
    }
    return null;
  }

  queueSize(runState) {
    return PHASES.reduce((sum, phase) => sum + (runState.queues?.[phase]?.length || 0), 0);
  }

  incrementDomainTally(runState, domain, count = 1) {
    const state = this.ensureRunState(runState);
    const normalizedDomain = normalizeDomain(domain || '');
    if (!normalizedDomain) return;
    const existing = Number(state.domainTally.get(normalizedDomain) || 0);
    state.domainTally.set(normalizedDomain, existing + Math.max(1, Number(count || 1)));
  }

  recordDomainCandidates(runState, candidates = []) {
    for (const candidate of candidates || []) {
      const domain = normalizeDomain(candidate?.url || '');
      if (domain) this.incrementDomainTally(runState, domain, 1);
    }
  }

  buildTaskActivityEvent({ task, status = 'completed', output = null, error = null, workerId = '' } = {}) {
    const phase = String(task?.phase || '').trim();
    const payload = task?.payload || {};
    const event = {
      id: uuidv4(),
      at: nowIso(),
      phase,
      phaseLabel: formatPhaseLabel(phase),
      status,
      workerId: workerId || '',
      taskId: task?.id || '',
      query: '',
      url: '',
      domain: '',
      summary: '',
      details: '',
      output: output || null,
      error: error ? String(error) : '',
    };
    const failureDetails = humanizeReason(error || '');

    if (phase === 'discover') {
      event.query = String(payload.query || output?.query || '').trim();
      if (status === 'started') {
        event.summary = event.query
          ? `Searching for "${event.query}"`
          : 'Running discovery search';
      } else if (status === 'completed') {
        event.summary = `Found ${Number(output?.found || 0)} results, queued ${Number(output?.queued || 0)} official checks`;
        const domains = Array.isArray(output?.topDomains)
          ? output.topDomains.map((item) => String(item.domain || '').trim()).filter(Boolean).slice(0, 4)
          : [];
        event.details = domains.length > 0
          ? `Top domains: ${domains.join(', ')}`
          : `Skipped off-topic: ${Number(output?.skippedIrrelevant || 0)}`;
      } else if (status === 'skipped') {
        event.summary = `Discovery skipped: ${humanizeReason(output?.reason || '') || 'not needed'}`;
      } else if (status === 'failed') {
        event.summary = `Discovery failed for "${event.query || 'query'}"`;
        event.details = failureDetails;
      } else if (status === 'blocked') {
        event.summary = `Discovery blocked: ${humanizeReason(output?.reason || '') || 'policy gate'}`;
      }
      return event;
    }

    if (phase === 'official_verify') {
      const candidateUrl = String(payload?.candidate?.url || output?.url || output?.candidateUrl || '').trim();
      event.url = normalizeUrl(candidateUrl) || candidateUrl;
      event.domain = normalizeDomain(event.url);
      if (status === 'started') {
        event.summary = event.domain
          ? `Verifying official source: ${event.domain}`
          : 'Verifying official source';
      } else if (status === 'completed') {
        event.summary = output?.verifiedOfficial
          ? `Official page verified${event.domain ? ` (${event.domain})` : ''}`
          : 'Official verification completed';
        if (output?.queuedExtract === false) {
          event.details = 'Skipped extraction because candidate was already queued earlier.';
        }
      } else if (status === 'skipped') {
        event.summary = `Skipped source${event.domain ? ` (${event.domain})` : ''}`;
        event.details = humanizeReason(output?.reason || 'not official');
      } else if (status === 'blocked') {
        event.summary = `Blocked source${event.domain ? ` (${event.domain})` : ''}`;
        event.details = humanizeReason(output?.reason || 'empty official page');
      } else if (status === 'failed') {
        event.summary = `Official verify failed${event.domain ? ` (${event.domain})` : ''}`;
        event.details = failureDetails;
      }
      return event;
    }

    if (phase === 'extract_fields') {
      const pageUrl = String(payload?.page?.url || '').trim();
      event.url = normalizeUrl(pageUrl) || pageUrl;
      event.domain = normalizeDomain(event.url);
      if (status === 'started') {
        event.summary = event.domain
          ? `Extracting fields from ${event.domain}`
          : 'Extracting schema fields';
      } else if (status === 'completed') {
        event.summary = `Extracted ${Number(output?.extracted || 0)} fields`;
        const details = [];
        if (output?.canonicalKey) details.push(`Key: ${output.canonicalKey}`);
        if (output?.extractionMode) details.push(`Mode: ${output.extractionMode}`);
        if (output?.extractionModel) details.push(`Model: ${output.extractionModel}`);
        event.details = details.join(' | ');
      } else if (status === 'blocked') {
        event.summary = `Extraction blocked: ${humanizeReason(output?.reason || '') || 'missing canonical key'}`;
      } else if (status === 'failed') {
        event.summary = 'Field extraction failed';
        event.details = failureDetails;
      }
      return event;
    }

    if (phase === 'evidence_validate') {
      if (status === 'started') {
        event.summary = 'Validating required field evidence';
      } else if (status === 'completed') {
        event.summary = 'Evidence validated and ready to persist';
        event.details = output?.canonicalKey ? `Key: ${output.canonicalKey}` : '';
      } else if (status === 'blocked') {
        event.summary = `Evidence gate blocked record`;
        const missing = Array.isArray(output?.missingOfficialEvidence) ? output.missingOfficialEvidence.join(', ') : '';
        event.details = missing || humanizeReason(output?.reason || '');
      } else if (status === 'failed') {
        event.summary = 'Evidence validation failed';
        event.details = failureDetails;
      }
      return event;
    }

    if (phase === 'persist') {
      event.url = normalizeUrl(payload?.verifiedOfficialUrl || payload?.record?.official_url || '') || '';
      event.domain = normalizeDomain(event.url);
      if (status === 'started') {
        event.summary = 'Saving verified record';
      } else if (status === 'completed') {
        event.summary = output?.deduped
          ? 'Updated existing record with fresher evidence'
          : 'Saved new verified record';
        const evidenceCount = Number(output?.evidenceCount || 0);
        event.details = `Evidence items: ${evidenceCount}`;
      } else if (status === 'blocked') {
        event.summary = 'Record blocked before save';
        event.details = humanizeReason(output?.reason || 'topic mismatch');
      } else if (status === 'failed') {
        event.summary = 'Persist step failed';
        event.details = failureDetails;
      }
      return event;
    }

    event.summary = `${formatPhaseLabel(phase)} ${status}`;
    return event;
  }

  pushActivity(runState, event = null) {
    if (!event) return;
    const state = this.ensureRunState(runState);
    state.activitySeq = Number(state.activitySeq || 0) + 1;
    const entry = {
      seq: state.activitySeq,
      ...event,
    };
    if (!entry.at) entry.at = nowIso();
    state.activityLog.push(entry);
    if (state.activityLog.length > 600) {
      state.activityLog.splice(0, state.activityLog.length - 600);
    }
    if (entry.domain) this.incrementDomainTally(state, entry.domain, 1);
  }

  buildRunSnapshot(runState) {
    const state = this.ensureRunState(runState);
    const queueByPhase = {};
    for (const phase of PHASES) queueByPhase[phase] = state.queues?.[phase]?.length || 0;
    const workerStatus = Array.from(state.workerStatus.values());
    const activeWorkers = workerStatus.filter((worker) => worker.status === 'busy').length;
    const goalProgress = this.getGoalProgress(state);
    const convergenceThreshold = Number(state.researchSettings?.convergenceThreshold || this.convergenceThreshold);
    const domainStats = Array.from(state.domainTally.entries())
      .map(([domain, count]) => ({ domain, count: Number(count || 0) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);
    const recentActivity = (state.activityLog || []).slice(-160);

    return {
      id: state.id,
      projectId: state.projectId,
      status: state.status,
      objective: state.objective,
      workerCount: state.workerCount,
      activeWorkers,
      workers: workerStatus,
      queueByPhase,
      queueSize: this.queueSize(state),
      convergenceCount: state.convergenceCount,
      convergenceThreshold,
      stats: { ...state.stats },
      researchSettings: { ...state.researchSettings },
      goalProgress,
      recentActivity,
      domainStats,
      intermediateSummary: state.intermediateSummary || state.promptSnapshot?.intermediateSummary || null,
      finalSynthesis: state.finalSynthesis || state.promptSnapshot?.finalSynthesis || null,
      updatedAt: Date.now(),
    };
  }

  emitProgress(runState, force = false) {
    const now = Date.now();
    if (!force && now - (runState.lastProgressAt || 0) < 300) return;
    runState.lastProgressAt = now;
    const payload = this.buildRunSnapshot(runState);
    if (this.progressSink) this.progressSink(payload);
    this.emit('progress', payload);
  }

  persistRunHeartbeat(runState) {
    this.run(
      `UPDATE research_runs
       SET status = ?, stats_json = ?, convergence_count = ?, updated_at = ?
       WHERE id = ?`,
      [
        runState.status,
        safeStringify(runState.stats),
        Number(runState.convergenceCount || 0),
        nowIso(),
        runState.id,
      ]
    );
    this.saveDatabase();
  }

  persistPromptSnapshot(runState) {
    const snapshot = {
      ...(runState?.promptSnapshot && typeof runState.promptSnapshot === 'object' ? runState.promptSnapshot : {}),
      intermediateSummary: runState?.intermediateSummary || runState?.promptSnapshot?.intermediateSummary || null,
      finalSynthesis: runState?.finalSynthesis || runState?.promptSnapshot?.finalSynthesis || null,
    };
    runState.promptSnapshot = snapshot;
    this.run(
      `UPDATE research_runs
       SET prompt_snapshot_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        safeStringify(snapshot),
        nowIso(),
        runState.id,
      ]
    );
    this.saveDatabase();
  }

  listRunRecordsForSynthesis(runState) {
    const settings = runState?.researchSettings || normalizeResearchSettings();
    const limit = Math.max(20, Math.min(400, Number(settings.synthesisRecordLimit || 120)));
    const rows = this.query(
      `SELECT id, canonical_key, record_json, verified_official_url, verified_at, updated_at
       FROM research_records
       WHERE project_id = ? AND run_id = ?
       ORDER BY verified_at DESC, updated_at DESC
       LIMIT ?`,
      [runState.projectId, runState.id, limit]
    );
    return rows.map((row) => ({
      id: row.id,
      canonicalKey: row.canonical_key,
      verifiedOfficialUrl: row.verified_official_url,
      verifiedAt: row.verified_at,
      record: safeParseJson(row.record_json, {}),
    }));
  }

  buildSynthesisPrompt(runState, records = []) {
    const stats = runState?.stats || {};
    const objective = String(runState?.objective || '').trim();
    const runInstructions = String(runState?.runInstructions || '').trim();
    const policyNotes = String(runState?.promptSnapshot?.permanentInstructions || '').trim();
    const guidance = [
      'You are preparing a final synthesis for a deep-research run.',
      'Use ONLY the provided dataset rows.',
      'Do not invent records, fields, or claims.',
      'If a fact is missing in dataset rows, state "Unknown from provided sources".',
      'Cite a source URL in each record bullet.',
      'Return markdown only.',
    ].join('\n');

    const recordRows = records.map((item, index) => {
      const record = item.record || {};
      const name = String(record.name || item.canonicalKey || `Record ${index + 1}`).trim();
      const sourceUrl = String(record.official_url || item.verifiedOfficialUrl || '').trim() || 'Unknown from provided sources';
      const location = [
        String(record.city || '').trim(),
        String(record.state || '').trim(),
      ].filter(Boolean).join(', ') || firstDefinedField(record, ['location']) || 'Unknown from provided sources';
      const summary = firstDefinedField(record, ['summary', 'description', 'focus', 'program_description']) || 'Unknown from provided sources';
      const keyDetails = firstDefinedField(record, ['category', 'status', 'services', 'level_of_care', 'notes']) || 'Unknown from provided sources';
      return [
        `#${index + 1}`,
        `name: ${truncateText(name, 120)}`,
        `source_url: ${sourceUrl}`,
        `location: ${truncateText(location, 100)}`,
        `summary: ${truncateText(summary, 180)}`,
        `key_details: ${truncateText(keyDetails, 140)}`,
      ].join(' | ');
    }).join('\n');

    const sections = [
      guidance,
      '',
      'Output format:',
      '1) # Final Research Synthesis',
      '2) ## Scope and Method',
      '3) ## Coverage Metrics',
      '4) ## Verified Record List',
      '5) ## Gaps and Unknowns',
      '6) ## Recommended Follow-up Queries',
      '',
      `Objective: ${objective || 'Not provided'}`,
      `Run instructions: ${truncateText(runInstructions, 1200) || 'Not provided'}`,
      `Policy notes: ${truncateText(policyNotes, 1000) || 'Not provided'}`,
      '',
      'Metrics:',
      `- discovered_candidates: ${Number(stats.discoveredCandidates || 0)}`,
      `- searches_issued: ${Number(stats.searchesIssued || 0)}`,
      `- verified_saved: ${Number(stats.verifiedSaved || 0)}`,
      `- rejected_non_official: ${Number(stats.rejectedNonOfficial || 0)}`,
      `- rejected_blocked: ${Number(stats.rejectedBlocked || 0)}`,
      `- rejected_irrelevant: ${Number(stats.rejectedIrrelevant || 0)}`,
      '',
      `Dataset rows (${records.length}):`,
      recordRows || 'None',
    ];
    return sections.join('\n');
  }

  async generateFinalSynthesis(runState) {
    const state = this.ensureRunState(runState);
    const settings = state.researchSettings || normalizeResearchSettings();
    if (settings.enableFinalSynthesis === false) {
      state.finalSynthesis = {
        status: 'skipped',
        reason: 'disabled',
        generatedAt: nowIso(),
        recordCount: 0,
      };
      this.persistPromptSnapshot(state);
      return state.finalSynthesis;
    }
    if (state.finalSynthesis?.status === 'completed' && String(state.finalSynthesis.text || '').trim()) {
      return state.finalSynthesis;
    }

    const records = this.listRunRecordsForSynthesis(state);
    const synthesisStart = nowIso();
    state.finalSynthesis = {
      status: 'running',
      startedAt: synthesisStart,
      recordCount: records.length,
    };
    this.persistPromptSnapshot(state);
    this.pushActivity(state, {
      id: uuidv4(),
      at: synthesisStart,
      phase: 'synthesis',
      phaseLabel: 'Synthesis',
      status: 'started',
      summary: `Compiling final synthesis from ${records.length} verified record${records.length === 1 ? '' : 's'}.`,
      details: '',
    });
    this.emitProgress(state, true);

    const goalProgress = this.getGoalProgress(state);
    const fallbackText = buildFallbackSynthesisMarkdown({
      runState: state,
      records,
      goals: goalProgress,
    });

    if (records.length === 0) {
      state.finalSynthesis = {
        status: 'completed',
        mode: 'fallback',
        text: fallbackText,
        generatedAt: nowIso(),
        recordCount: 0,
      };
      this.persistPromptSnapshot(state);
      this.pushActivity(state, {
        id: uuidv4(),
        at: nowIso(),
        phase: 'synthesis',
        phaseLabel: 'Synthesis',
        status: 'completed',
        summary: 'Final synthesis generated (no verified records to summarize).',
        details: '',
      });
      this.emitProgress(state, true);
      return state.finalSynthesis;
    }

    const prompt = this.buildSynthesisPrompt(state, records);
    try {
      if (!this.synthesisGenerator) throw new Error('synthesis_generator_unavailable');
      const result = await this.synthesisGenerator({
        runState: state,
        records,
        prompt,
      });
      const text = String(result?.text || '').trim();
      if (!text) throw new Error('empty_synthesis_output');
      state.finalSynthesis = {
        status: 'completed',
        mode: 'llm',
        model: String(result?.model || '').trim() || null,
        text,
        generatedAt: nowIso(),
        recordCount: records.length,
      };
    } catch (error) {
      state.finalSynthesis = {
        status: 'completed',
        mode: 'fallback',
        model: null,
        text: fallbackText,
        generatedAt: nowIso(),
        recordCount: records.length,
        warning: String(error?.message || error || 'synthesis_failed'),
      };
    }

    this.persistPromptSnapshot(state);
    this.pushActivity(state, {
      id: uuidv4(),
      at: nowIso(),
      phase: 'synthesis',
      phaseLabel: 'Synthesis',
      status: 'completed',
      summary: state.finalSynthesis.mode === 'llm'
        ? 'Final synthesis generated with model summary pass.'
        : 'Final synthesis generated using deterministic fallback.',
      details: state.finalSynthesis.warning
        ? `Fallback reason: ${state.finalSynthesis.warning}`
        : `Mode: ${state.finalSynthesis.mode || 'unknown'}`,
    });
    this.emitProgress(state, true);
    return state.finalSynthesis;
  }

  listRecentRunRecords(runState, limit = 4) {
    const safeLimit = Math.max(1, Math.min(12, Number(limit || 4)));
    const rows = this.query(
      `SELECT canonical_key, record_json, verified_official_url, verified_at
       FROM research_records
       WHERE project_id = ? AND run_id = ?
       ORDER BY verified_at DESC
       LIMIT ?`,
      [runState.projectId, runState.id, safeLimit]
    );
    return rows.map((row) => ({
      canonicalKey: row.canonical_key,
      verifiedOfficialUrl: row.verified_official_url,
      verifiedAt: row.verified_at,
      record: safeParseJson(row.record_json, {}),
    }));
  }

  buildProgressSummaryPrompt(runState, recentRecords = []) {
    const stats = runState?.stats || {};
    const goalProgress = this.getGoalProgress(runState);
    const recordsDigest = recentRecords.map((item, index) => {
      const record = item.record || {};
      const name = String(record.name || item.canonicalKey || `Record ${index + 1}`).trim();
      const location = [String(record.city || '').trim(), String(record.state || '').trim()].filter(Boolean).join(', ');
      const url = String(record.official_url || item.verifiedOfficialUrl || '').trim();
      return `#${index + 1} ${name}${location ? ` | ${location}` : ''}${url ? ` | ${url}` : ''}`;
    }).join('\n');

    return [
      'You are a research coordinator giving a brief in-run status update.',
      'Return 4 to 7 concise bullet points in plain language.',
      'Do not claim completion unless the run is complete.',
      'If no verified records exist yet, explicitly say that and mention next search focus.',
      '',
      `Objective: ${String(runState?.objective || '').trim()}`,
      `Run instructions: ${truncateText(String(runState?.runInstructions || '').trim(), 1000) || 'Not provided'}`,
      '',
      `Stats: searches=${Number(stats.searchesIssued || 0)}, discovered=${Number(stats.discoveredCandidates || 0)}, verified=${Number(stats.verifiedSaved || 0)}, rejected_non_official=${Number(stats.rejectedNonOfficial || 0)}, rejected_irrelevant=${Number(stats.rejectedIrrelevant || 0)}`,
      `Runtime minutes: ${Math.floor(Number(goalProgress?.current?.elapsedMinutes || 0))}`,
      '',
      `Recent verified records (${recentRecords.length}):`,
      recordsDigest || 'None',
    ].join('\n');
  }

  async maybeGenerateProgressSummary(runState, { force = false } = {}) {
    const state = this.ensureRunState(runState);
    if (state.status !== 'running') return null;
    const now = Date.now();
    const lastAt = Number(state.lastProgressSummaryAt || 0);
    const summaryIntervalMs = 90000;
    const searches = Number(state.stats.searchesIssued || 0);
    const verified = Number(state.stats.verifiedSaved || 0);
    const lastSearches = Number(state.lastProgressSummarySearches || 0);
    const lastVerified = Number(state.lastProgressSummaryVerified || 0);

    const changedEnough = (verified > lastVerified) || (searches - lastSearches >= 12);
    if (!force && !changedEnough && (now - lastAt) < summaryIntervalMs) {
      return null;
    }

    const recentRecords = this.listRecentRunRecords(state, 4);
    let summaryText = '';
    let summaryModel = '';
    if (this.progressSummaryGenerator) {
      try {
        const prompt = this.buildProgressSummaryPrompt(state, recentRecords);
        const llm = await this.progressSummaryGenerator({
          runState: state,
          recentRecords,
          prompt,
        });
        summaryText = String(llm?.text || '').trim();
        summaryModel = String(llm?.model || '').trim();
      } catch (_error) {
        summaryText = '';
      }
    }
    if (!summaryText) {
      summaryText = buildIntermediateSummaryText({
        runState: {
          ...state,
          goalProgress: this.getGoalProgress(state),
        },
        recentRecords,
      });
    }
    summaryText = String(summaryText || '').trim();
    if (!summaryText) return null;

    state.intermediateSummary = {
      text: summaryText,
      model: summaryModel || null,
      generatedAt: nowIso(),
      searchesIssued: searches,
      verifiedSaved: verified,
    };
    state.lastProgressSummaryAt = now;
    state.lastProgressSummarySearches = searches;
    state.lastProgressSummaryVerified = verified;
    state.promptSnapshot = {
      ...(state.promptSnapshot && typeof state.promptSnapshot === 'object' ? state.promptSnapshot : {}),
      intermediateSummary: state.intermediateSummary,
    };

    this.pushActivity(state, {
      id: uuidv4(),
      at: state.intermediateSummary.generatedAt,
      phase: 'synthesis',
      phaseLabel: 'Update',
      status: 'completed',
      summary: 'Progress update generated.',
      details: summaryText,
    });
    return state.intermediateSummary;
  }

  persistCheckpoint(runState) {
    const queuePayload = {};
    for (const phase of PHASES) {
      queuePayload[phase] = (runState.queues?.[phase] || []).map((task) => ({
        id: task.id,
        phase: task.phase,
        payload: task.payload,
        retries: task.retries,
        createdAt: task.createdAt,
      }));
    }
    const statePayload = {
      status: runState.status,
      objective: runState.objective,
      runInstructions: runState.runInstructions,
      workerCount: runState.workerCount,
      researchSettings: runState.researchSettings || normalizeResearchSettings(),
      topicProfile: runState.topicProfile || null,
      stats: runState.stats,
      convergenceCount: runState.convergenceCount,
      lastSavedCount: runState.lastSavedCount,
      queryCursor: Number(runState.queryCursor || 0),
      runStartedAtMs: Number(runState.runStartedAtMs || Date.now()),
      searchFailureStreak: Number(runState.searchFailureStreak || 0),
      searchBackoffUntil: Number(runState.searchBackoffUntil || 0),
      lastProgressSummaryAt: Number(runState.lastProgressSummaryAt || 0),
      lastProgressSummarySearches: Number(runState.lastProgressSummarySearches || 0),
      lastProgressSummaryVerified: Number(runState.lastProgressSummaryVerified || 0),
      discoverQueriesSeen: Array.from(runState.discoverQueriesSeen || []),
      candidateUrlsSeen: Array.from(runState.candidateUrlsSeen || []),
      activitySeq: Number(runState.activitySeq || 0),
      activityLog: Array.isArray(runState.activityLog) ? runState.activityLog.slice(-500) : [],
      domainTally: Object.fromEntries(runState.domainTally instanceof Map ? runState.domainTally.entries() : []),
      intermediateSummary: runState.intermediateSummary || null,
      finalSynthesis: runState.finalSynthesis || null,
      savedAt: nowIso(),
    };
    this.run(
      `INSERT INTO research_checkpoints (id, run_id, queue_json, state_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), runState.id, safeStringify(queuePayload), safeStringify(statePayload), nowIso()]
    );
    runState.lastCheckpointAt = Date.now();
    this.saveDatabase();
  }

  updateTaskRow(runState, task, status, output = null, error = null, workerId = null) {
    if (!task.taskRowInserted) {
      this.run(
        `INSERT INTO research_tasks
          (id, run_id, worker_id, phase, status, input_json, output_json, error, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          runState.id,
          workerId || 'worker',
          task.phase,
          status,
          safeStringify(task.payload),
          output ? safeStringify(output) : null,
          error || null,
          status === 'running' ? nowIso() : null,
          ['completed', 'failed', 'blocked', 'skipped'].includes(status) ? nowIso() : null,
        ]
      );
      task.taskRowInserted = true;
    } else {
      this.run(
        `UPDATE research_tasks
         SET status = ?, output_json = ?, error = ?, ended_at = ?, worker_id = ?
         WHERE id = ?`,
        [
          status,
          output ? safeStringify(output) : null,
          error || null,
          ['completed', 'failed', 'blocked', 'skipped'].includes(status) ? nowIso() : null,
          workerId || 'worker',
          task.id,
        ]
      );
    }
  }

  async executeDiscover(runState, task) {
    const query = String(task.payload?.query || '').trim();
    if (!query) return { skipped: true, reason: 'empty_query' };
    const settings = runState.researchSettings || normalizeResearchSettings();
    const taskDepth = Number(task.payload?.depth || 0);
    if (taskDepth > Number(settings.maxDiscoverDepth || 2)) {
      return { skipped: true, reason: 'max_discovery_depth_reached', query, depth: taskDepth };
    }

    const result = await searchWeb(query, {
      maxResults: Number(settings.maxSearchResultsPerQuery || 20),
      timeout: 9000,
      providerOrder: settings.searchProviderOrder,
      searxngUrl: settings.searxngUrl,
    });
    const entries = Array.isArray(result?.results) ? result.results : [];
    const searchError = String(result?.error || '').trim();
    if (entries.length === 0 && searchError) {
      runState.searchFailureStreak = Number(runState.searchFailureStreak || 0) + 1;
      if (/\b(403|429)\b/.test(searchError) || /socket|tls|timeout|network|econn|hang up|reset/i.test(searchError)) {
        const unitMs = /\b(403|429)\b/.test(searchError) ? 3000 : 1500;
        const backoffMs = Math.min(/\b(403|429)\b/.test(searchError) ? 60000 : 20000, unitMs * runState.searchFailureStreak);
        runState.searchBackoffUntil = Date.now() + backoffMs;
      }
    } else {
      runState.searchFailureStreak = 0;
      runState.searchBackoffUntil = 0;
    }
    const domainCounts = new Map();
    let queued = 0;
    let followUps = 0;
    let skippedIrrelevant = 0;
    let queuedFocusedFollowUps = 0;

    runState.stats.searchesIssued += 1;
    runState.stats.discoveredCandidates += entries.length;

    for (const candidate of entries) {
      const relevance = scoreTopicRelevance({
        title: candidate?.title || '',
        snippet: candidate?.snippet || '',
        url: candidate?.url || '',
      }, runState.topicProfile, settings);
      if (!relevance.isRelevant) {
        runState.stats.rejectedIrrelevant += 1;
        skippedIrrelevant += 1;
        continue;
      }

      const normalized = normalizeUrl(candidate?.url || '');
      if (!normalized) continue;
      const domain = normalizeDomain(normalized);
      if (domain) {
        domainCounts.set(domain, Number(domainCounts.get(domain) || 0) + 1);
        this.incrementDomainTally(runState, domain, 1);
      }
      const enqueued = this.enqueueTask(runState, 'official_verify', {
        query,
        depth: taskDepth,
        relevance,
        candidate: {
          title: String(candidate.title || '').trim(),
          url: normalized,
          snippet: String(candidate.snippet || '').trim(),
        },
      }, normalized);
      if (enqueued) queued += 1;

      const classification = classifySource(candidate, runState.sourcePolicy);
      const canExpand = followUps < Number(settings.maxFollowUpsPerQuery || 0)
        && taskDepth < Number(settings.maxDiscoverDepth || 2);
      if (!classification.isOfficial && canExpand) {
        const title = String(candidate.title || '').trim();
        if (title) {
          const followUp = buildOfficialFollowUpQuery({
            title,
            objective: runState.objective,
            locationHint: runState.topicProfile?.locationHint || '',
          });
          if (followUp && this.enqueueTask(runState, 'discover', { query: followUp, depth: taskDepth + 1 })) {
            followUps += 1;
            queuedFocusedFollowUps += 1;
          }
        }
      }
    }

    const topDomains = Array.from(domainCounts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      query,
      found: entries.length,
      queued,
      followUps,
      skippedIrrelevant,
      queuedFocusedFollowUps,
      topDomains,
      tookMs: Number(result?.took || 0),
      error: result?.error || null,
      failureStreak: Number(runState.searchFailureStreak || 0),
      backoffUntil: Number(runState.searchBackoffUntil || 0),
    };
  }

  async executeOfficialVerify(runState, task) {
    const settings = runState.researchSettings || normalizeResearchSettings();
    const candidate = task.payload?.candidate || {};
    const classification = classifySource(candidate, runState.sourcePolicy);
    if (classification?.domain) {
      this.incrementDomainTally(runState, classification.domain, 1);
    }
    if (!classification.isOfficial) {
      runState.stats.rejectedNonOfficial += 1;
      if (Number(task.payload?.depth || 0) < Number(settings.maxDiscoverDepth || 2)) {
        const title = String(candidate.title || '').trim();
        if (title) {
          const followUp = buildOfficialFollowUpQuery({
            title,
            objective: runState.objective,
            locationHint: runState.topicProfile?.locationHint || '',
          });
          if (followUp) {
            this.enqueueTask(runState, 'discover', {
              query: followUp,
              depth: Number(task.payload?.depth || 0) + 1,
            });
          }
        }
      }
      return {
        skipped: true,
        reason: classification.reason || 'not_official',
        candidateUrl: candidate.url || '',
      };
    }

    const page = await fetchPageContent(classification.normalizedUrl, { maxLength: 22000, timeout: 18000 });
    runState.stats.verifiedOfficialCandidates += 1;
    runState.stats.pagesFetched += 1;

    const content = String(page?.content || '').trim();
    if (!content && !String(page?.title || '').trim()) {
      runState.stats.rejectedBlocked += 1;
      return {
        blocked: true,
        reason: 'empty_official_page',
        url: classification.normalizedUrl,
      };
    }

    const contentRelevance = scoreTopicRelevance({
      title: String(page?.title || candidate?.title || '').trim(),
      snippet: String(candidate?.snippet || '').trim(),
      url: classification.normalizedUrl,
      content: content.slice(0, 7000),
    }, runState.topicProfile, settings);
    if (!contentRelevance.isRelevant) {
      runState.stats.rejectedIrrelevant += 1;
      return {
        skipped: true,
        reason: contentRelevance.reason || 'page_not_topic_relevant',
        url: classification.normalizedUrl,
        relevanceScore: contentRelevance.score,
      };
    }

    const queued = this.enqueueTask(runState, 'extract_fields', {
      page: {
        url: classification.normalizedUrl,
        title: String(page?.title || candidate.title || '').trim(),
        content,
      },
      source: classification,
      relevance: contentRelevance,
    }, classification.normalizedUrl);

    return {
      verifiedOfficial: true,
      url: classification.normalizedUrl,
      queuedExtract: queued,
    };
  }

  async executeExtractFields(runState, task) {
    const page = task.payload?.page || {};
    const extraction = await extractRecordFromOfficialPage({
      page,
      schema: runState.schema,
      extractionGenerator: this.extractionGenerator,
      objective: runState.objective,
      runInstructions: runState.runInstructions,
      topicProfile: runState.topicProfile || null,
    });

    const canonicalKey = extraction.canonicalKey;
    if (!canonicalKey) {
      runState.stats.rejectedBlocked += 1;
      return { blocked: true, reason: 'missing_canonical_key', pageUrl: page.url || '' };
    }

    if (!extraction.record.official_url) {
      extraction.record.official_url = normalizeUrl(page.url || '') || '';
    }

    runState.stats.extractedRecords += 1;
    const queued = this.enqueueTask(runState, 'evidence_validate', {
      canonicalKey,
      record: extraction.record,
      evidence: extraction.evidence || [],
      verifiedOfficialUrl: normalizeUrl(page.url || ''),
      pageTitle: page.title || '',
    }, canonicalKey);

    return {
      extracted: Object.keys(extraction.record || {}).length,
      canonicalKey,
      queuedValidate: queued,
      extractionMode: extraction.extractionMode || 'heuristic',
      extractionModel: extraction.extractionModel || '',
    };
  }

  async executeEvidenceValidate(runState, task) {
    const schema = runState.schema;
    const recordInput = task.payload?.record || {};
    const evidenceInput = Array.isArray(task.payload?.evidence) ? task.payload.evidence : [];
    const validation = validateRecordAgainstSchema(recordInput, schema);
    if (!validation.valid) {
      runState.stats.rejectedBlocked += 1;
      return {
        blocked: true,
        reason: 'missing_required_fields',
        missingRequired: validation.missingRequired,
      };
    }

    const evidenceByField = new Map();
    for (const item of evidenceInput) {
      const key = String(item.field_key || '').trim();
      if (!key) continue;
      const list = evidenceByField.get(key) || [];
      list.push({
        ...item,
        source_url: normalizeUrl(item.source_url || task.payload?.verifiedOfficialUrl || ''),
        source_domain: normalizeDomain(item.source_domain || ''),
        is_official: item.is_official !== false,
      });
      evidenceByField.set(key, list);
    }

    const missingOfficialEvidence = [];
    for (const field of schema) {
      if (!field.required) continue;
      const claims = evidenceByField.get(field.key) || [];
      const hasOfficial = claims.some((claim) =>
        claim.is_official === true &&
        String(claim.claim_text || '').trim().length > 0 &&
        String(claim.source_url || '').trim().length > 0
      );
      if (!hasOfficial) missingOfficialEvidence.push(field.key);
    }
    if (missingOfficialEvidence.length > 0) {
      runState.stats.rejectedBlocked += 1;
      return {
        blocked: true,
        reason: 'missing_official_evidence',
        missingOfficialEvidence,
      };
    }

    const compliance = validateInstructionCompliance({
      record: validation.normalizedRecord,
      evidence: evidenceInput,
      schema,
    });
    if (!compliance.compliant) {
      runState.stats.rejectedBlocked += 1;
      return {
        blocked: true,
        reason: 'instruction_compliance_failed',
        violations: compliance.violations,
      };
    }

    runState.stats.validatedRecords += 1;
    const queued = this.enqueueTask(runState, 'persist', {
      canonicalKey: task.payload.canonicalKey,
      verifiedOfficialUrl: normalizeUrl(task.payload.verifiedOfficialUrl || ''),
      record: validation.normalizedRecord,
      evidence: evidenceInput,
    }, task.payload.canonicalKey);

    return {
      validated: true,
      queuedPersist: queued,
      canonicalKey: task.payload.canonicalKey,
    };
  }

  async executePersist(runState, task) {
    const canonicalKey = String(task.payload?.canonicalKey || '').trim();
    const record = task.payload?.record || {};
    const evidence = Array.isArray(task.payload?.evidence) ? task.payload.evidence : [];
    const settings = runState.researchSettings || normalizeResearchSettings();
    if (!canonicalKey) {
      runState.stats.rejectedBlocked += 1;
      return { blocked: true, reason: 'missing_canonical_key' };
    }

    // Last safety gate: prevent off-topic records from ever being persisted.
    const recordRelevance = scoreTopicRelevance({
      title: String(record.name || '').trim(),
      snippet: String(record.summary || record.description || record.programDescription || '').trim(),
      url: normalizeUrl(record.official_url || task.payload?.verifiedOfficialUrl || ''),
      content: evidence
        .map((item) => String(item.claim_text || item.excerpt_text || '').trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 6000),
    }, runState.topicProfile, settings);
    if (!recordRelevance.isRelevant) {
      runState.stats.rejectedIrrelevant += 1;
      return {
        blocked: true,
        reason: recordRelevance.reason || 'record_not_topic_relevant',
        relevanceScore: recordRelevance.score,
      };
    }

    const existing = this.queryOne(
      `SELECT id FROM research_records WHERE project_id = ? AND canonical_key = ?`,
      [runState.projectId, canonicalKey]
    );
    const recordId = existing?.id || uuidv4();
    const verifiedOfficialUrl = normalizeUrl(task.payload?.verifiedOfficialUrl || record.official_url || '');

    if (existing?.id) {
      this.run(
        `UPDATE research_records
         SET run_id = ?, record_json = ?, verified_official_url = ?, verified_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          runState.id,
          safeStringify(record),
          verifiedOfficialUrl,
          nowIso(),
          nowIso(),
          recordId,
        ]
      );
      this.run(`DELETE FROM research_evidence WHERE record_id = ?`, [recordId]);
      runState.stats.deduped += 1;
    } else {
      this.run(
        `INSERT INTO research_records
          (id, project_id, run_id, canonical_key, record_json, verified_official_url, verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          recordId,
          runState.projectId,
          runState.id,
          canonicalKey,
          safeStringify(record),
          verifiedOfficialUrl,
          nowIso(),
          nowIso(),
          nowIso(),
        ]
      );
      runState.stats.verifiedSaved += 1;
    }

    for (const item of evidence) {
      this.run(
        `INSERT INTO research_evidence
          (id, record_id, field_key, claim_text, source_url, source_domain, source_title, excerpt_text, is_official, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          recordId,
          String(item.field_key || '').trim(),
          String(item.claim_text || '').trim(),
          normalizeUrl(item.source_url || verifiedOfficialUrl),
          normalizeDomain(item.source_domain || ''),
          String(item.source_title || '').trim(),
          String(item.excerpt_text || '').trim(),
          item.is_official === false ? 0 : 1,
          item.fetched_at || nowIso(),
        ]
      );
    }

    runState.lastActivityAt = Date.now();
    this.saveDatabase();
    return {
      persisted: true,
      recordId,
      deduped: Boolean(existing?.id),
      evidenceCount: evidence.length,
    };
  }

  async executeTask(runState, workerId, task) {
    switch (task.phase) {
      case 'discover':
        return this.executeDiscover(runState, task);
      case 'official_verify':
        return this.executeOfficialVerify(runState, task);
      case 'extract_fields':
        return this.executeExtractFields(runState, task);
      case 'evidence_validate':
        return this.executeEvidenceValidate(runState, task);
      case 'persist':
        return this.executePersist(runState, task);
      default:
        return { skipped: true, reason: 'unknown_phase', phase: task.phase, workerId };
    }
  }

  async workerLoop(runState, workerId) {
    const state = this.ensureRunState(runState);
    state.workerStatus.set(workerId, {
      workerId,
      status: 'idle',
      phase: null,
      taskId: null,
      updatedAt: Date.now(),
    });

    while (state.status === 'running' || state.status === 'paused') {
      if (state.status === 'paused') {
        state.workerStatus.set(workerId, {
          workerId,
          status: 'paused',
          phase: null,
          taskId: null,
          updatedAt: Date.now(),
        });
        await sleep(250);
        continue;
      }

      const task = this.dequeueTask(state);
      if (!task) {
        state.workerStatus.set(workerId, {
          workerId,
          status: 'idle',
          phase: null,
          taskId: null,
          updatedAt: Date.now(),
        });
        await sleep(220);
        continue;
      }

      if (task.phase === 'discover' && Date.now() < Number(state.searchBackoffUntil || 0)) {
        state.queues.discover.push(task);
        state.workerStatus.set(workerId, {
          workerId,
          status: 'backoff',
          phase: 'discover',
          taskId: null,
          updatedAt: Date.now(),
        });
        const waitMs = Math.min(1500, Math.max(250, Number(state.searchBackoffUntil || 0) - Date.now()));
        await sleep(waitMs);
        continue;
      }

      state.activeWorkersCount = Number(state.activeWorkersCount || 0) + 1;
      state.workerStatus.set(workerId, {
        workerId,
        status: 'busy',
        phase: task.phase,
        taskId: task.id,
        updatedAt: Date.now(),
      });
      this.updateTaskRow(state, task, 'running', null, null, workerId);
      this.pushActivity(state, this.buildTaskActivityEvent({
        task,
        status: 'started',
        workerId,
      }));

      try {
        const output = await this.executeTask(state, workerId, task);
        let taskStatus = 'completed';
        if (output?.blocked) {
          taskStatus = 'blocked';
          this.updateTaskRow(state, task, taskStatus, output, null, workerId);
        } else if (output?.skipped) {
          taskStatus = 'skipped';
          this.updateTaskRow(state, task, taskStatus, output, null, workerId);
        } else {
          this.updateTaskRow(state, task, taskStatus, output, null, workerId);
        }
        this.pushActivity(state, this.buildTaskActivityEvent({
          task,
          status: taskStatus,
          output,
          workerId,
        }));
      } catch (error) {
        state.stats.errors += 1;
        state.stats.lastError = error.message || String(error);
        const errorMessage = error.message || String(error);
        const nextRetry = Number(task.retries || 0) + 1;
        if (nextRetry < this.maxTaskRetries) {
          const retryTask = normalizeTaskPayload({
            ...task,
            id: uuidv4(),
            retries: nextRetry,
            createdAt: Date.now(),
          });
          state.queues[task.phase].push(retryTask);
          this.updateTaskRow(state, task, 'failed', null, `retry_${nextRetry}:${errorMessage}`, workerId);
          this.pushActivity(state, this.buildTaskActivityEvent({
            task,
            status: 'failed',
            error: `retry_${nextRetry}:${errorMessage}`,
            workerId,
          }));
        } else {
          this.updateTaskRow(state, task, 'failed', null, errorMessage, workerId);
          this.pushActivity(state, this.buildTaskActivityEvent({
            task,
            status: 'failed',
            error: errorMessage,
            workerId,
          }));
        }
      } finally {
        state.activeWorkersCount = Math.max(0, Number(state.activeWorkersCount || 1) - 1);
        state.lastActivityAt = Date.now();
        this.persistRunHeartbeat(state);
        this.emitProgress(state);
      }
    }

    state.workerStatus.set(workerId, {
      workerId,
      status: 'stopped',
      phase: null,
      taskId: null,
      updatedAt: Date.now(),
    });
  }

  async completeRun(runState, reason = 'convergence_reached') {
    if (!runState || runState.status === 'completed' || runState.status === 'cancelled' || runState.status === 'error') return;
    if (runState.completing) return;
    runState.completing = true;
    try {
      await this.generateFinalSynthesis(runState);
      runState.status = 'completed';
      runState.completedReason = reason;
      this.run(
        `UPDATE research_runs
         SET status = ?, stats_json = ?, convergence_count = ?, ended_at = ?, updated_at = ?, prompt_snapshot_json = ?
         WHERE id = ?`,
        [
          'completed',
          safeStringify(runState.stats),
          Number(runState.convergenceCount || 0),
          nowIso(),
          nowIso(),
          safeStringify(runState.promptSnapshot || {}),
          runState.id,
        ]
      );
      this.persistCheckpoint(runState);
      this.saveDatabase();
      this.emitProgress(runState, true);
    } finally {
      runState.completing = false;
    }
  }

  async failRun(runState, errorMessage) {
    if (!runState || runState.status === 'error') return;
    runState.status = 'error';
    runState.stats.errors += 1;
    runState.stats.lastError = String(errorMessage || 'unknown_error');
    this.run(
      `UPDATE research_runs
       SET status = ?, stats_json = ?, ended_at = ?, updated_at = ?
       WHERE id = ?`,
      ['error', safeStringify(runState.stats), nowIso(), nowIso(), runState.id]
    );
    this.persistCheckpoint(runState);
    this.saveDatabase();
    this.emitProgress(runState, true);
  }

  setupMonitorLoop(runState) {
    if (runState.monitorTimer) clearInterval(runState.monitorTimer);
    runState.monitorTimer = setInterval(async () => {
      if (!this.runs.has(runState.id)) {
        clearInterval(runState.monitorTimer);
        return;
      }

      if (runState.status === 'cancelled' || runState.status === 'completed' || runState.status === 'error') {
        clearInterval(runState.monitorTimer);
        this.persistRunHeartbeat(runState);
        this.emitProgress(runState, true);
        this.runs.delete(runState.id);
        return;
      }

      if (runState.status === 'running') {
        if (runState.completing) {
          this.persistRunHeartbeat(runState);
          this.emitProgress(runState);
          return;
        }
        const queueSize = this.queueSize(runState);
        const active = Number(runState.activeWorkersCount || 0);
        const settings = runState.researchSettings || normalizeResearchSettings();
        const convergenceThreshold = Number(settings.convergenceThreshold || this.convergenceThreshold);
        if (queueSize === 0 && active === 0) {
          const nowMs = Date.now();
          const backoffUntil = Number(runState.searchBackoffUntil || 0);
          if (backoffUntil > nowMs) {
            await this.maybeGenerateProgressSummary(runState);
            this.persistRunHeartbeat(runState);
            this.emitProgress(runState);
            return;
          }

          const persistentSearchFailure = Number(runState.searchFailureStreak || 0) >= 18
            && Number(runState.stats.discoveredCandidates || 0) === 0
            && Number(runState.stats.verifiedSaved || 0) === 0;
          if (persistentSearchFailure) {
            await this.completeRun(runState, 'search_backend_unavailable');
            return;
          }

          if (Number(runState.stats.verifiedSaved || 0) > Number(runState.lastSavedCount || 0)) {
            runState.lastSavedCount = Number(runState.stats.verifiedSaved || 0);
            runState.convergenceCount = 0;
          } else {
            runState.convergenceCount = Number(runState.convergenceCount || 0) + 1;
          }

          const goalsMet = this.runMeetsCompletionGoals(runState);
          const shouldRefill = runState.convergenceCount < convergenceThreshold || !goalsMet;
          if (shouldRefill) {
            const query = this.buildConvergenceQuery(runState);
            if (query) this.enqueueTask(runState, 'discover', { query, depth: 0 });
          }
          if (!goalsMet && runState.convergenceCount >= convergenceThreshold) {
            runState.convergenceCount = Math.max(0, convergenceThreshold - 1);
          }

          if (goalsMet && runState.convergenceCount >= convergenceThreshold && this.queueSize(runState) === 0) {
            await this.completeRun(runState, 'convergence_reached');
            return;
          }
        }

        const now = Date.now();
        if (now - Number(runState.lastActivityAt || 0) > this.stallTimeoutMs) {
          runState.stallRecoveries = Number(runState.stallRecoveries || 0) + 1;
          if (runState.stallRecoveries > this.maxStallRecoveries) {
            await this.failRun(runState, 'stall_watchdog_exceeded');
            return;
          }
          const recoveryQuery = this.buildConvergenceQuery(runState) || normalizeSearchQuery(`${runState.objective} primary source`);
          if (recoveryQuery) this.enqueueTask(runState, 'discover', { query: recoveryQuery, depth: 0 });
          runState.lastActivityAt = now;
        }

        await this.maybeGenerateProgressSummary(runState);

        if (Date.now() - Number(runState.lastCheckpointAt || 0) >= this.checkpointIntervalMs) {
          this.persistCheckpoint(runState);
        }
      }

      this.persistRunHeartbeat(runState);
      this.emitProgress(runState);
    }, this.monitorIntervalMs);
  }

  startWorkers(runState) {
    const workerCount = Math.max(1, Number(runState.workerCount || this.defaultWorkerCount));
    runState.workerLoops = [];
    for (let i = 0; i < workerCount; i += 1) {
      const workerId = `worker_${i + 1}`;
      const loopPromise = this.workerLoop(runState, workerId)
        .catch((error) => {
          runState.stats.errors += 1;
          runState.stats.lastError = error.message || String(error);
        });
      runState.workerLoops.push(loopPromise);
    }
  }

  async startRun({
    projectId,
    objective,
    runInstructions = '',
    workerCount = this.defaultWorkerCount,
    schema = DEFAULT_STARTER_SCHEMA,
    sourcePolicy = {},
    researchSettings = {},
    promptSnapshot = {},
    existingRunId = null,
    restoredCheckpoint = null,
  }) {
    const normalizedObjective = String(objective || '').trim();
    if (!normalizedObjective) {
      throw new Error('Run objective is required');
    }

    const runId = existingRunId || uuidv4();
    const normalizedSchema = normalizeSchema(schema);
    const mergedSourcePolicy = mergeSourcePolicy({}, sourcePolicy || {});
    const normalizedSettings = normalizeResearchSettings(
      researchSettings && Object.keys(researchSettings || {}).length > 0
        ? researchSettings
        : promptSnapshot?.researchSettings || {}
    );
    const topicProfile = buildTopicProfile({
      objective: normalizedObjective,
      runInstructions,
      promptSnapshot,
    });

    const baseState = this.ensureRunState({
      id: runId,
      projectId,
      objective: normalizedObjective,
      runInstructions: String(runInstructions || ''),
      workerCount: Math.max(1, Number(workerCount || this.defaultWorkerCount)),
      schema: normalizedSchema,
      sourcePolicy: mergedSourcePolicy,
      researchSettings: normalizedSettings,
      topicProfile,
      status: 'running',
      stats: buildStatsSkeleton(),
      lastSavedCount: 0,
      lastActivityAt: Date.now(),
      runStartedAtMs: Number(restoredCheckpoint?.runStartedAtMs || Date.now()),
      createdAt: nowIso(),
      promptSnapshot,
      finalSynthesis: restoredCheckpoint?.finalSynthesis || promptSnapshot?.finalSynthesis || null,
      queues: restoredCheckpoint?.queues || {
        discover: [],
        official_verify: [],
        extract_fields: [],
        evidence_validate: [],
        persist: [],
      },
      convergenceCount: Number(restoredCheckpoint?.convergenceCount || 0),
      discoverQueriesSeen: new Set(restoredCheckpoint?.discoverQueriesSeen || []),
      candidateUrlsSeen: new Set(restoredCheckpoint?.candidateUrlsSeen || []),
      queryCursor: Number(restoredCheckpoint?.queryCursor || 0),
      searchFailureStreak: Number(restoredCheckpoint?.searchFailureStreak || 0),
      searchBackoffUntil: Number(restoredCheckpoint?.searchBackoffUntil || 0),
      lastProgressSummaryAt: Number(restoredCheckpoint?.lastProgressSummaryAt || 0),
      lastProgressSummarySearches: Number(restoredCheckpoint?.lastProgressSummarySearches || 0),
      lastProgressSummaryVerified: Number(restoredCheckpoint?.lastProgressSummaryVerified || 0),
      intermediateSummary: restoredCheckpoint?.intermediateSummary || promptSnapshot?.intermediateSummary || null,
      activitySeq: Number(restoredCheckpoint?.activitySeq || 0),
      activityLog: Array.isArray(restoredCheckpoint?.activityLog) ? restoredCheckpoint.activityLog.slice(-500) : [],
      domainTally: restoredCheckpoint?.domainTally || {},
    });

    if (restoredCheckpoint?.stats) {
      baseState.stats = {
        ...buildStatsSkeleton(),
        ...(restoredCheckpoint.stats || {}),
      };
      baseState.lastSavedCount = Number(restoredCheckpoint.lastSavedCount || baseState.stats.verifiedSaved || 0);
    }
    if (restoredCheckpoint?.researchSettings) {
      baseState.researchSettings = normalizeResearchSettings(restoredCheckpoint.researchSettings);
    }
    if (restoredCheckpoint?.topicProfile) {
      baseState.topicProfile = restoredCheckpoint.topicProfile;
    }
    if (restoredCheckpoint?.finalSynthesis) {
      baseState.finalSynthesis = restoredCheckpoint.finalSynthesis;
    }
    if (restoredCheckpoint?.intermediateSummary) {
      baseState.intermediateSummary = restoredCheckpoint.intermediateSummary;
    }

    if (!restoredCheckpoint) {
      for (const seedQuery of this.buildSeedQueries({
        objective: normalizedObjective,
        runInstructions,
        promptSnapshot,
        researchSettings: baseState.researchSettings,
        topicProfile: baseState.topicProfile,
      })) {
        this.enqueueTask(baseState, 'discover', { query: seedQuery, depth: 0 });
      }
    } else {
      for (const phase of PHASES) {
        baseState.queues[phase] = (restoredCheckpoint.queues?.[phase] || []).map((task) => normalizeTaskPayload(task));
      }
    }

    this.runs.set(runId, baseState);
    this.startWorkers(baseState);
    this.setupMonitorLoop(baseState);
    this.persistCheckpoint(baseState);
    this.emitProgress(baseState, true);
    return this.buildRunSnapshot(baseState);
  }

  pauseRun(runId) {
    const runState = this.runs.get(runId);
    if (!runState) return null;
    runState.status = 'paused';
    this.persistRunHeartbeat(runState);
    this.persistCheckpoint(runState);
    this.emitProgress(runState, true);
    return this.buildRunSnapshot(runState);
  }

  async cancelRun(runId) {
    const runState = this.runs.get(runId);
    if (!runState) return null;
    runState.status = 'cancelled';
    this.run(
      `UPDATE research_runs
       SET status = ?, stats_json = ?, ended_at = ?, updated_at = ?
       WHERE id = ?`,
      ['cancelled', safeStringify(runState.stats), nowIso(), nowIso(), runId]
    );
    this.persistCheckpoint(runState);
    this.saveDatabase();
    this.emitProgress(runState, true);
    return this.buildRunSnapshot(runState);
  }

  steerRun(runId, steeringInput = '') {
    const runState = this.runs.get(runId);
    if (!runState) return { success: false, error: 'Run not active' };
    if (!['running', 'paused'].includes(String(runState.status || ''))) {
      return { success: false, error: 'Run is not steerable in current state' };
    }
    const steeringText = String(steeringInput || '').replace(/\s+/g, ' ').trim();
    if (!steeringText) return { success: false, error: 'Steering text is required' };

    const priorInstructions = String(runState.runInstructions || '').trim();
    runState.runInstructions = [priorInstructions, `Steering update: ${steeringText}`]
      .filter(Boolean)
      .join('\n');
    runState.topicProfile = buildTopicProfile({
      objective: runState.objective,
      runInstructions: runState.runInstructions,
      promptSnapshot: runState.promptSnapshot || {},
    });
    runState.promptSnapshot = {
      ...(runState.promptSnapshot && typeof runState.promptSnapshot === 'object' ? runState.promptSnapshot : {}),
      runInstructions: runState.runInstructions,
      updatedAt: nowIso(),
    };

    let queued = 0;
    const steeringObjective = `${String(runState.objective || '').trim()} ${steeringText}`.trim();
    const steeringQueries = this.buildSeedQueries({
      objective: steeringObjective,
      runInstructions: runState.runInstructions,
      promptSnapshot: runState.promptSnapshot || {},
      researchSettings: {
        ...(runState.researchSettings || normalizeResearchSettings()),
        seedQueryLimit: 12,
      },
      topicProfile: runState.topicProfile,
    });
    for (const query of steeringQueries) {
      if (this.enqueueTask(runState, 'discover', { query, depth: 0 })) queued += 1;
    }

    this.pushActivity(runState, {
      id: uuidv4(),
      at: nowIso(),
      phase: 'setup',
      phaseLabel: 'Steering',
      status: 'completed',
      summary: 'Run guidance updated.',
      details: `Instruction: ${steeringText}${queued > 0 ? ` | queued discovery queries: ${queued}` : ''}`,
    });

    this.persistPromptSnapshot(runState);
    this.persistCheckpoint(runState);
    this.emitProgress(runState, true);
    return {
      success: true,
      queuedQueries: queued,
      run: this.buildRunSnapshot(runState),
    };
  }

  async resumeRun({
    runId,
    projectId,
    objective,
    runInstructions,
    workerCount,
    schema,
    sourcePolicy,
    researchSettings,
    promptSnapshot,
  }) {
    const existingState = this.runs.get(runId);
    if (existingState) {
      existingState.status = 'running';
      this.persistRunHeartbeat(existingState);
      this.emitProgress(existingState, true);
      return this.buildRunSnapshot(existingState);
    }

    const checkpointRow = this.queryOne(
      `SELECT queue_json, state_json
       FROM research_checkpoints
       WHERE run_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [runId]
    );
    const queueJson = safeParseJson(checkpointRow?.queue_json, {});
    const stateJson = safeParseJson(checkpointRow?.state_json, {});
    const restoredCheckpoint = {
      queues: {
        discover: (queueJson?.discover || []).map((task) => normalizeTaskPayload(task)),
        official_verify: (queueJson?.official_verify || []).map((task) => normalizeTaskPayload(task)),
        extract_fields: (queueJson?.extract_fields || []).map((task) => normalizeTaskPayload(task)),
        evidence_validate: (queueJson?.evidence_validate || []).map((task) => normalizeTaskPayload(task)),
        persist: (queueJson?.persist || []).map((task) => normalizeTaskPayload(task)),
      },
      stats: stateJson?.stats || null,
      convergenceCount: Number(stateJson?.convergenceCount || 0),
      lastSavedCount: Number(stateJson?.lastSavedCount || 0),
      researchSettings: stateJson?.researchSettings || null,
      topicProfile: stateJson?.topicProfile || null,
      queryCursor: Number(stateJson?.queryCursor || 0),
      runStartedAtMs: Number(stateJson?.runStartedAtMs || Date.now()),
      searchFailureStreak: Number(stateJson?.searchFailureStreak || 0),
      searchBackoffUntil: Number(stateJson?.searchBackoffUntil || 0),
      lastProgressSummaryAt: Number(stateJson?.lastProgressSummaryAt || 0),
      lastProgressSummarySearches: Number(stateJson?.lastProgressSummarySearches || 0),
      lastProgressSummaryVerified: Number(stateJson?.lastProgressSummaryVerified || 0),
      discoverQueriesSeen: Array.isArray(stateJson?.discoverQueriesSeen) ? stateJson.discoverQueriesSeen : [],
      candidateUrlsSeen: Array.isArray(stateJson?.candidateUrlsSeen) ? stateJson.candidateUrlsSeen : [],
      activitySeq: Number(stateJson?.activitySeq || 0),
      activityLog: Array.isArray(stateJson?.activityLog) ? stateJson.activityLog : [],
      domainTally: stateJson?.domainTally && typeof stateJson.domainTally === 'object' ? stateJson.domainTally : {},
      intermediateSummary: stateJson?.intermediateSummary || null,
      finalSynthesis: stateJson?.finalSynthesis || null,
    };

    this.run(`UPDATE research_runs SET status = ?, updated_at = ? WHERE id = ?`, ['running', nowIso(), runId]);
    this.saveDatabase();
    return this.startRun({
      projectId,
      objective,
      runInstructions,
      workerCount,
      schema,
      sourcePolicy,
      researchSettings,
      promptSnapshot,
      existingRunId: runId,
      restoredCheckpoint,
    });
  }

  getRun(runId) {
    const inMemory = this.runs.get(runId);
    if (inMemory) return this.buildRunSnapshot(inMemory);
    const row = this.queryOne(`SELECT * FROM research_runs WHERE id = ?`, [runId]);
    if (!row) return null;
    const stats = safeParseJson(row.stats_json, buildStatsSkeleton());
    const promptSnapshot = safeParseJson(row.prompt_snapshot_json, {});
    const researchSettings = normalizeResearchSettings(promptSnapshot?.researchSettings || {});
    const startedAtMs = Date.parse(row.started_at || row.created_at || '') || Date.now();
    const goalProgress = this.getGoalProgress({
      researchSettings,
      runStartedAtMs: startedAtMs,
      stats,
    });
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      objective: row.objective,
      workerCount: Number(row.worker_count || this.defaultWorkerCount),
      convergenceCount: Number(row.convergence_count || 0),
       convergenceThreshold: Number(researchSettings.convergenceThreshold || this.convergenceThreshold),
      queueByPhase: {
        discover: 0,
        official_verify: 0,
        extract_fields: 0,
        evidence_validate: 0,
        persist: 0,
      },
      queueSize: 0,
      activeWorkers: 0,
      workers: [],
      stats,
      researchSettings,
      goalProgress,
      recentActivity: [],
      domainStats: [],
      intermediateSummary: promptSnapshot?.intermediateSummary || null,
      finalSynthesis: promptSnapshot?.finalSynthesis || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listRuns(projectId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
    const rows = projectId
      ? this.query(
        `SELECT * FROM research_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
        [projectId, safeLimit]
      )
      : this.query(
        `SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?`,
        [safeLimit]
      );
    return rows.map((row) => {
      const live = this.runs.get(row.id);
      if (live) return this.buildRunSnapshot(live);
      const stats = safeParseJson(row.stats_json, buildStatsSkeleton());
      const promptSnapshot = safeParseJson(row.prompt_snapshot_json, {});
      const researchSettings = normalizeResearchSettings(promptSnapshot?.researchSettings || {});
      const startedAtMs = Date.parse(row.started_at || row.created_at || '') || Date.now();
      const goalProgress = this.getGoalProgress({
        researchSettings,
        runStartedAtMs: startedAtMs,
        stats,
      });
      return {
        id: row.id,
        projectId: row.project_id,
        status: row.status,
        objective: row.objective,
        workerCount: Number(row.worker_count || this.defaultWorkerCount),
        convergenceCount: Number(row.convergence_count || 0),
        convergenceThreshold: Number(researchSettings.convergenceThreshold || this.convergenceThreshold),
        queueByPhase: {
          discover: 0,
          official_verify: 0,
          extract_fields: 0,
          evidence_validate: 0,
          persist: 0,
        },
        queueSize: 0,
        activeWorkers: 0,
        workers: [],
        stats,
        researchSettings,
        goalProgress,
        recentActivity: [],
        domainStats: [],
        intermediateSummary: promptSnapshot?.intermediateSummary || null,
        finalSynthesis: promptSnapshot?.finalSynthesis || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }
}

module.exports = {
  ResearchOrchestrator,
  buildStatsSkeleton,
  safeParseJson,
  safeStringify,
};
