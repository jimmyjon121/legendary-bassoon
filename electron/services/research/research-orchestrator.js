/**
 * Research Orchestrator - General-purpose deep research engine.
 *
 * LLM-driven pipeline:  plan -> search -> read -> analyze  (loop until convergence)
 * Then generates a final markdown report with citations.
 *
 * Keeps: worker pool, task queues, checkpointing, resume, progress emission.
 * Removed: All FFAS / treatment-program-specific logic.
 */

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const { searchWeb, fetchPageContent } = require('../web-search-service');
const {
  normalizeUrl,
  normalizeDomain,
  classifySource,
  mergeSourcePolicy,
  DEFAULT_SOURCE_POLICY,
} = require('./research-source-policy');
const {
  createEvidence,
  hasValidEvidence,
} = require('./research-schema');

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PHASES = ['plan', 'search', 'read', 'analyze'];
const PRIORITY_ORDER = ['analyze', 'read', 'search', 'plan'];
const STAGE_IDS = ['intent_compile', 'retrieve', 'verify', 'synthesize', 'gate'];
const PHASE_TO_STAGE = {
  plan: 'intent_compile',
  search: 'retrieve',
  read: 'verify',
  analyze: 'synthesize',
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

function safeParseJson(input, fallback) {
  if (!input || typeof input !== 'string') return fallback;
  try { return JSON.parse(input); } catch (_e) { return fallback; }
}

function safeStringify(value, fallback = '{}') {
  try { return JSON.stringify(value ?? {}); } catch (_e) { return fallback; }
}

function normalizeTaskPayload(task = {}) {
  return {
    id: task.id || uuidv4(),
    phase: task.phase || 'plan',
    payload: task.payload || {},
    retries: Number(task.retries || 0),
    createdAt: task.createdAt || Date.now(),
  };
}

function compactText(text = '', maxLen = 240) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 3)}...`;
}

function clampMultilineText(text = '', maxLen = 3000) {
  const s = String(text || '').replace(/\r/g, '').trim();
  if (!s) return '';
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 3)}...`;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function normalizeProjectContext(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    permanentInstructions: clampMultilineText(source.permanentInstructions || '', 4000),
    runInstructions: clampMultilineText(source.runInstructions || '', 3000),
    conversationDigest: clampMultilineText(source.conversationDigest || '', 7000),
    documentDigest: clampMultilineText(source.documentDigest || '', 7000),
    linkedConversations: normalizeStringArray(source.linkedConversations || []),
    linkedDocuments: normalizeStringArray(source.linkedDocuments || []),
  };
}

function mergeProjectContextValues(primary = {}, fallback = {}) {
  const preferred = normalizeProjectContext(primary);
  const backup = normalizeProjectContext(fallback);
  return {
    permanentInstructions: preferred.permanentInstructions || backup.permanentInstructions,
    runInstructions: preferred.runInstructions || backup.runInstructions,
    conversationDigest: preferred.conversationDigest || backup.conversationDigest,
    documentDigest: preferred.documentDigest || backup.documentDigest,
    linkedConversations: preferred.linkedConversations.length > 0 ? preferred.linkedConversations : backup.linkedConversations,
    linkedDocuments: preferred.linkedDocuments.length > 0 ? preferred.linkedDocuments : backup.linkedDocuments,
  };
}

function buildProjectContextMeta(projectContext = {}) {
  const context = normalizeProjectContext(projectContext);
  return {
    hasPermanentInstructions: Boolean(context.permanentInstructions),
    hasRunInstructions: Boolean(context.runInstructions),
    hasConversationDigest: Boolean(context.conversationDigest),
    hasDocumentDigest: Boolean(context.documentDigest),
    linkedConversations: context.linkedConversations.length,
    linkedDocuments: context.linkedDocuments.length,
  };
}

function buildProjectContextSection(projectContext = {}, options = {}) {
  const context = normalizeProjectContext(projectContext);
  const {
    includeDigests = false,
    digestChars = 1200,
  } = options || {};

  const lines = [];
  if (context.permanentInstructions) {
    lines.push('Project permanent instructions:');
    lines.push(context.permanentInstructions);
  }
  if (context.runInstructions) {
    if (lines.length > 0) lines.push('');
    lines.push('Run-specific instructions:');
    lines.push(context.runInstructions);
  }
  if (includeDigests && context.conversationDigest) {
    if (lines.length > 0) lines.push('');
    lines.push('Linked conversation context digest:');
    lines.push(clampMultilineText(context.conversationDigest, digestChars));
  }
  if (includeDigests && context.documentDigest) {
    if (lines.length > 0) lines.push('');
    lines.push('Linked document context digest:');
    lines.push(clampMultilineText(context.documentDigest, digestChars));
  }

  const linkedSummary = [];
  if (context.linkedConversations.length > 0) linkedSummary.push(`${context.linkedConversations.length} linked conversation(s)`);
  if (context.linkedDocuments.length > 0) linkedSummary.push(`${context.linkedDocuments.length} linked document(s)`);
  if (linkedSummary.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`Context scope: ${linkedSummary.join(', ')}.`);
  }

  if (lines.length === 0) return '';

  return [
    'Project context and constraints:',
    '---',
    ...lines,
    '---',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/*  Depth presets                                                      */
/* ------------------------------------------------------------------ */

const DEPTH_PRESETS = {
  quick: {
    maxQueries: 8,
    maxSourcesRead: 12,
    maxRuntimeMinutes: 5,
    maxFollowUpDepth: 1,
    convergenceThreshold: 3,
    topResultsPerQuery: 5,
    analyzeMaxContentChars: 6000,
  },
  standard: {
    maxQueries: 20,
    maxSourcesRead: 30,
    maxRuntimeMinutes: 15,
    maxFollowUpDepth: 2,
    convergenceThreshold: 5,
    topResultsPerQuery: 8,
    analyzeMaxContentChars: 10000,
  },
  deep: {
    maxQueries: 50,
    maxSourcesRead: 80,
    maxRuntimeMinutes: 45,
    maxFollowUpDepth: 4,
    convergenceThreshold: 8,
    topResultsPerQuery: 12,
    analyzeMaxContentChars: 15000,
  },
};

function resolveSettings(input = {}) {
  const presetKey = String(input.depth || input.preset || 'standard').toLowerCase();
  const preset = DEPTH_PRESETS[presetKey] || DEPTH_PRESETS.standard;
  return {
    ...preset,
    depth: presetKey,
    maxQueries: Number(input.maxQueries || preset.maxQueries),
    maxSourcesRead: Number(input.maxSourcesRead || preset.maxSourcesRead),
    maxRuntimeMinutes: Number(input.maxRuntimeMinutes || preset.maxRuntimeMinutes),
    maxFollowUpDepth: Number(input.maxFollowUpDepth || preset.maxFollowUpDepth),
    convergenceThreshold: Number(input.convergenceThreshold || preset.convergenceThreshold),
    topResultsPerQuery: Number(input.topResultsPerQuery || preset.topResultsPerQuery),
    analyzeMaxContentChars: Number(input.analyzeMaxContentChars || preset.analyzeMaxContentChars),
    providerOrder: input.providerOrder || null,
    searxngUrl: input.searxngUrl || '',
  };
}

/* ------------------------------------------------------------------ */
/*  Stats skeleton                                                     */
/* ------------------------------------------------------------------ */

function buildStatsSkeleton() {
  return {
    discoveredCandidates: 0,
    verifiedSaved: 0,
    rejectedNonOfficial: 0,
    rejectedBlocked: 0,
    rejectedIrrelevant: 0,
    droppedFindings: 0,
    skippedReads: 0,
    searchesIssued: 0,
    resultsFound: 0,
    sourcesRead: 0,
    sourcesFailed: 0,
    analyzeCalls: 0,
    findingsExtracted: 0,
    followUpQueriesGenerated: 0,
    errors: 0,
    lastError: null,
  };
}

const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'that', 'this', 'those', 'these', 'their',
  'there', 'where', 'when', 'what', 'which', 'using', 'used', 'use', 'find', 'verify', 'collect',
  'enough', 'detail', 'both', 'across', 'latest', 'information', 'official', 'source', 'sources',
  'truth', 'page', 'pages', 'website', 'websites', 'program', 'programs', 'research',
]);

const QUERY_NOISE_PHRASES = [
  'source of truth',
  'collect enough detail',
  'family-facing write-ups',
  'clinical dossier records',
  'use official program websites',
  'official pages',
];

const NON_OFFICIAL_REFERENCE_DOMAINS = [
  'wikipedia.org',
  'wikidata.org',
  'wikivoyage.org',
  'britannica.com',
  'fandom.com',
];

const GEORGIA_COUNTRY_CUES = [
  'country of georgia',
  'republic of georgia',
  'georgian language',
  'caucasus',
  'tbilisi',
  'black sea',
  'eurasia',
];

const GEORGIA_US_CUES = [
  'georgia',
  'atlanta',
  'savannah',
  'augusta',
  'macon',
  'county',
  'state',
  'usa',
  'united',
  'states',
  'ga',
];

const HEALTHCARE_PROGRAM_TERMS = [
  'residential',
  'treatment',
  'program',
  'programs',
  'therapy',
  'clinical',
  'behavioral',
  'mental',
  'health',
  'adolescent',
  'adolescents',
  'teen',
  'teens',
  'youth',
  'facility',
  'facilities',
  'family',
  'families',
];

function tokenizeTerms(text = '', minLen = 2) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= minLen);
}

function toTokenSet(text = '', minLen = 2) {
  return new Set(tokenizeTerms(text, minLen));
}

function hasAnyToken(tokenSet, terms = []) {
  if (!(tokenSet instanceof Set) || tokenSet.size === 0) return false;
  if (!Array.isArray(terms) || terms.length === 0) return false;
  for (const term of terms) {
    const normalized = String(term || '').toLowerCase().trim();
    if (!normalized) continue;
    if (tokenSet.has(normalized)) return true;
  }
  return false;
}

function countKeywordOverlap(tokenSet, keywords = []) {
  if (!(tokenSet instanceof Set) || tokenSet.size === 0) return 0;
  if (!Array.isArray(keywords) || keywords.length === 0) return 0;
  const tokenList = Array.from(tokenSet);
  let overlap = 0;
  for (const keyword of keywords) {
    const normalized = String(keyword || '').toLowerCase().trim();
    if (!normalized) continue;
    if (tokenSet.has(normalized)) {
      overlap += 1;
      continue;
    }
    // Handle light morphology drift (for example: "postgre" vs "postgresql").
    if (normalized.length >= 5) {
      const fuzzyMatch = tokenList.some((token) => (
        token.startsWith(normalized) || normalized.startsWith(token)
      ));
      if (fuzzyMatch) overlap += 1;
    }
  }
  return overlap;
}

function containsAnyPhrase(text = '', phrases = []) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return false;
  for (const phrase of phrases) {
    const needle = String(phrase || '').toLowerCase().trim();
    if (!needle) continue;
    if (haystack.includes(needle)) return true;
  }
  return false;
}

function extractKeywords(text = '', limit = 14) {
  const keywords = [];
  const seen = new Set();
  for (const token of tokenizeTerms(text, 3)) {
    if (QUERY_STOPWORDS.has(token)) continue;
    const normalized = token;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(normalized);
    if (keywords.length >= limit) break;
  }
  return keywords;
}

