function field(key, label, type = 'text', required = false, description = '', extractionHints = '') {
  return {
    key,
    label,
    type,
    required,
    description,
    extraction_hints: extractionHints,
  };
}

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

export const RESEARCH_SCHEMA_PRESETS = {
  starter: {
    key: 'starter',
    label: 'Starter',
    description: 'Minimal fields for broad deep-research runs.',
    schema: STARTER_SCHEMA,
  },
  entity_profile: {
    key: 'entity_profile',
    label: 'Entity Profile',
    description: 'General-purpose profile schema for people/orgs/products/topics.',
    schema: ENTITY_PROFILE_SCHEMA,
  },
  comparison: {
    key: 'comparison',
    label: 'Comparison Matrix',
    description: 'Source-backed pros/cons and scoring across options.',
    schema: COMPARISON_SCHEMA,
  },
  timeline: {
    key: 'timeline',
    label: 'Timeline',
    description: 'Chronological event capture with source traceability.',
    schema: TIMELINE_SCHEMA,
  },
};

export const RESEARCH_PERMANENT_INSTRUCTIONS = [
  'Prioritize primary and authoritative sources relevant to the topic.',
  'Treat project instructions as hard constraints.',
  'If a claim cannot be verified from a source, mark it as unknown instead of guessing.',
  'Keep extracted fields concise, normalized, and evidence-linked.',
  'Ask short clarifying questions only when they improve precision.',
  'Surface uncertainty and conflicting evidence explicitly.',
].join('\n');

export const RESEARCH_TASK_PRESETS = [
  {
    id: 'exploratory_scan',
    label: 'Exploratory Scan',
    description: 'Broad discovery to map the topic landscape.',
    instructions: [
      'Find broad coverage across primary and high-authority sources.',
      'Avoid low-quality aggregators when better sources exist.',
      'Capture key entities, themes, and unresolved gaps.',
    ].join('\n'),
  },
  {
    id: 'source_audit',
    label: 'Source Audit',
    description: 'Validate and stress-test claims from multiple sources.',
    instructions: [
      'Cross-check claims across independent sources.',
      'Flag conflicts, stale data, and weak attribution.',
      'Keep only claims with explicit evidence links.',
    ].join('\n'),
  },
  {
    id: 'structured_extraction',
    label: 'Structured Extraction',
    description: 'Populate schema fields with evidence-backed values.',
    instructions: [
      'Extract only fields supported by explicit source text.',
      'Leave missing fields blank/unknown, do not infer.',
      'Attach concise evidence for each populated required field.',
    ].join('\n'),
  },
  {
    id: 'comparison_analysis',
    label: 'Comparison Analysis',
    description: 'Build a compare-and-contrast view across candidates.',
    instructions: [
      'Evaluate options on consistent criteria.',
      'Summarize pros/cons with source-backed rationale.',
      'Highlight where data is missing or uncertain.',
    ].join('\n'),
  },
];

export const RESEARCH_DELIVERABLE_PRESETS = [
  {
    id: 'narrative_report',
    label: 'Narrative Report',
    description: 'Readable synthesis with citations and caveats.',
    instructions: [
      'Produce a concise narrative report for decision-making.',
      'Include citation-ready source references for major claims.',
      'Call out uncertainty and next research steps.',
    ].join('\n'),
  },
  {
    id: 'structured_table',
    label: 'Structured Table',
    description: 'Schema-aligned structured output for export/reuse.',
    instructions: [
      'Output normalized, schema-aligned fields.',
      'Keep values machine-friendly where possible.',
      'Preserve evidence traceability per row.',
    ].join('\n'),
  },
  {
    id: 'both',
    label: 'Both Deliverables',
    description: 'Generate both narrative and structured deliverables.',
    instructions: [
      'Produce both a narrative synthesis and structured records.',
      'Keep them consistent and source-aligned.',
      'Use the same evidence base for both outputs.',
    ].join('\n'),
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
    String(customInstructions || '').trim() ? `Run-Specific Notes:\n${String(customInstructions || '').trim()}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}
