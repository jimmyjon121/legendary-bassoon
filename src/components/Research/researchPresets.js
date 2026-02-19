/**
 * Research Presets
 *
 * General-purpose depth presets are the default.
 * Legacy schema presets are kept behind a `mode` flag for backward compatibility.
 */

/* ------------------------------------------------------------------ */
/*  Depth presets (default for general research mode)                   */
/* ------------------------------------------------------------------ */

export const RESEARCH_DEPTH_PRESETS = {
  quick: {
    key: 'quick',
    label: 'Quick',
    description: 'Fast overview - 5 min, ~10 sources.',
    icon: '⚡',
    settings: {
      depth: 'quick',
      maxQueries: 8,
      maxSourcesRead: 12,
      maxRuntimeMinutes: 5,
      maxFollowUpDepth: 1,
      convergenceThreshold: 3,
      topResultsPerQuery: 5,
    },
  },
  standard: {
    key: 'standard',
    label: 'Standard',
    description: 'Balanced research - 15 min, ~30 sources.',
    icon: '🔍',
    settings: {
      depth: 'standard',
      maxQueries: 20,
      maxSourcesRead: 30,
      maxRuntimeMinutes: 15,
      maxFollowUpDepth: 2,
      convergenceThreshold: 5,
      topResultsPerQuery: 8,
    },
  },
  deep: {
    key: 'deep',
    label: 'Deep',
    description: 'Exhaustive research - 45 min, ~80 sources.',
    icon: '🔬',
    settings: {
      depth: 'deep',
      maxQueries: 50,
      maxSourcesRead: 80,
      maxRuntimeMinutes: 45,
      maxFollowUpDepth: 4,
      convergenceThreshold: 8,
      topResultsPerQuery: 12,
    },
  },
};

export const DEFAULT_DEPTH = 'standard';

/* ------------------------------------------------------------------ */
/*  Schema field helper                                                */
/* ------------------------------------------------------------------ */

function field(key, label, type = 'text', required = false, description = '', extractionHints = '') {
  return { key, label, type, required, description, extraction_hints: extractionHints };
}

/* ------------------------------------------------------------------ */
/*  Legacy schema presets (hidden behind mode flag)                     */
/* ------------------------------------------------------------------ */

const STARTER_SCHEMA = [
  field('name', 'Name', 'text', true, 'Primary subject or entity name', 'Use exact name from primary source'),
  field('official_url', 'Primary Source URL', 'url', true, 'Canonical primary-source URL', 'Prefer official source pages'),
  field('summary', 'Summary', 'text', false, 'Short verified summary', '1-2 concise sentences'),
];

const ENTITY_PROFILE_SCHEMA = [
  field('name', 'Entity Name', 'text', true, 'Name of the person/company/org/topic unit', 'Exact name from source'),
  field('official_url', 'Primary Source URL', 'url', true, 'Canonical source URL', 'Use a stable source page'),
  field('category', 'Category', 'text', false, 'Type of entity', 'Company, agency, project, product, person, etc'),
  field('region', 'Region / Geography', 'text', false, 'Relevant location scope', 'Country, state, city, global'),
  field('status', 'Status', 'text', false, 'Current status from sources', 'Active, paused, archived, announced, etc'),
  field('key_facts', 'Key Facts', 'array', false, 'Important verified facts', 'Use concise bullets'),
  field('contact_or_reference', 'Contact / Reference', 'text', false, 'Contact point or reference identifier', 'Email, phone, issue tracker, docs root'),
  field('last_verified', 'Last Verified', 'date', false, 'Verification timestamp', 'ISO date if available'),
  field('notes', 'Notes', 'text', false, 'Important caveats or limitations', 'Include uncertainty when needed'),
];

