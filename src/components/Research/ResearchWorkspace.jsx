import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Beaker,
  Bot,
  CheckCircle2,
  FileText,
  Link2,
  Loader2,
  MapPinned,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import api from '../../utils/electronAPI';
import {
  cloneSchemaPreset,
  RESEARCH_PERMANENT_INSTRUCTIONS,
  RESEARCH_SCHEMA_PRESETS,
} from './researchPresets';
import './ResearchWorkspace.css';

const FIELD_TYPES = ['text', 'url', 'number', 'boolean', 'date', 'array'];

const DEFAULT_SOURCE_POLICY = {
  mode: 'discover_broad_verify_official',
  requireOfficial: true,
  rejectDirectoryPages: true,
  rejectSocialProfiles: true,
  officialDomains: [],
};

const DEFAULT_SCHEMA_PRESET_KEY = 'entity_profile';
const DEFAULT_SCHEMA = cloneSchemaPreset(DEFAULT_SCHEMA_PRESET_KEY);
const DEFAULT_DEPTH_PRESET = 'deep';
const CHAT_STYLE_MODE = true;
const DEFAULT_SCOPE_STATE = {
  geography: '',
  timeframe: '',
  entities: '',
  constraints: '',
  notes: '',
};

const US_STATE_ALIASES = [
  ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'], ['California', 'CA'],
  ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'], ['Florida', 'FL'], ['Georgia', 'GA'],
  ['Hawaii', 'HI'], ['Idaho', 'ID'], ['Illinois', 'IL'], ['Indiana', 'IN'], ['Iowa', 'IA'],
  ['Kansas', 'KS'], ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'],
  ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'], ['Mississippi', 'MS'], ['Missouri', 'MO'],
  ['Montana', 'MT'], ['Nebraska', 'NE'], ['Nevada', 'NV'], ['New Hampshire', 'NH'], ['New Jersey', 'NJ'],
  ['New Mexico', 'NM'], ['New York', 'NY'], ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'],
  ['Oklahoma', 'OK'], ['Oregon', 'OR'], ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'], ['South Carolina', 'SC'],
  ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'], ['Vermont', 'VT'],
  ['Virginia', 'VA'], ['Washington', 'WA'], ['West Virginia', 'WV'], ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
  ['District of Columbia', 'DC'],
];

function mergeScopeDraft(base = {}, hints = {}) {
  const next = { ...base };
  for (const key of ['geography', 'timeframe', 'entities', 'constraints']) {
    const value = String(hints?.[key] || '').trim();
    if (value) next[key] = value;
  }
  const notes = String(hints?.notes || '').trim();
  if (notes) {
    next.notes = next.notes ? `${next.notes}; ${notes}` : notes;
  }
  return next;
}

function inferScopeFromText(input = '') {
  const raw = String(input || '');
  const lower = raw.toLowerCase();
  const upperCodes = new Set((raw.match(/\b[A-Z]{2}\b/g) || []).map((item) => item.toUpperCase()));
  const scope = {};

  for (const [stateName, code] of US_STATE_ALIASES) {
    if (lower.includes(stateName.toLowerCase()) || upperCodes.has(code)) {
      scope.geography = stateName;
      break;
    }
  }

  const timeframeMatch = raw.match(/\b(19|20)\d{2}\b(?:\s*(?:-|to|through)\s*\b(19|20)\d{2}\b)?/i);
  if (timeframeMatch) {
    scope.timeframe = String(timeframeMatch[0] || '').trim();
  } else if (/\b(last|past|previous)\s+\d+\s+(day|days|week|weeks|month|months|year|years)\b/i.test(raw)) {
    const match = raw.match(/\b(last|past|previous)\s+\d+\s+(day|days|week|weeks|month|months|year|years)\b/i);
    scope.timeframe = String(match?.[0] || '').trim();
  }

  const entityMatch = raw.match(/\b(companies|organizations|people|papers|tools|products|programs|agencies)\b/i);
  if (entityMatch) {
    scope.entities = String(entityMatch[0] || '').trim();
  }

  const constraintSignals = [];
  if (/\bofficial\b|\bprimary source\b|\bfirst[- ]party\b/.test(lower)) constraintSignals.push('official sources only');
  if (/\bexclude\b|\bwithout\b|\bavoid\b/.test(lower)) constraintSignals.push('apply exclusion constraints');
  if (constraintSignals.length > 0) {
    scope.constraints = constraintSignals.join('; ');
  }

  return scope;
}

function buildRequiredClarifier(scope = {}) {
  return '';
}

function buildOptionalClarifier(scope = {}) {
  if (!String(scope.geography || '').trim()) {
    return 'Any geography to prioritize first, or should I search globally?';
  }
  if (!String(scope.timeframe || '').trim()) {
    return 'Any timeframe constraints, or should I include the full available timeline?';
  }
  return '';
}

function emptyProjectDraft() {
  return {
    name: '',
    description: '',
    permanent_instructions: RESEARCH_PERMANENT_INSTRUCTIONS,
    source_policy: { ...DEFAULT_SOURCE_POLICY },
  };
}

function cloneSchema(schema = DEFAULT_SCHEMA) {
  return schema.map((field) => ({ ...field }));
}

function sanitizeKey(input = '', index = 0) {
  const value = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return value || `field_${index + 1}`;
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) return 'just now';
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return 'just now';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function buildGuidedObjective({
  geography = '',
  timeframe = '',
  entities = '',
  constraints = '',
  notes = '',
} = {}) {
  const location = String(geography || '').trim();
  const time = String(timeframe || '').trim();
  const entityTypes = String(entities || '').trim();
  const hardConstraints = String(constraints || '').trim();
  const extra = String(notes || '').trim();
  if (!location && !time && !entityTypes && !hardConstraints && !extra) return '';
  const parts = [
    'Run deep research on this topic with broad source discovery and verification.',
    'Use primary and authoritative sources where possible.',
    'Collect evidence-backed findings and keep output ready for structured export.',
  ];
  if (location) parts.push(`Geography: ${location}.`);
  if (time) parts.push(`Timeframe: ${time}.`);
  if (entityTypes) parts.push(`Entity focus: ${entityTypes}.`);
  if (hardConstraints) parts.push(`Constraints: ${hardConstraints}.`);
  if (extra) parts.push(`Additional scope: ${extra}.`);
  return parts.join(' ');
}

function buildGuidedRunNotes({
  geography = '',
  timeframe = '',
  entities = '',
  constraints = '',
  notes = '',
} = {}) {
  const location = String(geography || '').trim();
  const time = String(timeframe || '').trim();
  const entityTypes = String(entities || '').trim();
  const hardConstraints = String(constraints || '').trim();
  const extra = String(notes || '').trim();
  const lines = [
    'Conversational research mode:',
    '- Follow project instructions and run criteria as hard constraints.',
    '- If scope is ambiguous, ask short clarification questions before broad discovery.',
    '- Prioritize primary/authoritative sources and maintain source traceability.',
    '- If required data cannot be verified, mark it as unknown instead of guessing.',
    '- Keep output export-ready for Markdown handoff.',
  ];
  if (location) lines.push(`- Geography: ${location}`);
  if (time) lines.push(`- Timeframe: ${time}`);
  if (entityTypes) lines.push(`- Entity focus: ${entityTypes}`);
  if (hardConstraints) lines.push(`- Constraints: ${hardConstraints}`);
  if (extra) lines.push(`- Additional notes: ${extra}`);
  return lines.join('\n');
}

function buildScopeSummary({
  geography = '',
  timeframe = '',
  entities = '',
  constraints = '',
} = {}) {
  const location = String(geography || '').trim();
  const time = String(timeframe || '').trim();
  const entityTypes = String(entities || '').trim();
  const hardConstraints = String(constraints || '').trim();
  const tokens = [];
  if (location) tokens.push(location);
  if (time) tokens.push(`timeframe: ${time}`);
  if (entityTypes) tokens.push(`entities: ${entityTypes}`);
  if (hardConstraints) tokens.push(`constraints: ${hardConstraints}`);
  return tokens.join(' | ');
}

function statusBadgeClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'running') return 'border-sky-400/30 bg-sky-500/15 text-sky-300';
  if (normalized === 'completed') return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300';
  if (normalized === 'paused') return 'border-amber-400/30 bg-amber-500/15 text-amber-300';
  if (normalized === 'cancelled' || normalized === 'error') return 'border-rose-400/30 bg-rose-500/15 text-rose-300';
  return 'border-forge-border bg-forge-hover text-text-secondary';
}

