const { normalizeUrl } = require('./research-source-policy');

const VALID_TYPES = new Set(['text', 'url', 'number', 'boolean', 'date', 'array']);

const DEFAULT_STARTER_SCHEMA = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    required: true,
    description: 'Primary entity name',
    extraction_hints: 'Page title, h1 heading, program name',
  },
  {
    key: 'official_url',
    label: 'Official URL',
    type: 'url',
    required: true,
    description: 'Canonical official website URL',
    extraction_hints: 'Current official page URL',
  },
  {
    key: 'summary',
    label: 'Summary',
    type: 'text',
    required: false,
    description: 'Short official summary',
    extraction_hints: 'Use the first clear explanatory paragraph',
  },
];

function toKey(raw, index = 0) {
  const fallback = `field_${index + 1}`;
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return value || fallback;
}

function normalizeField(rawField = {}, index = 0) {
  const key = toKey(rawField.key || rawField.label, index);
  const type = VALID_TYPES.has(rawField.type) ? rawField.type : 'text';
  return {
    key,
    label: String(rawField.label || key).trim() || key,
    type,
    required: Boolean(rawField.required),
    description: String(rawField.description || '').trim(),
    extraction_hints: String(rawField.extraction_hints || '').trim(),
  };
}

function normalizeSchema(inputSchema) {
  const seed = Array.isArray(inputSchema) && inputSchema.length > 0
    ? inputSchema
    : DEFAULT_STARTER_SCHEMA;
  const normalized = [];
  const seen = new Set();
  for (let i = 0; i < seed.length; i += 1) {
    const field = normalizeField(seed[i], i);
    let key = field.key;
    if (seen.has(key)) {
      let suffix = 2;
      while (seen.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    seen.add(key);
    normalized.push({ ...field, key });
  }
  return normalized.length > 0 ? normalized : DEFAULT_STARTER_SCHEMA.map((item) => ({ ...item }));
}

function getRequiredFieldKeys(schemaInput) {
  return normalizeSchema(schemaInput)
    .filter((field) => field.required)
    .map((field) => field.key);
}

function cleanupText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatUsPhone(rawValue) {
  const digits = String(rawValue || '').replace(/\D+/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalized.length !== 10) return cleanupText(rawValue);
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function extractPhoneByKeyword(content = '', keywords = []) {
  const phoneRegex = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/;
  const lines = String(content || '')
    .split('\n')
    .map((line) => cleanupText(line))
    .filter(Boolean);
  const loweredKeywords = (Array.isArray(keywords) ? keywords : [])
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean);

  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (loweredKeywords.length > 0 && !loweredKeywords.some((keyword) => lowered.includes(keyword))) {
      continue;
    }
    const match = line.match(phoneRegex);
    if (match) return formatUsPhone(match[0]);
  }

  const fallback = String(content || '').match(phoneRegex);
  return fallback ? formatUsPhone(fallback[0]) : null;
}

function extractAddressParts(content = '') {
  const lines = String(content || '')
    .split('\n')
    .map((line) => cleanupText(line))
    .filter(Boolean);

  const inlinePattern = /^(\d{1,6}\s+[A-Za-z0-9.#'\-/ ]+),\s*([A-Za-z .'\-]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)$/;
  for (const line of lines) {
    const match = line.match(inlinePattern);
    if (!match) continue;
    return {
      address: cleanupText(match[1]),
      city: cleanupText(match[2]),
      state: cleanupText(match[3]).toUpperCase(),
      zip: cleanupText(match[4]).slice(0, 5),
    };
  }

  const cityStateZipPattern = /^([A-Za-z .'\-]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)$/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(cityStateZipPattern);
    if (!match) continue;
    const prev = i > 0 ? lines[i - 1] : '';
    const looksLikePhone = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(prev);
    const address = /^\d{1,6}\s+/.test(prev) && !looksLikePhone ? prev : '';
    return {
      address: cleanupText(address),
      city: cleanupText(match[1]),
      state: cleanupText(match[2]).toUpperCase(),
      zip: cleanupText(match[3]).slice(0, 5),
    };
  }

  const text = String(content || '');
  const looseInline = text.match(/(\d{1,6}\s+[A-Za-z0-9.#'\-/ ]+),\s*([A-Za-z .'\-]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)/);
  if (looseInline) {
    const address = cleanupText(looseInline[1]);
    if (address && !/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(address)) {
      return {
        address,
        city: cleanupText(looseInline[2]),
        state: cleanupText(looseInline[3]).toUpperCase(),
        zip: cleanupText(looseInline[4]).slice(0, 5),
      };
    }
  }

  return null;
}

function extractAgeRange(content = '') {
  const text = String(content || '');
  const patterns = [
    /ages?\s*(\d{1,2})\s*(?:-|to|through)\s*(\d{1,2})/i,
    /(\d{1,2})\s*(?:-|to|through)\s*(\d{1,2})\s*(?:years?|yrs?|yo)\b/i,
    /\b(\d{1,2})\s*(?:and|&)\s*up\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const min = Number(match[1]);
    const max = match[2] ? Number(match[2]) : Number(match[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min: Math.min(min, max), max: Math.max(min, max) };
    }
  }
  return null;
}

function detectLevelOfCare(content = '') {
  const text = String(content || '').toLowerCase();
  const mapping = [
    ['inpatient', 'Inpatient'],
    ['residential treatment', 'Residential'],
    ['rtc', 'RTC'],
    ['partial hospitalization', 'PHP'],
    ['php', 'PHP'],
    ['intensive outpatient', 'IOP'],
    ['iop', 'IOP'],
    ['virtual iop', 'Virtual IOP'],
    ['outpatient', 'Outpatient'],
    ['crisis stabilization', 'Crisis'],
    ['group home', 'Group Home'],
    ['transitional living', 'TLP'],
    ['therapeutic day school', 'TDS'],
    ['sober living', 'Sober Living'],
    ['wilderness', 'Wilderness'],
  ];
  const result = [];
  for (const [keyword, normalized] of mapping) {
    if (text.includes(keyword) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result.length > 0 ? result : null;
}

function detectFocus(content = '') {
  const text = String(content || '').toLowerCase();
  const mapping = [
    ['dual diagnosis', 'Dual Diagnosis'],
    ['substance', 'Substance Use'],
    ['eating disorder', 'Eating Disorders'],
    ['autism', 'ASD/Autism'],
    ['trauma', 'Trauma'],
    ['special education', 'Special Education'],
    ['behavioral', 'Behavioral Health'],
    ['mental health', 'Mental Health'],
  ];
  for (const [keyword, normalized] of mapping) {
    if (text.includes(keyword)) return normalized;
  }
  return null;
}

function extractInsuranceNames(content = '') {
  const text = String(content || '').toLowerCase();
  const mapping = [
    ['aetna', 'Aetna'],
    ['blue cross', 'BCBS'],
    ['bcbs', 'BCBS'],
    ['cigna', 'Cigna'],
    ['unitedhealthcare', 'UHC'],
    ['uhc', 'UHC'],
    ['medicaid', 'Medicaid'],
    ['medicare', 'Medicare'],
    ['tricare', 'TRICARE'],
  ];
  const result = [];
  for (const [keyword, normalized] of mapping) {
    if (text.includes(keyword) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result.length > 0 ? result : null;
}

function extractAccreditations(content = '') {
  const text = String(content || '').toLowerCase();
  const mapping = [
    ['joint commission', 'Joint Commission'],
    ['carf', 'CARF'],
    ['council on accreditation', 'COA'],
    ['coa', 'COA'],
    ['legitscript', 'LegitScript'],
    ['naatp', 'NAATP'],
    ['natsap', 'NATSAP'],
  ];
  const result = [];
  for (const [keyword, normalized] of mapping) {
    if (text.includes(keyword) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result.length > 0 ? result : null;
}

function detectTernaryFlag(content = '', positiveKeywords = [], negativeKeywords = []) {
  const text = String(content || '').toLowerCase();
  const negatives = (Array.isArray(negativeKeywords) ? negativeKeywords : [])
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean);
  if (negatives.some((item) => text.includes(item))) {
    return 'No';
  }
  const positives = (Array.isArray(positiveKeywords) ? positiveKeywords : [])
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean);
  if (positives.some((item) => text.includes(item))) {
    return 'Yes';
  }
  return 'Unknown';
}

function coerceValue(field, rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  const type = field?.type || 'text';
  const key = String(field?.key || '').toLowerCase();
  if (type === 'url') {
    const normalized = normalizeUrl(rawValue);
    return normalized || null;
  }
  if (type === 'number') {
    const parsed = Number(String(rawValue).replace(/[^0-9.\-]+/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    const lower = cleanupText(rawValue).toLowerCase();
    if (!lower) return null;
    if (['yes', 'true', '1', 'y'].includes(lower)) return true;
    if (['no', 'false', '0', 'n'].includes(lower)) return false;
    return null;
  }
  if (type === 'array') {
    if (Array.isArray(rawValue)) {
      const cleaned = rawValue.map((entry) => cleanupText(entry)).filter(Boolean);
      return cleaned.length > 0 ? cleaned : null;
    }
    const parts = cleanupText(rawValue)
      .split(/[,;|]\s*/)
      .map((entry) => cleanupText(entry))
      .filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  if (type === 'date') {
    const value = cleanupText(rawValue);
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  let text = cleanupText(rawValue);
  if (text && (key.includes('phone') || key.includes('fax'))) {
    text = formatUsPhone(text);
  }
  if (text && key === 'state') {
    const match = text.match(/\b([A-Za-z]{2})\b/);
    if (match) text = match[1].toUpperCase();
  }
  if (text && key === 'zip') {
    const match = text.match(/\b\d{5}(?:-\d{4})?\b/);
    if (match) text = match[0].slice(0, 5);
  }
  return text || null;
}

function validateRecordAgainstSchema(recordInput = {}, schemaInput = DEFAULT_STARTER_SCHEMA) {
  const schema = normalizeSchema(schemaInput);
  const normalizedRecord = {};
  const missingRequired = [];

  for (const field of schema) {
    const value = coerceValue(field, recordInput[field.key]);
    if (value !== null && value !== undefined && value !== '') {
      normalizedRecord[field.key] = value;
    } else if (field.required) {
      missingRequired.push(field.key);
    }
  }

  return {
    valid: missingRequired.length === 0,
    missingRequired,
    normalizedRecord,
  };
}

function summarizeText(content, maxLen = 320) {
  const clean = cleanupText(content);
  if (!clean) return null;
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

function cleanTitle(rawTitle = '', pageUrl = '') {
  const title = cleanupText(rawTitle);
  if (!title) return pageUrl;
  const split = title.split(/\s[-|:]\s|[-|:]/).map((part) => cleanupText(part)).filter(Boolean);
  if (split.length === 0) return title;
  const best = split.sort((a, b) => b.length - a.length)[0];
  return best || title;
}

function pickLineByKeyword(content = '', field = {}) {
  const lines = String(content || '')
    .split('\n')
    .map((line) => cleanupText(line))
    .filter(Boolean);
  if (lines.length === 0) return null;

  const tokens = [
    field.key,
    String(field.label || ''),
    String(field.description || ''),
    String(field.extraction_hints || ''),
  ]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
  const uniqueTokens = Array.from(new Set(tokens));
  if (uniqueTokens.length === 0) return lines[0];

  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (uniqueTokens.some((token) => lowered.includes(token))) {
      return line;
    }
  }
  return lines[0];
}

function findFieldValue(field, page = {}) {
  const content = String(page.content || '');
  const text = cleanupText(content);
  const key = String(field.key || '').toLowerCase();
  const addressParts = extractAddressParts(content);
  const ageRange = extractAgeRange(content);

  if (key === 'official_url') {
    return normalizeUrl(page.url || '') || null;
  }
  if (key === 'name') {
    return cleanTitle(page.title || '', page.url || '');
  }
  if (key === 'id') {
    const baseName = cleanTitle(page.title || '', page.url || '');
    if (!baseName) return null;
    return baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  if (key === 'summary') {
    return summarizeText(text, 360);
  }
  if (key === 'address') {
    return addressParts?.address || null;
  }
  if (key === 'city') {
    return addressParts?.city || null;
  }
  if (key === 'state') {
    return addressParts?.state || null;
  }
  if (key === 'zip') {
    return addressParts?.zip || null;
  }
  if (key === 'age_min') {
    return Number.isFinite(ageRange?.min) ? ageRange.min : null;
  }
  if (key === 'age_max') {
    return Number.isFinite(ageRange?.max) ? ageRange.max : null;
  }
  if (key === 'age_notes') {
    const match = text.match(/\b(?:ages?|age range)\s*[:\-]?\s*([^.]{4,80})/i);
    return match ? cleanupText(match[1]) : null;
  }
  if (key === 'level_of_care') {
    return detectLevelOfCare(content);
  }
  if (key === 'focus') {
    return detectFocus(content);
  }
  if (key === 'insurance') {
    return extractInsuranceNames(content);
  }
  if (key === 'accreditations') {
    return extractAccreditations(content);
  }
  if (key === 'lgbtq_affirming') {
    return detectTernaryFlag(
      content,
      ['lgbtq', 'lgbt', 'gender-affirming', 'gender affirming', 'sexual orientation', 'gender identity'],
      ['not lgbtq', 'does not serve lgbtq', 'no lgbtq']
    );
  }
  if (key === 'treats_asd') {
    return detectTernaryFlag(
      content,
      ['autism spectrum', 'asd', 'autism services', 'autism treatment'],
      ['does not treat autism', 'not autism', 'no autism']
    );
  }
  if (key === 'treats_sud') {
    return detectTernaryFlag(
      content,
      ['substance use', 'addiction', 'sud', 'chemical dependency'],
      ['does not treat substance', 'no substance use', 'not addiction treatment']
    );
  }
  if (key === 'trauma_specialized') {
    return detectTernaryFlag(
      content,
      ['trauma-informed', 'trauma focused', 'trauma-focused', 'ptsd'],
      ['not trauma', 'no trauma treatment']
    );
  }
  if (key === 'website') {
    return normalizeUrl(page.url || '') || null;
  }
  if (key.includes('email')) {
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? cleanupText(match[0]) : null;
  }
  if (key === 'admissions_phone') {
    return extractPhoneByKeyword(content, ['admissions', 'admission', 'intake', 'enroll']);
  }
  if (key === 'fax') {
    return extractPhoneByKeyword(content, ['fax']);
  }
  if (key.includes('phone') || key.includes('call')) {
    return extractPhoneByKeyword(content, ['phone', 'call', 'contact']);
  }
  if (key.includes('url') || key.includes('website')) {
    const match = text.match(/https?:\/\/[^\s)]+/i);
    const candidate = match ? match[0] : page.url;
    const normalized = normalizeUrl(candidate);
    return normalized || null;
  }
  if (field.type === 'array') {
    const line = pickLineByKeyword(content, field);
    if (!line) return null;
    const parts = line
      .split(/[,;|]\s*/)
      .map((entry) => cleanupText(entry))
      .filter(Boolean);
    return parts.length > 0 ? parts : null;
  }

  const line = pickLineByKeyword(content, field);
  return line ? summarizeText(line, 240) : null;
}

function buildCanonicalKey(record = {}, verifiedOfficialUrl = '') {
  const officialUrl = normalizeUrl(record.official_url || verifiedOfficialUrl || '');
  if (officialUrl) {
    try {
      const parsed = new URL(officialUrl);
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
    } catch (_error) {
      // Fall through to name-based key
    }
  }

  const name = cleanupText(record.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!name) return '';
  return `name_${name}`;
}

function extractFirstJsonObject(text = '') {
  const source = String(text || '').trim();
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : source;
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    // Continue to scanning extraction below.
  }

  let depth = 0;
  let start = -1;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        const slice = source.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (_error) {
          // Keep scanning.
        }
      }
    }
  }
  return null;
}

function buildExtractionPrompt({
  page = {},
  schema = DEFAULT_STARTER_SCHEMA,
  objective = '',
  runInstructions = '',
  topicProfile = null,
} = {}) {
  const schemaSummary = normalizeSchema(schema).map((field) => ({
    key: field.key,
    type: field.type,
    required: field.required,
    label: field.label,
    description: field.description,
    hints: field.extraction_hints,
  }));
  const payload = {
    objective: cleanupText(objective),
    runInstructions: cleanupText(runInstructions),
    topicProfile: topicProfile || null,
    page: {
      url: cleanupText(page.url || ''),
      title: cleanupText(page.title || ''),
      content: String(page.content || '').slice(0, 18000),
    },
    schema: schemaSummary,
  };

  return [
    'You extract structured data from one official website page.',
    'Return STRICT JSON only, no markdown.',
    'Use only explicit statements from page content. Do not infer or guess.',
    'JSON shape:',
    '{',
    '  "record": { "<field_key>": <value>, ... },',
    '  "evidence": [',
    '    { "field_key": "<field_key>", "claim_text": "<concise value>", "excerpt_text": "<verbatim excerpt from page (<=220 chars)>" }',
    '  ]',
    '}',
    'Rules:',
    '- Omit unknown fields instead of inventing values.',
    '- Keep values concise and schema-compatible.',
    '- For arrays, output arrays.',
    '- Ensure every populated required field has at least one evidence row.',
    '',
    'INPUT JSON:',
    JSON.stringify(payload),
  ].join('\n');
}

function normalizeEvidenceItem(raw = {}, fieldKey = '', page = {}) {
  const key = cleanupText(raw.field_key || fieldKey);
  if (!key) return null;
  const claimText = cleanupText(raw.claim_text || raw.value || '');
  if (!claimText) return null;
  const sourceUrl = normalizeUrl(raw.source_url || page.url || '') || '';
  let sourceDomain = cleanupText(raw.source_domain || '');
  if (!sourceDomain && sourceUrl) {
    try {
      sourceDomain = new URL(sourceUrl).hostname.toLowerCase();
    } catch (_error) {
      sourceDomain = '';
    }
  }
  return {
    field_key: key,
    claim_text: claimText,
    excerpt_text: summarizeText(raw.excerpt_text || page.content || '', 240) || '',
    source_url: sourceUrl,
    source_title: cleanupText(raw.source_title || page.title || ''),
    source_domain: sourceDomain,
    is_official: raw.is_official !== false,
    fetched_at: new Date().toISOString(),
  };
}

function mergeEvidenceRows(existing = [], incoming = []) {
  const seen = new Set();
  const output = [];
  const pushUnique = (row) => {
    const normalized = row || null;
    if (!normalized) return;
    const key = [
      cleanupText(normalized.field_key).toLowerCase(),
      cleanupText(normalized.claim_text).toLowerCase(),
      cleanupText(normalized.source_url).toLowerCase(),
    ].join('|');
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  };
  for (const row of existing) pushUnique(row);
  for (const row of incoming) pushUnique(row);
  return output;
}

function extractRecordFromOfficialPageHeuristic({ page = {}, schema: schemaInput = DEFAULT_STARTER_SCHEMA }) {
  const schema = normalizeSchema(schemaInput);
  const record = {};
  const evidence = [];

  for (const field of schema) {
    const rawValue = findFieldValue(field, page);
    const value = coerceValue(field, rawValue);
    if (value === null || value === undefined || value === '') continue;
    record[field.key] = value;
    evidence.push({
      field_key: field.key,
      claim_text: Array.isArray(value) ? value.join(', ') : String(value),
      excerpt_text: summarizeText(String(page.content || ''), 240) || '',
      source_url: normalizeUrl(page.url || '') || '',
      source_title: cleanupText(page.title || ''),
      source_domain: (() => {
        try {
          return new URL(normalizeUrl(page.url || '')).hostname.toLowerCase();
        } catch (_error) {
          return '';
        }
      })(),
      is_official: true,
      fetched_at: new Date().toISOString(),
    });
  }

  return {
    record,
    evidence,
    canonicalKey: buildCanonicalKey(record, page.url || ''),
  };
}

async function runModelExtraction({
  page = {},
  schema = DEFAULT_STARTER_SCHEMA,
  objective = '',
  runInstructions = '',
  topicProfile = null,
  extractionGenerator = null,
} = {}) {
  if (typeof extractionGenerator !== 'function') return null;
  const prompt = buildExtractionPrompt({ page, schema, objective, runInstructions, topicProfile });
  const response = await extractionGenerator({
    prompt,
    page,
    schema: normalizeSchema(schema),
    objective,
    runInstructions,
    topicProfile,
  });

  if (!response) return null;
  if (response && typeof response === 'object' && response.record && typeof response.record === 'object') {
    return {
      record: response.record,
      evidence: Array.isArray(response.evidence) ? response.evidence : [],
      model: cleanupText(response.model || ''),
    };
  }

  const text = typeof response === 'string'
    ? response
    : cleanupText(response.text || response.content || response.response || response.message?.content || '');
  const parsed = extractFirstJsonObject(text);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    record: parsed.record && typeof parsed.record === 'object' ? parsed.record : {},
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    model: cleanupText(response?.model || ''),
  };
}

async function extractRecordFromOfficialPage({
  page = {},
  schema: schemaInput = DEFAULT_STARTER_SCHEMA,
  extractionGenerator = null,
  objective = '',
  runInstructions = '',
  topicProfile = null,
}) {
  const schema = normalizeSchema(schemaInput);
  const heuristic = extractRecordFromOfficialPageHeuristic({ page, schema });
  const mergedRecord = { ...(heuristic.record || {}) };
  let mergedEvidence = Array.isArray(heuristic.evidence) ? [...heuristic.evidence] : [];
  let extractionMode = 'heuristic';
  let extractionModel = '';

  try {
    const modelExtraction = await runModelExtraction({
      page,
      schema,
      objective,
      runInstructions,
      topicProfile,
      extractionGenerator,
    });
    if (modelExtraction && typeof modelExtraction.record === 'object') {
      extractionMode = 'hybrid';
      extractionModel = cleanupText(modelExtraction.model || '');
      const evidenceByField = new Map();
      const normalizedModelEvidence = [];

      for (const rawEvidence of Array.isArray(modelExtraction.evidence) ? modelExtraction.evidence : []) {
        const normalized = normalizeEvidenceItem(rawEvidence, rawEvidence?.field_key, page);
        if (!normalized) continue;
        normalizedModelEvidence.push(normalized);
        const key = cleanupText(normalized.field_key);
        const list = evidenceByField.get(key) || [];
        list.push(normalized);
        evidenceByField.set(key, list);
      }

      for (const field of schema) {
        const rawValue = modelExtraction.record[field.key];
        const value = coerceValue(field, rawValue);
        if (value === null || value === undefined || value === '') continue;
        mergedRecord[field.key] = value;
        if (!evidenceByField.has(field.key)) {
          const fallbackEvidence = normalizeEvidenceItem(
            {
              field_key: field.key,
              claim_text: Array.isArray(value) ? value.join(', ') : String(value),
              excerpt_text: summarizeText(String(page.content || ''), 220) || '',
            },
            field.key,
            page
          );
          if (fallbackEvidence) normalizedModelEvidence.push(fallbackEvidence);
        }
      }

      mergedEvidence = mergeEvidenceRows(mergedEvidence, normalizedModelEvidence);
    }
  } catch (_error) {
    // Keep heuristic extraction when model extraction fails.
  }

  if (!mergedRecord.official_url) {
    mergedRecord.official_url = normalizeUrl(page.url || '') || '';
  }

  for (const field of schema) {
    const value = mergedRecord[field.key];
    if (value === null || value === undefined || value === '') continue;
    const hasEvidence = mergedEvidence.some((item) => String(item?.field_key || '').trim() === field.key);
    if (hasEvidence) continue;
    const fallback = normalizeEvidenceItem(
      {
        field_key: field.key,
        claim_text: Array.isArray(value) ? value.join(', ') : String(value),
        excerpt_text: summarizeText(String(page.content || ''), 220) || '',
      },
      field.key,
      page
    );
    if (fallback) mergedEvidence.push(fallback);
  }

  return {
    record: mergedRecord,
    evidence: mergedEvidence,
    canonicalKey: buildCanonicalKey(mergedRecord, page.url || ''),
    extractionMode,
    extractionModel,
  };
}

function validateInstructionCompliance({ record = {}, evidence = [], schema: schemaInput = DEFAULT_STARTER_SCHEMA }) {
  const schema = normalizeSchema(schemaInput);
  const disallowed = new Set(['unknown', 'n/a', 'na', 'not available', 'tbd', 'none']);
  const violations = [];

  for (const field of schema) {
    const value = record[field.key];
    if (value === null || value === undefined || value === '') continue;
    const asText = String(Array.isArray(value) ? value.join(' ') : value).trim().toLowerCase();
    if (disallowed.has(asText)) {
      violations.push(`field_${field.key}_placeholder_value`);
    }
  }

  const evidenceByField = new Map();
  for (const item of evidence) {
    const list = evidenceByField.get(item.field_key) || [];
    list.push(item);
    evidenceByField.set(item.field_key, list);
  }

  for (const field of schema) {
    if (!field.required) continue;
    const claims = evidenceByField.get(field.key) || [];
    const hasOfficial = claims.some((item) => item.is_official === true && String(item.claim_text || '').trim().length > 0);
    if (!hasOfficial) {
      violations.push(`field_${field.key}_missing_official_evidence`);
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}

module.exports = {
  DEFAULT_STARTER_SCHEMA,
  normalizeSchema,
  getRequiredFieldKeys,
  validateRecordAgainstSchema,
  extractRecordFromOfficialPage,
  buildCanonicalKey,
  validateInstructionCompliance,
};