const COMPARISON_SCHEMA = [
  field('candidate', 'Candidate', 'text', true, 'Item being compared', 'Name of option/source'),
  field('source_url', 'Source URL', 'url', true, 'Evidence URL', 'Direct source page'),
  field('pros', 'Pros', 'array', false, 'Strengths', 'Keep concrete and source-backed'),
  field('cons', 'Cons', 'array', false, 'Tradeoffs', 'Keep concrete and source-backed'),
  field('score', 'Score', 'number', false, 'Optional normalized score', '0-100 or chosen scale'),
  field('rationale', 'Rationale', 'text', false, 'Why this score/position', 'Short justification'),
];

const TIMELINE_SCHEMA = [
  field('event_date', 'Event Date', 'date', true, 'Date of event or milestone', 'ISO date when possible'),
  field('event_title', 'Event Title', 'text', true, 'Milestone headline', 'Short and specific'),
  field('source_url', 'Source URL', 'url', true, 'Primary source for event', 'Prefer first-party publication'),
  field('significance', 'Significance', 'text', false, 'Why event matters', 'Concise impact note'),
];

/**
 * Schema presets (for legacy/program_research mode only)
 */
export const RESEARCH_SCHEMA_PRESETS = {
  starter: { key: 'starter', label: 'Starter', description: 'Minimal fields for broad research runs.', schema: STARTER_SCHEMA },
  entity_profile: { key: 'entity_profile', label: 'Entity Profile', description: 'General-purpose profile schema.', schema: ENTITY_PROFILE_SCHEMA },
  comparison: { key: 'comparison', label: 'Comparison Matrix', description: 'Source-backed pros/cons and scoring.', schema: COMPARISON_SCHEMA },
  timeline: { key: 'timeline', label: 'Timeline', description: 'Chronological event capture.', schema: TIMELINE_SCHEMA },
};

export const RESEARCH_PERMANENT_INSTRUCTIONS = [
  'Prioritize primary and authoritative sources relevant to the topic.',
  'Treat project instructions as hard constraints.',
  'If a claim cannot be verified from a source, mark it as unknown instead of guessing.',
  'Surface uncertainty and conflicting evidence explicitly.',
].join('\n');

export const RESEARCH_TASK_PRESETS = [
  {
    id: 'exploratory_scan',
    label: 'Exploratory Scan',
    description: 'Broad discovery to map the topic landscape.',
    instructions: 'Find broad coverage across primary and high-authority sources.\nCapture key entities, themes, and unresolved gaps.',
  },
  {
    id: 'source_audit',
    label: 'Source Audit',
    description: 'Validate and stress-test claims from multiple sources.',
    instructions: 'Cross-check claims across independent sources.\nFlag conflicts, stale data, and weak attribution.',
  },
  {
    id: 'comparison_analysis',
    label: 'Comparison Analysis',
    description: 'Build a compare-and-contrast view across candidates.',
    instructions: 'Evaluate options on consistent criteria.\nSummarize pros/cons with source-backed rationale.',
  },
];

export const RESEARCH_DELIVERABLE_PRESETS = [
  {
    id: 'narrative_report',
    label: 'Narrative Report',
    description: 'Readable synthesis with citations and caveats.',
    instructions: 'Produce a concise narrative report for decision-making.\nInclude citation-ready source references for major claims.',
  },
];

export function cloneSchemaPreset(presetKey = 'starter') {
  const preset = RESEARCH_SCHEMA_PRESETS[presetKey] || RESEARCH_SCHEMA_PRESETS.starter;
  return preset.schema.map((item) => ({ ...item }));
}

export function buildRunInstructionBundle({
  taskType = 'exploratory_scan',
  deliverableType = 'narrative_report',
  customInstructions = '',
} = {}) {
  const taskPreset = RESEARCH_TASK_PRESETS.find((item) => item.id === taskType);
  const deliverablePreset = RESEARCH_DELIVERABLE_PRESETS.find((item) => item.id === deliverableType);
  const parts = [
    taskPreset ? `Task Focus:\n${taskPreset.instructions}` : '',
    deliverablePreset ? `Deliverable Requirements:\n${deliverablePreset.instructions}` : '',
    String(customInstructions || '').trim() ? `Run-Specific Notes:\n${customInstructions.trim()}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}
