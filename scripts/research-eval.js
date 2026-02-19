#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const {
  buildIntentProfile,
  isRelevantToIntent,
  tuneQueriesForIntent,
  buildCoreQuestionQuery,
  scoreFindingRelevance,
} = require('../electron/services/research/research-orchestrator');
const {
  classifySource,
  mergeSourcePolicy,
  DEFAULT_SOURCE_POLICY,
} = require('../electron/services/research/research-source-policy');

const NON_OFFICIAL_REFERENCE_DOMAINS = [
  'wikipedia.org',
  'wikidata.org',
  'wikivoyage.org',
  'britannica.com',
  'fandom.com',
];

function normalizeDomain(input = '') {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return String(url.hostname || '').replace(/^www\./, '').toLowerCase();
  } catch (_error) {
    return raw.replace(/^www\./, '');
  }
}

function isLikelyNonOfficialReferenceDomain(domain = '') {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return NON_OFFICIAL_REFERENCE_DOMAINS.some((item) => normalized === item || normalized.endsWith(`.${item}`));
}

function parseArgs(argv = []) {
  const args = { fixtures: path.join(__dirname, 'research-eval-fixtures.json'), threshold: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (token === '--fixtures') args.fixtures = path.resolve(process.cwd(), String(argv[i + 1] || '').trim());
    if (token === '--threshold') args.threshold = Number(argv[i + 1]);
    if (token === '--json') args.json = true;
  }
  return args;
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function evaluateCandidate(candidate = {}, policy = {}, intent = {}) {
  const sourceDecision = classifySource({ url: candidate.url || '' }, policy);
  if (sourceDecision.isRejected) {
    return { accepted: false, reason: sourceDecision.reason || 'rejected' };
  }
  if (intent.requiresOfficial && isLikelyNonOfficialReferenceDomain(sourceDecision.domain)) {
    return { accepted: false, reason: 'non_official_reference_domain' };
  }
  if (policy.allowedDomains?.length > 0 && !sourceDecision.isOfficial) {
    return { accepted: false, reason: 'allowlist_only' };
  }
  if (policy.requireOfficial && !sourceDecision.isOfficial && sourceDecision.tier === 'tertiary') {
    return { accepted: false, reason: 'official_required_tertiary' };
  }

  const preview = `${candidate.title || ''}\n${candidate.snippet || ''}\n${candidate.url || ''}`;
  const previewRelevant = isRelevantToIntent(preview, intent);
  const deferToReadStage = intent.requiresOfficial && sourceDecision.isOfficial;
  if (!previewRelevant && !deferToReadStage) {
    return { accepted: false, reason: 'intent_mismatch' };
  }
  return { accepted: true, reason: deferToReadStage && !previewRelevant ? 'accepted_deferred_relevance' : 'accepted' };
}

function mean(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const total = values.reduce((acc, value) => acc + Number(value || 0), 0);
  return total / values.length;
}

function pct(part, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return part / total;
}

function scoreCase(testCase = {}) {
  const policy = mergeSourcePolicy(DEFAULT_SOURCE_POLICY, testCase.sourcePolicy || {});
  const intent = buildIntentProfile(testCase.question || '', {}, policy);
  const baseQuery = buildCoreQuestionQuery(testCase.question || '', intent);
  const tunedQueries = tuneQueriesForIntent(testCase.seedQueries || [], intent, 20);

  const conciseQueries = tunedQueries.filter((query) => query.length <= 180 && query.length >= 4);
  const officialKeywordQueries = tunedQueries.filter((query) => /\bofficial\b|\bwebsite\b|\bdocs\b/.test(query.toLowerCase()));

  let candidateCorrect = 0;
  const candidateResults = (testCase.searchCandidates || []).map((candidate) => {
    const decision = evaluateCandidate(candidate, policy, intent);
    const expected = Boolean(candidate.expectAccepted);
    const correct = decision.accepted === expected;
    if (correct) candidateCorrect += 1;
    return {
      url: candidate.url || '',
      expected,
      accepted: decision.accepted,
      reason: decision.reason,
      correct,
    };
  });

  let relevanceCorrect = 0;
  const relevanceScores = (testCase.contentSamples || []).map((sample) => {
    const text = String(sample.text || '');
    const expected = Boolean(sample.expectRelevant);
    const relevant = isRelevantToIntent(text, intent);
    const score = scoreFindingRelevance(text, intent);
    const correct = relevant === expected;
    if (correct) relevanceCorrect += 1;
    return {
      expected,
      relevant,
      score,
      correct,
    };
  });

  const queryScore = (() => {
    const coverage = tunedQueries.length > 0 ? 1 : 0;
    const concise = tunedQueries.length > 0 ? pct(conciseQueries.length, tunedQueries.length) : 0;
    const officialBias = policy.requireOfficial && tunedQueries.length > 0
      ? pct(officialKeywordQueries.length, tunedQueries.length)
      : 1;
    return (coverage * 0.4) + (concise * 0.35) + (officialBias * 0.25);
  })();

  const candidateScore = candidateResults.length > 0 ? pct(candidateCorrect, candidateResults.length) : 1;
  const relevanceScore = relevanceScores.length > 0 ? pct(relevanceCorrect, relevanceScores.length) : 1;
  const avgFindingRelevance = relevanceScores.length > 0 ? mean(relevanceScores.map((item) => item.score)) : 1;

  const finalScore = (
    (queryScore * 0.25) +
    (candidateScore * 0.45) +
    (relevanceScore * 0.25) +
    (avgFindingRelevance * 0.05)
  ) * 100;

  return {
    id: testCase.id || 'unknown_case',
    question: testCase.question || '',
    baseQuery,
    tunedQueries,
    metrics: {
      queryScore: Number((queryScore * 100).toFixed(1)),
      candidateScore: Number((candidateScore * 100).toFixed(1)),
      relevanceScore: Number((relevanceScore * 100).toFixed(1)),
      avgFindingRelevance: Number((avgFindingRelevance * 100).toFixed(1)),
      score: Number(finalScore.toFixed(1)),
    },
    candidateResults,
    relevanceResults: relevanceScores,
  };
}

function printHuman(result = {}, threshold = 82) {
  const rows = result.cases.map((item) => ({
    id: item.id,
    score: item.metrics.score,
    query: item.metrics.queryScore,
    candidates: item.metrics.candidateScore,
    relevance: item.metrics.relevanceScore,
    pass: item.metrics.score >= threshold ? 'PASS' : 'FAIL',
  }));
  console.log('\nResearch Reliability Evaluation');
  console.log('================================');
  for (const row of rows) {
    console.log(
      `${row.pass.padEnd(4)} ${row.id.padEnd(28)} score=${String(row.score).padStart(5)} ` +
      `query=${String(row.query).padStart(5)} cand=${String(row.candidates).padStart(5)} rel=${String(row.relevance).padStart(5)}`
    );
  }
  console.log('--------------------------------');
  console.log(`Overall score: ${result.overallScore} (threshold ${threshold})`);
  console.log(`Result: ${result.passed ? 'PASS' : 'FAIL'}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = safeReadJson(args.fixtures);
  const cases = Array.isArray(fixtures.cases) ? fixtures.cases : [];
  const threshold = Number.isFinite(args.threshold)
    ? Number(args.threshold)
    : Number(fixtures.threshold || 82);
  if (cases.length === 0) {
    console.error('No eval cases found.');
    process.exit(1);
  }

  const caseResults = cases.map((testCase) => scoreCase(testCase));
  const overallScore = Number(mean(caseResults.map((item) => item.metrics.score)).toFixed(1));
  const passed = overallScore >= threshold;
  const payload = {
    fixtures: path.basename(args.fixtures),
    threshold,
    overallScore,
    passed,
    cases: caseResults,
    generatedAt: new Date().toISOString(),
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHuman(payload, threshold);
  }

  if (!passed) process.exit(1);
}

main();
