import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import api from '../../utils/electronAPI';
import { useAppStore } from '../../stores/appStore';
import { RESEARCH_DEPTH_PRESETS, DEFAULT_DEPTH } from './researchPresets';
import './ResearchWorkspace.css';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(value) {
  if (!value) return 'just now';
  const at = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(at)) return 'just now';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'running') return 'border-sky-400/30 bg-sky-500/15 text-sky-300';
  if (s === 'completed') return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300';
  if (s === 'paused') return 'border-amber-400/30 bg-amber-500/15 text-amber-300';
  if (s === 'cancelled' || s === 'error') return 'border-rose-400/30 bg-rose-500/15 text-rose-300';
  return 'border-forge-border bg-forge-hover text-text-secondary';
}

function qualityBadgeClass(score = 0) {
  const value = Number(score || 0);
  if (value >= 85) return 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300';
  if (value >= 70) return 'border-sky-400/35 bg-sky-500/12 text-sky-300';
  if (value >= 55) return 'border-amber-400/35 bg-amber-500/12 text-amber-300';
  return 'border-rose-400/35 bg-rose-500/12 text-rose-300';
}

function formatPercent(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 100)}%`;
}

const STAGE_LABELS = {
  intent_compile: 'Intent',
  retrieve: 'Retrieve',
  verify: 'Verify',
  synthesize: 'Synthesize',
  gate: 'Gate',
};

function stageTone(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300';
  if (normalized === 'running') return 'border-sky-400/30 bg-sky-500/10 text-sky-300';
  if (normalized === 'failed' || normalized === 'blocked') return 'border-rose-400/30 bg-rose-500/10 text-rose-300';
  return 'border-forge-border/40 bg-forge-surface/40 text-text-secondary';
}

function phaseIcon(phase) {
  switch (phase) {
    case 'plan': return <Zap size={13} className="text-violet-400" />;
    case 'search': return <Search size={13} className="text-sky-400" />;
    case 'read': return <Globe size={13} className="text-teal-400" />;
    case 'analyze': return <BookOpen size={13} className="text-amber-400" />;
    case 'synthesis': return <FileText size={13} className="text-emerald-400" />;
    case 'progress': return <MessageSquare size={13} className="text-sky-300" />;
    default: return <Search size={13} className="text-text-secondary" />;
  }
}

function activityToneClass(status = '') {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'border-emerald-400/20 bg-emerald-500/8';
  if (s === 'started') return 'border-sky-400/20 bg-sky-500/8';
  if (s === 'failed') return 'border-rose-400/20 bg-rose-500/8';
  return 'border-forge-border/50 bg-forge-hover/40';
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function DepthSelector({ value, onChange }) {
  const presets = Object.values(RESEARCH_DEPTH_PRESETS);
  return (
    <div className="flex gap-2">
      {presets.map((preset) => (
        <button
          key={preset.key}
          onClick={() => onChange(preset.key)}
          className={`
            flex-1 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all text-left
            ${value === preset.key
              ? 'border-sky-400/40 bg-sky-500/15 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.1)]'
              : 'border-forge-border/60 bg-forge-surface/50 text-text-secondary hover:border-forge-border hover:bg-forge-hover/60'}
          `}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span>{preset.icon}</span>
            <span className="font-semibold">{preset.label}</span>
          </div>
          <div className="text-[10px] opacity-70">{preset.description}</div>
        </button>
      ))}
    </div>
  );
}

function ActivityFeed({ activities = [], progressSummaries = [] }) {
  const feedRef = useRef(null);
  const items = useMemo(() => {
    const all = [...(activities || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));
    return all.slice(-80);
  }, [activities]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [items.length]);

  if (items.length === 0 && (!progressSummaries || progressSummaries.length === 0)) {
    return (
      <div className="flex items-center justify-center h-32 text-text-secondary text-xs">
        Activity will appear here when research starts...
      </div>
    );
  }

  return (
    <div ref={feedRef} className="research-scroll space-y-1 max-h-[500px] overflow-y-auto pr-1">
      {progressSummaries?.map((ps, i) => (
        <div key={`ps-${i}`} className="research-chat-agent rounded-lg px-3 py-2 text-xs text-sky-100">
          <div className="flex items-center gap-1.5 mb-1">
            <MessageSquare size={12} className="text-sky-400" />
            <span className="text-[10px] text-text-secondary">{formatRelativeTime(ps.at)}</span>
          </div>
          <p className="leading-relaxed">{ps.text}</p>
        </div>
      ))}
      {items.map((item) => (
        <div
          key={item.id || item.seq}
          className={`rounded-md border px-2.5 py-1.5 text-[11px] ${activityToneClass(item.status)}`}
        >
          <div className="flex items-center gap-1.5">
            {phaseIcon(item.phase)}
            <span className="font-medium text-text-primary flex-1 truncate">
              {item.summary || item.phaseLabel || item.phase}
            </span>
            <span className="text-[10px] text-text-secondary shrink-0">
              {formatRelativeTime(item.at)}
            </span>
          </div>
          {item.details && (
            <div className="mt-0.5 text-[10px] text-text-secondary pl-5 truncate">{item.details}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SourcesPanel({ sources = [] }) {
  const [expanded, setExpanded] = useState(true);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="research-card rounded-xl p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Globe size={14} className="text-teal-400" />
        <span className="text-xs font-semibold text-text-primary">Sources Read ({sources.length})</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 max-h-64 overflow-y-auto research-scroll">
          {sources.map((s, i) => (
            <div key={`${s.url}-${i}`} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-forge-hover/50 text-[11px]">
              <Globe size={11} className="text-text-secondary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text-primary truncate">{s.title || s.domain || s.url}</div>
                <div className="text-[10px] text-text-secondary truncate">{s.domain || s.url}</div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                  {s.isOfficial ? (
                    <span className="px-1 py-0.5 rounded border border-emerald-400/35 bg-emerald-500/10 text-emerald-300">official</span>
                  ) : null}
                  {s.sourceTier ? (
                    <span className="px-1 py-0.5 rounded border border-forge-border/50 bg-forge-surface/50 text-text-secondary">{s.sourceTier}</span>
                  ) : null}
                  {Number.isFinite(Number(s.sourceQuality)) ? (
                    <span className="text-text-secondary/80">q:{Math.round(Number(s.sourceQuality) * 100)}</span>
                  ) : null}
                </div>
              </div>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 shrink-0">
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FindingsPanel({ findings = [] }) {
  const [expanded, setExpanded] = useState(true);
  if (!findings || findings.length === 0) return null;
  return (
    <div className="research-card rounded-xl p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <BookOpen size={14} className="text-amber-400" />
        <span className="text-xs font-semibold text-text-primary">Key Findings ({findings.length})</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 max-h-80 overflow-y-auto research-scroll">
          {findings.map((f, i) => (
            <div key={f.id || i} className="px-2.5 py-2 rounded-md border border-forge-border/40 bg-forge-surface/40 text-[11px]">
              <p className="text-text-primary leading-relaxed">{f.text}</p>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-text-secondary">
                {f.category && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/20 text-amber-300">
                    {f.category}
                  </span>
                )}
                {f.sourceDomain && (
                  <span className="truncate">{f.sourceDomain}</span>
                )}
                {Number(f.relevanceScore || 0) > 0 ? (
                  <span className="text-text-secondary/80">rel:{Math.round(Number(f.relevanceScore || 0) * 100)}</span>
                ) : null}
                {f.sourceTier ? (
                  <span className="text-text-secondary/80">{f.sourceTier}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportView({ report }) {
  const [copied, setCopied] = useState(false);
  if (!report || !report.text) return null;
  const handleCopy = () => {
    navigator.clipboard.writeText(report.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="research-card rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-forge-border/40">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-emerald-400" />
          <span className="text-xs font-semibold text-text-primary">Research Report</span>
          {report.mode && (
            <span className="text-[10px] text-text-secondary">({report.mode})</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="px-2 py-1 rounded-md text-[11px] border border-forge-border/50 bg-forge-surface/50 text-text-secondary hover:text-text-primary hover:bg-forge-hover transition-colors flex items-center gap-1"
          >
            {copied ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="px-4 py-3 max-h-[600px] overflow-y-auto research-scroll">
        <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed text-text-primary whitespace-pre-wrap">
          {report.text}
        </div>
      </div>
      {report.warning && (
        <div className="px-4 py-2 border-t border-amber-400/20 bg-amber-500/5 text-[11px] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle size={12} />
          {report.warning}
        </div>
      )}
    </div>
  );
}

function StatsBar({ stats = {}, goalProgress = {}, totalFindings = 0, totalSources = 0, convergenceCount = 0, convergenceThreshold = 5 }) {
  const current = goalProgress?.current || {};
  const goals = goalProgress?.goals || {};
  return (
    <div className="flex flex-wrap gap-3 text-[11px]">
      <div className="flex items-center gap-1.5 text-text-secondary">
        <Search size={11} className="text-sky-400" />
        <span>{stats.searchesIssued || 0} searches</span>
        {goals.maxQueries > 0 && (
          <span className="text-text-secondary/60">/ {goals.maxQueries}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-text-secondary">
        <Globe size={11} className="text-teal-400" />
        <span>{totalSources || stats.sourcesRead || 0} sources</span>
        {goals.maxSourcesRead > 0 && (
          <span className="text-text-secondary/60">/ {goals.maxSourcesRead}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-text-secondary">
        <BookOpen size={11} className="text-amber-400" />
        <span>{totalFindings || stats.findingsExtracted || 0} findings</span>
      </div>
      {current.elapsedMinutes > 0 && (
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Clock size={11} />
          <span>{Math.round(current.elapsedMinutes * 10) / 10}m</span>
          {goals.maxRuntimeMinutes > 0 && (
            <span className="text-text-secondary/60">/ {goals.maxRuntimeMinutes}m</span>
          )}
        </div>
      )}
    </div>
  );
}

function ReliabilityCard({ quality = null, stats = {} }) {
  if (!quality) return null;
  const issues = Array.isArray(quality.issues) ? quality.issues : [];
  return (
    <div className="research-card rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-text-primary">Reliability</div>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${qualityBadgeClass(quality.score)}`}>
          {quality.grade} {Number(quality.score || 0)}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div className="px-2 py-1 rounded border border-forge-border/40 bg-forge-surface/40 text-text-secondary">
          <div className="opacity-70">Official Ratio</div>
          <div className="text-text-primary font-medium">{quality.sourceCount > 0 ? formatPercent(quality.officialSources / quality.sourceCount) : 'n/a'}</div>
        </div>
        <div className="px-2 py-1 rounded border border-forge-border/40 bg-forge-surface/40 text-text-secondary">
          <div className="opacity-70">Citation Coverage</div>
          <div className="text-text-primary font-medium">{formatPercent(quality.citationCoverage)}</div>
        </div>
        <div className="px-2 py-1 rounded border border-forge-border/40 bg-forge-surface/40 text-text-secondary">
          <div className="opacity-70">Rejected</div>
          <div className="text-text-primary font-medium">{(stats.rejectedBlocked || 0) + (stats.rejectedNonOfficial || 0) + (stats.rejectedIrrelevant || 0)}</div>
        </div>
        <div className="px-2 py-1 rounded border border-forge-border/40 bg-forge-surface/40 text-text-secondary">
          <div className="opacity-70">Dropped Findings</div>
          <div className="text-text-primary font-medium">{stats.droppedFindings || 0}</div>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="mt-2 text-[10px] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle size={11} />
          <span className="truncate">Issues: {issues.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function StageStatusCard({ stageOrder = [] }) {
  if (!Array.isArray(stageOrder) || stageOrder.length === 0) return null;
  return (
    <div className="research-card rounded-xl p-3">
      <div className="text-xs font-semibold text-text-primary mb-2">Pipeline Stages</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {stageOrder.map((stage) => (
          <div
            key={stage.stageId}
            className={`rounded-md border px-2 py-1 text-[10px] ${stageTone(stage.status)}`}
          >
            <div className="font-semibold">{STAGE_LABELS[stage.stageId] || stage.stageId}</div>
            <div className="opacity-80 capitalize">{stage.status || 'pending'}</div>
            {typeof stage.pass === 'boolean' && (
              <div className="opacity-70">{stage.pass ? 'pass' : 'fail'}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssumptionsCard({ assumptions = [] }) {
  if (!Array.isArray(assumptions) || assumptions.length === 0) return null;
  return (
    <div className="research-card rounded-xl p-3">
      <div className="text-xs font-semibold text-text-primary mb-2">Assumptions</div>
      <div className="space-y-1.5 max-h-44 overflow-y-auto research-scroll">
        {assumptions.slice(-8).map((item, idx) => (
          <div key={`${item.code || 'assumption'}-${idx}`} className="text-[11px] rounded-md border border-forge-border/40 bg-forge-surface/40 px-2 py-1.5">
            <div className="text-text-primary">{item.text || item.code || 'assumption'}</div>
            {item.createdAt && (
              <div className="text-[10px] text-text-secondary mt-0.5">{formatRelativeTime(item.createdAt)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PolicyViolationsCard({ violations = [], onRerunRelaxed }) {
  if (!Array.isArray(violations) || violations.length === 0) return null;
  return (
    <div className="research-card rounded-xl p-3 border border-amber-400/20 bg-amber-500/5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-amber-300">Policy Blocks</div>
        {typeof onRerunRelaxed === 'function' && (
          <button
            onClick={onRerunRelaxed}
            className="px-2 py-1 rounded-md text-[10px] border border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors flex items-center gap-1"
            title="Rerun with balanced source policy"
          >
            <RefreshCw size={10} />
            Rerun Balanced
          </button>
        )}
      </div>
      <div className="space-y-1.5 max-h-44 overflow-y-auto research-scroll">
        {violations.slice(-12).map((item, idx) => (
          <div key={`${item.id || item.code}-${idx}`} className="rounded-md border border-amber-400/20 bg-forge-surface/40 px-2 py-1.5 text-[11px]">
            <div className="text-amber-200">{item.reason || item.code || 'blocked source'}</div>
            <div className="text-[10px] text-text-secondary mt-0.5 truncate">
              {item.domain || item.url || 'unknown source'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunHistoryItem({ run, isActive, onSelect }) {
  return (
    <button
      onClick={() => onSelect(run.id)}
      className={`
        w-full text-left px-3 py-2 rounded-lg border text-xs transition-all
        ${isActive
          ? 'border-sky-400/30 bg-sky-500/10'
          : 'border-forge-border/40 bg-forge-surface/30 hover:bg-forge-hover/50'}
      `}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${statusBadgeClass(run.status)}`}>
          {run.status}
        </span>
        <span className="text-[10px] text-text-secondary">{formatRelativeTime(run.createdAt || run.created_at)}</span>
      </div>
      <div className="text-text-primary truncate font-medium">{run.question || run.objective || 'Untitled run'}</div>
      <div className="text-[10px] text-text-secondary mt-0.5">
        {run.stats?.searchesIssued || 0} searches, {run.totalFindings || run.stats?.findingsExtracted || 0} findings
        {run.quality?.grade ? `, ${run.quality.grade} ${run.quality.score || 0}` : ''}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function ResearchWorkspace({ workspace = 'research' }) {
  // Projects
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');

  // Research question + settings
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [isStarting, setIsStarting] = useState(false);

  // Runs
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [showRunHistory, setShowRunHistory] = useState(false);

  // Steering
  const [steerInput, setSteerInput] = useState('');
  const [isSteering, setIsSteering] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState('activity');
  const [notice, setNotice] = useState('');
  const promoteResearchContext = useAppStore((state) => state.promoteResearchContext);

  const selectedProjectIdRef = useRef(selectedProjectId);
  const selectedRunIdRef = useRef(selectedRunId);

  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);
  useEffect(() => { selectedRunIdRef.current = selectedRunId; }, [selectedRunId]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  /* -- Active run -------------------------------------------------- */

  const activeRun = useMemo(() => {
    if (!runs.length) return null;
    if (selectedRunId) return runs.find((r) => r.id === selectedRunId) || null;
    return runs.find((r) => r.status === 'running') || runs[0];
  }, [runs, selectedRunId]);

  const isRunActive = activeRun && (activeRun.status === 'running' || activeRun.status === 'paused');

  /* -- Data loading ------------------------------------------------- */

  const refreshProjects = useCallback(async (preferredId = null) => {
    const list = await api.research.listProjects(workspace);
    const normalized = Array.isArray(list) ? list : [];
    setProjects(normalized);
    setSelectedProjectId((current) => {
      const candidate = preferredId || current;
      if (candidate && normalized.some((p) => p.id === candidate)) return candidate;
      return normalized[0]?.id || null;
    });
  }, [workspace]);

  const refreshRuns = useCallback(async (projectId = selectedProjectIdRef.current) => {
    if (!projectId) { setRuns([]); setSelectedRunId(null); return; }
    const list = await api.research.listRuns(projectId, 200);
    const normalized = Array.isArray(list) ? list : [];
    setRuns(normalized);
    setSelectedRunId((current) => {
      if (current && normalized.some((r) => r.id === current)) return current;
      const running = normalized.find((r) => r.status === 'running');
      return running?.id || normalized[0]?.id || null;
    });
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId);
      setProjectName(project?.name || '');
      refreshRuns(selectedProjectId);
    } else {
      setRuns([]);
      setSelectedRunId(null);
    }
  }, [selectedProjectId, projects, refreshRuns]);

  /* -- Progress subscription --------------------------------------- */

  useEffect(() => {
    const unsubscribe = api.research.onRunProgress((payload) => {
      if (!payload?.id) return;
      setRuns((prev) => {
        const next = [...prev];
        const idx = next.findIndex((r) => r.id === payload.id);
        if (idx >= 0) next[idx] = { ...next[idx], ...payload };
        else next.unshift(payload);
        return next;
      });
      if (!selectedRunIdRef.current) setSelectedRunId(payload.id);
      if (['completed', 'error', 'cancelled'].includes(payload.status)) {
        refreshRuns(selectedProjectIdRef.current);
      }
    });
    return () => unsubscribe?.();
  }, [refreshRuns]);

  /* -- Notice auto-dismiss ----------------------------------------- */

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* -- Actions ------------------------------------------------------ */

  const handleCreateProject = useCallback(async () => {
    const name = `Research ${new Date().toLocaleDateString()}`;
    const result = await api.research.createProject({ workspace, name, description: '' });
    if (result?.success) {
      await refreshProjects(result.id);
      setNotice('Project created');
    }
  }, [workspace, refreshProjects]);

  const handleDeleteProject = useCallback(async () => {
    if (!selectedProjectId) return;
    const result = await api.research.deleteProject(selectedProjectId);
    if (result?.success) {
      setSelectedProjectId(null);
      await refreshProjects();
      setNotice('Project deleted');
    }
  }, [selectedProjectId, refreshProjects]);

  const handleStartRun = useCallback(async () => {
    if (!selectedProjectId || !question.trim()) return;
    setIsStarting(true);
    try {
      const preset = RESEARCH_DEPTH_PRESETS[depth] || RESEARCH_DEPTH_PRESETS.standard;
      const sourcePolicy = selectedProject?.source_policy || {};
      const result = await api.research.startRun({
        projectId: selectedProjectId,
        objective: question.trim(),
        intent: question.trim(),
        jurisdiction: 'auto',
        sourcePolicy,
        settings: preset.settings,
        workerCount: 3,
      });
      if (result?.success && result.run) {
        setSelectedRunId(result.run.id);
        setNotice('Research started');
      } else {
        setNotice(result?.error || 'Failed to start research');
      }
    } catch (err) {
      setNotice(String(err?.message || 'Failed to start research'));
    } finally {
      setIsStarting(false);
    }
  }, [selectedProjectId, question, depth, selectedProject]);

  const handleRerunBalancedPolicy = useCallback(async () => {
    if (!selectedProjectId || !activeRun?.question) return;
    setIsStarting(true);
    try {
      const preset = RESEARCH_DEPTH_PRESETS[depth] || RESEARCH_DEPTH_PRESETS.standard;
      const result = await api.research.startRun({
        projectId: selectedProjectId,
        objective: activeRun.question,
        intent: activeRun.intent || activeRun.question,
        jurisdiction: activeRun.jurisdiction || 'auto',
        sourcePolicy: {
          ...(selectedProject?.source_policy || {}),
          mode: 'balanced',
          allowSecondary: true,
          rejectTertiary: false,
        },
        settings: preset.settings,
        workerCount: Number(activeRun.workerCount || 3),
      });
      if (result?.success && result.run) {
        setSelectedRunId(result.run.id);
        setNotice('Rerun started with balanced source policy');
      } else {
        setNotice(result?.error || 'Failed to rerun with balanced policy');
      }
    } catch (err) {
      setNotice(String(err?.message || 'Failed to rerun with balanced policy'));
    } finally {
      setIsStarting(false);
    }
  }, [selectedProjectId, activeRun, depth, selectedProject]);

  const handlePause = useCallback(async () => {
    if (!activeRun?.id) return;
    await api.research.pauseRun(activeRun.id);
  }, [activeRun]);

  const handleResume = useCallback(async () => {
    if (!activeRun?.id) return;
    await api.research.resumeRun(activeRun.id);
  }, [activeRun]);

  const handleCancel = useCallback(async () => {
    if (!activeRun?.id) return;
    await api.research.cancelRun(activeRun.id);
  }, [activeRun]);

  const handleSteer = useCallback(async () => {
    if (!activeRun?.id || !steerInput.trim()) return;
    setIsSteering(true);
    try {
      await api.research.steerRun(activeRun.id, steerInput.trim());
      setSteerInput('');
      setNotice('Steering instruction sent');
    } catch (_err) {
      setNotice('Failed to steer run');
    } finally {
      setIsSteering(false);
    }
  }, [activeRun, steerInput]);

  const handleCopyReport = useCallback(() => {
    if (activeRun?.report?.text) {
      navigator.clipboard.writeText(activeRun.report.text);
      setNotice('Report copied to clipboard');
    }
  }, [activeRun]);

  const handlePromoteContext = useCallback((target) => {
    if (!activeRun || typeof promoteResearchContext !== 'function') return;
    const summary = String(
      activeRun.report?.text
      || activeRun.recentFindings?.map((item) => item.text).slice(0, 5).join(' ')
      || activeRun.question
      || ''
    ).trim().slice(0, 1800);
    const citations = Array.isArray(activeRun.sourcesRead)
      ? activeRun.sourcesRead.map((item) => item.url).filter(Boolean).slice(0, 20)
      : [];
    promoteResearchContext({
      runId: activeRun.id,
      title: activeRun.question || 'Research run',
      summary,
      citations,
      target: String(target || '').toLowerCase() === 'code' ? 'code' : 'casual',
      metadata: {
        quality: activeRun.quality || null,
        qualityGate: activeRun.qualityGate || null,
        relevanceScore: Number(activeRun.relevanceScore || 0),
        jurisdictionMatch: activeRun.jurisdictionMatch ?? null,
      },
    });
    setNotice(`Promoted research context to ${target === 'code' ? 'Coding' : 'Casual'} workspace`);
  }, [activeRun, promoteResearchContext]);

  /* -- Keyboard shortcuts ------------------------------------------- */

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isStarting && question.trim() && selectedProjectId) {
      e.preventDefault();
      handleStartRun();
    }
  }, [handleStartRun, isStarting, question, selectedProjectId]);

  const handleSteerKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && steerInput.trim()) {
      e.preventDefault();
      handleSteer();
    }
  }, [handleSteer, steerInput]);

  /* -- Render ------------------------------------------------------- */

  const domainStats = activeRun?.domainStats || [];

  return (
    <div className="research-workspace flex flex-col w-full h-full min-h-0 text-text-primary">
      {/* Header */}
      <div className="research-header px-4 py-3 border-b border-forge-border/30 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Search size={18} className="text-sky-400" />
            <h1 className="text-base font-bold text-text-primary">Deep Research</h1>
            {/* Project selector */}
            <select
              value={selectedProjectId || ''}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
              className="ml-2 px-2 py-1 rounded-md bg-forge-surface/80 border border-forge-border/40 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-sky-400/40"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateProject}
              className="px-2.5 py-1 rounded-md text-[11px] border border-forge-border/50 bg-forge-surface/50 text-text-secondary hover:text-text-primary hover:bg-forge-hover transition-colors flex items-center gap-1"
            >
              <Plus size={12} />
              New Project
            </button>
            {selectedProjectId && (
              <button
                onClick={handleDeleteProject}
                className="px-2 py-1 rounded-md text-[11px] border border-rose-400/20 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            )}
            <button
              onClick={() => setShowRunHistory(!showRunHistory)}
              className="px-2.5 py-1 rounded-md text-[11px] border border-forge-border/50 bg-forge-surface/50 text-text-secondary hover:text-text-primary hover:bg-forge-hover transition-colors flex items-center gap-1"
            >
              <Clock size={12} />
              History
            </button>
          </div>
        </div>
      </div>

      {/* Notice banner */}
      {notice && (
        <div className="px-4 py-1.5 bg-sky-500/10 border-b border-sky-400/20 text-xs text-sky-200">
          {notice}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: main area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto research-scroll">
          {/* Composer */}
          {!isRunActive && (
            <div className="p-4 space-y-3">
              <div className="research-card rounded-xl p-4 space-y-3">
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  What would you like me to research?
                </label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter your research question... (Ctrl+Enter to start)"
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg bg-forge-bg/80 border border-forge-border/40 text-sm text-text-primary placeholder-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-sky-400/40 focus:border-sky-400/40"
                />
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-1.5">Research Depth</label>
                  <DepthSelector value={depth} onChange={setDepth} />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-[10px] text-text-secondary/60">
                    {RESEARCH_DEPTH_PRESETS[depth]?.settings?.maxQueries || 0} queries max,{' '}
                    {RESEARCH_DEPTH_PRESETS[depth]?.settings?.maxSourcesRead || 0} sources max,{' '}
                    {RESEARCH_DEPTH_PRESETS[depth]?.settings?.maxRuntimeMinutes || 0} min limit
                  </div>
                  <button
                    onClick={handleStartRun}
                    disabled={isStarting || !question.trim() || !selectedProjectId}
                    className="px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5
                      bg-sky-500 text-white hover:bg-sky-400 shadow-lg shadow-sky-500/20
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {isStarting ? (
                      <><Loader2 size={13} className="animate-spin" /> Starting...</>
                    ) : (
                      <><Search size={13} /> Start Research</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active run display */}
          {activeRun && (
            <div className="p-4 space-y-3">
              {/* Run header */}
              <div className="research-card rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusBadgeClass(activeRun.status)}`}>
                        {activeRun.status === 'running' && <Loader2 size={10} className="inline-block animate-spin mr-1" />}
                        {activeRun.status}
                      </span>
                    </div>
                    <h2 className="text-sm font-semibold text-text-primary">{activeRun.question || activeRun.objective || 'Research run'}</h2>
                  </div>
                  {/* Run controls */}
                  <div className="flex items-center gap-1.5 ml-3 shrink-0">
                    {activeRun.status === 'running' && (
                      <button onClick={handlePause} className="p-1.5 rounded-md border border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors" title="Pause">
                        <Pause size={14} />
                      </button>
                    )}
                    {activeRun.status === 'paused' && (
                      <button onClick={handleResume} className="p-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors" title="Resume">
                        <Play size={14} />
                      </button>
                    )}
                    {isRunActive && (
                      <button onClick={handleCancel} className="p-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors" title="Cancel">
                        <Square size={14} />
                      </button>
                    )}
                    {activeRun.report?.text && (
                      <button onClick={handleCopyReport} className="p-1.5 rounded-md border border-forge-border/40 text-text-secondary hover:text-text-primary hover:bg-forge-hover transition-colors" title="Copy report">
                        <Copy size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handlePromoteContext('casual')}
                      className="px-2 py-1 rounded-md text-[10px] border border-forge-border/40 text-text-secondary hover:text-text-primary hover:bg-forge-hover transition-colors"
                      title="Promote run context to Casual workspace"
                    >
                      To Casual
                    </button>
                    <button
                      onClick={() => handlePromoteContext('code')}
                      className="px-2 py-1 rounded-md text-[10px] border border-forge-border/40 text-text-secondary hover:text-text-primary hover:bg-forge-hover transition-colors"
                      title="Promote run context to Code workspace"
                    >
                      To Code
                    </button>
                  </div>
                </div>
                <StatsBar
                  stats={activeRun.stats || {}}
                  goalProgress={activeRun.goalProgress}
                  totalFindings={activeRun.totalFindings}
                  totalSources={activeRun.totalSources}
                  convergenceCount={activeRun.convergenceCount}
                  convergenceThreshold={activeRun.convergenceThreshold}
                />
                <div className="mt-2">
                  <ReliabilityCard quality={activeRun.quality} stats={activeRun.stats || {}} />
                </div>
                <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <StageStatusCard stageOrder={activeRun.stageOrder || []} />
                  <AssumptionsCard assumptions={activeRun.assumptions || []} />
                </div>
                <div className="mt-2">
                  <PolicyViolationsCard
                    violations={activeRun.policyViolations || []}
                    onRerunRelaxed={handleRerunBalancedPolicy}
                  />
                </div>
              </div>

              {/* Steering input (when run is active) */}
              {isRunActive && (
                <div className="research-card rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={steerInput}
                      onChange={(e) => setSteerInput(e.target.value)}
                      onKeyDown={handleSteerKeyDown}
                      placeholder="Steer research: add a topic, refine focus..."
                      className="flex-1 px-3 py-1.5 rounded-md bg-forge-bg/60 border border-forge-border/30 text-xs text-text-primary placeholder-text-secondary/40 focus:outline-none focus:ring-1 focus:ring-sky-400/30"
                    />
                    <button
                      onClick={handleSteer}
                      disabled={isSteering || !steerInput.trim()}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-sky-500/20 text-sky-300 border border-sky-400/30 hover:bg-sky-500/30 disabled:opacity-40 transition-colors"
                    >
                      {isSteering ? <Loader2 size={12} className="animate-spin" /> : 'Steer'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <div className="flex items-center gap-1 px-1">
                {['activity', 'findings', 'sources', 'report'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`
                      px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize
                      ${activeTab === tab
                        ? 'bg-sky-500/15 text-sky-300 border border-sky-400/30'
                        : 'text-text-secondary hover:text-text-primary hover:bg-forge-hover/50 border border-transparent'}
                    `}
                  >
                    {tab}
                    {tab === 'findings' && activeRun.totalFindings > 0 && (
                      <span className="ml-1 text-[10px] opacity-70">({activeRun.totalFindings})</span>
                    )}
                    {tab === 'sources' && activeRun.totalSources > 0 && (
                      <span className="ml-1 text-[10px] opacity-70">({activeRun.totalSources})</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="min-h-[200px]">
                {activeTab === 'activity' && (
                  <ActivityFeed
                    activities={activeRun.recentActivity || []}
                    progressSummaries={activeRun.progressSummaries || []}
                  />
                )}
                {activeTab === 'findings' && (
                  <FindingsPanel findings={activeRun.recentFindings || []} />
                )}
                {activeTab === 'sources' && (
                  <SourcesPanel sources={activeRun.sourcesRead || []} />
                )}
                {activeTab === 'report' && (
                  <ReportView report={activeRun.report} />
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!activeRun && !isStarting && projects.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
              <Search size={48} className="text-text-secondary/30 mb-4" />
              <h2 className="text-lg font-semibold text-text-primary mb-1">Deep Research</h2>
              <p className="text-sm text-text-secondary mb-4">
                Ask any question and get a comprehensive, LLM-powered research report with sources.
              </p>
              <button
                onClick={handleCreateProject}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 text-white hover:bg-sky-400 transition-colors flex items-center gap-1.5"
              >
                <Plus size={13} />
                Create Research Project
              </button>
            </div>
          )}
        </div>

        {/* Right sidebar: Run history + domain stats */}
        {showRunHistory && (
          <div className="w-72 border-l border-forge-border/30 bg-forge-surface/20 overflow-y-auto research-scroll shrink-0">
            <div className="p-3 space-y-2">
              <h3 className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1.5">
                <Clock size={12} />
                Run History
              </h3>
              {runs.length === 0 && (
                <div className="text-[11px] text-text-secondary/50 text-center py-4">No runs yet</div>
              )}
              {runs.map((run) => (
                <RunHistoryItem
                  key={run.id}
                  run={run}
                  isActive={run.id === activeRun?.id}
                  onSelect={(id) => setSelectedRunId(id)}
                />
              ))}
            </div>

            {/* Domain stats */}
            {domainStats.length > 0 && (
              <div className="p-3 border-t border-forge-border/30">
                <h3 className="text-xs font-semibold text-text-secondary mb-2 flex items-center gap-1.5">
                  <Globe size={12} />
                  Top Domains
                </h3>
                <div className="space-y-1">
                  {domainStats.slice(0, 10).map((d) => (
                    <div key={d.domain} className="flex items-center justify-between text-[11px]">
                      <span className="text-text-primary truncate">{d.domain}</span>
                      <span className="text-text-secondary shrink-0 ml-2">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ResearchWorkspace;
