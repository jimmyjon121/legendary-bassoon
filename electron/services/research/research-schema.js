/**
 * Research Schema
 *
 * Evidence-backed finding model with backward-compatible exports.
 */

const { normalizeUrl } = require('./research-source-policy');

const FINDING_CATEGORIES = ['fact', 'statistic', 'opinion', 'definition', 'comparison', 'example', 'recommendation'];

function createEvidence({
  id = '',
  quote = '',
  sourceUrl = '',
  sourceTitle = '',
  sourceDomain = '',
  capturedAt = null,
  supportsFindingIds = [],
  isOfficial = false,
} = {}) {
  return {
    id: String(id || '').trim(),
    quote: String(quote || '').trim(),
    sourceUrl: normalizeUrl(sourceUrl || ''),
    sourceTitle: String(sourceTitle || '').trim(),
    sourceDomain: String(sourceDomain || '').trim(),
    capturedAt: capturedAt || new Date().toISOString(),
    supportsFindingIds: Array.isArray(supportsFindingIds)
      ? supportsFindingIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    isOfficial: Boolean(isOfficial),
  };
}

function hasValidEvidence(evidence = []) {
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  return evidence.some((item) => {
    const quote = String(item?.quote || '').trim();
    const sourceUrl = normalizeUrl(item?.sourceUrl || item?.source_url || '');
    return quote.length > 0 && sourceUrl.length > 0;
  });
}

function createFinding({
  id,
  text,
  sourceUrl,
  sourceTitle,
  sourceDomain,
  category,
  addedAt,
  evidence = [],
  relevanceScore = 0,
} = {}) {
  const normalizedEvidence = Array.isArray(evidence)
    ? evidence.map((item) => createEvidence(item)).filter((item) => item.quote && item.sourceUrl)
    : [];

  return {
    id: String(id || '').trim(),
    text: String(text || '').trim(),
    sourceUrl: normalizeUrl(sourceUrl || ''),
    sourceTitle: String(sourceTitle || '').trim(),
    sourceDomain: String(sourceDomain || '').trim(),
    category: FINDING_CATEGORIES.includes(category) ? category : 'fact',
    addedAt: addedAt || new Date().toISOString(),
    relevanceScore: Number(relevanceScore || 0),
    evidence: normalizedEvidence,
  };
}

function validateFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  if (!String(finding.text || '').trim()) return false;
  if (!hasValidEvidence(finding.evidence)) return false;
  return true;
}

function dedupeFindings(findings = []) {
  const seen = new Set();
  const result = [];
  for (const finding of findings) {
    const key = String(finding.text || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

function groupFindingsByDomain(findings = []) {
  const map = new Map();
  for (const finding of findings) {
    const domain = finding.sourceDomain || 'unknown';
    const list = map.get(domain) || [];
    list.push(finding);
    map.set(domain, list);
  }
  return map;
}

function groupFindingsByCategory(findings = []) {
  const map = new Map();
  for (const finding of findings) {
    const category = finding.category || 'fact';
    const list = map.get(category) || [];
    list.push(finding);
    map.set(category, list);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  Legacy exports (backward compatibility)                           */
/* ------------------------------------------------------------------ */

const DEFAULT_STARTER_SCHEMA = [
  { key: 'name', label: 'Name', type: 'text', required: true, description: 'Entity name', extraction_hints: '' },
  { key: 'official_url', label: 'URL', type: 'url', required: true, description: 'Source URL', extraction_hints: '' },
  { key: 'summary', label: 'Summary', type: 'text', required: false, description: 'Short summary', extraction_hints: '' },
];

function normalizeSchema(input) {
  return Array.isArray(input) && input.length > 0
    ? input.map((field, index) => ({
      key: String(field.key || `field_${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: String(field.label || field.key || `Field ${index + 1}`),
      type: field.type || 'text',
      required: Boolean(field.required),
      description: String(field.description || ''),
      extraction_hints: String(field.extraction_hints || ''),
    }))
    : DEFAULT_STARTER_SCHEMA.map((field) => ({ ...field }));
}

function validateRecordAgainstSchema(record = {}, schema = DEFAULT_STARTER_SCHEMA) {
  const normalized = normalizeSchema(schema);
  const missingRequired = normalized
    .filter((field) => field.required && !String(record[field.key] || '').trim())
    .map((field) => field.key);
  return { valid: missingRequired.length === 0, missingRequired, normalizedRecord: { ...record } };
}

function extractRecordFromOfficialPage({ page = {}, schema: _schema = DEFAULT_STARTER_SCHEMA }) {
  const record = {};
  if (page.title) record.name = String(page.title).trim();
  if (page.url) record.official_url = normalizeUrl(page.url);
  if (page.content) record.summary = String(page.content).slice(0, 300).trim();

  const evidence = [];
  if (record.summary && record.official_url) {
    evidence.push(createEvidence({
      quote: record.summary,
      sourceUrl: record.official_url,
      sourceTitle: record.name || '',
      supportsFindingIds: [],
      isOfficial: true,
    }));
  }

  return {
    record,
    evidence,
    canonicalKey: record.name ? record.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : '',
  };
}

function buildCanonicalKey(record = {}) {
  const name = String(record.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return name || '';
}

function validateInstructionCompliance() {
  return { compliant: true, violations: [] };
}

module.exports = {
  FINDING_CATEGORIES,
  createEvidence,
  hasValidEvidence,
  createFinding,
  validateFinding,
  dedupeFindings,
  groupFindingsByDomain,
  groupFindingsByCategory,
  DEFAULT_STARTER_SCHEMA,
  normalizeSchema,
  validateRecordAgainstSchema,
  extractRecordFromOfficialPage,
  buildCanonicalKey,
  validateInstructionCompliance,
};