function activityStatusLabel(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return 'Update';
  if (normalized === 'started') return 'Started';
  if (normalized === 'completed') return 'Done';
  if (normalized === 'blocked') return 'Blocked';
  if (normalized === 'failed') return 'Failed';
  if (normalized === 'skipped') return 'Skipped';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function activityToneClass(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  if (normalized === 'started') return 'border-sky-400/25 bg-sky-500/10 text-sky-200';
  if (normalized === 'blocked') return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
  if (normalized === 'failed') return 'border-rose-400/25 bg-rose-500/10 text-rose-200';
  if (normalized === 'skipped') return 'border-forge-border bg-forge-hover text-text-secondary';
  return 'border-forge-border bg-forge-hover text-text-secondary';
}

function activityStatusPillClass(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200';
  if (normalized === 'started') return 'border-sky-400/30 bg-sky-500/15 text-sky-200';
  if (normalized === 'blocked') return 'border-amber-400/30 bg-amber-500/15 text-amber-200';
  if (normalized === 'failed') return 'border-rose-400/30 bg-rose-500/15 text-rose-200';
  if (normalized === 'skipped') return 'border-forge-border bg-forge-hover text-text-secondary';
  return 'border-forge-border bg-forge-hover text-text-secondary';
}

function compactQueryPreview(query = '', maxLength = 120) {
  const text = String(query || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function buildResearchPlan({ objective = '', runInstructions = '' } = {}) {
  const merged = `${String(objective || '')} ${String(runInstructions || '')}`.toLowerCase();
  const steps = [];
  const locationMatch = String(objective || '').match(/\b(in|across|within|near)\s+([A-Za-z][A-Za-z\s-]{2,40})/i);
  const locationHint = locationMatch?.[2] ? ` in ${locationMatch[2].trim()}` : '';

  steps.push(`Discover relevant sources${locationHint} with broad multi-query coverage.`);
  steps.push('Verify critical claims against primary/authoritative sources before persistence.');
  steps.push('Extract structured fields with schema validation and evidence traces.');

  if (/\bmd\b|\bmarkdown\b|\bcursor\b/.test(merged)) {
    steps.push('Prepare export-ready Markdown output package for Cursor handoff.');
  } else {
    steps.push('Maintain evidence traceability for every persisted record field.');
  }

  return steps;
}

function clampWorkers(value) {
  const count = Number(value || 4);
  if (!Number.isFinite(count)) return 4;
  return Math.max(1, Math.min(12, Math.floor(count)));
}

function inferPresetKeyFromSchema(schema = []) {
  const keys = new Set((Array.isArray(schema) ? schema : []).map((field) => String(field?.key || '').trim()));
  if (keys.has('candidate') && keys.has('pros') && keys.has('cons')) return 'comparison';
  if (keys.has('event_date') && keys.has('event_title')) return 'timeline';
  if (keys.has('category') && keys.has('key_facts')) return 'entity_profile';
  return 'starter';
}

const RESEARCH_GUARDRAIL_MARKER = 'Prioritize primary and authoritative sources relevant to the topic.';

export function ResearchWorkspace({ workspace = 'research' }) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectDraft, setProjectDraft] = useState(emptyProjectDraft());
  const [schemaDraft, setSchemaDraft] = useState(cloneSchema(DEFAULT_SCHEMA));
  const [runDraft, setRunDraft] = useState({
    objective: '',
    runInstructions: '',
    workerCount: 4,
    depthPreset: DEFAULT_DEPTH_PRESET,
    strictTopicMatching: true,
  });
  const [guidedDraft, setGuidedDraft] = useState(() => ({ ...DEFAULT_SCOPE_STATE }));
  const [planningInput, setPlanningInput] = useState('');
  const [planningMessages, setPlanningMessages] = useState(() => ([
    {
      id: `planner_${Date.now()}`,
      role: 'assistant',
      content: 'Tell me what you need in plain language. I will ask follow-ups only when required.',
    },
  ]));
  const [runs, setRuns] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [recordDetails, setRecordDetails] = useState(null);
  const [conversationLinks, setConversationLinks] = useState({ linked: [], available: [] });
  const [documentLinks, setDocumentLinks] = useState({ linked: [], available: [] });
  const [recordScope, setRecordScope] = useState('run');
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('setup');
  const [selectedSchemaPreset, setSelectedSchemaPreset] = useState(DEFAULT_SCHEMA_PRESET_KEY);
  const [showSchemaAdvanced, setShowSchemaAdvanced] = useState(false);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [showComposerDetails, setShowComposerDetails] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [runSteeringInput, setRunSteeringInput] = useState('');
  const [isSteeringRun, setIsSteeringRun] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [notice, setNotice] = useState('');

  const selectedProjectIdRef = useRef(selectedProjectId);
  const selectedRunIdRef = useRef(selectedRunId);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const criteriaScopeHints = useMemo(
    () => inferScopeFromText(projectDraft.permanent_instructions || ''),
    [projectDraft.permanent_instructions]
  );

  const resolvedScopeDraft = useMemo(() => {
    const withCriteria = mergeScopeDraft({ ...DEFAULT_SCOPE_STATE }, criteriaScopeHints);
    return mergeScopeDraft(withCriteria, guidedDraft);
  }, [criteriaScopeHints, guidedDraft]);

  const dynamicColumns = useMemo(() => {
    const schema = selectedProject?.schema || schemaDraft;
    return (Array.isArray(schema) ? schema : []).map((field) => field.key);
  }, [selectedProject, schemaDraft]);

  const activeRun = useMemo(() => {
    if (!Array.isArray(runs) || runs.length === 0) return null;
    if (selectedRunId) {
      return runs.find((item) => item.id === selectedRunId) || null;
    }
    return runs.find((item) => item.status === 'running') || runs[0];
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (activeRun) {
      setShowComposerDetails(false);
    }
  }, [activeRun?.id]);

  const refreshProjects = useCallback(async (preferredProjectId = null) => {
    const list = await api.research.listProjects(workspace);
    const normalized = Array.isArray(list) ? list : [];
    setProjects(normalized);
    setSelectedProjectId((current) => {
      const candidate = preferredProjectId || current;
      if (candidate && normalized.some((item) => item.id === candidate)) return candidate;
      return normalized[0]?.id || null;
    });
  }, [workspace]);

  const refreshRuns = useCallback(async (projectId = selectedProjectIdRef.current) => {
    if (!projectId) {
      setRuns([]);
      setSelectedRunId(null);
      return;
    }
    const list = await api.research.listRuns(projectId, 200);
    const normalized = Array.isArray(list) ? list : [];
    setRuns(normalized);
    setSelectedRunId((current) => {
      if (current && normalized.some((item) => item.id === current)) return current;
      const running = normalized.find((item) => item.status === 'running');
      return running?.id || normalized[0]?.id || null;
    });
  }, []);

  const refreshRecords = useCallback(async ({
    projectId = selectedProjectIdRef.current,
    runId = selectedRunIdRef.current,
    scope = recordScope,
  } = {}) => {
    if (!projectId) {
      setRecords([]);
      return;
    }
    const effectiveRunId = scope === 'run' ? runId : null;
    const list = await api.research.listRecords(projectId, effectiveRunId, 2000);
    setRecords(Array.isArray(list) ? list : []);
  }, [recordScope]);

  const refreshProjectLinks = useCallback(async (projectId = selectedProjectIdRef.current) => {
    if (!projectId) {
      setConversationLinks({ linked: [], available: [] });
      setDocumentLinks({ linked: [], available: [] });
      return;
    }
    const [conversations, documents] = await Promise.all([
      api.research.listConversations(projectId),
      api.research.listDocuments(projectId),
    ]);
    setConversationLinks(conversations || { linked: [], available: [] });
    setDocumentLinks(documents || { linked: [], available: [] });
  }, []);

  const loadProject = useCallback(async (projectId) => {
    if (!projectId) return;
    const item = await api.research.getProject(projectId);
    if (!item) return;
    const resolvedSchema = cloneSchema(Array.isArray(item.schema) && item.schema.length > 0 ? item.schema : DEFAULT_SCHEMA);
    setProjectDraft({
      name: item.name || '',
      description: item.description || '',
      permanent_instructions: item.permanent_instructions || '',
      source_policy: item.source_policy || { ...DEFAULT_SOURCE_POLICY },
    });
    setSchemaDraft(resolvedSchema);
    setSelectedSchemaPreset(inferPresetKeyFromSchema(resolvedSchema));
    await Promise.all([
      refreshRuns(projectId),
      refreshProjectLinks(projectId),
    ]);
  }, [refreshProjectLinks, refreshRuns]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setRuns([]);
      setRecords([]);
      setSelectedRunId(null);
      setSelectedRecordId(null);
      setRecordDetails(null);
      return;
    }
    loadProject(selectedProjectId);
  }, [loadProject, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    refreshRecords({
      projectId: selectedProjectId,
      runId: selectedRunId,
      scope: recordScope,
    });
  }, [recordScope, refreshRecords, selectedProjectId, selectedRunId]);

  useEffect(() => {
    const unsubscribe = api.research.onRunProgress((payload) => {
      if (!payload?.id) return;
      setRuns((prev) => {
        const next = [...prev];
        const index = next.findIndex((item) => item.id === payload.id);
        if (index >= 0) next[index] = { ...next[index], ...payload };
        else next.unshift(payload);
        return next;
      });

      const activeProjectId = selectedProjectIdRef.current;
      if (!activeProjectId || payload.projectId !== activeProjectId) return;
      if (!selectedRunIdRef.current) {
        setSelectedRunId(payload.id);
      }
      if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'cancelled') {
        refreshRuns(activeProjectId);
        refreshRecords({ projectId: activeProjectId, runId: payload.id, scope: recordScope });
      }
    });
    return () => unsubscribe?.();
  }, [recordScope, refreshRecords, refreshRuns]);

  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetails(null);
      return;
    }
    api.research.getRecord(selectedRecordId).then((result) => {
      setRecordDetails(result || null);
    });
  }, [selectedRecordId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const applySchemaPreset = useCallback((presetKey) => {
    const preset = RESEARCH_SCHEMA_PRESETS[presetKey];
    if (!preset) return;
    setSchemaDraft(cloneSchemaPreset(presetKey));
    setSelectedSchemaPreset(presetKey);
    setNotice(`Applied schema preset: ${preset.label}`);
  }, []);

  const applyResearchGuardrails = useCallback(() => {
    const current = String(projectDraft.permanent_instructions || '');
    if (current.includes(RESEARCH_GUARDRAIL_MARKER)) {
      setNotice('Research guardrails are already active.');
      return;
    }
    setProjectDraft((prev) => ({
      ...prev,
      permanent_instructions: String(prev.permanent_instructions || '').trim()
        ? `${prev.permanent_instructions.trim()}\n\n${RESEARCH_PERMANENT_INSTRUCTIONS}`
        : RESEARCH_PERMANENT_INSTRUCTIONS,
    }));
    setNotice('Research guardrails added to permanent instructions.');
  }, [projectDraft.permanent_instructions]);

  const handleObjectiveChange = useCallback((event) => {
    const value = String(event?.target?.value || '');
    setRunDraft((prev) => ({ ...prev, objective: value }));
    const hints = inferScopeFromText(value);
    if (Object.keys(hints).length > 0) {
      setGuidedDraft((prev) => mergeScopeDraft(prev, hints));
    }
  }, []);

  const handlePlanningSubmit = useCallback((event) => {
    event?.preventDefault();
    const text = String(planningInput || '').trim();
    if (!text) return;

    const inferredFromInput = inferScopeFromText(text);
    const nextScope = mergeScopeDraft(resolvedScopeDraft, inferredFromInput);
    const objectiveFromScope = buildGuidedObjective(nextScope);
    const requiredClarifier = buildRequiredClarifier(nextScope);
    const optionalClarifier = requiredClarifier ? '' : buildOptionalClarifier(nextScope);
    const summary = buildScopeSummary(nextScope);

    setGuidedDraft((prev) => mergeScopeDraft(prev, inferredFromInput));
    setRunDraft((prev) => ({
      ...prev,
      objective: String(prev.objective || '').trim() ? prev.objective : (objectiveFromScope || text),
      runInstructions: String(prev.runInstructions || '').trim()
        ? prev.runInstructions
        : buildGuidedRunNotes(nextScope),
    }));
    setPlanningInput('');

    const assistantReply = requiredClarifier
      ? requiredClarifier
      : optionalClarifier
        ? `${optionalClarifier} Current scope: ${summary || 'not set yet'}.`
        : `Great. Scope captured: ${summary || 'ready'}. Press Start Research Run when you are ready.`;

    setPlanningMessages((prev) => ([
      ...prev,
      { id: `planner_user_${Date.now()}`, role: 'user', content: text },
      { id: `planner_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: 'assistant', content: assistantReply },
    ]));
  }, [planningInput, resolvedScopeDraft]);

  const handleNewProject = useCallback(() => {
    setSelectedProjectId(null);
    setProjectDraft(emptyProjectDraft());
    setSchemaDraft(cloneSchemaPreset(DEFAULT_SCHEMA_PRESET_KEY));
    setSelectedSchemaPreset(DEFAULT_SCHEMA_PRESET_KEY);
    setShowSchemaAdvanced(false);
    setRuns([]);
    setRecords([]);
    setConversationLinks({ linked: [], available: [] });
    setDocumentLinks({ linked: [], available: [] });
    setSelectedRunId(null);
    setSelectedRecordId(null);
    setRecordDetails(null);
    setRunDraft({
      objective: '',
      runInstructions: '',
      workerCount: 4,
      depthPreset: DEFAULT_DEPTH_PRESET,
      strictTopicMatching: true,
    });
    setGuidedDraft({ ...DEFAULT_SCOPE_STATE });
    setPlanningInput('');
    setPlanningMessages([
      {
        id: `planner_${Date.now()}`,
        role: 'assistant',
        content: 'Tell me what you need in plain language. I will ask follow-ups only when required.',
      },
    ]);
    setShowRunHistory(false);
    setInspectorTab('setup');
    setShowInspector(true);
    setNotice('Creating a new project.');
  }, []);

  const handleSaveProject = useCallback(async () => {
    setIsSavingProject(true);
    try {
      if (!selectedProjectId) {
        const result = await api.research.createProject({
          workspace,
          name: projectDraft.name || 'Research Project',
          description: projectDraft.description || '',
          permanent_instructions: projectDraft.permanent_instructions || '',
          schema: schemaDraft,
          source_policy: projectDraft.source_policy || DEFAULT_SOURCE_POLICY,
        });
        if (!result?.success) {
          setNotice(result?.error || 'Failed to create project.');
          return;
        }
        await refreshProjects(result.id);
        setSelectedProjectId(result.id);
        setNotice('Project created.');
        return;
      }

      const result = await api.research.updateProject({
        id: selectedProjectId,
        name: projectDraft.name || 'Research Project',
        description: projectDraft.description || '',
        permanent_instructions: projectDraft.permanent_instructions || '',
        schema: schemaDraft,
        source_policy: projectDraft.source_policy || DEFAULT_SOURCE_POLICY,
      });
      if (!result?.success) {
        setNotice(result?.error || 'Failed to save project.');
        return;
      }
      await refreshProjects(selectedProjectId);
      setNotice('Project saved.');
    } finally {
      setIsSavingProject(false);
    }
  }, [projectDraft, refreshProjects, schemaDraft, selectedProjectId, workspace]);

  const handleDeleteProject = useCallback(async () => {
    if (!selectedProjectId) return;
    const confirmed = window.confirm('Delete this research project and all related runs/records?');
    if (!confirmed) return;
    const result = await api.research.deleteProject(selectedProjectId);
    if (!result?.success) {
      setNotice(result?.error || 'Failed to delete project.');
      return;
    }
    handleNewProject();
    await refreshProjects();
    setNotice('Project deleted.');
  }, [handleNewProject, refreshProjects, selectedProjectId]);

  const handleRunStart = useCallback(async (event) => {
    event?.preventDefault();
    if (!selectedProjectId) {
      setNotice('Create or select a project first.');
      return;
    }
    const objective = runDraft.objective.trim() || buildGuidedObjective(resolvedScopeDraft);
    if (!objective) {
      setNotice('Describe your research request first.');
      return;
    }
    const blockingClarifier = buildRequiredClarifier(resolvedScopeDraft);
    if (blockingClarifier) {
      setPlanningMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && String(last?.content || '').trim() === blockingClarifier.trim()) {
          return prev;
        }
        return [
          ...prev,
          {
            id: `planner_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: blockingClarifier,
          },
        ];
      });
      setNotice('Starting run with broad scope. Add clarifications in chat to improve precision.');
    }

    setIsStartingRun(true);
    try {
      const guidedNotes = buildGuidedRunNotes(resolvedScopeDraft);
      const mergedInstructions = [guidedNotes, runDraft.runInstructions.trim()].filter(Boolean).join('\n\n');

      const researchSettings = {
        depthPreset: String(runDraft.depthPreset || DEFAULT_DEPTH_PRESET),
        strictTopicMatching: runDraft.strictTopicMatching !== false,
        enableFinalSynthesis: true,
      };

      const result = await api.research.startRun({
        projectId: selectedProjectId,
        objective,
        runInstructions: mergedInstructions,
        workerCount: clampWorkers(runDraft.workerCount),
        researchSettings,
      });
      if (!result?.success) {
        setNotice(result?.error || 'Failed to start run.');
        return;
      }
      const runId = result?.run?.id || null;
      if (runId) setSelectedRunId(runId);
      await refreshRuns(selectedProjectId);
      await refreshRecords({ projectId: selectedProjectId, runId, scope: recordScope });
      setNotice('Research run started.');
    } finally {
      setIsStartingRun(false);
    }
  }, [recordScope, refreshRecords, refreshRuns, resolvedScopeDraft, runDraft, selectedProjectId]);

  const handleRunControl = useCallback(async (action, runId) => {
    const targetRunId = runId || selectedRunId || activeRun?.id;
    if (!targetRunId) return;

    let result = null;
    if (action === 'pause') result = await api.research.pauseRun(targetRunId);
    if (action === 'resume') result = await api.research.resumeRun(targetRunId);
    if (action === 'cancel') result = await api.research.cancelRun(targetRunId);

    if (!result?.success) {
      setNotice(result?.error || `Failed to ${action} run.`);
      return;
    }

    await refreshRuns(selectedProjectIdRef.current);
    await refreshRecords({
      projectId: selectedProjectIdRef.current,
      runId: selectedRunIdRef.current || targetRunId,
      scope: recordScope,
    });
    setNotice(`Run ${action}d.`);
  }, [activeRun?.id, recordScope, refreshRecords, refreshRuns, selectedRunId]);

  const handleRunSteer = useCallback(async () => {
    const targetRunId = selectedRunId || activeRun?.id;
    const instruction = runSteeringInput.trim();
    if (!targetRunId) {
      setNotice('Select an active run first.');
      return;
    }
    if (!instruction) {
      setNotice('Type a short steering instruction first.');
      return;
    }
    setIsSteeringRun(true);
    try {
      const result = await api.research.steerRun(targetRunId, instruction);
      if (!result?.success) {
        setNotice(result?.error || 'Failed to apply steering instruction.');
        return;
      }
      setRunSteeringInput('');
      await refreshRuns(selectedProjectIdRef.current);
      setNotice(`Steering applied. Queued ${Number(result?.queuedQueries || 0)} focused discovery queries.`);
    } finally {
      setIsSteeringRun(false);
    }
  }, [activeRun?.id, refreshRuns, runSteeringInput, selectedRunId]);

  const toggleConversationLink = useCallback(async (conversation) => {
    if (!selectedProjectId || !conversation?.id) return;
    const result = conversation.linked
      ? await api.research.unlinkConversation(selectedProjectId, conversation.id)
      : await api.research.linkConversation(selectedProjectId, conversation.id);
    if (!result?.success) {
      setNotice(result?.error || 'Failed to update conversation link.');
      return;
    }
    await refreshProjectLinks(selectedProjectId);
  }, [refreshProjectLinks, selectedProjectId]);

  const toggleDocumentLink = useCallback(async (doc) => {
    if (!selectedProjectId || !doc?.id) return;
    const result = doc.linked
      ? await api.research.unlinkDocument(selectedProjectId, doc.id)
      : await api.research.linkDocument(selectedProjectId, doc.id);
    if (!result?.success) {
      setNotice(result?.error || 'Failed to update document link.');
      return;
    }
    await refreshProjectLinks(selectedProjectId);
  }, [refreshProjectLinks, selectedProjectId]);

  const handleUploadDocument = useCallback(async () => {
    setIsUploadingDocs(true);
    try {
      const selectedFiles = await api.selectFile({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'doc', 'docx', 'csv', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) return;

      let successCount = 0;
      for (const filePath of selectedFiles) {
        const result = await api.ingestDocument({ filePath, workspace });
        if (result?.success) successCount += 1;
      }
      await refreshProjectLinks(selectedProjectIdRef.current);
      setNotice(`${successCount}/${selectedFiles.length} documents uploaded.`);
    } finally {
      setIsUploadingDocs(false);
    }
  }, [refreshProjectLinks, workspace]);

  const recordsForTimeline = useMemo(() => {
    if (recordScope !== 'run' || !selectedRunId) return records;
    return records.filter((item) => item.run_id === selectedRunId);
  }, [recordScope, records, selectedRunId]);

  const dashboardStats = useMemo(() => {
    const running = runs.filter((item) => item.status === 'running').length;
    const paused = runs.filter((item) => item.status === 'paused').length;
    const verified = records.length;
    const linkedChats = conversationLinks.linked?.length || 0;
    const linkedDocs = documentLinks.linked?.length || 0;
    return { running, paused, verified, linkedChats, linkedDocs };
  }, [conversationLinks.linked, documentLinks.linked, records.length, runs]);

  const guidedObjectivePreview = useMemo(
    () => buildGuidedObjective(resolvedScopeDraft),
    [resolvedScopeDraft]
  );

  useEffect(() => {
    if (!guidedObjectivePreview) return;
    setRunDraft((prev) => {
      const currentObjective = String(prev.objective || '').trim();
      if (currentObjective) return prev;
      return { ...prev, objective: guidedObjectivePreview };
    });
  }, [guidedObjectivePreview]);

  const runActivity = useMemo(
    () => Array.isArray(activeRun?.recentActivity) ? activeRun.recentActivity : [],
    [activeRun]
  );

  const runDomainStats = useMemo(
    () => Array.isArray(activeRun?.domainStats) ? activeRun.domainStats : [],
    [activeRun]
  );
  const runFinalSynthesis = useMemo(
    () => activeRun?.finalSynthesis || null,
    [activeRun]
  );

  const activitySummary = useMemo(() => {
    const summary = {
      total: 0,
      discover: 0,
      officialVerify: 0,
      extract: 0,
      validate: 0,
      persist: 0,
      blocked: 0,
      failed: 0,
      completed: 0,
    };
    for (const item of runActivity) {
      summary.total += 1;
      const phase = String(item?.phase || '').toLowerCase();
      const status = String(item?.status || '').toLowerCase();
      if (phase === 'discover') summary.discover += 1;
      if (phase === 'official_verify') summary.officialVerify += 1;
      if (phase === 'extract_fields') summary.extract += 1;
      if (phase === 'evidence_validate') summary.validate += 1;
      if (phase === 'persist') summary.persist += 1;
      if (status === 'blocked') summary.blocked += 1;
      if (status === 'failed') summary.failed += 1;
      if (status === 'completed') summary.completed += 1;
    }
    return summary;
  }, [runActivity]);

  const queryTraceRows = useMemo(() => {
    const map = new Map();
    for (const item of runActivity) {
      const query = compactQueryPreview(item?.query || '');
      if (!query) continue;
      const key = query.toLowerCase();
      const current = map.get(key) || {
        query,
        status: 'started',
        summary: '',
        hits: 0,
        lastAt: '',
      };
      current.hits += 1;
      current.status = String(item?.status || current.status || 'started').toLowerCase();
      current.summary = String(item?.summary || current.summary || '');
      current.lastAt = item?.at || current.lastAt;
      map.set(key, current);
    }
    return Array.from(map.values())
      .sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime())
      .slice(0, 8);
  }, [runActivity]);

  const recentSourceTrace = useMemo(() => {
    const rows = [];
    const seen = new Set();
    for (const item of [...runActivity].reverse()) {
      const source = String(item?.domain || item?.url || '').trim();
      if (!source) continue;
      const phase = String(item?.phaseLabel || item?.phase || 'task').trim();
      const key = `${source.toLowerCase()}::${phase.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        source: compactQueryPreview(source, 84),
        phase,
        status: String(item?.status || '').toLowerCase(),
        at: item?.at || '',
      });
      if (rows.length >= 8) break;
    }
    return rows;
  }, [runActivity]);

  const runPlanSteps = useMemo(
    () => buildResearchPlan({
      objective: activeRun?.objective || runDraft.objective || guidedObjectivePreview,
      runInstructions: runDraft.runInstructions,
    }),
    [activeRun?.objective, guidedObjectivePreview, runDraft.objective, runDraft.runInstructions]
  );

  const runProgressPercent = useMemo(() => {
    const goals = activeRun?.goalProgress?.goals || {};
    const current = activeRun?.goalProgress?.current || {};
    const checks = [
      { current: Number(current.discoveredCandidates || 0), goal: Number(goals.minDiscoveredCandidates || 0) },
      { current: Number(current.searchesIssued || 0), goal: Number(goals.minSearchesIssued || 0) },
      { current: Number(current.verifiedRecords || 0), goal: Number(goals.minVerifiedRecords || 0) },
      { current: Number(current.elapsedMinutes || 0), goal: Number(goals.minRuntimeMinutes || 0) },
    ];
    const ratios = checks
      .map((item) => (item.goal > 0 ? Math.min(1, item.current / item.goal) : 1))
      .filter((value) => Number.isFinite(value));
    if (!ratios.length) return 0;
    const ratio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }, [activeRun]);

  const hasRunObjective = Boolean(runDraft.objective.trim() || guidedObjectivePreview);
  const scopeSummary = useMemo(() => buildScopeSummary(resolvedScopeDraft), [resolvedScopeDraft]);
  const missingCoreScope = useMemo(() => {
    if (hasRunObjective) return [];
    return ['Objective'];
  }, [hasRunObjective]);
  const requiredClarifierQuestion = useMemo(
    () => (hasRunObjective
      ? buildOptionalClarifier(resolvedScopeDraft)
      : 'Describe the topic or question you want researched.'),
    [hasRunObjective, resolvedScopeDraft]
  );
  const canStartRun = Boolean(
    selectedProjectId &&
    hasRunObjective
  );
  const visibleRuns = showRunHistory ? runs : runs.slice(0, 3);
  const activeRunIsLive = ['running', 'paused'].includes(String(activeRun?.status || '').toLowerCase());
  const showResearchDetails = showDiagnostics || !CHAT_STYLE_MODE;
  const showFullComposer = !activeRunIsLive || showComposerDetails;
  const showSetupChat = CHAT_STYLE_MODE || showComposerDetails;
  const showRunCriteriaEditor = showDiagnostics && showComposerDetails;
  const showActivityStream = showResearchDetails;
  const showPerformanceCards = showResearchDetails;
  const showArchivePanels = showDiagnostics || !CHAT_STYLE_MODE;
  const inspectorTabs = useMemo(
    () => (CHAT_STYLE_MODE
      ? [
        { id: 'setup', label: 'Setup' },
        { id: 'sources', label: 'Context' },
        { id: 'audit', label: 'Export' },
      ]
      : [
        { id: 'setup', label: 'Setup' },
        { id: 'sources', label: 'Sources' },
        { id: 'schema', label: 'Schema' },
        { id: 'audit', label: 'Audit' },
      ]),
    []
  );
  const visibleRecordLimit = activeRunIsLive && !showDiagnostics ? 8 : 24;

  return (
    <div className="research-workspace flex-1 flex flex-col h-full min-h-0">
      <div className="research-header px-4 py-3 border-b border-forge-border flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-400/30 flex items-center justify-center">
            <Beaker size={18} className="text-sky-300" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">Deep Research</div>
            <div className="text-xs text-text-muted truncate">Chat-first deep research, modeled after modern assistant research flows</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedProjectId || ''}
            onChange={(event) => setSelectedProjectId(event.target.value || null)}
            className="h-9 px-3 rounded-lg bg-forge-surface border border-forge-border text-sm text-text-primary min-w-[220px]"
          >
            {!projects.length && <option value="">No project yet</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleNewProject}
            className="h-9 px-3 rounded-lg border border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover text-sm flex items-center gap-1"
          >
            <Plus size={14} />
            New
          </button>

          <button
            type="button"
            onClick={() => setShowInspector((prev) => !prev)}
            className="h-9 px-3 rounded-lg border border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover text-sm flex items-center gap-1"
            title="Toggle project settings panel"
          >
            <Settings2 size={14} />
            {showInspector ? 'Hide Settings' : 'Settings'}
          </button>
        </div>
      </div>

      {notice ? (
        <div className="px-4 py-2 text-xs border-b border-forge-border text-sky-300 bg-sky-500/5">
          {notice}
        </div>
      ) : null}

      <div className="px-4 py-2 border-b border-forge-border/70">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="research-chip research-chip-active px-2.5 py-1 rounded-full">
            Agentic Research
          </span>
          <span className="research-chip px-2.5 py-1 rounded-full">
            {activeRun ? `Run ${String(activeRun.status || '').toLowerCase()}` : 'Ready'}
          </span>
          {activeRun ? (
            <span className="research-chip px-2.5 py-1 rounded-full">
              Progress {runProgressPercent}%
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            className={`px-2.5 py-1 rounded-full border ${
              showDiagnostics
                ? 'border-sky-400/35 bg-sky-500/12 text-sky-200'
                : 'border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover'
            }`}
          >
            {showDiagnostics ? 'Hide Details' : 'Show Details'}
          </button>
          {showDiagnostics ? (
            <>
              <span className="research-chip px-2.5 py-1 rounded-full">Active {dashboardStats.running}</span>
              <span className="research-chip px-2.5 py-1 rounded-full">Verified {dashboardStats.verified}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="research-shell flex-1 min-h-0 flex flex-col xl:flex-row">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="research-scroll flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="research-card rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <MessageSquare size={15} className="text-sky-300" />
                      Deep Research Chat
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      Ask in plain language. The researcher plans, searches, verifies, and summarizes.
                    </div>
                  </div>
                  {activeRun ? (
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${statusBadgeClass(activeRun.status)}`}>
                      {activeRun.status}
                    </span>
                  ) : null}
                </div>

                {!activeRun ? (
                  <div className="mt-3 space-y-3">
                    <div className="research-chat-agent rounded-xl px-3 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Bot size={13} className="text-sky-300" />
                        Research Assistant (Agentic Mode)
                      </div>
                      <div className="text-sm text-text-primary mt-1">
                        Tell me your request in plain language, and I will ask short follow-up questions only when needed.
                      </div>
                      <div className="text-[11px] text-text-muted mt-1">
                        Example: "Find leading open-source vector databases and compare their licensing and performance claims."
                      </div>
                    </div>

                    {scopeSummary ? (
                      <div className="research-chat-user rounded-xl px-3 py-3">
                        <div className="text-[10px] uppercase tracking-wide text-sky-200/80">Current Scope</div>
                        <div className="text-sm text-text-primary mt-1">
                          {scopeSummary}
                        </div>
                      </div>
                    ) : null}

                    {missingCoreScope.length > 0 ? (
                      <div className="research-chat-agent rounded-xl px-3 py-3 border border-amber-400/20 bg-amber-500/5">
                        <div className="flex items-center gap-1.5 text-xs text-amber-200">
                          <AlertTriangle size={13} />
                          Clarification needed
                        </div>
                        <div className="text-[11px] text-amber-100/80 mt-1">
                          Still needed: {missingCoreScope.join(', ')}
                        </div>
                      </div>
                    ) : (runDraft.objective.trim() || guidedObjectivePreview) ? (
                      <div className="research-chat-agent rounded-xl px-3 py-3 border border-emerald-400/20 bg-emerald-500/5">
                        <div className="flex items-center gap-1.5 text-xs text-emerald-200">
                          <CheckCircle2 size={13} />
                          Scope is ready.
                        </div>
                        <div className="text-[11px] text-emerald-100/80 mt-1">
                          Start the run to begin discovery, verification, and final synthesis.
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className={`mt-3 grid gap-3 ${showResearchDetails ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.95fr)]' : ''}`}>
                    <div className="space-y-3 min-w-0">
                      <div className="research-chat-user rounded-xl px-3 py-3">
                        <div className="text-[10px] uppercase tracking-wide text-sky-200/80">Objective</div>
                        <div className="text-sm text-text-primary mt-1">
                          {activeRun.objective || 'No objective provided'}
                        </div>
                      </div>

                      <div className="research-chat-agent rounded-xl px-3 py-3 border border-forge-border/80">
                        <div className="text-[10px] uppercase tracking-wide text-text-muted">Steer Active Run</div>
                        <div className="text-[11px] text-text-muted mt-1">
                          Add a follow-up like you would in chat (for example: "Focus on sources from 2025 onward.").
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            value={runSteeringInput}
                            onChange={(event) => setRunSteeringInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                if (!isSteeringRun) handleRunSteer();
                              }
                            }}
                            placeholder="Steering instruction..."
                            className="flex-1 rounded-lg border border-forge-border bg-forge-bg/70 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-sky-400/60"
                          />
                          <button
                            type="button"
                            onClick={handleRunSteer}
                            disabled={isSteeringRun || !runSteeringInput.trim()}
                            className="px-3 py-2 rounded-lg border border-forge-border text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                          >
                            {isSteeringRun ? 'Applying...' : 'Apply'}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleRunControl('pause', activeRun.id)}
                          disabled={String(activeRun.status || '').toLowerCase() !== 'running'}
                          className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50 flex items-center gap-1"
                        >
                          <Pause size={12} />
                          Pause
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRunControl('resume', activeRun.id)}
                          disabled={String(activeRun.status || '').toLowerCase() !== 'paused'}
                          className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50 flex items-center gap-1"
                        >
                          <Play size={12} />
                          Resume
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRunControl('cancel', activeRun.id)}
                          disabled={!['running', 'paused'].includes(String(activeRun.status || '').toLowerCase())}
                          className="h-8 px-3 rounded-md border border-rose-400/30 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 flex items-center gap-1"
                        >
                          <Square size={12} />
                          Stop
                        </button>
                      </div>

                      {activeRun?.intermediateSummary?.text ? (
                        <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] uppercase tracking-wide text-sky-200/85">Latest Progress Update</div>
                            <div className="text-[10px] text-text-muted">
                              {activeRun.intermediateSummary?.generatedAt
                                ? formatDate(activeRun.intermediateSummary.generatedAt)
                                : formatRelativeTime(activeRun.updatedAt || activeRun.updated_at)}
                            </div>
                          </div>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-primary max-h-[220px] overflow-y-auto pr-1 research-scroll">
                            {activeRun.intermediateSummary.text}
                          </pre>
                        </div>
                      ) : null}

                      {showPerformanceCards ? (
                      <div className="research-chat-agent rounded-xl px-3 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                              <Bot size={13} className="text-sky-300" />
                              Research engine
                            </div>
                            <div className="text-xs text-text-muted mt-1">
                              Run {activeRun.id?.slice(0, 8)} | updated {formatRelativeTime(activeRun.updatedAt || activeRun.updated_at)}
                            </div>
                          </div>
                          {(activeRun.status || '') === 'completed' ? (
                            <CheckCircle2 size={15} className="text-emerald-300 shrink-0 mt-0.5" />
                          ) : null}
                        </div>
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[11px] text-text-secondary">
                            <span>Deep-search progress</span>
                            <span>{runProgressPercent}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-forge-hover overflow-hidden mt-1">
                            <div className="h-full bg-sky-400/80" style={{ width: `${Math.max(2, runProgressPercent)}%` }} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                          <div className="rounded-lg border border-forge-border px-2 py-1.5">
                            <div className="text-[10px] text-text-muted uppercase">Discovered</div>
                            <div className="text-xs text-text-primary mt-0.5">
                              {Math.floor(activeRun.goalProgress?.current?.discoveredCandidates || 0)} / {Math.floor(activeRun.goalProgress?.goals?.minDiscoveredCandidates || 0)}
                            </div>
                          </div>
                          <div className="rounded-lg border border-forge-border px-2 py-1.5">
                            <div className="text-[10px] text-text-muted uppercase">Searches</div>
                            <div className="text-xs text-text-primary mt-0.5">
                              {Math.floor(activeRun.goalProgress?.current?.searchesIssued || 0)} / {Math.floor(activeRun.goalProgress?.goals?.minSearchesIssued || 0)}
                            </div>
                          </div>
                          <div className="rounded-lg border border-forge-border px-2 py-1.5">
                            <div className="text-[10px] text-text-muted uppercase">Verified</div>
                            <div className="text-xs text-text-primary mt-0.5">
                              {Math.floor(activeRun.goalProgress?.current?.verifiedRecords || 0)} / {Math.floor(activeRun.goalProgress?.goals?.minVerifiedRecords || 0)}
                            </div>
                          </div>
                          <div className="rounded-lg border border-forge-border px-2 py-1.5">
                            <div className="text-[10px] text-text-muted uppercase">Runtime</div>
                            <div className="text-xs text-text-primary mt-0.5">
                              {Math.floor(activeRun.goalProgress?.current?.elapsedMinutes || 0)}m / {Math.floor(activeRun.goalProgress?.goals?.minRuntimeMinutes || 0)}m
                            </div>
                          </div>
                        </div>
                      </div>
                      ) : null}

                      <div className="rounded-xl border border-forge-border bg-forge-surface/70 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-wide text-text-muted">Final Synthesis</div>
                          <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${activityStatusPillClass(runFinalSynthesis?.status || 'started')}`}>
                            {activityStatusLabel(runFinalSynthesis?.status || 'started')}
                          </span>
                        </div>
                        {runFinalSynthesis?.status === 'running' ? (
                          <div className="text-xs text-text-muted mt-2 flex items-center gap-1.5">
                            <Loader2 size={12} className="animate-spin" />
                            Generating final summary from verified records...
                          </div>
                        ) : runFinalSynthesis?.text ? (
                          <>
                            <div className="text-[11px] text-text-muted mt-1">
                              {runFinalSynthesis?.generatedAt ? `Generated ${formatDate(runFinalSynthesis.generatedAt)}` : 'Generated at run completion'}
                              {runFinalSynthesis?.model ? ` | model ${runFinalSynthesis.model}` : ''}
                              {Number.isFinite(Number(runFinalSynthesis?.recordCount))
                                ? ` | records ${Number(runFinalSynthesis.recordCount)}`
                                : ''}
                            </div>
                            {runFinalSynthesis?.warning ? (
                              <div className="text-[11px] text-amber-200 mt-1">
                                Fallback note: {runFinalSynthesis.warning}
                              </div>
                            ) : null}
                            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-text-primary leading-relaxed max-h-[340px] overflow-y-auto pr-1 research-scroll">
                              {runFinalSynthesis.text}
                            </pre>
                          </>
                        ) : runFinalSynthesis?.status === 'skipped' ? (
                          <div className="text-xs text-text-muted mt-2">
                            Final synthesis skipped for this run.
                          </div>
                        ) : (
                          <div className="text-xs text-text-muted mt-2">
                            Final synthesis will appear automatically when coverage goals complete.
                          </div>
                        )}
                      </div>

                      {showActivityStream ? (
                      <div className="space-y-2">
                        {runActivity.length === 0 ? (
                          <div className="text-xs text-text-muted border border-forge-border rounded-lg px-3 py-2">
                            Waiting for the first worker event...
                          </div>
                        ) : (
                          runActivity.slice(-12).map((activity) => (
                            <div
                              key={`${activity.seq || activity.id}-${activity.at}`}
                              className={`research-feed-event rounded-lg border px-3 py-2 ${activityToneClass(activity.status)}`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide">
                                <span className="text-text-secondary">{activity.phaseLabel || 'Task'}</span>
                                <span>{activityStatusLabel(activity.status)}</span>
                              </div>
                              <div className="text-xs text-text-primary mt-1">
                                {activity.summary || 'Progress update'}
                              </div>
                              {activity.query ? (
                                <div className="text-[11px] text-text-muted mt-1 break-words">
                                  Query: {activity.query}
                                </div>
                              ) : null}
                              {(activity.domain || activity.url) ? (
                                <div className="text-[11px] text-text-muted mt-1 break-words">
                                  {activity.domain ? `Domain: ${activity.domain}` : `URL: ${activity.url}`}
                                </div>
                              ) : null}
                              {activity.details ? (
                                <div className="text-[11px] text-text-secondary mt-1 break-words">
                                  {activity.details}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-text-muted mt-1">
                                {formatRelativeTime(activity.at)}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      ) : null}
                    </div>

                    {showResearchDetails ? (
                    <div className="research-activity-panel rounded-xl border border-forge-border bg-forge-bg/70 px-3 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Live Activity</div>
                        <span className="text-[10px] text-text-secondary">{activitySummary.total} events</span>
                      </div>

                      <div className="rounded-lg border border-forge-border bg-forge-surface/60 px-3 py-2">
                        <div className="text-[11px] text-text-primary font-medium">Research Plan Created</div>
                        <div className="space-y-1 mt-2">
                          {runPlanSteps.map((step, index) => (
                            <div key={`plan-step-${index}`} className="text-[11px] text-text-secondary">
                              {index + 1}. {step}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-forge-border bg-forge-surface/60 px-3 py-2">
                        <div className="text-[11px] text-text-primary font-medium">Gathering Sources</div>
                        <div className="text-[11px] text-text-muted mt-1">
                          Discover: {activitySummary.discover} | Official Verify: {activitySummary.officialVerify}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          Extract: {activitySummary.extract} | Validate: {activitySummary.validate} | Persist: {activitySummary.persist}
                        </div>
                        <div className="text-[11px] text-text-muted mt-1">
                          Searches issued: {Math.floor(activeRun?.goalProgress?.current?.searchesIssued || 0)} | Candidate pages: {Math.floor(activeRun?.goalProgress?.current?.discoveredCandidates || 0)}
                        </div>
                        {queryTraceRows.length > 0 ? (
                          <div className="space-y-1.5 mt-2">
                            {queryTraceRows.slice(0, 6).map((item, index) => (
                              <div key={`query-trace-${index}`} className="rounded-md border border-forge-border px-2 py-1.5 bg-forge-bg/60">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] text-text-primary break-words">{item.query}</span>
                                  <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${activityStatusPillClass(item.status)}`}>
                                    {activityStatusLabel(item.status)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-text-muted mt-1 break-words">
                                  {item.summary || `Seen ${item.hits} update${item.hits === 1 ? '' : 's'}`}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-text-muted mt-2">No query trace yet.</div>
                        )}
                      </div>

                      <div className="rounded-lg border border-forge-border bg-forge-surface/60 px-3 py-2">
                        <div className="text-[11px] text-text-primary font-medium">Top Domains</div>
                        {!runDomainStats.length ? (
                          <div className="text-[11px] text-text-muted mt-1">Waiting for domain activity...</div>
                        ) : (
                          <div className="space-y-1 mt-1">
                            {runDomainStats.slice(0, 6).map((item) => (
                              <div key={`domain-${item.domain}`} className="text-[11px] text-text-secondary flex items-center justify-between gap-2">
                                <span className="truncate">{item.domain}</span>
                                <span className="text-text-muted">{item.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-forge-border bg-forge-surface/60 px-3 py-2">
                        <div className="text-[11px] text-text-primary font-medium">Recent Sources Opened</div>
                        {!recentSourceTrace.length ? (
                          <div className="text-[11px] text-text-muted mt-1">No source trace yet.</div>
                        ) : (
                          <div className="space-y-1.5 mt-1">
                            {recentSourceTrace.map((item, index) => (
                              <div key={`source-trace-${index}`} className="rounded-md border border-forge-border px-2 py-1.5 bg-forge-bg/60">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="text-text-primary truncate">{item.source}</span>
                                  <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${activityStatusPillClass(item.status)}`}>
                                    {activityStatusLabel(item.status)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-text-muted mt-1">
                                  {item.phase} | {formatRelativeTime(item.at)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-forge-border bg-forge-surface/60 px-3 py-2">
                        <div className="text-[11px] text-text-primary font-medium">Quality Gates</div>
                        <div className="text-[11px] text-text-muted mt-1">
                          Verified: {activeRun?.stats?.verifiedSaved || 0}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          Blocked: {activeRun?.stats?.rejectedBlocked || 0} | Non-official: {activeRun?.stats?.rejectedNonOfficial || 0}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          Irrelevant: {activeRun?.stats?.rejectedIrrelevant || 0} | Failed: {activitySummary.failed}
                        </div>
                      </div>
                    </div>
                    ) : null}
                  </div>
                )}
              </div>

              {activeRun && showArchivePanels ? (
                <div className="research-card rounded-xl p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <MapPinned size={14} className="text-sky-300" />
                    Domain Breadth (Expanded)
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Extended domain view for audit and coverage checks.
                  </div>
                  {!runDomainStats.length ? (
                    <div className="text-xs text-text-muted mt-3">No source domains recorded yet.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(() => {
                        const top = runDomainStats.slice(0, 8);
                        const maxCount = Math.max(...top.map((item) => Number(item.count || 0)), 1);
                        return top.map((item) => (
                          <div key={item.domain} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-text-primary truncate">{item.domain}</span>
                              <span className="text-text-muted">{item.count}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-forge-hover overflow-hidden">
                              <div
                                className="h-full bg-sky-400/80"
                                style={{ width: `${Math.max(6, Math.round((Number(item.count || 0) / maxCount) * 100))}%` }}
                              />
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              ) : null}

              {runs.length > 0 && showArchivePanels ? (
                <div className="research-card rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-text-primary">Run History</div>
                      <div className="text-xs text-text-muted mt-1">
                        Select a run to inspect records and evidence.
                      </div>
                    </div>
                    {runs.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => setShowRunHistory((prev) => !prev)}
                        className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover"
                      >
                        {showRunHistory ? 'Show Fewer Runs' : 'Show All Runs'}
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-2 mt-3">
                    {visibleRuns.map((run) => {
                      const isSelected = run.id === selectedRunId;
                      const runStats = run.stats || {};
                      return (
                        <button
                          key={run.id}
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                          className={`research-run-enter w-full text-left rounded-xl px-4 py-3 border ${
                            isSelected
                              ? 'border-sky-400/35 bg-sky-500/10'
                              : 'border-forge-border bg-forge-surface/70 hover:bg-forge-hover'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm text-text-primary font-medium truncate pr-2">
                              {run.objective}
                            </div>
                            <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${statusBadgeClass(run.status)}`}>
                              {run.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-text-muted mt-1">
                            Run {run.id.slice(0, 8)} | updated {formatDate(run.updatedAt || run.updated_at)}
                          </div>
                          <div className="text-[11px] text-text-muted mt-1">
                            Verified {runStats.verifiedSaved || 0} | Blocked {runStats.rejectedBlocked || 0} | Non-official {runStats.rejectedNonOfficial || 0} | Irrelevant {runStats.rejectedIrrelevant || 0}
                          </div>
                          <div className="text-[11px] text-text-muted">
                            Queue {run.queueSize || 0} | Workers {run.activeWorkers || 0}/{run.workerCount || 4} | Convergence {run.convergenceCount || 0}/{run.convergenceThreshold || 5}
                          </div>
                          {isSelected ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRunControl('pause', run.id);
                                }}
                                disabled={run.status !== 'running'}
                                className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50 flex items-center gap-1"
                              >
                                <Pause size={12} />
                                Pause
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRunControl('resume', run.id);
                                }}
                                disabled={run.status !== 'paused'}
                                className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50 flex items-center gap-1"
                              >
                                <Play size={12} />
                                Resume
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRunControl('cancel', run.id);
                                }}
                                disabled={run.status !== 'running' && run.status !== 'paused'}
                                className="h-8 px-3 rounded-md border border-rose-400/30 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 flex items-center gap-1"
                              >
                                <Square size={12} />
                                Cancel
                              </button>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!selectedProjectId ? (
                <div className="research-card rounded-xl p-5">
                  <div className="text-sm font-medium text-text-primary">Create a project to start research</div>
                  <div className="text-xs text-text-muted mt-2">
                    Projects keep permanent instructions, linked chats/documents, and verified records across runs.
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveProject}
                    className="mt-4 h-9 px-3 rounded-lg bg-sky-500 text-white hover:bg-sky-500/90 text-sm flex items-center gap-1"
                  >
                    <Save size={14} />
                    Create Project
                  </button>
                </div>
              ) : null}

              {runs.length === 0 && selectedProjectId ? (
                <div className="research-card rounded-xl p-5">
                  <div className="text-sm text-text-primary">No runs yet for this project.</div>
                  <div className="text-xs text-text-muted mt-1">Describe your request in the chat-style setup below, answer any clarifiers, then start the run.</div>
                </div>
              ) : null}

              {showArchivePanels ? (
              <div className="research-card rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <div className="text-sm font-medium text-text-primary">Verified Records</div>
                    <div className="text-xs text-text-muted">
                      {recordScope === 'run' && selectedRunId ? 'Showing selected run records' : 'Showing all project records'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshRecords({ projectId: selectedProjectId, runId: selectedRunId, scope: recordScope })}
                    className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover flex items-center gap-1"
                  >
                    <RefreshCw size={12} />
                    Refresh
                  </button>
                </div>

                {!recordsForTimeline.length ? (
                  <div className="text-xs text-text-muted">No verified records yet.</div>
                ) : (
                  <div className="space-y-2">
                    {recordsForTimeline.slice(0, visibleRecordLimit).map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setSelectedRecordId(row.id)}
                        className={`w-full text-left border rounded-lg px-3 py-2 text-xs ${
                          selectedRecordId === row.id
                            ? 'border-sky-400/35 bg-sky-500/10'
                            : 'border-forge-border hover:bg-forge-hover'
                        }`}
                      >
                        <div className="font-medium text-text-primary">
                          {row.record?.name || row.canonical_key}
                        </div>
                        <div className="text-text-muted mt-0.5">
                          {row.verified_official_url || 'No official URL'} | evidence {row.evidence_count || 0}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-forge-border bg-forge-surface/60 backdrop-blur-sm">
            <div className="max-w-4xl mx-auto p-3">
              <form onSubmit={handleRunStart} className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wide text-text-muted">Ask Deep Research</div>
                  <button
                    type="button"
                    onClick={() => setShowComposerDetails((prev) => !prev)}
                    className="h-8 px-3 rounded-lg border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover"
                  >
                    {activeRunIsLive
                      ? (showFullComposer ? 'Hide Composer' : 'New Query')
                      : (showComposerDetails ? 'Hide Advanced' : 'Advanced')}
                  </button>
                </div>

                {!showFullComposer ? (
                  <div className="rounded-lg border border-sky-400/20 bg-sky-500/5 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-sky-100/90">
                      Active run in progress. Use the steering input in the run feed for mid-run guidance.
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowComposerDetails(true)}
                      className="h-8 px-3 rounded-md border border-sky-400/30 text-[11px] text-sky-200 hover:bg-sky-500/10"
                    >
                      Open New Run Composer
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border border-forge-border bg-forge-bg">
                      <textarea
                        value={runDraft.objective}
                        onChange={handleObjectiveChange}
                        placeholder='Describe your request in plain language. Example: "Find all current grants for climate startups in California."'
                        className="w-full min-h-[72px] max-h-[160px] resize-y bg-transparent px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none"
                      />
                    </div>

                    {showSetupChat ? (
                      <div className="rounded-xl border border-forge-border bg-forge-bg px-3 py-2.5 space-y-2">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Conversation</div>
                        <div className="max-h-[132px] overflow-y-auto pr-1 space-y-2 research-scroll">
                          {planningMessages.slice(-8).map((item) => (
                            <div key={item.id} className={item.role === 'user' ? 'research-chat-user rounded-lg px-2.5 py-2' : 'research-chat-agent rounded-lg px-2.5 py-2'}>
                              <div className="text-[10px] uppercase tracking-wide text-text-muted">{item.role === 'user' ? 'You' : 'Assistant'}</div>
                              <div className="text-xs text-text-primary mt-1 whitespace-pre-wrap break-words">{item.content}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-forge-border bg-forge-bg px-2 py-2 flex items-center gap-2">
                      <input
                        value={planningInput}
                        onChange={(event) => setPlanningInput(event.target.value)}
                        placeholder="Reply with clarifications (geography, timeframe, entities, exclusions, etc.)"
                        className="flex-1 h-8 px-3 rounded-md bg-forge-surface border border-forge-border text-sm text-text-primary"
                      />
                      <button
                        type="button"
                        onClick={handlePlanningSubmit}
                        className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover"
                      >
                        Send
                      </button>
                    </div>

                    {missingCoreScope.length > 0 ? (
                      <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-amber-200">
                          <AlertTriangle size={13} />
                          Clarification recommended before broad search
                        </div>
                        <div className="mt-0.5 text-[11px] text-amber-100/80">
                          {requiredClarifierQuestion}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-200">
                        Scope looks good. Start run when ready.
                      </div>
                    )}

                    {showRunCriteriaEditor ? (
                      <div className="rounded-xl border border-forge-border bg-forge-bg px-3 py-3 space-y-2">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Advanced Run Notes</div>
                        <textarea
                          value={runDraft.runInstructions}
                          onChange={(event) => setRunDraft((prev) => ({ ...prev, runInstructions: event.target.value }))}
                          placeholder="Add any extra criteria. Project instruction box content is always applied."
                          className="w-full min-h-[68px] rounded-lg border border-forge-border bg-forge-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none"
                        />
                        <div className="text-[11px] text-text-muted">
                          {scopeSummary
                            ? `Current scope: ${scopeSummary}`
                            : 'No structured scope captured yet. You can still run using your plain-language objective.'}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {showFullComposer ? (
                    <button
                      type="submit"
                      disabled={!canStartRun || isStartingRun}
                      className="h-9 px-4 rounded-lg bg-sky-500 text-white hover:bg-sky-500/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                    >
                      {isStartingRun ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Start Deep Research
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowComposerDetails(true)}
                      className="h-9 px-3 rounded-lg border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover"
                    >
                      Open New Run Composer
                    </button>
                  )}
                    <button
                      type="button"
                      onClick={() => setShowInspector(true)}
                      className="h-9 px-3 rounded-lg border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover"
                    >
                      Open Settings
                    </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {showInspector ? (
          <aside className="research-scroll xl:w-[380px] w-full xl:border-l border-t xl:border-t-0 border-forge-border bg-forge-surface/50 min-h-0 overflow-y-auto p-3 space-y-3">
            <section className="research-card rounded-xl p-2">
              <div className={`grid gap-1 ${inspectorTabs.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {inspectorTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setInspectorTab(tab.id)}
                    className={`h-8 rounded-md text-[11px] border ${
                      inspectorTab === tab.id
                        ? 'border-sky-400/35 bg-sky-500/12 text-sky-200'
                        : 'border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </section>

            {inspectorTab === 'setup' ? (
            <section className="research-card rounded-xl p-3 space-y-2">
              <div className="text-xs uppercase tracking-wide text-text-muted">Project Setup</div>
              <input
                value={projectDraft.name}
                onChange={(event) => setProjectDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Project name"
                className="w-full h-9 px-3 rounded-lg bg-forge-bg border border-forge-border text-sm text-text-primary"
              />
              <textarea
                value={projectDraft.description}
                onChange={(event) => setProjectDraft((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Description"
                className="w-full min-h-[68px] rounded-lg bg-forge-bg border border-forge-border px-3 py-2 text-xs text-text-primary"
              />
              <textarea
                value={projectDraft.permanent_instructions}
                onChange={(event) => setProjectDraft((prev) => ({ ...prev, permanent_instructions: event.target.value }))}
                placeholder="Permanent instructions for every run"
                className="w-full min-h-[120px] rounded-lg bg-forge-bg border border-forge-border px-3 py-2 text-xs text-text-primary"
              />
              <div className="border border-forge-border rounded-lg p-2 space-y-2">
                <div className="text-[11px] text-text-secondary">Schema Presets (recommended)</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.values(RESEARCH_SCHEMA_PRESETS).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => applySchemaPreset(preset.key)}
                      className={`text-left rounded-md border px-2 py-2 text-[11px] ${
                        selectedSchemaPreset === preset.key
                          ? 'border-sky-400/35 bg-sky-500/12 text-sky-200'
                          : 'border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover'
                      }`}
                    >
                      <div className="font-medium">{preset.label}</div>
                      <div className="text-[10px] opacity-80 mt-0.5">{preset.description}</div>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-text-muted">
                  Active preset: {RESEARCH_SCHEMA_PRESETS[selectedSchemaPreset]?.label || 'Starter'} | fields: {schemaDraft.length}
                </div>
              </div>
              <button
                type="button"
                onClick={applyResearchGuardrails}
                className="h-8 px-3 rounded-md border border-forge-border text-xs text-text-secondary hover:text-text-primary hover:bg-forge-hover"
              >
                Apply Research Guardrails
              </button>
              <input
                value={(projectDraft.source_policy?.officialDomains || []).join(', ')}
                onChange={(event) =>
                  setProjectDraft((prev) => ({
                    ...prev,
                    source_policy: {
                      ...(prev.source_policy || DEFAULT_SOURCE_POLICY),
                      officialDomains: event.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  }))
                }
                placeholder="Optional official domains (comma-separated)"
                className="w-full h-9 px-3 rounded-lg bg-forge-bg border border-forge-border text-xs text-text-primary"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveProject}
                  disabled={isSavingProject}
                  className="h-9 px-3 rounded-lg bg-sky-500 text-white hover:bg-sky-500/90 disabled:opacity-50 text-xs flex items-center gap-1"
                >
                  {isSavingProject ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
                {selectedProjectId ? (
                  <button
                    type="button"
                    onClick={handleDeleteProject}
                    className="h-9 px-3 rounded-lg border border-rose-400/35 text-rose-300 hover:bg-rose-500/10 text-xs flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                ) : null}
              </div>
            </section>
            ) : null}

            {inspectorTab === 'sources' ? (
            <>
            <section className="research-card rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-text-muted">Linked Chats</div>
                <span className="research-chip px-2 py-1 rounded-full text-[10px]">
                  {conversationLinks.linked?.length || 0} linked
                </span>
              </div>
              <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1 research-scroll">
                {(conversationLinks.available || []).slice(0, 80).map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => toggleConversationLink(conversation)}
                    className={`w-full text-left rounded-lg border px-2.5 py-2 text-[11px] ${
                      conversation.linked
                        ? 'border-sky-400/35 bg-sky-500/12'
                        : 'border-forge-border hover:bg-forge-hover'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-text-primary">
                      <Link2 size={11} />
                      <span className="truncate">{conversation.title || conversation.id}</span>
                    </div>
                    <div className="text-text-muted mt-1 line-clamp-2">{conversation.preview || 'No preview'}</div>
                  </button>
                ))}
                {!(conversationLinks.available || []).length && (
                  <div className="text-[11px] text-text-muted">No conversations available in this workspace.</div>
                )}
              </div>
            </section>

            <section className="research-card rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-text-muted">Linked Documents</div>
                <div className="flex items-center gap-2">
                  <span className="research-chip px-2 py-1 rounded-full text-[10px]">
                    {documentLinks.linked?.length || 0} linked
                  </span>
                  <button
                    type="button"
                    onClick={handleUploadDocument}
                    disabled={isUploadingDocs}
                    className="h-7 px-2 rounded-md border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50 flex items-center gap-1"
                    title="Upload and index documents"
                  >
                    {isUploadingDocs ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                    Upload
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1 research-scroll">
                {(documentLinks.available || []).slice(0, 120).map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => toggleDocumentLink(doc)}
                    className={`w-full text-left rounded-lg border px-2.5 py-2 text-[11px] ${
                      doc.linked
                        ? 'border-sky-400/35 bg-sky-500/12'
                        : 'border-forge-border hover:bg-forge-hover'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-text-primary">
                      <FileText size={11} />
                      <span className="truncate">{doc.filename || doc.id}</span>
                    </div>
                  </button>
                ))}
                {!(documentLinks.available || []).length && (
                  <div className="text-[11px] text-text-muted">No uploaded documents available yet.</div>
                )}
              </div>
            </section>
            </>
            ) : null}

            {inspectorTab === 'schema' ? (
            <section className="research-card rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-text-muted">Schema</div>
                <div className="text-[10px] text-text-muted">Preset-driven to keep setup simple</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(RESEARCH_SCHEMA_PRESETS).map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => applySchemaPreset(preset.key)}
                    className={`text-left rounded-md border px-2 py-2 text-[11px] ${
                      selectedSchemaPreset === preset.key
                        ? 'border-sky-400/35 bg-sky-500/12 text-sky-200'
                        : 'border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover'
                    }`}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{preset.description}</div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between border border-forge-border rounded-md px-2 py-1.5 text-[11px] text-text-secondary">
                <span>
                  Fields: {schemaDraft.length} | Required: {schemaDraft.filter((field) => field.required).length}
                </span>
                <button
                  type="button"
                  onClick={() => setShowSchemaAdvanced((prev) => !prev)}
                  className="text-sky-300 hover:text-sky-200"
                >
                  {showSchemaAdvanced ? 'Hide Advanced Editor' : 'Show Advanced Editor'}
                </button>
              </div>

              {!showSchemaAdvanced ? (
                <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1 research-scroll">
                  {schemaDraft.slice(0, 24).map((field) => (
                    <div key={field.key} className="flex items-center justify-between rounded-md border border-forge-border px-2 py-1 text-[11px]">
                      <span className="text-text-primary truncate pr-2">{field.label || field.key}</span>
                      <span className="text-text-muted whitespace-nowrap">
                        {field.key} {field.required ? '(required)' : ''}
                      </span>
                    </div>
                  ))}
                  {schemaDraft.length > 24 ? (
                    <div className="text-[10px] text-text-muted">Showing first 24 fields. Use Advanced Editor for full edit.</div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 research-scroll">
                  <button
                    type="button"
                    onClick={() =>
                      setSchemaDraft((prev) => [
                        ...prev,
                        {
                          key: `field_${prev.length + 1}`,
                          label: 'New Field',
                          type: 'text',
                          required: false,
                          description: '',
                          extraction_hints: '',
                        },
                      ])
                    }
                    className="h-7 px-2 rounded-md border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover flex items-center gap-1"
                  >
                    <Plus size={11} />
                    Add Field
                  </button>
                  {schemaDraft.map((field, index) => (
                    <div key={`${field.key}-${index}`} className="border border-forge-border rounded-lg p-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={field.key}
                          onChange={(event) =>
                            setSchemaDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, key: sanitizeKey(event.target.value, index) } : item))
                            )
                          }
                          className="h-8 px-2 rounded-md bg-forge-bg border border-forge-border text-[11px] text-text-primary"
                        />
                        <input
                          value={field.label}
                          onChange={(event) =>
                            setSchemaDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, label: event.target.value } : item))
                            )
                          }
                          className="h-8 px-2 rounded-md bg-forge-bg border border-forge-border text-[11px] text-text-primary"
                        />
                      </div>
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                        <select
                          value={field.type}
                          onChange={(event) =>
                            setSchemaDraft((prev) =>
                              prev.map((item, i) => (i === index ? { ...item, type: event.target.value } : item))
                            )
                          }
                          className="h-8 px-2 rounded-md bg-forge-bg border border-forge-border text-[11px] text-text-primary"
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <label className="text-[11px] text-text-secondary flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={Boolean(field.required)}
                            onChange={(event) =>
                              setSchemaDraft((prev) =>
                                prev.map((item, i) => (i === index ? { ...item, required: event.target.checked } : item))
                              )
                            }
                          />
                          Required
                        </label>
                        <button
                          type="button"
                          onClick={() => setSchemaDraft((prev) => prev.filter((_, i) => i !== index))}
                          className="h-8 px-2 rounded-md border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover"
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        value={field.extraction_hints || ''}
                        onChange={(event) =>
                          setSchemaDraft((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, extraction_hints: event.target.value } : item))
                          )
                        }
                        placeholder="Extraction hints"
                        className="w-full h-8 px-2 rounded-md bg-forge-bg border border-forge-border text-[11px] text-text-primary"
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
            ) : null}

            {inspectorTab === 'audit' ? (
            <section className="research-card rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-text-muted">Records + Evidence</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setRecordScope('run')}
                    className={`h-7 px-2 rounded-md text-[11px] ${
                      recordScope === 'run'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                        : 'border border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover'
                    }`}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordScope('project')}
                    className={`h-7 px-2 rounded-md text-[11px] ${
                      recordScope === 'project'
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                        : 'border border-forge-border text-text-secondary hover:text-text-primary hover:bg-forge-hover'
                    }`}
                  >
                    Project
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => api.research.exportRecords({ projectId: selectedProjectId, format: 'json' })}
                  disabled={!selectedProjectId}
                  className="h-7 px-2 rounded-md border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => api.research.exportRecords({ projectId: selectedProjectId, format: 'csv' })}
                  disabled={!selectedProjectId}
                  className="h-7 px-2 rounded-md border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => api.research.exportRecords({ projectId: selectedProjectId, format: 'md' })}
                  disabled={!selectedProjectId}
                  className="h-7 px-2 rounded-md border border-forge-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-forge-hover disabled:opacity-50"
                >
                  Export MD (Cursor)
                </button>
              </div>

              <div className="border border-forge-border rounded-lg overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-forge-hover">
                    <tr>
                      {dynamicColumns.map((column) => (
                        <th key={column} className="text-left px-2 py-1 whitespace-nowrap text-text-secondary">
                          {column}
                        </th>
                      ))}
                      <th className="text-left px-2 py-1 whitespace-nowrap text-text-secondary">evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 120).map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedRecordId(row.id)}
                        className={`border-t border-forge-border cursor-pointer ${
                          selectedRecordId === row.id ? 'bg-sky-500/10' : 'hover:bg-forge-hover'
                        }`}
                      >
                        {dynamicColumns.map((column) => (
                          <td key={`${row.id}-${column}`} className="px-2 py-1 text-text-primary align-top">
                            {Array.isArray(row.record?.[column])
                              ? row.record[column].join(', ')
                              : String(row.record?.[column] ?? '')}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-text-secondary align-top">{row.evidence_count || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            {recordDetails ? (
                <div className="space-y-1 max-h-[220px] overflow-y-auto pr-1">
                  <div className="text-[11px] text-text-primary font-medium">
                    Evidence for {recordDetails.record?.name || recordDetails.canonical_key}
                  </div>
                  {(recordDetails.evidence || []).map((item) => (
                    <div key={item.id} className="border border-forge-border rounded-lg p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-text-primary">{item.field_key}</span>
                        <span className={item.is_official ? 'text-emerald-300' : 'text-amber-300'}>
                          {item.is_official ? 'official' : 'unverified'}
                        </span>
                      </div>
                      <div className="text-text-secondary mt-1">{item.claim_text}</div>
                      <div className="text-text-muted mt-1 break-all">{item.source_url}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-text-muted">Select a record to inspect evidence.</div>
              )}
            </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default ResearchWorkspace;