function isLikelyNonOfficialReferenceDomain(domain = '') {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return NON_OFFICIAL_REFERENCE_DOMAINS.some((candidate) => {
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

function buildIntentProfile(question = '', projectContext = {}, sourcePolicy = {}) {
  const project = normalizeProjectContext(projectContext);
  const contextText = [project.permanentInstructions, project.runInstructions]
    .filter(Boolean)
    .join('\n');
  const fullText = `${String(question || '')}\n${contextText}`.toLowerCase();
  const mode = String(sourcePolicy?.mode || '').toLowerCase();

  const requiresOfficial = Boolean(sourcePolicy?.requireOfficial)
    || mode.includes('official')
    || /\bofficial\b/.test(fullText)
    || /\bsource of truth\b/.test(fullText)
    || /\bverify\b|\bverified\b/.test(fullText);

  const focusTerms = HEALTHCARE_PROGRAM_TERMS.filter((term) => fullText.includes(term));
  const questionKeywords = extractKeywords(question, 16);
  const minimumKeywordOverlap = questionKeywords.length >= 4 ? 1 : 0;
  const georgiaMentioned = /\bgeorgia\b/.test(fullText);
  const hasClinicalContext = hasAnyToken(toTokenSet(fullText, 2), HEALTHCARE_PROGRAM_TERMS);
  const georgiaCountryIntent = containsAnyPhrase(fullText, GEORGIA_COUNTRY_CUES);
  const usGeorgiaIntent = georgiaMentioned && hasClinicalContext && !georgiaCountryIntent;

  return {
    requiresOfficial,
    questionKeywords,
    minimumKeywordOverlap,
    focusTerms: Array.from(new Set(focusTerms)),
    usGeorgiaIntent,
  };
}

function isRelevantToIntent(text = '', intent = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const tokens = toTokenSet(lower, 2);

  if (intent.usGeorgiaIntent) {
    const hasCountryCue = containsAnyPhrase(lower, GEORGIA_COUNTRY_CUES);
    const hasUsCue = hasAnyToken(tokens, GEORGIA_US_CUES);
    const hasProgramCue = hasAnyToken(tokens, HEALTHCARE_PROGRAM_TERMS);
    if (hasCountryCue && !hasUsCue && !hasProgramCue) {
      return false;
    }
  }

  if (Array.isArray(intent.focusTerms) && intent.focusTerms.length > 0) {
    if (!hasAnyToken(tokens, intent.focusTerms)) {
      return false;
    }
  }

  const overlap = countKeywordOverlap(tokens, intent.questionKeywords || []);
  if (Number(intent.minimumKeywordOverlap || 0) > 0 && overlap < intent.minimumKeywordOverlap) {
    return false;
  }

  return true;
}

function applyIntentToQuery(rawQuery = '', intent = {}) {
  let query = String(rawQuery || '').replace(/\s+/g, ' ').trim();
  if (!query) return '';

  for (const phrase of QUERY_NOISE_PHRASES) {
    const pattern = new RegExp(phrase, 'ig');
    query = query.replace(pattern, ' ');
  }
  query = query.replace(/\s+/g, ' ').trim();
  if (!query) return '';

  const lower = query.toLowerCase();
  if (intent.requiresOfficial && !/\bofficial\b|\bprimary source\b|\bsource of truth\b|\bwebsite\b/.test(lower)) {
    query = `${query} official website`;
  }

  if (intent.usGeorgiaIntent && /\bgeorgia\b/i.test(query) && !/\bgeorgia state\b|\bunited states\b|\busa\b|\bga\b/i.test(lower)) {
    query = `${query} Georgia state United States`;
  }
  if (intent.usGeorgiaIntent) {
    if (!/-country/i.test(query)) query = `${query} -country`;
    if (!/-tbilisi/i.test(query)) query = `${query} -Tbilisi`;
    if (!/-caucasus/i.test(query)) query = `${query} -Caucasus`;
  }

  if (Array.isArray(intent.focusTerms) && intent.focusTerms.length > 0) {
    const queryTokens = toTokenSet(query, 2);
    if (!hasAnyToken(queryTokens, intent.focusTerms)) {
      query = `${query} ${intent.focusTerms.slice(0, 3).join(' ')}`;
    }
  }

  return query.replace(/\s+/g, ' ').trim();
}

function normalizeQueryCandidate(query = '', maxLen = 180) {
  const compact = String(query || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (!compact) return '';
  if (compact.length <= maxLen) return compact;
  const clipped = compact.slice(0, maxLen);
  return clipped.replace(/\s+\S*$/, '').trim() || clipped.trim();
}

function buildCoreQuestionQuery(question = '', intent = {}) {
  const raw = String(question || '').trim();
  if (!raw) return '';
  const firstSentence = raw.split(/[.?!\n]/).map((item) => item.trim()).find(Boolean) || raw;
  const tokens = tokenizeTerms(firstSentence, 2);
  const picked = [];
  const seen = new Set();
  for (const token of tokens) {
    if (QUERY_STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    picked.push(token);
    if (picked.length >= 12) break;
  }
  let base = picked.join(' ').trim() || firstSentence;
  if (intent.usGeorgiaIntent && /\bgeorgia\b/i.test(base) && !/\bstate\b|\busa\b|\bunited states\b/i.test(base)) {
    base = `${base} georgia state united states`;
  }
  return normalizeQueryCandidate(base, 120);
}

function scoreFindingRelevance(text = '', intent = {}) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  const tokens = toTokenSet(lower, 2);
  let score = 0.25;

  if (isRelevantToIntent(raw, intent)) score += 0.45;

  const overlap = countKeywordOverlap(tokens, intent.questionKeywords || []);
  const keywordTarget = Math.max(1, Number(intent.minimumKeywordOverlap || 0));
  score += Math.min(0.2, (overlap / keywordTarget) * 0.1);

  if (Array.isArray(intent.focusTerms) && intent.focusTerms.length > 0) {
    if (hasAnyToken(tokens, intent.focusTerms)) score += 0.1;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function buildStageStatus() {
  const stageStatus = {};
  for (const stageId of STAGE_IDS) {
    stageStatus[stageId] = {
      stageId,
      status: 'pending', // pending | running | completed | failed | blocked
      pass: null,
      attempts: 0,
      updatedAt: null,
      reason: '',
    };
  }
  return stageStatus;
}

function ensureStageStatusShape(input = {}) {
  const next = buildStageStatus();
  if (!input || typeof input !== 'object') return next;
  for (const stageId of STAGE_IDS) {
    const candidate = input[stageId];
    if (!candidate || typeof candidate !== 'object') continue;
    next[stageId] = {
      stageId,
      status: String(candidate.status || 'pending'),
      pass: typeof candidate.pass === 'boolean' ? candidate.pass : null,
      attempts: Math.max(0, Number(candidate.attempts || 0)),
      updatedAt: candidate.updatedAt || null,
      reason: String(candidate.reason || ''),
    };
  }
  return next;
}

function scoreRunRelevance(findings = []) {
  if (!Array.isArray(findings) || findings.length === 0) return 0;
  const values = findings
    .map((finding) => Number(finding?.relevanceScore || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return 0;
  const total = values.reduce((acc, value) => acc + value, 0);
  return Number((total / values.length).toFixed(2));
}

function buildJurisdictionTokenSet(jurisdiction = '') {
  return new Set(
    String(jurisdiction || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function scoreJurisdictionMatch(runState = {}) {
  const jurisdiction = String(runState.jurisdiction || '').trim().toLowerCase();
  const findings = Array.isArray(runState.findings) ? runState.findings : [];
  if (!jurisdiction || jurisdiction === 'auto') {
    if (runState.intentProfile?.usGeorgiaIntent) {
      const total = findings.length;
      if (total === 0) return 0;
      let hits = 0;
      for (const finding of findings) {
        const text = String(finding?.text || '').toLowerCase();
        const hasUsGeorgiaCue = /\bgeorgia\b/.test(text) && /\bstate\b|\batlanta\b|\bunited states\b|\busa\b/.test(text);
        const hasCountryCue = /\bcaucasus\b|\btbilisi\b|\bblack sea\b/.test(text);
        if (hasUsGeorgiaCue && !hasCountryCue) hits += 1;
      }
      return Number((hits / total).toFixed(2));
    }
    return null;
  }

  const jurisdictionTokens = buildJurisdictionTokenSet(jurisdiction);
  if (jurisdictionTokens.size === 0 || findings.length === 0) return 0;

  let matched = 0;
  for (const finding of findings) {
    const tokens = toTokenSet(String(finding?.text || ''), 2);
    const hasMatch = Array.from(jurisdictionTokens).some((token) => tokens.has(token));
    if (hasMatch) matched += 1;
  }
  return Number((matched / findings.length).toFixed(2));
}

function buildQualityGate(runState = {}, quality = null) {
  const metrics = quality || buildRunQuality(runState);
  const stageStatus = ensureStageStatusShape(runState.stageStatus || {});
  const stageFailures = STAGE_IDS
    .map((stageId) => stageStatus[stageId])
    .filter((stage) => stage && stage.pass === false)
    .map((stage) => stage.stageId);

  const reasons = [];
  if ((metrics.score || 0) < 70) reasons.push('quality_score_below_threshold');
  if (Array.isArray(metrics.issues) && metrics.issues.length > 0) reasons.push(...metrics.issues);
  if (stageFailures.length > 0) reasons.push(...stageFailures.map((item) => `stage_failed:${item}`));

  return {
    passed: reasons.length === 0,
    score: Number(metrics.score || 0),
    threshold: 70,
    reasons,
    stageStatus,
  };
}

function buildIntentAndAssumptions(question = '', intent = '', jurisdiction = '') {
  const assumptions = [];
  const normalizedIntent = String(intent || '').trim() || String(question || '').trim();
  const normalizedJurisdiction = String(jurisdiction || '').trim() || 'auto';

  const lowerQuestion = String(question || '').toLowerCase();
  const mentionsGeorgia = /\bgeorgia\b/.test(lowerQuestion);
  const mentionsUs = /\busa\b|\bunited states\b|\bstate\b|\batlanta\b/.test(lowerQuestion);
  const mentionsCountry = /\bcountry\b|\bcaucasus\b|\btbilisi\b|\bblack sea\b/.test(lowerQuestion);

  if (mentionsGeorgia && !mentionsUs && !mentionsCountry && normalizedJurisdiction === 'auto') {
    assumptions.push({
      code: 'ambiguous_georgia_disambiguated_to_us_state',
      text: 'Interpreted "Georgia" as Georgia state, United States due to program/clinical context.',
      createdAt: nowIso(),
    });
  }

  if (normalizedJurisdiction === 'auto') {
    assumptions.push({
      code: 'jurisdiction_auto_resolution',
      text: 'Jurisdiction resolved automatically from the research objective and context.',
      createdAt: nowIso(),
    });
  }

  return {
    intent: normalizedIntent,
    jurisdiction: normalizedJurisdiction,
    assumptions,
  };
}

function buildRunQuality(runState = {}) {
  const state = runState || {};
  const stats = state.stats || {};
  const sources = Array.isArray(state.sourcesRead) ? state.sourcesRead : [];
  const findings = Array.isArray(state.findings) ? state.findings : [];
  const sourceCount = sources.length;
  const findingCount = findings.length;
  const officialSources = sources.filter((source) => source.isOfficial).length;
  const trustedSources = sources.filter((source) => ['authoritative', 'secondary', 'high', 'standard'].includes(String(source.sourceTier || ''))).length;
  const citedFindings = findings.filter((finding) => String(finding.sourceUrl || '').trim().length > 0).length;
  const rejectedTotal = Number(stats.rejectedBlocked || 0) + Number(stats.rejectedNonOfficial || 0) + Number(stats.rejectedIrrelevant || 0);
  const reviewedTotal = sourceCount + rejectedTotal;
  const rejectionRate = reviewedTotal > 0 ? rejectedTotal / reviewedTotal : 0;
  const officialRatio = sourceCount > 0 ? officialSources / sourceCount : 0;
  const trustedRatio = sourceCount > 0 ? trustedSources / sourceCount : 0;
  const citationCoverage = findingCount > 0 ? citedFindings / findingCount : 0;

  let score = 100;
  score -= Math.round(rejectionRate * 35);
  score += Math.round(trustedRatio * 12);
  score += Math.round(citationCoverage * 8);
  if (state.sourcePolicy?.requireOfficial) {
    score += Math.round(officialRatio * 10);
  }
  if (sourceCount < 3) score -= 12;
  if (findingCount === 0) score -= 20;
  score = Math.max(0, Math.min(100, score));

  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  const issues = [];
  if (state.sourcePolicy?.requireOfficial && officialRatio < 0.35) issues.push('low_official_source_ratio');
  if (rejectionRate > 0.6) issues.push('high_rejection_rate');
  if (citationCoverage < 0.7 && findingCount > 0) issues.push('low_citation_coverage');
  if ((state.policyViolations || []).length > 0) issues.push('policy_violations_detected');
  if (findingCount === 0) issues.push('no_findings');

  return {
    score,
    grade,
    sourceCount,
    findingCount,
    officialSources,
    trustedSources,
    citationCoverage: Number(citationCoverage.toFixed(2)),
    rejectionRate: Number(rejectionRate.toFixed(2)),
    issues,
  };
}

function tuneQueriesForIntent(queries = [], intent = {}, maxCount = 20) {
  const output = [];
  const seen = new Set();
  for (const item of queries) {
    const tuned = normalizeQueryCandidate(applyIntentToQuery(item, intent), 180);
    if (!tuned) continue;
    if (tuned.length < 3) continue;
    const key = tuned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tuned);
    if (output.length >= maxCount) break;
  }
  return output;
}

/* ------------------------------------------------------------------ */
/*  LLM prompt builders                                                */
/* ------------------------------------------------------------------ */

function buildPlanPrompt(question, projectContext = {}) {
  const contextSection = buildProjectContextSection(projectContext, { includeDigests: true, digestChars: 1500 });
  const lines = [
    'You are a research assistant. Your job is to generate search queries that will help answer a research question thoroughly.',
    '',
    `Research question: "${question}"`,
  ];
  if (contextSection) {
    lines.push('');
    lines.push(contextSection);
    lines.push('');
    lines.push('Use the project context above as hard guidance when forming queries.');
  }
  lines.push('');
  lines.push('Generate 8-15 diverse web search queries that will help answer this question comprehensively.');
  lines.push('Cover different angles, sub-topics, and perspectives.');
  lines.push('Keep each query concise (4-14 words), specific, and disambiguated when geography/entity names are ambiguous.');
  lines.push('Prioritize first-party or official pages over encyclopedic summaries.');
  lines.push('Output ONLY a JSON array of query strings, nothing else.');
  lines.push('');
  lines.push('Example output:');
  lines.push('["query one", "query two", "query three"]');
  return lines.join('\n');
}

function buildAnalyzePrompt(pageContent, question, existingFindingsCount, projectContext = {}) {
  const content = compactText(pageContent, 12000);
  const contextSection = buildProjectContextSection(projectContext, { includeDigests: false });
  const lines = [
    'You are a research analyst. Extract key findings from the page content below that are relevant to the research question.',
    '',
    `Research question: "${question}"`,
    `Findings collected so far: ${existingFindingsCount}`,
  ];
  if (contextSection) {
    lines.push('');
    lines.push(contextSection);
    lines.push('');
    lines.push('Follow these project instructions while extracting findings.');
  }
  lines.push('');
  lines.push('Page content:');
  lines.push('---');
  lines.push(content);
  lines.push('---');
  lines.push('');
  lines.push('Extract relevant findings and suggest follow-up search queries for knowledge gaps.');
  lines.push('Output ONLY valid JSON in this exact format:');
  lines.push('{');
  lines.push('  "findings": [{"text": "key finding text", "category": "fact"}],');
  lines.push('  "followUpQueries": ["follow-up query if gaps exist"]');
  lines.push('}');
  lines.push('');
  lines.push('Categories: fact, statistic, opinion, definition, comparison, example, recommendation');
  lines.push('If the page is not relevant, return: {"findings": [], "followUpQueries": []}');
  lines.push('Keep each finding concise (1-2 sentences). Include 0-3 follow-up queries only if there are clear gaps.');
  return lines.join('\n');
}

function buildProgressSummary(question, findings, sourcesCount, searchesCount, projectContext = {}) {
  const topFindings = findings.slice(-6).map((f) => `- ${compactText(f.text, 120)}`).join('\n');
  const contextSection = buildProjectContextSection(projectContext, { includeDigests: false });
  const lines = [
    'You are a research assistant providing a brief progress update.',
    '',
    `Research question: "${question}"`,
    `Sources read: ${sourcesCount}`,
    `Searches issued: ${searchesCount}`,
    `Findings so far: ${findings.length}`,
  ];
  if (contextSection) {
    lines.push('');
    lines.push(contextSection);
  }
  lines.push('');
  lines.push('Recent findings:');
  lines.push(topFindings || '(none yet)');
  lines.push('');
  lines.push('Write a 2-3 sentence progress summary of what has been found so far and what is still being investigated.');
  lines.push('Be conversational and informative. Output only the summary text, nothing else.');
  return lines.join('\n');
}

function buildReportPrompt(question, findings, projectContext = {}) {
  const findingRows = findings.map((f, i) => {
    const src = f.sourceDomain ? ` [Source: ${f.sourceDomain}]` : '';
    return `${i + 1}. ${f.text}${src}`;
  }).join('\n');
  const contextSection = buildProjectContextSection(projectContext, { includeDigests: true, digestChars: 1800 });

  const lines = [
    'You are a research analyst writing a comprehensive research report.',
    '',
    `Research question: "${question}"`,
  ];
  if (contextSection) {
    lines.push('');
    lines.push(contextSection);
    lines.push('');
    lines.push('Treat project instructions as constraints while synthesizing the report.');
  }
  lines.push('');
  lines.push(`Key findings from ${findings.length} sources:`);
  lines.push(findingRows || '(no findings collected)');
  lines.push('');
  lines.push('Write a comprehensive research report in markdown format with these sections:');
  lines.push('# Research Report');
  lines.push('## Executive Summary');
  lines.push('(2-3 paragraph overview of key conclusions)');
  lines.push('## Key Findings');
  lines.push('(Detailed findings organized by theme, with inline source citations like [Source: domain.com])');
  lines.push('## Analysis');
  lines.push('(Synthesis and interpretation of findings)');
  lines.push('## Gaps and Limitations');
  lines.push('(What could not be determined, areas needing further research)');
  lines.push('## Sources');
  lines.push('(List all unique source URLs referenced)');
  lines.push('');
  lines.push('Use the findings data above. Do not invent information. Cite sources inline.');
  lines.push('If findings are insufficient, state that clearly rather than fabricating content.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  LLM output parsers                                                 */
/* ------------------------------------------------------------------ */

function extractJsonFromText(text) {
  const raw = String(text || '').trim();
  // Try direct parse first
  const direct = safeParseJson(raw, null);
  if (direct) return direct;
  // Try extracting from markdown code block
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    const parsed = safeParseJson(codeBlock[1].trim(), null);
    if (parsed) return parsed;
  }
  // Try finding first { or [
  const bracketStart = raw.indexOf('[');
  const braceStart = raw.indexOf('{');
  let start = -1;
  if (bracketStart >= 0 && (braceStart < 0 || bracketStart < braceStart)) {
    start = bracketStart;
  } else if (braceStart >= 0) {
    start = braceStart;
  }
  if (start >= 0) {
    const isArray = raw[start] === '[';
    const closeChar = isArray ? ']' : '}';
    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === raw[start]) depth++;
      if (raw[i] === closeChar) depth--;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        const parsed = safeParseJson(candidate, null);
        if (parsed) return parsed;
        break;
      }
    }
  }
  return null;
}

function parseQueriesFromLLM(text) {
  const parsed = extractJsonFromText(text);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item || '').trim()).filter((q) => q.length >= 3);
  }
  if (parsed && Array.isArray(parsed.queries)) {
    return parsed.queries.map((item) => String(item || '').trim()).filter((q) => q.length >= 3);
  }
  // Fallback: extract quoted strings
  const matches = String(text || '').match(/"([^"]{3,120})"/g) || [];
  return matches.map((m) => m.replace(/"/g, '').trim()).filter((q) => q.length >= 3);
}

function parseAnalysisFromLLM(text) {
  const parsed = extractJsonFromText(text);
  const result = { findings: [], followUpQueries: [] };
  if (!parsed) return result;

  if (Array.isArray(parsed.findings)) {
    for (const item of parsed.findings) {
      const txt = String(item?.text || item || '').trim();
      if (txt.length < 5) continue;
      result.findings.push({
        text: txt,
        category: String(item?.category || 'fact').toLowerCase(),
      });
    }
  }
  if (Array.isArray(parsed.followUpQueries)) {
    result.followUpQueries = parsed.followUpQueries
      .map((q) => String(q || '').trim())
      .filter((q) => q.length >= 3)
      .slice(0, 3);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Activity event formatting                                          */
/* ------------------------------------------------------------------ */

function formatPhaseLabel(phase) {
  const labels = {
    plan: 'Plan',
    search: 'Search',
    read: 'Read',
    analyze: 'Analyze',
    synthesis: 'Synthesis',
    progress: 'Progress',
  };
  return labels[phase] || 'Task';
}

/* ------------------------------------------------------------------ */
/*  ResearchOrchestrator class                                         */
/* ------------------------------------------------------------------ */

class ResearchOrchestrator extends EventEmitter {
  constructor({ db, saveDatabase, progressSink, llmCall } = {}) {
    super();
    this.db = db;
    this.saveDatabase = typeof saveDatabase === 'function' ? saveDatabase : () => {};
    this.progressSink = typeof progressSink === 'function' ? progressSink : null;
    this.llmCall = typeof llmCall === 'function' ? llmCall : null;
    this.defaultWorkerCount = 3;
    this.maxTaskRetries = 2;
    this.monitorIntervalMs = 4000;
    this.checkpointIntervalMs = 30000;
    this.stallTimeoutMs = 120000;
    this.maxStallRecoveries = 3;
    this.progressSummaryIntervalMs = 60000;
    this.runs = new Map();
  }

  /* -- DB helpers --------------------------------------------------- */

  query(sql, params = []) {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }

  queryOne(sql, params = []) {
    const rows = this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  run(sql, params = []) {
    if (!this.db) return;
    this.db.run(sql, params);
  }

  /* -- State management --------------------------------------------- */

  ensureRunState(runState) {
    if (!runState.queues) {
      runState.queues = { plan: [], search: [], read: [], analyze: [] };
    }
    for (const phase of PHASES) {
      if (!Array.isArray(runState.queues[phase])) runState.queues[phase] = [];
    }
    if (!runState.workerStatus) runState.workerStatus = new Map();
    if (!runState.queriesSeen) runState.queriesSeen = new Set();
    if (!runState.urlsSeen) runState.urlsSeen = new Set();
    if (!Number.isFinite(runState.convergenceCount)) runState.convergenceCount = 0;
    if (!runState.stats) runState.stats = buildStatsSkeleton();
    if (!runState.settings) runState.settings = resolveSettings(runState.settings || {});
    runState.sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, runState.sourcePolicy || {});
    runState.projectContext = normalizeProjectContext(runState.projectContext || {});
    if (!runState.intentProfile || typeof runState.intentProfile !== 'object') {
      runState.intentProfile = buildIntentProfile(runState.question || '', runState.projectContext, runState.sourcePolicy);
    }
    if (!runState.stageStatus || typeof runState.stageStatus !== 'object') {
      runState.stageStatus = buildStageStatus();
    } else {
      runState.stageStatus = ensureStageStatusShape(runState.stageStatus);
    }
    if (!Array.isArray(runState.assumptions)) runState.assumptions = [];
    if (!Array.isArray(runState.policyViolations)) runState.policyViolations = [];
    if (!Array.isArray(runState.steeringEvents)) runState.steeringEvents = [];
    runState.intent = String(runState.intent || '').trim() || String(runState.question || '').trim();
    runState.jurisdiction = String(runState.jurisdiction || '').trim() || 'auto';
    if (!Array.isArray(runState.findings)) runState.findings = [];
    if (!Array.isArray(runState.sourcesRead)) runState.sourcesRead = [];
    if (!Number.isFinite(runState.runStartedAtMs)) runState.runStartedAtMs = Date.now();
    if (!Number.isFinite(runState.lastActivityAt)) runState.lastActivityAt = Date.now();
    if (!Number.isFinite(runState.lastCheckpointAt)) runState.lastCheckpointAt = 0;
    if (!Number.isFinite(runState.lastProgressSummaryAt)) runState.lastProgressSummaryAt = 0;
    if (!Number.isFinite(runState.stallRecoveries)) runState.stallRecoveries = 0;
    if (!runState.workerLoops) runState.workerLoops = [];
    if (!Array.isArray(runState.activityLog)) runState.activityLog = [];
    if (!Number.isFinite(runState.activitySeq)) runState.activitySeq = runState.activityLog.length || 0;
    if (!runState.report) runState.report = runState.report || null;
    if (!runState.progressSummaries) runState.progressSummaries = runState.progressSummaries || [];
    if (!runState.createdAt) runState.createdAt = nowIso();
    if (runState.domainTally instanceof Map) { /* ok */ }
    else if (runState.domainTally && typeof runState.domainTally === 'object') {
      runState.domainTally = new Map(Object.entries(runState.domainTally));
    } else {
      runState.domainTally = new Map();
    }
    if (!runState.taskKeys) runState.taskKeys = new Set();
    if (!runState.stepKeys) runState.stepKeys = new Set();
    if (runState.persistedFindingKeys instanceof Set) { /* ok */ }
    else if (Array.isArray(runState.persistedFindingKeys)) {
      runState.persistedFindingKeys = new Set(runState.persistedFindingKeys);
    } else {
      runState.persistedFindingKeys = new Set();
    }
    return runState;
  }

  /* -- Queue management --------------------------------------------- */

  enqueueTask(runState, phase, payload = {}, dedupeKey = '') {
    if (!PHASES.includes(phase)) return false;
    const state = this.ensureRunState(runState);
    const settings = state.settings;
    const stepKey = String(payload.stepKey || dedupeKey || '').trim();

    // Enforce limits
    if (phase === 'search') {
      const query = String(payload.query || '').replace(/\s+/g, ' ').trim();
      if (!query || query.length < 3) return false;
      const key = query.toLowerCase();
      if (state.queriesSeen.has(key)) return false;
      if (state.stats.searchesIssued >= settings.maxQueries) return false;
      state.queriesSeen.add(key);
      payload.query = query;
    }
    if (phase === 'read') {
      const url = normalizeUrl(payload.url || '');
      if (!url) return false;
      if (state.urlsSeen.has(url)) return false;
      if (state.stats.sourcesRead >= settings.maxSourcesRead) return false;
      state.urlsSeen.add(url);
      payload.url = url;
    }
    if (stepKey) {
      const key = `${phase}:${stepKey}`;
      if (state.stepKeys.has(key)) return false;
      state.stepKeys.add(key);
      payload.stepKey = stepKey;
    } else if (dedupeKey) {
      const key = `${phase}:${dedupeKey}`;
      if (state.taskKeys.has(key)) return false;
      state.taskKeys.add(key);
    }

    state.queues[phase].push(normalizeTaskPayload({ phase, payload }));
    // New work should reset convergence streak so runs do not end prematurely.
    state.convergenceCount = 0;
    return true;
  }

  dequeueTask(runState) {
    const state = this.ensureRunState(runState);
    for (const phase of PRIORITY_ORDER) {
      const queue = state.queues[phase];
      if (queue && queue.length > 0) return queue.shift();
    }
    return null;
  }

  queueSize(runState) {
    let total = 0;
    for (const phase of PHASES) total += (runState.queues?.[phase]?.length || 0);
    return total;
  }

  setStageState(runState, stageId, patch = {}) {
    if (!stageId || !STAGE_IDS.includes(stageId)) return;
    const state = this.ensureRunState(runState);
    const current = state.stageStatus?.[stageId] || {
      stageId,
      status: 'pending',
      pass: null,
      attempts: 0,
      updatedAt: null,
      reason: '',
    };
    const next = {
      ...current,
      ...patch,
      stageId,
      updatedAt: nowIso(),
    };
    if (patch.status === 'running') {
      next.attempts = Math.max(1, Number(current.attempts || 0) + 1);
    } else if (!Number.isFinite(Number(next.attempts))) {
      next.attempts = Number(current.attempts || 0);
    }
    state.stageStatus[stageId] = next;
  }

  addAssumptions(runState, assumptions = []) {
    if (!Array.isArray(assumptions) || assumptions.length === 0) return;
    const state = this.ensureRunState(runState);
    const seen = new Set(state.assumptions.map((item) => String(item?.code || item?.text || '').trim()));
    for (const entry of assumptions) {
      const code = String(entry?.code || '').trim();
      const text = String(entry?.text || '').trim();
      const key = code || text;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      state.assumptions.push({
        code: code || 'assumption',
        text: text || code,
        createdAt: entry?.createdAt || nowIso(),
      });
    }
    if (state.assumptions.length > 40) {
      state.assumptions.splice(0, state.assumptions.length - 40);
    }
  }

  recordPolicyViolation(runState, violation = {}) {
    const state = this.ensureRunState(runState);
    const payload = {
      id: uuidv4(),
      code: String(violation.code || 'policy_violation').trim(),
      reason: String(violation.reason || '').trim(),
      domain: normalizeDomain(violation.domain || ''),
      url: normalizeUrl(violation.url || ''),
      phase: String(violation.phase || '').trim(),
      stageId: String(violation.stageId || '').trim(),
      at: nowIso(),
    };
    state.policyViolations.push(payload);
    if (state.policyViolations.length > 250) {
      state.policyViolations.splice(0, state.policyViolations.length - 250);
    }
  }

  /* -- Domain tally ------------------------------------------------- */

  incrementDomainTally(runState, domain, count = 1) {
    if (!domain) return;
    const d = normalizeDomain(domain);
    if (!d) return;
    const current = runState.domainTally?.get(d) || 0;
    runState.domainTally.set(d, current + count);
  }

  buildFindingCanonicalKey(text = '') {
    const normalized = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized.slice(0, 120) || `finding_${uuidv4().slice(0, 8)}`;
  }

  persistFindingRecord(runState, finding = {}) {
    const state = this.ensureRunState(runState);
    const text = String(finding.text || '').trim();
    if (!text) return;

    const sourceUrl = normalizeUrl(finding.sourceUrl || finding.source_url || '');
    const canonicalKey = this.buildFindingCanonicalKey(text);
    const dedupeKey = `${canonicalKey}:${sourceUrl || 'no_source'}`;
    if (state.persistedFindingKeys.has(dedupeKey)) return;
    state.persistedFindingKeys.add(dedupeKey);

    const now = nowIso();
    const recordId = uuidv4();
    const sourceDomain = normalizeDomain(finding.sourceDomain || sourceUrl || '');
    const sourceTitle = String(finding.sourceTitle || '').trim();
    const category = String(finding.category || 'fact').trim() || 'fact';
    const isOfficial = finding.isOfficial ? 1 : 0;
    const findingId = String(finding.id || '').trim();
    const typedEvidence = createEvidence({
      quote: String(finding.quote || text).trim().slice(0, 1200),
      sourceUrl,
      sourceTitle,
      sourceDomain,
      capturedAt: now,
      supportsFindingIds: findingId ? [findingId] : [],
      isOfficial: Boolean(isOfficial),
    });

    const recordPayload = {
      name: compactText(text, 90),
      summary: text,
      category,
      official_url: sourceUrl,
      source_url: sourceUrl,
      source_domain: sourceDomain,
      source_title: sourceTitle,
      added_at: now,
      evidence: hasValidEvidence([typedEvidence]) ? [typedEvidence] : [],
    };

    this.run(
      `INSERT INTO research_records (id, project_id, run_id, canonical_key, record_json, verified_official_url, verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recordId,
        state.projectId,
        state.id,
        canonicalKey,
        safeStringify(recordPayload),
        isOfficial ? sourceUrl : null,
        isOfficial ? now : null,
        now,
        now,
      ]
    );

    if (sourceUrl) {
      this.run(
        `INSERT INTO research_evidence (id, record_id, field_key, claim_text, source_url, source_domain, source_title, excerpt_text, is_official, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          recordId,
          'summary',
          text,
          sourceUrl,
          sourceDomain,
          sourceTitle,
          typedEvidence.quote || compactText(text, 280),
          isOfficial,
          now,
        ]
      );
    }

    if (isOfficial) {
      state.stats.verifiedSaved += 1;
    }
  }

  /* -- Activity tracking -------------------------------------------- */

  buildTaskActivityEvent({ task, status, output, error, workerId }) {
    const phase = task?.phase || 'task';
    const stageId = PHASE_TO_STAGE[phase] || null;
    const event = {
      id: uuidv4(),
      at: nowIso(),
      phase,
      stageId,
      phaseLabel: formatPhaseLabel(phase),
      status: String(status || 'started').toLowerCase(),
      workerId: workerId || null,
      taskId: task?.id || null,
      summary: '',
      details: '',
      query: '',
      url: '',
      domain: '',
    };

    if (phase === 'plan') {
      if (status === 'started') event.summary = 'Generating search plan from research question...';
      else if (status === 'completed') event.summary = `Generated ${output?.queriesGenerated || 0} search queries`;
      else if (status === 'failed') event.summary = `Plan generation failed: ${String(error || '').slice(0, 80)}`;
    } else if (phase === 'search') {
      event.query = String(task.payload?.query || '').slice(0, 100);
      if (status === 'started') event.summary = `Searching: "${event.query}"`;
      else if (status === 'completed') {
        event.summary = `Found ${output?.found || 0} results, queued ${output?.queued || 0}`;
        const detailBits = [];
        if (output?.provider) detailBits.push(`Provider: ${output.provider}`);
        if (Number(output?.rejected || 0) > 0) detailBits.push(`Rejected: ${output.rejected}`);
        event.details = detailBits.join(' | ');
      }
      else if (status === 'failed') event.summary = `Search failed: ${String(error || '').slice(0, 80)}`;
    } else if (phase === 'read') {
      event.url = String(task.payload?.url || '').slice(0, 120);
      event.domain = normalizeDomain(event.url);
      if (status === 'started') event.summary = event.domain ? `Reading ${event.domain}...` : 'Reading source...';
      else if (status === 'completed') event.summary = `Read ${output?.contentLength || 0} chars from ${event.domain || 'source'}`;
      else if (status === 'skipped') event.summary = `Skipped: ${output?.reason || 'insufficient content'}`;
      else if (status === 'failed') event.summary = `Read failed: ${String(error || '').slice(0, 80)}`;
    } else if (phase === 'analyze') {
      event.domain = normalizeDomain(task.payload?.url || '');
      if (status === 'started') event.summary = event.domain ? `Analyzing ${event.domain}...` : 'Analyzing source content...';
      else if (status === 'completed') {
        event.summary = `Extracted ${output?.findingsExtracted || 0} findings`;
        const detailBits = [];
        if (output?.followUpQueries > 0) detailBits.push(`${output.followUpQueries} follow-up queries queued`);
        if (output?.droppedFindings > 0) detailBits.push(`${output.droppedFindings} findings dropped`);
        event.details = detailBits.join(' | ');
      }
      else if (status === 'failed') event.summary = `Analysis failed: ${String(error || '').slice(0, 80)}`;
    } else if (phase === 'synthesis') {
      if (status === 'started') event.summary = 'Generating final research report...';
      else if (status === 'completed') event.summary = 'Research report generated successfully';
      else if (status === 'failed') event.summary = `Report generation failed: ${String(error || '').slice(0, 80)}`;
    } else if (phase === 'progress') {
      event.summary = String(output?.text || 'Progress update').slice(0, 300);
    }

    return event;
  }

  pushActivity(runState, event) {
    if (!event) return;
    const state = this.ensureRunState(runState);
    state.activitySeq = (state.activitySeq || 0) + 1;
    const entry = { seq: state.activitySeq, ...event };
    if (!entry.at) entry.at = nowIso();
    state.activityLog.push(entry);
    if (state.activityLog.length > 500) {
      state.activityLog.splice(0, state.activityLog.length - 500);
    }
    if (entry.domain) this.incrementDomainTally(state, entry.domain, 1);
  }

  /* -- Progress / snapshots ----------------------------------------- */

  buildRunSnapshot(runState) {
    const state = this.ensureRunState(runState);
    const queueByPhase = {};
    for (const phase of PHASES) queueByPhase[phase] = state.queues?.[phase]?.length || 0;
    const workerStatus = Array.from(state.workerStatus.values());
    const activeWorkers = workerStatus.filter((w) => w.status === 'busy').length;
    const goalProgress = this.getGoalProgress(state);
    const domainStats = Array.from(state.domainTally.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 16);
    const recentActivity = (state.activityLog || []).slice(-120);
    const recentFindings = (state.findings || []).slice(-20).map((f) => ({
      id: f.id,
      text: compactText(f.text, 200),
      sourceUrl: f.sourceUrl || '',
      sourceDomain: f.sourceDomain || '',
      category: f.category || 'fact',
      relevanceScore: Number(f.relevanceScore || 0),
      sourceTier: f.sourceTier || '',
      sourceQuality: Number(f.sourceQuality || 0),
      isOfficial: Boolean(f.isOfficial),
    }));
    const quality = buildRunQuality(state);
    const stageStatus = ensureStageStatusShape(state.stageStatus || {});
    const relevanceScore = scoreRunRelevance(state.findings || []);
    const jurisdictionMatch = scoreJurisdictionMatch(state);
    const qualityGate = buildQualityGate(state, quality);
    const stageOrder = STAGE_IDS
      .map((stageId) => stageStatus[stageId])
      .filter(Boolean);
    const activeStage = stageOrder.find((item) => item.status === 'running')
      || stageOrder.find((item) => item.pass === null && item.status !== 'completed')
      || stageOrder[stageOrder.length - 1]
      || null;

    return {
      id: state.id,
      projectId: state.projectId,
      status: state.status,
      question: state.question,
      intent: state.intent || state.question,
      jurisdiction: state.jurisdiction || 'auto',
      workerCount: state.workerCount,
      activeWorkers,
      workers: workerStatus,
      queueByPhase,
      queueSize: this.queueSize(state),
      convergenceCount: state.convergenceCount,
      convergenceThreshold: state.settings?.convergenceThreshold || 5,
      stats: { ...state.stats },
      settings: { ...state.settings },
      sourcePolicy: { ...(state.sourcePolicy || DEFAULT_SOURCE_POLICY) },
      contextMeta: buildProjectContextMeta(state.projectContext),
      quality,
      qualityGate,
      relevanceScore,
      jurisdictionMatch,
      assumptions: (state.assumptions || []).slice(-40),
      policyViolations: (state.policyViolations || []).slice(-120),
      stageStatus,
      stageOrder,
      stageId: activeStage?.stageId || null,
      goalProgress,
      recentActivity,
      recentFindings,
      domainStats,
      totalFindings: state.findings?.length || 0,
      totalSources: state.sourcesRead?.length || 0,
      sourcesRead: (state.sourcesRead || []).slice(-50).map((s) => ({
        url: s.url || '',
        title: s.title || '',
        domain: s.domain || '',
        contentLength: s.contentLength || 0,
        isOfficial: Boolean(s.isOfficial),
        sourceTier: s.sourceTier || '',
        sourceQuality: Number(s.sourceQuality || 0),
        sourceReason: s.sourceReason || '',
        query: s.query || '',
        depth: Number(s.depth || 0),
      })),
      report: state.report || null,
      progressSummaries: state.progressSummaries || [],
      createdAt: state.createdAt || null,
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

  getGoalProgress(runState) {
    const settings = runState.settings || resolveSettings();
    const elapsedMs = Math.max(0, Date.now() - Number(runState.runStartedAtMs || Date.now()));
    const elapsedMinutes = elapsedMs / 60000;
    const stats = runState.stats || buildStatsSkeleton();
    const goals = {
      maxQueries: settings.maxQueries,
      maxSourcesRead: settings.maxSourcesRead,
      maxRuntimeMinutes: settings.maxRuntimeMinutes,
    };
    const current = {
      elapsedMinutes,
      searchesIssued: stats.searchesIssued || 0,
      sourcesRead: stats.sourcesRead || 0,
      findings: (runState.findings || []).length,
    };
    return { goals, current };
  }

  isRuntimeExceeded(runState) {
    const settings = runState.settings || resolveSettings();
    const elapsed = (Date.now() - Number(runState.runStartedAtMs || Date.now())) / 60000;
    return elapsed >= settings.maxRuntimeMinutes;
  }

  /* -- DB persistence ----------------------------------------------- */

  persistRunHeartbeat(runState) {
    this.run(
      `UPDATE research_runs SET status = ?, stats_json = ?, convergence_count = ?, updated_at = ? WHERE id = ?`,
      [runState.status, safeStringify(runState.stats), runState.convergenceCount || 0, nowIso(), runState.id]
    );
    this.saveDatabase();
  }

  persistCheckpoint(runState) {
    const queuePayload = {};
    for (const phase of PHASES) {
      queuePayload[phase] = (runState.queues?.[phase] || []).map((t) => ({
        id: t.id, phase: t.phase, payload: t.payload, retries: t.retries, createdAt: t.createdAt,
      }));
    }
    const statePayload = {
      status: runState.status,
      question: runState.question,
      intent: runState.intent || runState.question,
      jurisdiction: runState.jurisdiction || 'auto',
      workerCount: runState.workerCount,
      settings: runState.settings,
      sourcePolicy: runState.sourcePolicy,
      projectContext: runState.projectContext,
      intentProfile: runState.intentProfile,
      stageStatus: ensureStageStatusShape(runState.stageStatus || {}),
      assumptions: (runState.assumptions || []).slice(-80),
      policyViolations: (runState.policyViolations || []).slice(-250),
      steeringEvents: (runState.steeringEvents || []).slice(-120),
      quality: buildRunQuality(runState),
      stats: runState.stats,
      convergenceCount: runState.convergenceCount,
      findings: (runState.findings || []).slice(-200),
      sourcesRead: (runState.sourcesRead || []).slice(-100),
      runStartedAtMs: runState.runStartedAtMs,
      queriesSeen: Array.from(runState.queriesSeen || []),
      urlsSeen: Array.from(runState.urlsSeen || []),
      taskKeys: Array.from(runState.taskKeys || []),
      stepKeys: Array.from(runState.stepKeys || []),
      activitySeq: runState.activitySeq || 0,
      activityLog: (runState.activityLog || []).slice(-400),
      domainTally: Object.fromEntries(runState.domainTally instanceof Map ? runState.domainTally.entries() : []),
      persistedFindingKeys: Array.from(runState.persistedFindingKeys || []),
      report: runState.report || null,
      progressSummaries: runState.progressSummaries || [],
      savedAt: nowIso(),
    };
    this.run(
      `INSERT INTO research_checkpoints (id, run_id, queue_json, state_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), runState.id, safeStringify(queuePayload), safeStringify(statePayload), nowIso()]
    );
    runState.lastCheckpointAt = Date.now();
    this.saveDatabase();
  }

  updateTaskRow(runState, task, status, output = null, error = null, workerId = null) {
    if (!task.taskRowInserted) {
      this.run(
        `INSERT INTO research_tasks (id, run_id, worker_id, phase, status, input_json, output_json, error, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [task.id, runState.id, workerId || 'worker', task.phase, status,
         safeStringify(task.payload), output ? safeStringify(output) : null, error || null,
         status === 'running' ? nowIso() : null,
         ['completed', 'failed', 'blocked', 'skipped'].includes(status) ? nowIso() : null]
      );
      task.taskRowInserted = true;
    } else {
      this.run(
        `UPDATE research_tasks SET status = ?, output_json = ?, error = ?, ended_at = ?, worker_id = ? WHERE id = ?`,
        [status, output ? safeStringify(output) : null, error || null,
         ['completed', 'failed', 'blocked', 'skipped'].includes(status) ? nowIso() : null,
         workerId || 'worker', task.id]
      );
    }
  }

  /* -- Phase executors ---------------------------------------------- */

  async executePlan(runState, _task) {
    const question = String(runState.question || '').trim();
    if (!question) return { skipped: true, reason: 'empty_question' };
    this.setStageState(runState, 'intent_compile', { status: 'running', pass: null, reason: '' });
    const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, runState.sourcePolicy || {});
    runState.sourcePolicy = sourcePolicy;
    const compiled = buildIntentAndAssumptions(
      question,
      runState.intent || question,
      runState.jurisdiction || 'auto'
    );
    runState.intent = compiled.intent;
    runState.jurisdiction = compiled.jurisdiction;
    this.addAssumptions(runState, compiled.assumptions);
    const intent = buildIntentProfile(question, runState.projectContext, sourcePolicy);
    runState.intentProfile = intent;

    if (this.llmCall) {
      const prompt = buildPlanPrompt(question, runState.projectContext);
      try {
        const result = await this.llmCall({ prompt, maxTokens: 1200 });
        const queries = parseQueriesFromLLM(result?.text || '');
        if (queries.length > 0) {
          const settings = runState.settings || resolveSettings();
          const tuned = tuneQueriesForIntent(queries, intent, settings.maxQueries);
          const finalQueries = tuned.length > 0
            ? tuned
            : this.generateFallbackQueries(question, intent).slice(0, settings.maxQueries);
          for (const query of finalQueries) {
            this.enqueueTask(runState, 'search', { query, depth: 0 });
          }
          this.setStageState(runState, 'intent_compile', {
            status: 'completed',
            pass: true,
            reason: tuned.length > 0 ? 'llm_plan_generated' : 'fallback_plan_generated',
          });
          return {
            queriesGenerated: finalQueries.length,
            queries: finalQueries,
            mode: tuned.length > 0 ? 'llm' : 'fallback',
            stageId: 'intent_compile',
          };
        }
      } catch (err) {
        // Fall through to fallback query generation
        runState.stats.errors += 1;
        runState.stats.lastError = `plan_llm_failed: ${err.message || err}`;
      }
    }

    // Fallback: generate basic queries from the question itself
    const fallbackQueries = this.generateFallbackQueries(question, intent);
    for (const query of fallbackQueries) {
      this.enqueueTask(runState, 'search', { query, depth: 0 });
    }
    this.setStageState(runState, 'intent_compile', {
      status: 'completed',
      pass: fallbackQueries.length > 0,
      reason: fallbackQueries.length > 0 ? 'fallback_plan_generated' : 'no_queries_generated',
    });
    return { queriesGenerated: fallbackQueries.length, queries: fallbackQueries, mode: 'fallback', stageId: 'intent_compile' };
  }

  generateFallbackQueries(question, intent = {}) {
    const q = buildCoreQuestionQuery(question, intent);
    if (!q) return [];
    const queries = [
      q,
      `${q} official website`,
      `${q} admissions`,
      `${q} program details`,
      `${q} contact information`,
      `${q} accreditation`,
      `${q} licensing`,
      `${q} outcomes`,
    ];
    if (intent.usGeorgiaIntent) {
      queries.push(`${q} georgia state united states`);
      queries.push(`${q} atlanta georgia`);
    }
    return tuneQueriesForIntent(queries, intent, 12);
  }

  async executeSearch(runState, task) {
    const query = String(task.payload?.query || '').trim();
    if (!query) return { skipped: true, reason: 'empty_query' };
    this.setStageState(runState, 'retrieve', { status: 'running', pass: null, reason: '' });
    const settings = runState.settings || resolveSettings();
    const depth = Number(task.payload?.depth || 0);
    if (depth > settings.maxFollowUpDepth) {
      return { skipped: true, reason: 'max_depth_exceeded' };
    }

    const searchOpts = {
      maxResults: settings.topResultsPerQuery,
      timeout: 16000,
    };
    if (settings.providerOrder) searchOpts.providerOrder = settings.providerOrder;
    if (settings.searxngUrl) searchOpts.searxngUrl = settings.searxngUrl;

    const result = await searchWeb(query, searchOpts);
    const entries = Array.isArray(result?.results) ? result.results : [];
    runState.stats.searchesIssued += 1;
    runState.stats.resultsFound += entries.length;
    runState.stats.discoveredCandidates += entries.length;

    let queued = 0;
    let rejected = 0;
    const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, runState.sourcePolicy || {});
    const intent = runState.intentProfile || buildIntentProfile(runState.question, runState.projectContext, sourcePolicy);
    runState.intentProfile = intent;
    for (const entry of entries) {
      const sourceDecision = classifySource({ url: entry.url || '' }, sourcePolicy);
      if (sourceDecision.isRejected) {
        runState.stats.rejectedBlocked += 1;
        rejected += 1;
        this.recordPolicyViolation(runState, {
          code: sourceDecision.reason || 'source_rejected',
          reason: sourceDecision.reason || 'source_rejected',
          url: entry.url || '',
          domain: sourceDecision.domain || '',
          phase: 'search',
          stageId: 'retrieve',
        });
        continue;
      }

      if (intent.requiresOfficial && isLikelyNonOfficialReferenceDomain(sourceDecision.domain)) {
        runState.stats.rejectedNonOfficial += 1;
        rejected += 1;
        this.recordPolicyViolation(runState, {
          code: 'non_official_reference_domain',
          reason: 'non_official_reference_domain',
          url: entry.url || '',
          domain: sourceDecision.domain || '',
          phase: 'search',
          stageId: 'retrieve',
        });
        continue;
      }

      if (sourcePolicy.allowedDomains?.length > 0 && !sourceDecision.isOfficial) {
        runState.stats.rejectedNonOfficial += 1;
        rejected += 1;
        this.recordPolicyViolation(runState, {
          code: 'allowlist_only',
          reason: 'allowlist_only',
          url: entry.url || '',
          domain: sourceDecision.domain || '',
          phase: 'search',
          stageId: 'retrieve',
        });
        continue;
      }

      if (sourcePolicy.requireOfficial && !sourceDecision.isOfficial && sourceDecision.tier === 'tertiary') {
        runState.stats.rejectedNonOfficial += 1;
        rejected += 1;
        this.recordPolicyViolation(runState, {
          code: 'official_required_non_authoritative',
          reason: 'official_required_non_authoritative',
          url: entry.url || '',
          domain: sourceDecision.domain || '',
          phase: 'search',
          stageId: 'retrieve',
        });
        continue;
      }

      const resultPreview = `${entry.title || ''}\n${entry.snippet || ''}\n${entry.url || ''}`;
      const isPreviewRelevant = isRelevantToIntent(resultPreview, intent);
      const deferToReadStage = intent.requiresOfficial && sourceDecision.isOfficial;
      if (!isPreviewRelevant && !deferToReadStage) {
        runState.stats.rejectedIrrelevant += 1;
        rejected += 1;
        continue;
      }

      const url = sourceDecision.normalizedUrl || normalizeUrl(entry.url || '');
      if (!url) continue;
      const domain = sourceDecision.domain || normalizeDomain(url);
      if (domain) this.incrementDomainTally(runState, domain, 1);

      const enqueued = this.enqueueTask(runState, 'read', {
        url,
        title: String(entry.title || '').trim(),
        snippet: String(entry.snippet || '').trim(),
        query,
        depth,
        isOfficial: Boolean(sourceDecision.isOfficial),
        sourceTier: sourceDecision.tier || 'standard',
        sourceQuality: Number(sourceDecision.quality || 0),
        sourceReason: sourceDecision.reason || '',
      }, url);
      if (enqueued) queued += 1;
    }

    this.setStageState(runState, 'retrieve', {
      status: 'completed',
      pass: queued > 0 || entries.length > 0,
      reason: queued > 0 ? 'queued_read_tasks' : (entries.length > 0 ? 'results_found_no_queue' : 'no_results'),
    });

    return {
      query,
      found: entries.length,
      queued,
      rejected,
      provider: result?.provider || null,
      error: result?.error || null,
      stageId: 'retrieve',
    };
  }

  async executeRead(runState, task) {
    const url = String(task.payload?.url || '').trim();
    if (!url) return { skipped: true, reason: 'no_url' };
    this.setStageState(runState, 'verify', { status: 'running', pass: null, reason: '' });
    const settings = runState.settings || resolveSettings();
    const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, runState.sourcePolicy || {});
    const intent = runState.intentProfile || buildIntentProfile(runState.question, runState.projectContext, sourcePolicy);
    runState.intentProfile = intent;
    const domain = normalizeDomain(url);

    if (intent.requiresOfficial && isLikelyNonOfficialReferenceDomain(domain)) {
      runState.stats.rejectedNonOfficial += 1;
      runState.stats.skippedReads += 1;
      this.recordPolicyViolation(runState, {
        code: 'non_official_reference_domain',
        reason: 'non_official_reference_domain',
        url,
        domain,
        phase: 'read',
        stageId: 'verify',
      });
      this.setStageState(runState, 'verify', {
        status: 'blocked',
        pass: false,
        reason: 'non_official_reference_domain',
      });
      return { skipped: true, reason: 'non_official_reference_domain' };
    }

    const page = await fetchPageContent(url, {
      maxLength: settings.analyzeMaxContentChars,
      timeout: 18000,
    });
    runState.stats.sourcesRead += 1;

    const content = String(page?.content || '').trim();
    if (content.length < 100) {
      runState.stats.sourcesFailed += 1;
      runState.stats.rejectedIrrelevant += 1;
      runState.stats.skippedReads += 1;
      this.setStageState(runState, 'verify', {
        status: 'completed',
        pass: false,
        reason: 'insufficient_content',
      });
      return { skipped: true, reason: 'insufficient_content', contentLength: content.length };
    }

    const relevanceText = [
      task.payload?.title || '',
      task.payload?.snippet || '',
      page?.title || '',
      content.slice(0, 6000),
    ].join('\n');
    if (!isRelevantToIntent(relevanceText, intent)) {
      runState.stats.rejectedIrrelevant += 1;
      runState.stats.skippedReads += 1;
      this.setStageState(runState, 'verify', {
        status: 'completed',
        pass: false,
        reason: 'off_topic_content',
      });
      return { skipped: true, reason: 'off_topic_content' };
    }

    const evidenceQuote = compactText(content.slice(0, 900), 420);
    runState.sourcesRead.push({
      url,
      title: String(page?.title || task.payload?.title || '').trim(),
      domain,
      contentLength: content.length,
      readAt: nowIso(),
      rendered: Boolean(page?.rendered),
      isOfficial: Boolean(task.payload?.isOfficial),
      sourceTier: String(task.payload?.sourceTier || ''),
      sourceQuality: Number(task.payload?.sourceQuality || 0),
      sourceReason: String(task.payload?.sourceReason || ''),
      query: String(task.payload?.query || ''),
      depth: Number(task.payload?.depth || 0),
      evidenceQuote,
    });

    this.enqueueTask(runState, 'analyze', {
      url,
      title: String(page?.title || task.payload?.title || '').trim(),
      content,
      domain,
      depth: Number(task.payload?.depth || 0),
      isOfficial: Boolean(task.payload?.isOfficial),
    });

    this.setStageState(runState, 'verify', {
      status: 'completed',
      pass: true,
      reason: 'source_verified',
    });

    return {
      contentLength: content.length,
      title: page?.title || '',
      rendered: Boolean(page?.rendered),
      stageId: 'verify',
    };
  }

  async executeAnalyze(runState, task) {
    const content = String(task.payload?.content || '').trim();
    const question = String(runState.question || '').trim();
    if (!content || !question) return { skipped: true, reason: 'missing_content_or_question' };
    this.setStageState(runState, 'synthesize', { status: 'running', pass: null, reason: '' });

    const settings = runState.settings || resolveSettings();
    const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, runState.sourcePolicy || {});
    const intent = runState.intentProfile || buildIntentProfile(question, runState.projectContext, sourcePolicy);
    runState.intentProfile = intent;
    const trimmedContent = content.slice(0, settings.analyzeMaxContentChars);

    if (!this.llmCall) {
      // No LLM available - store the source as a finding based on snippet
      const snippet = compactText(task.payload?.snippet || content, 300);
      let extractedCount = 0;
      if (snippet && isRelevantToIntent(snippet, intent)) {
        const evidence = createEvidence({
          quote: snippet,
          sourceUrl: task.payload?.url || '',
          sourceTitle: task.payload?.title || '',
          sourceDomain: task.payload?.domain || '',
          supportsFindingIds: [],
          isOfficial: Boolean(task.payload?.isOfficial),
        });
        const finding = {
          id: uuidv4(),
          text: snippet,
          sourceUrl: task.payload?.url || '',
          sourceTitle: task.payload?.title || '',
          sourceDomain: task.payload?.domain || '',
          category: 'fact',
          isOfficial: Boolean(task.payload?.isOfficial),
          sourceTier: String(task.payload?.sourceTier || ''),
          sourceQuality: Number(task.payload?.sourceQuality || 0),
          relevanceScore: scoreFindingRelevance(snippet, intent),
          addedAt: nowIso(),
          evidence: evidence.quote && evidence.sourceUrl ? [evidence] : [],
        };
        if (hasValidEvidence(finding.evidence)) {
          finding.evidence[0].supportsFindingIds = [finding.id];
          runState.findings.push(finding);
          this.persistFindingRecord(runState, finding);
          runState.stats.findingsExtracted += 1;
          extractedCount = 1;
        } else {
          runState.stats.droppedFindings += 1;
        }
      } else if (snippet) {
        runState.stats.droppedFindings += 1;
      }
      this.setStageState(runState, 'synthesize', {
        status: 'completed',
        pass: extractedCount > 0,
        reason: extractedCount > 0 ? 'deterministic_finding_added' : 'no_evidence_backed_findings',
      });
      return { findingsExtracted: extractedCount, mode: 'no_llm' };
    }

    const prompt = buildAnalyzePrompt(trimmedContent, question, runState.findings.length, runState.projectContext);
    const result = await this.llmCall({ prompt, maxTokens: 1500 });
    const parsed = parseAnalysisFromLLM(result?.text || '');
    runState.stats.analyzeCalls += 1;

    let acceptedFindings = 0;
    let droppedFindings = 0;
    for (const finding of parsed.findings) {
      if (!isRelevantToIntent(finding.text, intent)) {
        runState.stats.rejectedIrrelevant += 1;
        runState.stats.droppedFindings += 1;
        droppedFindings += 1;
        continue;
      }
      const relevanceScore = scoreFindingRelevance(finding.text, intent);
      if (relevanceScore < 0.45) {
        runState.stats.droppedFindings += 1;
        droppedFindings += 1;
        continue;
      }
      const normalizedFinding = {
        id: uuidv4(),
        text: finding.text,
        sourceUrl: task.payload?.url || '',
        sourceTitle: task.payload?.title || '',
        sourceDomain: task.payload?.domain || '',
        category: finding.category || 'fact',
        isOfficial: Boolean(task.payload?.isOfficial),
        sourceTier: String(task.payload?.sourceTier || ''),
        sourceQuality: Number(task.payload?.sourceQuality || 0),
        relevanceScore,
        addedAt: nowIso(),
        evidence: [createEvidence({
          quote: compactText(finding.text, 500),
          sourceUrl: task.payload?.url || '',
          sourceTitle: task.payload?.title || '',
          sourceDomain: task.payload?.domain || '',
          supportsFindingIds: [],
          isOfficial: Boolean(task.payload?.isOfficial),
        })],
      };
      if (!hasValidEvidence(normalizedFinding.evidence)) {
        runState.stats.droppedFindings += 1;
        droppedFindings += 1;
        continue;
      }
      normalizedFinding.evidence[0].supportsFindingIds = [normalizedFinding.id];
      runState.findings.push(normalizedFinding);
      this.persistFindingRecord(runState, normalizedFinding);
      runState.stats.findingsExtracted += 1;
      acceptedFindings += 1;
    }

    // Enqueue follow-up queries
    const depth = Number(task.payload?.depth || 0);
    let queuedFollowUp = 0;
    if (depth < settings.maxFollowUpDepth) {
      const tunedFollowUp = tuneQueriesForIntent(parsed.followUpQueries, intent, 3);
      for (const query of tunedFollowUp) {
        if (!isRelevantToIntent(query, intent)) continue;
        this.enqueueTask(runState, 'search', { query, depth: depth + 1, stepKey: `followup:${query.toLowerCase()}` });
        runState.stats.followUpQueriesGenerated += 1;
        queuedFollowUp += 1;
      }
    }

    this.setStageState(runState, 'synthesize', {
      status: 'completed',
      pass: acceptedFindings > 0,
      reason: acceptedFindings > 0 ? 'evidence_backed_findings_added' : 'no_evidence_backed_findings',
    });

    return {
      findingsExtracted: acceptedFindings,
      droppedFindings,
      followUpQueries: queuedFollowUp,
      stageId: 'synthesize',
    };
  }

  /* -- Progress summaries ------------------------------------------- */

  async maybeEmitProgressSummary(runState) {
    const now = Date.now();
    if (now - (runState.lastProgressSummaryAt || 0) < this.progressSummaryIntervalMs) return;
    if (!this.llmCall) return;
    if (runState.findings.length === 0) return;

    runState.lastProgressSummaryAt = now;
    try {
      const prompt = buildProgressSummary(
        runState.question,
        runState.findings,
        runState.sourcesRead.length,
        runState.stats.searchesIssued,
        runState.projectContext,
      );
      const result = await this.llmCall({ prompt, maxTokens: 400 });
      const text = String(result?.text || '').trim();
      if (text) {
        runState.progressSummaries.push({ text, at: nowIso(), findingsCount: runState.findings.length });
        this.pushActivity(runState, {
          id: uuidv4(),
          at: nowIso(),
          phase: 'progress',
          phaseLabel: 'Progress',
          status: 'completed',
          summary: text,
        });
        this.emitProgress(runState, true);
      }
    } catch (_err) {
      // Non-fatal - just skip this progress summary
    }
  }

  /* -- Final report generation -------------------------------------- */

  async generateReport(runState) {
    const state = this.ensureRunState(runState);
    if (state.report?.status === 'completed' && state.report?.text) return state.report;

    state.report = { status: 'running', startedAt: nowIso() };
    this.pushActivity(state, {
      id: uuidv4(), at: nowIso(), phase: 'synthesis', phaseLabel: 'Synthesis',
      status: 'started', summary: `Generating final report from ${state.findings.length} findings...`,
    });
    this.emitProgress(state, true);

    // Build fallback report
    const fallbackText = this.buildFallbackReport(state);

    if (state.findings.length === 0) {
      state.report = { status: 'completed', mode: 'fallback', text: fallbackText, generatedAt: nowIso(), findingsCount: 0 };
      this.pushActivity(state, {
        id: uuidv4(), at: nowIso(), phase: 'synthesis', phaseLabel: 'Synthesis',
        status: 'completed', summary: 'Report generated (no findings to summarize).',
      });
      this.emitProgress(state, true);
      return state.report;
    }

    if (!this.llmCall) {
      state.report = { status: 'completed', mode: 'fallback', text: fallbackText, generatedAt: nowIso(), findingsCount: state.findings.length };
      this.pushActivity(state, {
        id: uuidv4(), at: nowIso(), phase: 'synthesis', phaseLabel: 'Synthesis',
        status: 'completed', summary: 'Report generated (deterministic fallback, no LLM).',
      });
      this.emitProgress(state, true);
      return state.report;
    }

    try {
      const prompt = buildReportPrompt(state.question, state.findings, state.projectContext);
      const result = await this.llmCall({ prompt, maxTokens: 4000 });
      const text = String(result?.text || '').trim();
      if (!text) throw new Error('empty_report_output');

      state.report = {
        status: 'completed',
        mode: 'llm',
        model: String(result?.model || '').trim() || null,
        text,
        generatedAt: nowIso(),
        findingsCount: state.findings.length,
      };
    } catch (err) {
      state.report = {
        status: 'completed',
        mode: 'fallback',
        text: fallbackText,
        generatedAt: nowIso(),
        findingsCount: state.findings.length,
        warning: String(err?.message || err || 'report_generation_failed'),
      };
    }

    this.pushActivity(state, {
      id: uuidv4(), at: nowIso(), phase: 'synthesis', phaseLabel: 'Synthesis',
      status: 'completed',
      summary: state.report.mode === 'llm' ? 'Final research report generated.' : 'Report generated using fallback.',
    });
    this.emitProgress(state, true);
    return state.report;
  }

  buildFallbackReport(runState) {
    const stats = runState.stats || {};
    const lines = [];
    lines.push('# Research Report');
    lines.push('');
    lines.push('## Research Question');
    lines.push(String(runState.question || 'Not provided'));
    lines.push('');
    lines.push('## Coverage');
    lines.push(`- Searches issued: ${stats.searchesIssued || 0}`);
    lines.push(`- Sources read: ${stats.sourcesRead || 0}`);
    lines.push(`- Findings extracted: ${stats.findingsExtracted || 0}`);
    lines.push('');
    lines.push('## Key Findings');
    if (!runState.findings || runState.findings.length === 0) {
      lines.push('No findings were extracted during this research run.');
    } else {
      const byDomain = new Map();
      for (const f of runState.findings) {
        const domain = f.sourceDomain || 'unknown';
        const list = byDomain.get(domain) || [];
        list.push(f);
        byDomain.set(domain, list);
      }
      for (const [domain, domainFindings] of byDomain) {
        lines.push(`\n### From ${domain}`);
        for (const f of domainFindings) {
          lines.push(`- ${f.text}`);
        }
      }
    }
    lines.push('');
    lines.push('## Sources');
    const uniqueSources = new Map();
    for (const s of (runState.sourcesRead || [])) {
      if (!uniqueSources.has(s.url)) uniqueSources.set(s.url, s);
    }
    if (uniqueSources.size === 0) {
      lines.push('No sources were successfully read.');
    } else {
      for (const [url, source] of uniqueSources) {
        lines.push(`- [${source.title || source.domain || 'Source'}](${url})`);
      }
    }
    return lines.join('\n');
  }

  /* -- Task dispatcher ---------------------------------------------- */

  async executeTask(runState, workerId, task) {
    switch (task.phase) {
      case 'plan': return this.executePlan(runState, task);
      case 'search': return this.executeSearch(runState, task);
      case 'read': return this.executeRead(runState, task);
      case 'analyze': return this.executeAnalyze(runState, task);
      default: return { skipped: true, reason: 'unknown_phase' };
    }
  }

  /* -- Worker loop -------------------------------------------------- */

  async workerLoop(runState, workerId) {
    const state = this.ensureRunState(runState);
    state.workerStatus.set(workerId, { workerId, status: 'idle', phase: null, taskId: null, updatedAt: Date.now() });

    while (state.status === 'running' || state.status === 'paused') {
      if (state.status === 'paused') {
        state.workerStatus.set(workerId, { workerId, status: 'paused', phase: null, taskId: null, updatedAt: Date.now() });
        await sleep(250);
        continue;
      }

      const task = this.dequeueTask(state);
      if (!task) {
        state.workerStatus.set(workerId, { workerId, status: 'idle', phase: null, taskId: null, updatedAt: Date.now() });
        await sleep(200);
        continue;
      }

      state.workerStatus.set(workerId, { workerId, status: 'busy', phase: task.phase, taskId: task.id, updatedAt: Date.now() });
      this.updateTaskRow(state, task, 'running', null, null, workerId);
      this.pushActivity(state, this.buildTaskActivityEvent({ task, status: 'started', workerId }));
      this.emitProgress(state);

      try {
        const output = await this.executeTask(state, workerId, task);
        const taskStatus = output?.blocked ? 'blocked' : output?.skipped ? 'skipped' : 'completed';
        this.updateTaskRow(state, task, taskStatus, output, null, workerId);
        this.pushActivity(state, this.buildTaskActivityEvent({ task, status: taskStatus, output, workerId }));
        const stageId = PHASE_TO_STAGE[task.phase];
        if (stageId && taskStatus === 'blocked') {
          this.setStageState(state, stageId, {
            status: 'blocked',
            pass: false,
            reason: String(output?.reason || output?.error || 'blocked'),
          });
        } else if (stageId && taskStatus === 'skipped' && output?.reason) {
          this.setStageState(state, stageId, {
            status: 'completed',
            pass: false,
            reason: String(output.reason),
          });
        }
      } catch (error) {
        state.stats.errors += 1;
        state.stats.lastError = error.message || String(error);
        const stageId = PHASE_TO_STAGE[task.phase];
        if (stageId) {
          this.setStageState(state, stageId, {
            status: 'failed',
            pass: false,
            reason: String(error?.message || error || 'task_error'),
          });
        }
        const nextRetry = (task.retries || 0) + 1;
        if (nextRetry < this.maxTaskRetries) {
          state.queues[task.phase].push(normalizeTaskPayload({
            ...task, id: uuidv4(), retries: nextRetry, createdAt: Date.now(),
          }));
          this.updateTaskRow(state, task, 'failed', null, `retry_${nextRetry}:${error.message}`, workerId);
        } else {
          this.updateTaskRow(state, task, 'failed', null, error.message, workerId);
        }
        this.pushActivity(state, this.buildTaskActivityEvent({ task, status: 'failed', error: error.message, workerId }));
      } finally {
        state.lastActivityAt = Date.now();
        this.persistRunHeartbeat(state);
        this.emitProgress(state);
      }
    }

    state.workerStatus.set(workerId, { workerId, status: 'stopped', phase: null, taskId: null, updatedAt: Date.now() });
  }

  /* -- Run lifecycle ------------------------------------------------ */

  async completeRun(runState, reason = 'convergence_reached') {
    if (!runState || runState.status === 'completed' || runState.status === 'cancelled' || runState.status === 'error') return;
    if (runState.completing) return;
    runState.completing = true;
    try {
      this.setStageState(runState, 'gate', { status: 'running', pass: null, reason: 'quality_gate_running' });
      await this.generateReport(runState);
      const quality = buildRunQuality(runState);
      const qualityGate = buildQualityGate(runState, quality);
      this.setStageState(runState, 'gate', {
        status: 'completed',
        pass: Boolean(qualityGate.passed),
        reason: qualityGate.passed ? 'quality_gate_passed' : 'quality_gate_failed',
      });
      runState.status = 'completed';
      runState.completedReason = reason;
      this.run(
        `UPDATE research_runs SET status = ?, stats_json = ?, convergence_count = ?, ended_at = ?, updated_at = ?, prompt_snapshot_json = ?
         WHERE id = ?`,
        ['completed', safeStringify(runState.stats), runState.convergenceCount || 0, nowIso(), nowIso(),
         safeStringify({
           settings: runState.settings,
           sourcePolicy: runState.sourcePolicy,
           projectContext: runState.projectContext,
           intent: runState.intent || runState.question,
           jurisdiction: runState.jurisdiction || 'auto',
           assumptions: runState.assumptions || [],
           policyViolations: runState.policyViolations || [],
           stageStatus: ensureStageStatusShape(runState.stageStatus || {}),
           quality,
           qualityGate,
           relevanceScore: scoreRunRelevance(runState.findings || []),
           jurisdictionMatch: scoreJurisdictionMatch(runState),
           report: runState.report,
           progressSummaries: runState.progressSummaries,
          }), runState.id]
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
    this.setStageState(runState, 'gate', {
      status: 'failed',
      pass: false,
      reason: String(errorMessage || 'run_error'),
    });
    runState.stats.errors += 1;
    runState.stats.lastError = String(errorMessage || 'unknown_error');
    this.run(
      `UPDATE research_runs SET status = ?, stats_json = ?, ended_at = ?, updated_at = ? WHERE id = ?`,
      ['error', safeStringify(runState.stats), nowIso(), nowIso(), runState.id]
    );
    this.persistCheckpoint(runState);
    this.saveDatabase();
    this.emitProgress(runState, true);
  }

  /* -- Monitor loop ------------------------------------------------- */

  setupMonitorLoop(runState) {
    if (runState.monitorTimer) clearInterval(runState.monitorTimer);
    runState.monitorTimer = setInterval(async () => {
      if (!this.runs.has(runState.id)) {
        clearInterval(runState.monitorTimer);
        return;
      }

      if (['cancelled', 'completed', 'error'].includes(runState.status)) {
        clearInterval(runState.monitorTimer);
        this.persistRunHeartbeat(runState);
        this.emitProgress(runState, true);
        this.runs.delete(runState.id);
        return;
      }

      if (runState.status === 'running') {
        if (runState.completing) {
          this.emitProgress(runState);
          return;
        }

        // Check runtime limit
        if (this.isRuntimeExceeded(runState)) {
          await this.completeRun(runState, 'runtime_limit_reached');
          return;
        }

        // Check convergence
        const queueSize = this.queueSize(runState);
        const activeCount = Array.from(runState.workerStatus.values()).filter((w) => w.status === 'busy').length;

        if (queueSize === 0 && activeCount === 0) {
          runState.convergenceCount = (runState.convergenceCount || 0) + 1;
          const threshold = runState.settings?.convergenceThreshold || 5;
          if (runState.convergenceCount >= threshold) {
            await this.completeRun(runState, 'convergence_reached');
            return;
          }
        } else if (runState.convergenceCount !== 0) {
          // Convergence should be based on consecutive idle checks only.
          runState.convergenceCount = 0;
        }

        // Stall detection
        const now = Date.now();
        if (now - (runState.lastActivityAt || 0) > this.stallTimeoutMs) {
          runState.stallRecoveries = (runState.stallRecoveries || 0) + 1;
          if (runState.stallRecoveries > this.maxStallRecoveries) {
            await this.failRun(runState, 'stall_watchdog_exceeded');
            return;
          }
          // Inject a fresh search as recovery
          this.enqueueTask(runState, 'search', {
            query: `${runState.question} latest information`,
            depth: 0,
          });
          runState.lastActivityAt = now;
        }

        // Periodic progress summary
        await this.maybeEmitProgressSummary(runState);

        // Checkpoint
        if (Date.now() - (runState.lastCheckpointAt || 0) >= this.checkpointIntervalMs) {
          this.persistCheckpoint(runState);
        }
      }

      this.persistRunHeartbeat(runState);
      this.emitProgress(runState);
    }, this.monitorIntervalMs);
  }

  startWorkers(runState) {
    const count = Math.max(1, Number(runState.workerCount || this.defaultWorkerCount));
    runState.workerLoops = [];
    for (let i = 0; i < count; i++) {
      const wid = `worker_${i + 1}`;
      runState.workerLoops.push(
        this.workerLoop(runState, wid).catch((err) => {
          runState.stats.errors += 1;
          runState.stats.lastError = err.message || String(err);
        })
      );
    }
  }

  async startRun({
    projectId,
    question,
    intent = '',
    jurisdiction = 'auto',
    workerCount = this.defaultWorkerCount,
    settings = {},
    sourcePolicy = {},
    projectContext = {},
    existingRunId = null,
    restoredCheckpoint = null,
  }) {
    const normalizedQuestion = String(question || '').trim();
    if (!normalizedQuestion) throw new Error('Research question is required');

    const runId = existingRunId || uuidv4();
    const resolvedSettings = resolveSettings(
      restoredCheckpoint?.settings || (settings && Object.keys(settings).length > 0 ? settings : {})
    );
    const resolvedSourcePolicy = mergeSourcePolicy(
      DEFAULT_SOURCE_POLICY,
      restoredCheckpoint?.sourcePolicy || sourcePolicy || {}
    );
    const resolvedProjectContext = mergeProjectContextValues(
      projectContext || {},
      restoredCheckpoint?.projectContext || {}
    );
    const compiledIntent = buildIntentAndAssumptions(
      normalizedQuestion,
      restoredCheckpoint?.intent || intent || normalizedQuestion,
      restoredCheckpoint?.jurisdiction || jurisdiction || 'auto'
    );

    const baseState = this.ensureRunState({
      id: runId,
      projectId,
      question: normalizedQuestion,
      intent: compiledIntent.intent,
      jurisdiction: compiledIntent.jurisdiction,
      workerCount: Math.max(1, Number(workerCount || this.defaultWorkerCount)),
      settings: resolvedSettings,
      sourcePolicy: resolvedSourcePolicy,
      projectContext: resolvedProjectContext,
      status: 'running',
      stats: buildStatsSkeleton(),
      lastActivityAt: Date.now(),
      runStartedAtMs: Number(restoredCheckpoint?.runStartedAtMs || Date.now()),
      createdAt: nowIso(),
      findings: restoredCheckpoint?.findings || [],
      sourcesRead: restoredCheckpoint?.sourcesRead || [],
      report: restoredCheckpoint?.report || null,
      progressSummaries: restoredCheckpoint?.progressSummaries || [],
      queues: restoredCheckpoint?.queues || { plan: [], search: [], read: [], analyze: [] },
      convergenceCount: Number(restoredCheckpoint?.convergenceCount || 0),
      queriesSeen: new Set(restoredCheckpoint?.queriesSeen || []),
      urlsSeen: new Set(restoredCheckpoint?.urlsSeen || []),
      taskKeys: new Set(restoredCheckpoint?.taskKeys || []),
      stepKeys: new Set(restoredCheckpoint?.stepKeys || []),
      activitySeq: Number(restoredCheckpoint?.activitySeq || 0),
      activityLog: Array.isArray(restoredCheckpoint?.activityLog) ? restoredCheckpoint.activityLog.slice(-400) : [],
      domainTally: restoredCheckpoint?.domainTally || {},
      intentProfile: restoredCheckpoint?.intentProfile || null,
      stageStatus: restoredCheckpoint?.stageStatus || buildStageStatus(),
      assumptions: restoredCheckpoint?.assumptions || compiledIntent.assumptions || [],
      policyViolations: restoredCheckpoint?.policyViolations || [],
      steeringEvents: restoredCheckpoint?.steeringEvents || [],
      persistedFindingKeys: Array.isArray(restoredCheckpoint?.persistedFindingKeys)
        ? new Set(restoredCheckpoint.persistedFindingKeys)
        : new Set(),
    });

    if (restoredCheckpoint?.stats) {
      baseState.stats = { ...buildStatsSkeleton(), ...restoredCheckpoint.stats };
    }
    this.addAssumptions(baseState, compiledIntent.assumptions || []);

    // Seed with plan task if fresh run
    if (!restoredCheckpoint) {
      this.enqueueTask(baseState, 'plan', { question: normalizedQuestion });
    } else {
      for (const phase of PHASES) {
        baseState.queues[phase] = (restoredCheckpoint.queues?.[phase] || []).map(normalizeTaskPayload);
      }
    }

    // Insert DB row for new runs
    if (!existingRunId) {
      this.run(
        `INSERT INTO research_runs (id, project_id, objective, worker_count, status, stats_json, prompt_snapshot_json, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [runId, projectId, normalizedQuestion, baseState.workerCount, 'running',
         safeStringify(baseState.stats), safeStringify({
           settings: resolvedSettings,
           sourcePolicy: resolvedSourcePolicy,
           projectContext: resolvedProjectContext,
           intent: baseState.intent || normalizedQuestion,
           jurisdiction: baseState.jurisdiction || 'auto',
           assumptions: baseState.assumptions || [],
           policyViolations: baseState.policyViolations || [],
           stageStatus: ensureStageStatusShape(baseState.stageStatus || {}),
           quality: buildRunQuality(baseState),
           qualityGate: buildQualityGate(baseState),
           relevanceScore: scoreRunRelevance(baseState.findings || []),
           jurisdictionMatch: scoreJurisdictionMatch(baseState),
          }), nowIso(), nowIso(), nowIso()]
      );
      this.saveDatabase();
    }

    this.runs.set(runId, baseState);
    this.startWorkers(baseState);
    this.setupMonitorLoop(baseState);
    this.persistCheckpoint(baseState);
    this.emitProgress(baseState, true);
    return this.buildRunSnapshot(baseState);
  }

  pauseRun(runId) {
    const state = this.runs.get(runId);
    if (!state) return null;
    state.status = 'paused';
    this.persistRunHeartbeat(state);
    this.persistCheckpoint(state);
    this.emitProgress(state, true);
    return this.buildRunSnapshot(state);
  }

  async cancelRun(runId) {
    const state = this.runs.get(runId);
    if (!state) return null;
    state.status = 'cancelled';
    this.run(
      `UPDATE research_runs SET status = ?, stats_json = ?, ended_at = ?, updated_at = ? WHERE id = ?`,
      ['cancelled', safeStringify(state.stats), nowIso(), nowIso(), runId]
    );
    this.persistCheckpoint(state);
    this.saveDatabase();
    this.emitProgress(state, true);
    return this.buildRunSnapshot(state);
  }

  async resumeRun({ runId, projectId, question, intent, jurisdiction, workerCount, settings, sourcePolicy, projectContext }) {
    const existing = this.runs.get(runId);
    if (existing) {
      existing.projectContext = mergeProjectContextValues(projectContext || {}, existing.projectContext || {});
      if (intent) existing.intent = String(intent || '').trim();
      if (jurisdiction) existing.jurisdiction = String(jurisdiction || '').trim();
      existing.status = 'running';
      this.persistRunHeartbeat(existing);
      this.emitProgress(existing, true);
      return this.buildRunSnapshot(existing);
    }

    const checkpointRow = this.queryOne(
      `SELECT queue_json, state_json FROM research_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      [runId]
    );
    if (!checkpointRow) {
      this.run(`UPDATE research_runs SET status = ?, updated_at = ? WHERE id = ?`, ['running', nowIso(), runId]);
      this.saveDatabase();
      return this.startRun({
        projectId,
        question: question || '',
        workerCount,
        settings: settings || {},
        sourcePolicy: sourcePolicy || {},
        projectContext: projectContext || {},
        existingRunId: runId,
        restoredCheckpoint: null,
      });
    }

    const queueJson = safeParseJson(checkpointRow?.queue_json, {});
    const stateJson = safeParseJson(checkpointRow?.state_json, {});

    const restoredCheckpoint = {
      queues: {
        plan: (queueJson?.plan || []).map(normalizeTaskPayload),
        search: (queueJson?.search || []).map(normalizeTaskPayload),
        read: (queueJson?.read || []).map(normalizeTaskPayload),
        analyze: (queueJson?.analyze || []).map(normalizeTaskPayload),
      },
      stats: stateJson?.stats || null,
      settings: stateJson?.settings || null,
      sourcePolicy: stateJson?.sourcePolicy || null,
      projectContext: stateJson?.projectContext || null,
      intent: stateJson?.intent || null,
      jurisdiction: stateJson?.jurisdiction || null,
      stageStatus: stateJson?.stageStatus || null,
      assumptions: stateJson?.assumptions || [],
      policyViolations: stateJson?.policyViolations || [],
      steeringEvents: stateJson?.steeringEvents || [],
      convergenceCount: Number(stateJson?.convergenceCount || 0),
      findings: stateJson?.findings || [],
      sourcesRead: stateJson?.sourcesRead || [],
      report: stateJson?.report || null,
      progressSummaries: stateJson?.progressSummaries || [],
      runStartedAtMs: Number(stateJson?.runStartedAtMs || Date.now()),
      queriesSeen: Array.isArray(stateJson?.queriesSeen) ? stateJson.queriesSeen : [],
      urlsSeen: Array.isArray(stateJson?.urlsSeen) ? stateJson.urlsSeen : [],
      taskKeys: Array.isArray(stateJson?.taskKeys) ? stateJson.taskKeys : [],
      stepKeys: Array.isArray(stateJson?.stepKeys) ? stateJson.stepKeys : [],
      activitySeq: Number(stateJson?.activitySeq || 0),
      activityLog: Array.isArray(stateJson?.activityLog) ? stateJson.activityLog : [],
      domainTally: stateJson?.domainTally || {},
      intentProfile: stateJson?.intentProfile || null,
      persistedFindingKeys: Array.isArray(stateJson?.persistedFindingKeys) ? stateJson.persistedFindingKeys : [],
    };

    this.run(`UPDATE research_runs SET status = ?, updated_at = ? WHERE id = ?`, ['running', nowIso(), runId]);
    this.saveDatabase();

    return this.startRun({
      projectId,
      question: question || stateJson?.question || '',
      intent: intent || stateJson?.intent || question || stateJson?.question || '',
      jurisdiction: jurisdiction || stateJson?.jurisdiction || 'auto',
      workerCount,
      settings: settings || stateJson?.settings || {},
      sourcePolicy: sourcePolicy || stateJson?.sourcePolicy || {},
      projectContext: projectContext || stateJson?.projectContext || {},
      existingRunId: runId,
      restoredCheckpoint,
    });
  }

  /* -- Run queries -------------------------------------------------- */

  getRun(runId) {
    const live = this.runs.get(runId);
    if (live) return this.buildRunSnapshot(live);
    const row = this.queryOne(`SELECT * FROM research_runs WHERE id = ?`, [runId]);
    if (!row) return null;
    const stats = safeParseJson(row.stats_json, buildStatsSkeleton());
    const snapshot = safeParseJson(row.prompt_snapshot_json, {});
    const settings = resolveSettings(snapshot?.settings || {});
    const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, snapshot?.sourcePolicy || {});
    const projectContext = normalizeProjectContext(snapshot?.projectContext || {});
    const startedAtMs = Date.parse(row.started_at || row.created_at || '') || Date.now();
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      question: row.objective,
      intent: snapshot?.intent || row.objective,
      jurisdiction: snapshot?.jurisdiction || 'auto',
      workerCount: Number(row.worker_count || this.defaultWorkerCount),
      convergenceCount: Number(row.convergence_count || 0),
      convergenceThreshold: settings.convergenceThreshold || 5,
      queueByPhase: { plan: 0, search: 0, read: 0, analyze: 0 },
      queueSize: 0,
      activeWorkers: 0,
      workers: [],
      stats,
      settings,
      sourcePolicy,
      contextMeta: buildProjectContextMeta(projectContext),
      quality: snapshot?.quality || null,
      qualityGate: snapshot?.qualityGate || null,
      relevanceScore: Number(snapshot?.relevanceScore || 0),
      jurisdictionMatch: snapshot?.jurisdictionMatch ?? null,
      assumptions: Array.isArray(snapshot?.assumptions) ? snapshot.assumptions : [],
      policyViolations: Array.isArray(snapshot?.policyViolations) ? snapshot.policyViolations : [],
      stageStatus: ensureStageStatusShape(snapshot?.stageStatus || {}),
      stageOrder: STAGE_IDS.map((stageId) => ensureStageStatusShape(snapshot?.stageStatus || {})[stageId]),
      stageId: null,
      goalProgress: this.getGoalProgress({ settings, runStartedAtMs: startedAtMs, stats, findings: [] }),
      recentActivity: [],
      recentFindings: [],
      domainStats: [],
      totalFindings: 0,
      totalSources: 0,
      report: snapshot?.report || null,
      progressSummaries: snapshot?.progressSummaries || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listRuns(projectId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
    const rows = projectId
      ? this.query(`SELECT * FROM research_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`, [projectId, safeLimit])
      : this.query(`SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?`, [safeLimit]);
    return rows.map((row) => {
      const live = this.runs.get(row.id);
      if (live) return this.buildRunSnapshot(live);
      const stats = safeParseJson(row.stats_json, buildStatsSkeleton());
      const snapshot = safeParseJson(row.prompt_snapshot_json, {});
      const settings = resolveSettings(snapshot?.settings || {});
      const sourcePolicy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, snapshot?.sourcePolicy || {});
      const projectContext = normalizeProjectContext(snapshot?.projectContext || {});
      return {
        id: row.id,
        projectId: row.project_id,
        status: row.status,
        question: row.objective,
        intent: snapshot?.intent || row.objective,
        jurisdiction: snapshot?.jurisdiction || 'auto',
        workerCount: Number(row.worker_count || this.defaultWorkerCount),
        convergenceCount: Number(row.convergence_count || 0),
        convergenceThreshold: settings.convergenceThreshold || 5,
        queueByPhase: { plan: 0, search: 0, read: 0, analyze: 0 },
        queueSize: 0,
        activeWorkers: 0,
        workers: [],
        stats,
        settings,
        sourcePolicy,
        contextMeta: buildProjectContextMeta(projectContext),
        quality: snapshot?.quality || null,
        qualityGate: snapshot?.qualityGate || null,
        relevanceScore: Number(snapshot?.relevanceScore || 0),
        jurisdictionMatch: snapshot?.jurisdictionMatch ?? null,
        assumptions: Array.isArray(snapshot?.assumptions) ? snapshot.assumptions : [],
        policyViolations: Array.isArray(snapshot?.policyViolations) ? snapshot.policyViolations : [],
        stageStatus: ensureStageStatusShape(snapshot?.stageStatus || {}),
        stageOrder: STAGE_IDS.map((stageId) => ensureStageStatusShape(snapshot?.stageStatus || {})[stageId]),
        stageId: null,
        goalProgress: { goals: {}, current: {} },
        recentActivity: [],
        recentFindings: [],
        domainStats: [],
        totalFindings: 0,
        totalSources: 0,
        report: snapshot?.report || null,
        progressSummaries: snapshot?.progressSummaries || [],
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
  DEPTH_PRESETS,
  resolveSettings,
  buildIntentProfile,
  isRelevantToIntent,
  tuneQueriesForIntent,
  buildCoreQuestionQuery,
  scoreFindingRelevance,
  buildRunQuality,
};
