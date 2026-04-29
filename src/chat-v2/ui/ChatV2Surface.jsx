import { useCallback, useEffect, useMemo, useRef, useState, memo, lazy, Suspense } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Briefcase,
  CheckCircle,
  Code2,
  Compass,
  Cpu,
  GitBranch,
  Globe,
  MessageCircle,
  Paperclip,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  SlidersHorizontal,
  Square,
  Unplug,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useChatV2SessionStore } from '../../stores/chatV2SessionStore';
import { useToastStore } from '../../stores/toastStore';
import { safeCall } from '../../utils/electronAPI';
import { ModelExperienceWorkbench } from './ModelExperienceWorkbench';

const StreamingMarkdown = lazy(() =>
  import('./StreamingMarkdown').then((m) => ({
    default: m.StreamingMarkdown || m.default,
  }))
);

const WEB_SEARCH_PREF_KEY = 'researchWebSearchEnabled';
const THINK_LONGER_PREF_KEY = 'chatV2ThinkLongerEnabled';

const CTX_LENGTH_CHOICES = [
  { label: 'Auto', tokens: null },
  { label: '4K', tokens: 4096 },
  { label: '8K', tokens: 8192 },
  { label: '16K', tokens: 16384 },
  { label: '32K', tokens: 32768 },
  { label: '64K', tokens: 65536 },
  { label: '128K', tokens: 131072 },
];

const BACKEND_OVERRIDE_CHOICES = [
  { value: '', label: 'Backend: auto' },
  { value: 'ollama-cuda', label: 'NVIDIA GPU' },
  { value: 'ollama-cpu', label: 'CPU' },
  { value: 'llamanode', label: 'llama.cpp' },
  { value: 'openvino-npu', label: 'Intel NPU' },
  { value: 'openvino-gpu', label: 'Intel iGPU' },
  { value: 'openvino-hybrid', label: 'Unified Brain' },
  { value: 'llamacpp-vulkan', label: 'Intel Arc (Vulkan)' },
];

const TASK_INTENT_CHOICES = [
  { value: 'auto', label: 'Auto' },
  { value: 'chat', label: 'Chat' },
  { value: 'code', label: 'Code' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'creative', label: 'Creative' },
  { value: 'research', label: 'Research' },
];

const WORKSPACE_CHROME = {
  casual: {
    label: 'Casual',
    color: '#818cf8',
    Icon: MessageCircle,
    description: 'Quick chat, fresh answers, and low-friction exploration when you just need the app to help.',
  },
  work: {
    label: 'Work',
    color: '#10b981',
    Icon: Briefcase,
    description: 'Structured planning, drafting, and decision support with cleaner outputs and fewer dead ends.',
  },
  research: {
    label: 'Research',
    color: '#38bdf8',
    Icon: Compass,
    description: 'Source-grounded investigation, synthesis, and verification when the answer needs to hold up.',
  },
  code: {
    label: 'Code',
    color: '#f59e0b',
    Icon: Code2,
    description: 'Implementation, debugging, patch planning, and review with a more technical working surface.',
  },
};

function withAlpha(color, alpha) {
  if (typeof color !== 'string' || !color.startsWith('#')) return color;
  return `${color}${alpha}`;
}

function attachmentSignature(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  return attachments.map((attachment) => attachment?.id || attachment?.name || '').join('|');
}

function reasoningSignature(reasoning = null) {
  if (!reasoning || typeof reasoning !== 'object') return '';
  return [
    String(reasoning.content || reasoning.closedContent || ''),
    Number(reasoning.tokens) || 0,
    Number(reasoning.ms) || 0,
    reasoning.active ? '1' : '0',
  ].join('|');
}

function formatReasoningDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '0s';
  if (value < 1000) return `${Math.max(1, Math.round(value / 100)) / 10}s`;
  return `${Math.round(value / 1000)}s`;
}

function humanizePlanStep(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizePlanSteps(steps = [], fallback = 'Base defaults') {
  const normalized = Array.isArray(steps)
    ? steps.map(humanizePlanStep).filter(Boolean)
    : [];
  return normalized.length ? normalized.join(' > ') : fallback;
}

function formatTimelineEventType(value = '') {
  const normalized = String(value || 'note').trim();
  return humanizePlanStep(normalized || 'note');
}

function inferParamBillionsFromText(value = '') {
  const match = String(value || '').match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isLargeLocalGgufModel(model = '', modelInfo = null) {
  const text = [
    model,
    modelInfo?.name,
    modelInfo?.modelName,
    modelInfo?.path,
    modelInfo?.parameterSize,
  ].filter(Boolean).join(' ');
  const normalized = text.toLowerCase();
  if (!normalized.startsWith('gguf:') && !normalized.includes('.gguf')) return false;
  const billions = inferParamBillionsFromText(text);
  if (billions && billions >= 14) return true;
  return /(?:24b|30b|32b|33b|34b|70b|72b|104b)/i.test(text);
}

function formatDomain(url) {
  try {
    const host = new URL(String(url || '')).hostname.replace(/^www\./i, '');
    return host || '';
  } catch {
    return '';
  }
}

function WebSearchActivityFeed({ activity = [], active = false }) {
  const items = Array.isArray(activity) ? activity.slice(-8) : [];
  if (items.length === 0 && !active) return null;

  const latestRunning = active || items.some((item) => item?.status === 'running');

  return (
    <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/[0.035] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-sky-200/90">
          <Globe size={12} />
          Live web search
        </div>
        <span className="text-[10px] text-sky-200/45">
          {latestRunning ? 'working' : 'ready'}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.length === 0 && (
          <div className="flex items-start gap-2 text-[11px] leading-4">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-zinc-300/90">
                Waiting for search query...
              </div>
            </div>
          </div>
        )}
        {items.map((item) => {
          const status = String(item?.status || 'info');
          const isRunning = status === 'running';
          const isError = status === 'error';
          const isDone = status === 'done' || status === 'ok';
          const domain = formatDomain(item?.url);
          const meta = [
            domain,
            Number.isFinite(Number(item?.count)) ? `${Number(item.count)} result${Number(item.count) === 1 ? '' : 's'}` : null,
            Number.isFinite(Number(item?.tookMs)) && Number(item.tookMs) > 0 ? `${Math.round(Number(item.tookMs))}ms` : null,
          ].filter(Boolean).join(' · ');

          return (
            <div key={item.id || `${item.ts}-${item.message}`} className="flex items-start gap-2 text-[11px] leading-4">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  isError
                    ? 'bg-red-300'
                    : isDone
                      ? 'bg-emerald-300'
                      : 'bg-sky-300'
                } ${isRunning ? 'animate-pulse' : ''}`}
              />
              <div className="min-w-0 flex-1">
                <div className={`${isError ? 'text-red-200/85' : 'text-zinc-300/90'} truncate`} title={item?.message || ''}>
                  {item?.message || 'Searching...'}
                </div>
                {meta && (
                  <div className="truncate text-[10px] text-zinc-500" title={meta}>
                    {meta}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatReasoningStatus(reasoning = null) {
  if (!reasoning || typeof reasoning !== 'object' || !reasoning.active) return '';
  const tokens = Number(reasoning.tokens) || 0;
  const duration = formatReasoningDuration(reasoning.ms);
  return `Reasoning... ${tokens} tokens / ${duration}`;
}

function ReasoningPanel({ reasoning, className = '' }) {
  const content = String(reasoning?.closedContent || reasoning?.content || '').trim();
  if (!content) return null;
  const summary = [
    'View reasoning',
    Number(reasoning?.tokens) > 0 ? `${Number(reasoning.tokens)} tokens` : null,
    Number(reasoning?.ms) > 0 ? formatReasoningDuration(reasoning.ms) : null,
  ].filter(Boolean).join(' - ');

  return (
    <details className={`rounded-lg border border-white/[0.08] bg-black/20 ${className}`.trim()}>
      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-zinc-400 hover:text-zinc-200">
        {summary}
      </summary>
      <div className="border-t border-white/[0.06] px-3 py-2 text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
        <Suspense fallback={<div>{content}</div>}>
          <StreamingMarkdown content={content} />
        </Suspense>
      </div>
    </details>
  );
}

function buildStarterPrompts(workspace, canUseWebSearch) {
  if (workspace === 'code') {
    return [
      {
        title: 'Debug a failure',
        prompt: 'Help me debug this issue and propose the smallest safe fix.',
        detail: 'Good for logs, tracebacks, and broken flows.',
      },
      {
        title: 'Patch review',
        prompt: 'Review this approach for bugs, regressions, and missing tests.',
        detail: 'Focuses on practical code-review feedback.',
      },
      {
        title: 'Implementation plan',
        prompt: 'Turn this feature request into a concrete implementation plan with files and risks.',
        detail: 'Useful before editing or refactoring.',
      },
    ];
  }

  if (workspace === 'work') {
    return [
      {
        title: 'Action plan',
        prompt: 'Turn this situation into a prioritized action plan with owners and next steps.',
        detail: 'Great for organizing messy work quickly.',
      },
      {
        title: 'Draft update',
        prompt: 'Draft a concise stakeholder update with risks, progress, and asks.',
        detail: 'Keeps the tone sharp and professional.',
      },
      {
        title: 'Decision memo',
        prompt: 'Help me compare options, tradeoffs, and a recommended decision.',
        detail: 'Useful when you need a clean recommendation.',
      },
    ];
  }

  if (workspace === 'research') {
    return [
      {
        title: 'Investigate a topic',
        prompt: 'Research this topic, summarize the strongest findings, and cite the most relevant sources.',
        detail: 'Built for source-grounded digging.',
      },
      {
        title: 'Compare evidence',
        prompt: 'Find the strongest arguments on each side of this issue and note conflicts in the evidence.',
        detail: 'Helpful when sources disagree.',
      },
      {
        title: 'Verify freshness',
        prompt: 'What changed recently on this topic, and what should I verify before trusting the answer?',
        detail: 'Good for current events and unstable facts.',
      },
    ];
  }

  return [
    {
      title: canUseWebSearch ? 'Fresh info' : 'Quick help',
      prompt: canUseWebSearch
        ? "What's today's date and top news in the Middle East?"
        : 'Help me get oriented on this topic in plain language.',
      detail: canUseWebSearch
        ? 'A good smoke test for web grounding.'
        : 'Great for fast explanations without setup.',
    },
    {
      title: 'Plan something',
      prompt: 'Help me turn this into a simple, concrete plan I can actually follow.',
      detail: 'Useful when you know the goal but not the steps.',
    },
    {
      title: 'Make it simpler',
      prompt: 'Explain this clearly, cut the jargon, and tell me what matters most.',
      detail: 'Good when the model is technically right but hard to read.',
    },
  ];
}

const MessageRow = memo(function MessageRow({ message, onEditUser, onBranchFrom, accentColor }) {
  const isUser = message.role === 'user';
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const reasoning = !isUser && message?.reasoning ? message.reasoning : null;
  const userBubbleStyle = isUser
    ? {
        background: `linear-gradient(135deg, ${accentColor} 0%, ${withAlpha(accentColor, 'cc')} 100%)`,
      }
    : undefined;

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'} py-2`}>
      <div className={`flex max-w-[80%] flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={[
            'rounded-2xl px-4 py-3 text-sm leading-relaxed break-words',
            isUser
              ? 'text-white'
              : 'border border-white/[0.07] bg-[#0c0e16] text-zinc-200',
          ].join(' ')}
          style={userBubbleStyle}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <Suspense fallback={<div className="whitespace-pre-wrap">{message.content}</div>}>
              <StreamingMarkdown content={message.content} />
            </Suspense>
          )}

          {attachments.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="rounded-md border border-white/12 bg-black/20 px-2 py-0.5 text-[11px]"
                >
                  {att.name}
                </span>
              ))}
            </div>
          )}

          {!isUser && <ReasoningPanel reasoning={reasoning} className="mt-2.5" />}
        </div>

        <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {isUser && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition hover:text-zinc-300 hover:bg-white/[0.06]"
              onClick={() => onEditUser?.(message)}
              aria-label="Edit message"
            >
              <Pencil size={11} />
              Edit
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition hover:text-zinc-300 hover:bg-white/[0.06]"
            onClick={() => onBranchFrom?.(message.id)}
            aria-label="Create branch from this message"
          >
            <GitBranch size={11} />
            Branch
          </button>
        </div>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.accentColor === next.accentColor &&
  attachmentSignature(prev.message.attachments) === attachmentSignature(next.message.attachments) &&
  reasoningSignature(prev.message.reasoning) === reasoningSignature(next.message.reasoning)
));

function AttachmentChips({ files, onRemove }) {
  if (!Array.isArray(files) || files.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {files.map((file) => (
        <span
          key={file.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-200"
        >
          <span className="max-w-[220px] truncate">{file.name}</span>
          <button type="button" className="opacity-70 transition hover:opacity-100" onClick={() => onRemove(file.id)} aria-label={`Remove ${file.name}`}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

function ControlButton({ icon: Icon, label, color, active = false, onClick, disabled = false, busy = false }) {
  const activeStyle = active
    ? {
        borderColor: withAlpha(color, '35'),
        background: withAlpha(color, '18'),
        color,
      }
    : undefined;
  const LeadingIcon = busy ? RefreshCw : Icon;

  return (
    <button
      type="button"
      className={[
        'inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-medium transition-all',
        active
          ? ''
          : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-200 hover:border-white/14 hover:bg-white/[0.06]',
        'disabled:cursor-not-allowed disabled:opacity-40',
      ].join(' ')}
      style={activeStyle}
      onClick={onClick}
      disabled={disabled}
    >
      <LeadingIcon size={13} className={busy ? 'animate-spin' : ''} />
      <span>{label}</span>
    </button>
  );
}

function TelemetryCard({ icon: Icon, label, value, detail, color }) {
  return (
    <div
      className="rounded-2xl border px-3.5 py-3"
      style={{
        borderColor: withAlpha(color, '20'),
        background: `linear-gradient(180deg, ${withAlpha(color, '0a')} 0%, rgba(8,10,15,0.96) 100%)`,
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border"
          style={{
            borderColor: withAlpha(color, '30'),
            background: withAlpha(color, '14'),
            color,
          }}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
          <div className="mt-0.5 truncate text-[13px] font-medium text-zinc-200" title={value}>
            {value}
          </div>
        </div>
      </div>
      {detail && (
        <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-zinc-500 pl-11">
          {detail}
        </div>
      )}
    </div>
  );
}

function PromptCard({ title, detail, prompt, color, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(prompt)}
      className="group rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5 text-left transition-all duration-200 hover:border-white/16 hover:bg-white/[0.05]"
    >
      <div
        className="inline-flex rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] font-medium"
        style={{
          borderColor: withAlpha(color, '28'),
          background: withAlpha(color, '10'),
          color,
        }}
      >
        {title}
      </div>
      <div className="mt-2 text-[13px] font-medium leading-snug text-zinc-200 group-hover:text-white transition-colors">{prompt}</div>
      <div className="mt-1.5 text-[11px] leading-4 text-zinc-500">{detail}</div>
    </button>
  );
}

export function ChatV2Surface({ engine, title = 'Chat V2 (Standalone)' }) {
  const [state, setState] = useState(() => engine.getState());
  const [input, setInput] = useState('');
  const contextLengthTokens = useChatV2SessionStore((s) => s.contextLengthTokens);
  const setContextLengthTokens = useChatV2SessionStore((s) => s.setContextLengthTokens);
  const backendOverride = useChatV2SessionStore((s) => s.backendOverride);
  const setBackendOverride = useChatV2SessionStore((s) => s.setBackendOverride);
  const tuningMode = useChatV2SessionStore((s) => s.tuningMode);
  const setTuningMode = useChatV2SessionStore((s) => s.setTuningMode);
  const taskIntent = useChatV2SessionStore((s) => s.taskIntent);
  const setTaskIntent = useChatV2SessionStore((s) => s.setTaskIntent);
  const advancedOverrides = useChatV2SessionStore((s) => s.advancedOverrides);
  const setAdvancedOverride = useChatV2SessionStore((s) => s.setAdvancedOverride);
  const setAdvancedOverrides = useChatV2SessionStore((s) => s.setAdvancedOverrides);
  const resetAdvancedOverrides = useChatV2SessionStore((s) => s.resetAdvancedOverrides);
  const currentModelInfo = useAppStore((s) => s.currentModelInfo);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage?.getItem(WEB_SEARCH_PREF_KEY) === 'true';
  });
  // Default to vanilla chat settings; users can opt-in per session.
  const [thinkLongerEnabled, setThinkLongerEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage?.getItem(THINK_LONGER_PREF_KEY) === 'true';
  });
  const [isRefreshingRuntime, setIsRefreshingRuntime] = useState(false);
  const [isWarmingModel, setIsWarmingModel] = useState(false);
  const [runtimePanelOpen, setRuntimePanelOpen] = useState(false);
  const [modelHealthOpen, setModelHealthOpen] = useState(false);
  const [autopilotDetailsOpen, setAutopilotDetailsOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [activeModelPreset, setActiveModelPreset] = useState(null);
  const [isResettingPreset, setIsResettingPreset] = useState(false);
  const [loadConfidence, setLoadConfidence] = useState(null);
  const [lastKnownGoodProfile, setLastKnownGoodProfile] = useState(null);
  const [backendDecisionTimeline, setBackendDecisionTimeline] = useState([]);
  const [warmupResult, setWarmupResult] = useState(null);
  const lastRecordedLoadOutcomeRef = useRef('');
  const lastRecordedBackendDecisionRef = useRef('');
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    const unsub = engine.subscribe(setState);
    return unsub;
  }, [engine]);

  const workspaceId = String(state.workspace || 'casual');
  const workspaceChrome = WORKSPACE_CHROME[workspaceId] || WORKSPACE_CHROME.casual;
  const workspaceColor = workspaceChrome.color;
  const WorkspaceIcon = workspaceChrome.Icon;
  const canUseWebSearch = state.workspace === 'research' || state.workspace === 'casual' || state.workspace === 'work';
  const messages = useMemo(
    () => (Array.isArray(state.messages) ? state.messages : []),
    [state.messages]
  );
  const branches = Array.isArray(state.branches) ? state.branches : [];

  const resizeComposer = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    if (!canUseWebSearch && webSearchEnabled) {
      setWebSearchEnabled(false);
    }
  }, [canUseWebSearch, webSearchEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(WEB_SEARCH_PREF_KEY, webSearchEnabled ? 'true' : 'false');
  }, [webSearchEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage?.setItem(THINK_LONGER_PREF_KEY, thinkLongerEnabled ? 'true' : 'false');
  }, [thinkLongerEnabled]);

  useEffect(() => {
    if (isNearBottomRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: state.isGenerating ? 'auto' : 'smooth' });
    }
  }, [state.messages.length, state.streamingContent, state.streamingStatus, state.streamingReasoning, state.isGenerating]);

  useEffect(() => {
    resizeComposer();
  }, [input, resizeComposer]);

  useEffect(() => {
    let cancelled = false;
    async function loadActivePreset() {
      if (!state.model) {
        setActiveModelPreset(null);
        return;
      }
      const presets = await safeCall('getModelPresets', [state.model, state.workspace], []);
      if (cancelled) return;
      const active = Array.isArray(presets)
        ? (presets.find((preset) => preset?.is_default) || presets[0] || null)
        : null;
      setActiveModelPreset(active);
    }
    void loadActivePreset();
    return () => {
      cancelled = true;
    };
  }, [state.model, state.workspace, isSavingPreset, isResettingPreset]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof window === 'undefined') return undefined;

    const resizeTarget = el.parentElement || el;
    let frame = 0;
    const scheduleResize = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        resizeComposer();
      });
    };

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        scheduleResize();
      });
      observer.observe(resizeTarget);
    }

    window.addEventListener('resize', scheduleResize);
    scheduleResize();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
    };
  }, [resizeComposer]);

  const handleMessagesScroll = useCallback((e) => {
    const el = e.currentTarget;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const canSend = input.trim().length > 0;
  const isSteering = canSend && state.isGenerating;
  const hasMessages = messages.length > 0;
  const activeBranch = branches.find((b) => b.id === state.currentBranchId) || null;

  const perfLabel = useMemo(() => {
    if (!state.metrics?.tokensPerSecond) return null;
    return `${state.metrics.tokensPerSecond} tok/s`;
  }, [state.metrics?.tokensPerSecond]);
  const followUps = useMemo(
    () => buildFollowUps({ messages, workspace: state.workspace }),
    [messages, state.workspace]
  );
  const starterPrompts = useMemo(
    () => buildStarterPrompts(workspaceId, canUseWebSearch),
    [workspaceId, canUseWebSearch]
  );
  const runtimeState = state.runtimeState || null;
  const currentBackend = runtimeState?.currentBackend;
  const backendId = currentBackend?.id || currentBackend?.name || 'unknown';
  const perfProfile = runtimeState?.profile || 'balanced';
  const topGpu = Array.isArray(runtimeState?.deviceUtilization?.gpus)
    ? runtimeState.deviceUtilization.gpus[0]
    : null;
  const npuState = runtimeState?.deviceUtilization?.npu || null;
  const modelToken = String(state.model || '')
    .toLowerCase()
    .replace(/:latest$/i, '')
    .trim();
  const latestEvidence = useMemo(() => {
    const rows = Array.isArray(runtimeState?.offloadEvidence) ? runtimeState.offloadEvidence : [];
    if (rows.length === 0) return null;
    if (!modelToken) return rows[rows.length - 1];
    const match = [...rows]
      .reverse()
      .find((row) => {
        const hint = String(row?.model || row?.key || '').toLowerCase();
        return hint.includes(modelToken);
      });
    return match || rows[rows.length - 1];
  }, [runtimeState?.offloadEvidence, modelToken]);
  const inferenceOptions = useMemo(
    () => state.effectiveInferenceOptions || state.activeInferenceOptions || {},
    [state.effectiveInferenceOptions, state.activeInferenceOptions],
  );
  const activeCtx = Number(inferenceOptions?.num_ctx || 0);
  const modelCtxCap = Number(
    currentModelInfo?.contextLength
    || currentModelInfo?.effectiveContextLength
    || currentModelInfo?.rawContextLength
    || 0,
  );
  const activeBatch = Number(inferenceOptions?.num_batch || 0);
  const activeGpuLayers = Number.isFinite(Number(inferenceOptions?.num_gpu))
    ? Number(inferenceOptions.num_gpu)
    : null;
  const largeLocalModel = useMemo(
    () => isLargeLocalGgufModel(state.model, currentModelInfo),
    [state.model, currentModelInfo],
  );
  const safeFitOptions = useMemo(() => ({
    num_ctx: modelCtxCap > 0 ? Math.min(modelCtxCap, 4096) : 4096,
    num_batch: 64,
    num_predict: 768,
    kv_cache_type: 'q4_0',
    flash_attn: true,
  }), [modelCtxCap]);
  const safeFitActive = Boolean(
    tuningMode === 'advanced'
    && Number(advancedOverrides?.num_ctx || contextLengthTokens || 0) > 0
    && Number(advancedOverrides?.num_ctx || contextLengthTokens || 0) <= safeFitOptions.num_ctx
    && Number(advancedOverrides?.num_batch || 0) <= safeFitOptions.num_batch
    && advancedOverrides?.kv_cache_type === safeFitOptions.kv_cache_type
  );
  const requestedModel = state.requestedModel || state.model || runtimeState?.requestedModel || null;
  const effectiveModel = state.effectiveModel || runtimeState?.effectiveModel || requestedModel;
  const executionMode = state.executionMode || runtimeState?.lastExecutionMode || null;
  const modeReasons = Array.isArray(state.modeReasons) && state.modeReasons.length > 0
    ? state.modeReasons
    : (Array.isArray(runtimeState?.modeReasons) ? runtimeState.modeReasons : []);
  const experiencePlan = state.experiencePlan || runtimeState?.lastExperiencePlan || null;
  const autopilotSummary = experiencePlan?.summary || null;
  const autopilotFamily = autopilotSummary?.modelFamily || experiencePlan?.profile?.family || 'chat';
  const autopilotIntent = autopilotSummary?.taskIntent || experiencePlan?.taskIntent || taskIntent || 'auto';
  const autopilotContext = Number(
    autopilotSummary?.context
    || experiencePlan?.effectiveOptions?.num_ctx
    || inferenceOptions?.num_ctx
    || 0,
  );
  const autopilotBackend = experiencePlan?.explicitBackendPin
    || experiencePlan?.softBackendPreference
    || runtimeState?.softBackendPreference
    || backendId;
  const autopilotWarnings = useMemo(() => (
    Array.isArray(experiencePlan?.warnings) ? experiencePlan.warnings : []
  ), [experiencePlan?.warnings]);
  const autopilotOverrideTrace = useMemo(() => {
    if (Array.isArray(experiencePlan?.overrideTrace)) return experiencePlan.overrideTrace;
    if (Array.isArray(runtimeState?.overrideTrace)) return runtimeState.overrideTrace;
    return [];
  }, [experiencePlan?.overrideTrace, runtimeState?.overrideTrace]);
  const autopilotClampReasons = useMemo(() => {
    if (Array.isArray(experiencePlan?.clampReasons)) return experiencePlan.clampReasons;
    if (Array.isArray(runtimeState?.clampReasons)) return runtimeState.clampReasons;
    return [];
  }, [experiencePlan?.clampReasons, runtimeState?.clampReasons]);
  const autopilotBackendSource = experiencePlan?.explicitBackendPin
    ? 'forced'
    : (runtimeState?.backendDecisionSource || (experiencePlan?.softBackendPreference ? 'soft preference' : 'auto'));
  const requestedCtx = Number(state.activeInferenceOptions?.num_ctx || 0);
  const npuLabel = npuState
    ? (npuState.serverRunning ? 'online' : 'offline')
    : 'unknown';
  const gpuLabel = topGpu
    ? `${Math.round(Number(topGpu.utilizationGpu || 0))}% | VRAM ${Math.round(Number(topGpu.vramPercent || 0))}%`
    : 'n/a';
  const offloadLabel = latestEvidence
    ? (latestEvidence.verified ? 'offload verified' : 'offload unverified')
    : 'offload unknown';
  const sendMetadataRef = useRef({});
  sendMetadataRef.current = {
    ...(canUseWebSearch ? { webSearchEnabled } : {}),
    ...(thinkLongerEnabled ? { thinkLonger: true } : {}),
  };
  const executionBadgeLabel = executionMode === 'fallback_model'
    ? 'casual baseline fallback'
    : executionMode === 'compat'
      ? 'compat generate'
      : 'native chat';
  const routingDetail = requestedModel && effectiveModel && requestedModel !== effectiveModel
    ? `${requestedModel} -> ${effectiveModel}`
    : (effectiveModel || requestedModel || 'Model routing stable');
  const optionsSummary = [
    activeCtx > 0 ? `ctx ${activeCtx}` : null,
    activeBatch > 0 ? `batch ${activeBatch}` : null,
    activeGpuLayers != null ? `gpu ${activeGpuLayers}` : null,
  ].filter(Boolean).join(' | ');

  const approxTokensUsed = useMemo(() => {
    let chars = 0;
    for (const m of messages) {
      chars += String(m.content || '').length;
      const r = m.reasoning;
      if (r && typeof r === 'object') {
        chars += String(r.content || r.closedContent || '').length;
      }
    }
    chars += String(state.streamingContent || '').length;
    return Math.max(0, Math.ceil(chars / 4));
  }, [messages, state.streamingContent]);

  const ctxBudget = activeCtx > 0 ? activeCtx : (modelCtxCap > 0 ? modelCtxCap : 0);
  const ctxUsePercent = ctxBudget > 0 ? Math.min(100, Math.round((approxTokensUsed / ctxBudget) * 100)) : 0;
  const ctxUsedClass =
    ctxBudget > 0 && ctxUsePercent >= 95
      ? 'text-red-400'
      : ctxBudget > 0 && ctxUsePercent >= 80
        ? 'text-amber-300'
        : 'text-zinc-500';
  const ctxUsedLabel =
    ctxBudget > 0
      ? `${approxTokensUsed.toLocaleString()} / ${ctxBudget.toLocaleString()} (${ctxUsePercent}%)`
      : null;
  const activePresetSummary = useMemo(() => {
    if (!activeModelPreset) return 'No saved model preset';
    const task = activeModelPreset.task_intent && activeModelPreset.task_intent !== 'auto'
      ? `task ${activeModelPreset.task_intent}`
      : null;
    const ctx = Number(activeModelPreset.context_length) > 0
      ? `ctx ${Number(activeModelPreset.context_length).toLocaleString()}`
      : null;
    const device = activeModelPreset.device_pin ? `pin ${activeModelPreset.device_pin}` : null;
    const advancedCount = activeModelPreset.advanced_options && typeof activeModelPreset.advanced_options === 'object'
      ? Object.keys(activeModelPreset.advanced_options).length
      : 0;
    return [task, ctx, device, advancedCount ? `${advancedCount} advanced` : null]
      .filter(Boolean)
      .join(' / ') || 'Safe preset defaults';
  }, [activeModelPreset]);
  const preflightWarnings = useMemo(() => {
    const warnings = [];
    if (!state.model) warnings.push('No model selected.');
    if (!currentBackend || backendId === 'unknown') warnings.push('Backend is not ready yet.');
    if (modelCtxCap > 0 && activeCtx > modelCtxCap) {
      warnings.push(`Requested context exceeds model cap and will clamp to ${modelCtxCap.toLocaleString()}.`);
    }
    if (ctxBudget > 0 && ctxUsePercent >= 95) warnings.push('Context is almost full.');
    else if (ctxBudget > 0 && ctxUsePercent >= 80) warnings.push('Context is getting high.');
    if (topGpu && Number(topGpu.vramPercent || 0) >= 92) warnings.push('GPU memory pressure is high.');
    if (largeLocalModel && !safeFitActive && ((activeCtx > 4096) || (activeBatch > 96))) {
      warnings.push('Large local GGUF may be more stable with Safe Fit tuning.');
    }
    if (runtimeState?.queue?.queued > 0) warnings.push(`${runtimeState.queue.queued} runtime job(s) queued.`);
    if (latestEvidence && latestEvidence.verified === false) warnings.push('GPU offload has not been verified for this model.');
    return warnings;
  }, [state.model, currentBackend, backendId, modelCtxCap, activeCtx, activeBatch, ctxBudget, ctxUsePercent, topGpu, largeLocalModel, safeFitActive, runtimeState?.queue?.queued, latestEvidence]);
  const modelHealthStatus = useMemo(() => {
    const blocked = preflightWarnings.some((warning) => /no model|backend is not ready/i.test(warning));
    if (blocked) {
      return {
        tone: 'blocked',
        label: 'Blocked',
        Icon: AlertTriangle,
        className: 'border-red-400/25 bg-red-500/10 text-red-300',
      };
    }
    if (preflightWarnings.length > 0 || autopilotWarnings.length > 0) {
      return {
        tone: 'warning',
        label: 'Check',
        Icon: AlertTriangle,
        className: 'border-amber-400/25 bg-amber-500/10 text-amber-300',
      };
    }
    return {
      tone: 'ready',
      label: 'Ready',
      Icon: CheckCircle,
      className: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
    };
  }, [preflightWarnings, autopilotWarnings]);
  const modelHealthChecks = useMemo(() => ([
    {
      label: 'Model',
      value: state.model ? String(state.model) : 'No model selected',
      ok: Boolean(state.model),
    },
    {
      label: 'Backend',
      value: backendId === 'unknown' ? 'Not ready' : `${backendId} (${autopilotBackendSource})`,
      ok: Boolean(currentBackend && backendId !== 'unknown'),
    },
    {
      label: 'Context',
      value: [
        activeCtx > 0 ? activeCtx.toLocaleString() : 'auto',
        modelCtxCap > 0 ? `cap ${modelCtxCap.toLocaleString()}` : 'cap estimated',
      ].join(' / '),
      ok: !(modelCtxCap > 0 && activeCtx > modelCtxCap) && ctxUsePercent < 95,
    },
    {
      label: 'Memory',
      value: topGpu ? `VRAM ${Math.round(Number(topGpu.vramPercent || 0))}%` : 'No GPU sample',
      ok: !topGpu || Number(topGpu.vramPercent || 0) < 92,
    },
    {
      label: 'Fit',
      value: safeFitActive ? 'Safe Fit active' : (largeLocalModel ? 'Large GGUF' : 'Standard'),
      ok: !largeLocalModel || safeFitActive || !(activeCtx > 4096 || activeBatch > 96),
    },
    {
      label: 'Route',
      value: routingDetail,
      ok: executionMode !== 'fallback_model',
    },
    {
      label: 'Preset',
      value: activePresetSummary,
      ok: true,
    },
  ]), [state.model, backendId, autopilotBackendSource, currentBackend, activeCtx, activeBatch, modelCtxCap, ctxUsePercent, topGpu, safeFitActive, largeLocalModel, routingDetail, executionMode, activePresetSummary]);
  const autopilotDetailRows = useMemo(() => ([
    ['Task', autopilotIntent],
    ['Family', autopilotFamily],
    ['Context', autopilotContext ? autopilotContext.toLocaleString() : 'auto'],
    ['Backend', autopilotBackend || 'auto'],
    ['Source', autopilotBackendSource],
    ['Trace', summarizePlanSteps(autopilotOverrideTrace, 'Base defaults')],
    ['Clamp', summarizePlanSteps(autopilotClampReasons, 'None')],
  ]), [autopilotIntent, autopilotFamily, autopilotContext, autopilotBackend, autopilotBackendSource, autopilotOverrideTrace, autopilotClampReasons]);
  const autopilotDecisionCards = useMemo(() => ([
    {
      label: 'Task',
      value: autopilotIntent,
      detail: taskIntent && taskIntent !== 'auto'
        ? 'Set by this chat'
        : 'Detected from workspace, prompt, and model family',
      tone: taskIntent && taskIntent !== 'auto' ? 'cyan' : 'zinc',
    },
    {
      label: 'Context',
      value: autopilotContext ? autopilotContext.toLocaleString() : 'auto',
      detail: autopilotClampReasons.length
        ? summarizePlanSteps(autopilotClampReasons, 'Clamped by model metadata')
        : (contextLengthTokens ? 'Set by context picker' : 'Balanced against model and hardware'),
      tone: autopilotClampReasons.length ? 'amber' : 'zinc',
    },
    {
      label: 'Backend',
      value: autopilotBackend || 'auto',
      detail: backendOverride
        ? 'Strict per-chat pin'
        : (experiencePlan?.softBackendPreference ? 'Soft preference, fallback allowed' : 'Automatic local route'),
      tone: backendOverride ? 'amber' : 'zinc',
    },
    {
      label: 'Preset',
      value: activeModelPreset ? 'Active' : 'None',
      detail: activePresetSummary,
      tone: activeModelPreset ? 'emerald' : 'zinc',
    },
  ]), [
    autopilotIntent,
    autopilotContext,
    autopilotBackend,
    autopilotClampReasons,
    taskIntent,
    contextLengthTokens,
    backendOverride,
    experiencePlan?.softBackendPreference,
    activeModelPreset,
    activePresetSummary,
  ]);
  const streamingReasoning = state.streamingReasoning && typeof state.streamingReasoning === 'object'
    ? state.streamingReasoning
    : null;
  const reasoningStatus = formatReasoningStatus(streamingReasoning);
  const streamReasoningPanelData = streamingReasoning && !streamingReasoning.active
    ? {
        ...streamingReasoning,
        content: streamingReasoning.closedContent || streamingReasoning.content || '',
      }
    : null;
  const composerTagStyle = {
    borderColor: withAlpha(workspaceColor, '2f'),
    background: withAlpha(workspaceColor, '12'),
    color: workspaceColor,
  };
  const sendButtonStyle = isSteering
    ? {
        background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
        boxShadow: '0 22px 46px -28px rgba(245, 158, 11, 0.9)',
      }
    : {
        background: `linear-gradient(135deg, ${workspaceColor} 0%, ${withAlpha(workspaceColor, 'd4')} 100%)`,
        boxShadow: `0 22px 46px -28px ${withAlpha(workspaceColor, 'de')}`,
      };
  const recoveryHint = backendOverride
    ? 'Forced backend is active. Retry, or reset to Auto and let Autopilot recover.'
    : (executionMode === 'fallback_model'
      ? 'Fallback model path was used. Retry can reload the preferred model.'
      : 'Retry will reuse the last prompt with current runtime state.');
  const recoveryState = useMemo(() => {
    const warnings = [...preflightWarnings, ...autopilotWarnings];
    const blocked = warnings.find((warning) => /no model|backend is not ready/i.test(warning));
    const manualTuningActive = Boolean(
      backendOverride
      || tuningMode === 'advanced'
      || contextLengthTokens != null
      || Object.keys(advancedOverrides || {}).length > 0
    );
    const explanation = blocked
      || (backendOverride
        ? `Backend is pinned to ${backendOverride}; Auto fallback can clear the pin before retrying.`
        : (warnings[0] || 'Runtime is available; retry choices below decide how much state to preserve.'));
    return {
      blocked,
      explanation,
      manualTuningActive,
      canRetry: Boolean(state.error) && !state.isGenerating,
      canReload: Boolean(state.model) && !state.isGenerating,
    };
  }, [
    preflightWarnings,
    autopilotWarnings,
    backendOverride,
    tuningMode,
    contextLengthTokens,
    advancedOverrides,
    state.error,
    state.isGenerating,
    state.model,
  ]);
  const confidenceStatus = loadConfidence?.status || (modelHealthStatus.tone === 'blocked' ? 'blocked' : modelHealthStatus.tone === 'warning' ? 'check' : 'ready');
  const confidenceLabel = confidenceStatus === 'blocked'
    ? 'Blocked'
    : confidenceStatus === 'check'
      ? 'Check'
      : 'Ready';
  const confidenceClassName = confidenceStatus === 'blocked'
    ? 'border-red-400/25 bg-red-500/10 text-red-300'
    : confidenceStatus === 'check'
      ? 'border-amber-400/25 bg-amber-500/10 text-amber-300'
      : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300';
  const ConfidenceIcon = confidenceStatus === 'ready' ? CheckCircle : AlertTriangle;
  const confidenceChecks = Array.isArray(loadConfidence?.checks) ? loadConfidence.checks : modelHealthChecks;
  const confidenceWarnings = Array.isArray(loadConfidence?.warnings) ? loadConfidence.warnings : [];
  const confidenceFailureMemory = Array.isArray(loadConfidence?.failureMemory) ? loadConfidence.failureMemory : [];

  const recordBackendDecision = useCallback(async ({
    eventType = 'note',
    status = 'info',
    reason = '',
    backend = backendId,
    options = inferenceOptions,
  } = {}) => {
    if (!state.model) return;
    const signature = [
      state.model,
      state.workspace,
      eventType,
      status,
      backend || '',
      reason || '',
      options?.num_ctx || '',
      options?.num_batch || '',
      options?.kv_cache_type || '',
      options?.num_predict || '',
    ].join('|');
    if (signature === lastRecordedBackendDecisionRef.current) return;
    lastRecordedBackendDecisionRef.current = signature;
    await safeCall('recordBackendDecision', [{
      model: state.model,
      workspace: state.workspace,
      eventType,
      status,
      backend,
      reason,
      options,
    }], { success: false });
    const timeline = await safeCall('getBackendDecisionTimeline', [{
      model: state.model,
      workspace: state.workspace,
      limit: 8,
    }], []);
    setBackendDecisionTimeline(Array.isArray(timeline) ? timeline : []);
  }, [state.model, state.workspace, backendId, inferenceOptions]);

  useEffect(() => {
    let cancelled = false;
    async function resolveConfidence() {
      if (!state.model) {
        setLoadConfidence(null);
        setLastKnownGoodProfile(null);
        setBackendDecisionTimeline([]);
        return;
      }
      const lastGood = await safeCall('getLastKnownGoodModelLoad', [{
        model: state.model,
        workspace: state.workspace,
      }], null);
      if (cancelled) return;
      setLastKnownGoodProfile(lastGood || null);
      const confidence = await safeCall('resolveModelLoadConfidence', [{
        model: state.model,
        workspace: state.workspace,
        modelInfo: currentModelInfo || null,
        runtimeState,
        experiencePlan,
        activePreset: activeModelPreset || null,
        advancedOverrides: advancedOverrides || {},
        effectiveOptions: inferenceOptions || {},
        contextLengthTokens,
        warmupResult,
        lastKnownGood: lastGood || null,
      }], { success: false, status: 'blocked', checks: [], warnings: ['Load confidence unavailable'] });
      if (!cancelled) {
        setLoadConfidence(confidence || null);
        setBackendDecisionTimeline(Array.isArray(confidence?.timeline) ? confidence.timeline : []);
      }
    }
    void resolveConfidence();
    return () => {
      cancelled = true;
    };
  }, [
    state.model,
    state.workspace,
    currentModelInfo,
    runtimeState,
    experiencePlan,
    activeModelPreset,
    advancedOverrides,
    inferenceOptions,
    contextLengthTokens,
    warmupResult,
  ]);

  useEffect(() => {
    if (!state.model) return;
    void recordBackendDecision({
      eventType: 'model_selected',
      status: 'info',
      backend: backendId,
      reason: `Selected ${state.model}`,
      options: inferenceOptions || {},
    });
  }, [state.model, backendId, inferenceOptions, recordBackendDecision]);

  useEffect(() => {
    if (!state.model || !experiencePlan) return;
    void recordBackendDecision({
      eventType: 'autopilot_plan',
      status: confidenceStatus === 'blocked' ? 'blocked' : 'info',
      backend: autopilotBackend,
      reason: `Autopilot ${autopilotIntent}; ${autopilotBackendSource}`,
      options: inferenceOptions || {},
    });
  }, [
    state.model,
    experiencePlan,
    autopilotBackend,
    autopilotIntent,
    autopilotBackendSource,
    confidenceStatus,
    inferenceOptions,
    recordBackendDecision,
  ]);

  useEffect(() => {
    if (!lastKnownGoodProfile || !state.model) return;
    void recordBackendDecision({
      eventType: 'last_good_found',
      status: 'success',
      backend: lastKnownGoodProfile.backend || backendId,
      reason: `Last good profile: ctx ${lastKnownGoodProfile.context || 'auto'}, batch ${lastKnownGoodProfile.batch || 'auto'}`,
      options: lastKnownGoodProfile.options || {},
    });
  }, [lastKnownGoodProfile, state.model, backendId, recordBackendDecision]);

  useEffect(() => {
    if (state.isGenerating || !state.model) return;
    const tps = Number(state.metrics?.tokensPerSecond || 0);
    if (!Number.isFinite(tps) || tps <= 0) return;
    const signature = [
      state.model,
      state.workspace,
      backendId,
      activeCtx,
      activeBatch,
      inferenceOptions?.kv_cache_type || '',
      inferenceOptions?.num_predict || '',
      state.metrics?.firstTokenMs || '',
      tps,
    ].join('|');
    if (signature === lastRecordedLoadOutcomeRef.current) return;
    lastRecordedLoadOutcomeRef.current = signature;
    void safeCall('recordModelLoadOutcome', [{
      model: state.model,
      workspace: state.workspace,
      source: 'chat-generation',
      success: true,
      backend: backendId,
      context: activeCtx || null,
      batch: activeBatch || null,
      kvCacheType: inferenceOptions?.kv_cache_type || null,
      numPredict: inferenceOptions?.num_predict || null,
      firstTokenMs: state.metrics?.firstTokenMs || null,
      tokensPerSecond: tps,
      options: inferenceOptions || {},
    }], { success: false });
    void recordBackendDecision({
      eventType: 'generation_succeeded',
      status: 'success',
      backend: backendId,
      reason: `${tps} tok/s${state.metrics?.firstTokenMs ? `, first token ${state.metrics.firstTokenMs}ms` : ''}`,
      options: inferenceOptions || {},
    });
  }, [
    state.isGenerating,
    state.model,
    state.workspace,
    state.metrics?.tokensPerSecond,
    state.metrics?.firstTokenMs,
    backendId,
    activeCtx,
    activeBatch,
    inferenceOptions,
    recordBackendDecision,
  ]);

  useEffect(() => {
    if (!state.error || !state.model || state.isGenerating) return;
    const signature = ['failed', state.model, state.workspace, backendId, state.error].join('|');
    if (signature === lastRecordedLoadOutcomeRef.current) return;
    lastRecordedLoadOutcomeRef.current = signature;
    void safeCall('recordModelLoadOutcome', [{
      model: state.model,
      workspace: state.workspace,
      source: 'chat-generation',
      success: false,
      backend: backendId,
      context: activeCtx || null,
      batch: activeBatch || null,
      kvCacheType: inferenceOptions?.kv_cache_type || null,
      numPredict: inferenceOptions?.num_predict || null,
      error: state.error,
      options: inferenceOptions || {},
    }], { success: false });
    void recordBackendDecision({
      eventType: 'generation_failed',
      status: 'failed',
      backend: backendId,
      reason: state.error,
      options: inferenceOptions || {},
    });
  }, [state.error, state.model, state.workspace, state.isGenerating, backendId, activeCtx, activeBatch, inferenceOptions, recordBackendDecision]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const value = input.trim();
    if (!value) return;
    if (!state.model) {
      useToastStore.getState().error('No model selected', 'Choose or load a model before sending.');
      return;
    }
    setInput('');
    if (state.isGenerating) {
      await engine.steer(value, sendMetadataRef.current);
    } else {
      await engine.sendUserMessage(value, sendMetadataRef.current);
    }
  }, [input, engine, state.isGenerating, state.model]);

  const handleEditUser = useCallback(async (message) => {
    const updated = window.prompt('Edit message', message.content);
    if (updated == null) return;
    const next = String(updated).trim();
    if (!next || next === message.content) return;
    await engine.editUserMessage(message.id, next);
  }, [engine]);

  const handleCreateBranchFrom = useCallback(async (messageId) => {
    const branchName = window.prompt('Branch name (optional)', '') || null;
    await engine.createBranchFromMessage(messageId, branchName);
  }, [engine]);

  const handleSwitchBranch = useCallback(async (e) => {
    const branchId = e.target.value;
    if (!branchId) return;
    await engine.switchBranch(branchId);
  }, [engine]);

  const handlePickFiles = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const normalized = files.map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      originalPath: file.path || file.webkitRelativePath || null,
      file,
    }));
    engine.addDraftAttachments(normalized);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [engine]);

  const handleQuickPrompt = useCallback((prompt) => {
    setInput(prompt);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleInputKeyDown = useCallback(async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const value = e.target.value?.trim();
    if (!value) return;
    if (!state.model) {
      useToastStore.getState().error('No model selected', 'Choose or load a model before sending.');
      return;
    }
    setInput('');
    if (state.isGenerating) {
      await engine.steer(value, sendMetadataRef.current);
    } else {
      await engine.sendUserMessage(value, sendMetadataRef.current);
    }
  }, [engine, state.isGenerating, state.model]);

  const handleRefreshRuntime = useCallback(async () => {
    setIsRefreshingRuntime(true);
    try {
      await engine.refreshRuntimeState(true);
    } finally {
      setIsRefreshingRuntime(false);
    }
  }, [engine]);

  const handleWarmupModel = useCallback(async () => {
    if (!state.model) return;
    setIsWarmingModel(true);
    setWarmupResult({ status: 'warming', model: state.model, startedAt: Date.now() });
    void recordBackendDecision({
      eventType: 'warmup_started',
      status: 'info',
      backend: backendId,
      reason: 'Manual model warmup started.',
      options: inferenceOptions || {},
    });
    try {
      const result = await engine.warmupModel(state.model, { lane: 'lane_interactive' });
      const loaded = Boolean(result?.success || result?.ok);
      const nextWarmup = {
        status: loaded ? 'loaded' : 'failed',
        model: state.model,
        backend: result?.backend || backendId || null,
        elapsedMs: result?.timings?.elapsedMs || null,
        fallbackReason: result?.fallbackReason || null,
        error: result?.error || result?.fallbackReason || null,
        completedAt: Date.now(),
      };
      setWarmupResult(nextWarmup);
      await safeCall('recordModelLoadOutcome', [{
        model: state.model,
        workspace: state.workspace,
        source: 'warmup',
        success: loaded,
        backend: nextWarmup.backend,
        context: activeCtx || inferenceOptions?.num_ctx || null,
        batch: activeBatch || inferenceOptions?.num_batch || null,
        kvCacheType: inferenceOptions?.kv_cache_type || null,
        numPredict: inferenceOptions?.num_predict || null,
        error: nextWarmup.error || '',
        options: inferenceOptions || {},
      }], { success: false });
      void recordBackendDecision({
        eventType: loaded ? 'warmup_succeeded' : 'warmup_failed',
        status: loaded ? 'success' : 'failed',
        backend: nextWarmup.backend || backendId,
        reason: loaded ? 'Model warmed successfully.' : (nextWarmup.error || 'Warmup failed.'),
        options: inferenceOptions || {},
      });
      if (loaded) {
        useToastStore.getState().success('Model warmed', `${state.model} loaded on ${nextWarmup.backend || 'runtime'}.`);
      } else {
        useToastStore.getState().error('Warmup failed', nextWarmup.error || 'The model did not warm successfully.');
      }
    } finally {
      setIsWarmingModel(false);
      void engine.refreshRuntimeState(true);
    }
  }, [engine, state.model, state.workspace, backendId, activeCtx, activeBatch, inferenceOptions, recordBackendDecision]);

  const handleEjectModel = useCallback(async () => {
    if (!state.model) return;
    await Promise.all([
      safeCall('unloadModel', [], null),
      safeCall('unloadNpuModel', [], null),
    ]);
    setWarmupResult({ status: 'unloaded', model: state.model, completedAt: Date.now() });
    void recordBackendDecision({
      eventType: 'model_unloaded',
      status: 'info',
      backend: backendId,
      reason: 'Model was unloaded from active runtimes.',
      options: inferenceOptions || {},
    });
    useToastStore.getState().success('Unloaded', 'Unloaded current model');
    void engine.refreshRuntimeState(true);
  }, [engine, state.model, backendId, inferenceOptions, recordBackendDecision]);

  const handleAdvancedNumber = useCallback((key, value) => {
    const raw = String(value || '').trim();
    setTuningMode('advanced');
    setAdvancedOverride(key, raw === '' ? null : Number(raw));
  }, [setAdvancedOverride, setTuningMode]);

  const handleAdvancedToggle = useCallback((key, value) => {
    setTuningMode('advanced');
    setAdvancedOverride(key, Boolean(value));
  }, [setAdvancedOverride, setTuningMode]);

  const handleAdvancedSelect = useCallback((key, value) => {
    setTuningMode('advanced');
    setAdvancedOverride(key, value || null);
  }, [setAdvancedOverride, setTuningMode]);

  const handleResetTuningSession = useCallback(() => {
    resetAdvancedOverrides();
    setAdvancedOverrides({});
    setContextLengthTokens(null);
    setBackendOverride(null);
    useToastStore.getState().info('Autopilot restored', 'This chat is back to safe automatic tuning.');
  }, [resetAdvancedOverrides, setAdvancedOverrides, setContextLengthTokens, setBackendOverride]);

  const handleApplySafeFit = useCallback(() => {
    const nextOverrides = {
      ...(advancedOverrides || {}),
      ...safeFitOptions,
    };
    setTuningMode('advanced');
    setAdvancedOverrides(nextOverrides);
    setContextLengthTokens(safeFitOptions.num_ctx);
    void recordBackendDecision({
      eventType: 'safe_fit_applied',
      status: 'warning',
      backend: backendId,
      reason: 'Safe Fit lowered context, batch, output cap, and KV cache for stability.',
      options: nextOverrides,
    });
    useToastStore.getState().info('Safe Fit applied', 'Context, batch, output cap, and KV cache were lowered for stability.');
  }, [advancedOverrides, safeFitOptions, setTuningMode, setAdvancedOverrides, setContextLengthTokens, backendId, recordBackendDecision]);

  const handleUseLastGood = useCallback(() => {
    if (!lastKnownGoodProfile) {
      useToastStore.getState().error('No last-good profile', 'Run a successful warmup or generation first.');
      return;
    }
    const nextOverrides = {
      ...(advancedOverrides || {}),
    };
    if (Number.isFinite(Number(lastKnownGoodProfile.context)) && Number(lastKnownGoodProfile.context) > 0) {
      nextOverrides.num_ctx = Number(lastKnownGoodProfile.context);
    }
    if (Number.isFinite(Number(lastKnownGoodProfile.batch)) && Number(lastKnownGoodProfile.batch) > 0) {
      nextOverrides.num_batch = Number(lastKnownGoodProfile.batch);
    }
    if (Number.isFinite(Number(lastKnownGoodProfile.numPredict)) && Number(lastKnownGoodProfile.numPredict) > 0) {
      nextOverrides.num_predict = Number(lastKnownGoodProfile.numPredict);
    }
    if (lastKnownGoodProfile.kvCacheType) {
      nextOverrides.kv_cache_type = lastKnownGoodProfile.kvCacheType;
    }
    if (lastKnownGoodProfile.backend) {
      nextOverrides.softBackendPreference = lastKnownGoodProfile.backend;
    }
    setTuningMode('advanced');
    setAdvancedOverrides(nextOverrides);
    setContextLengthTokens(nextOverrides.num_ctx || null);
    void recordBackendDecision({
      eventType: 'last_good_applied',
      status: 'success',
      backend: lastKnownGoodProfile.backend || backendId,
      reason: 'Applied last-good profile to this chat session only.',
      options: nextOverrides,
    });
    useToastStore.getState().success('Last Good applied', 'Known-good settings were applied to this chat. Save Preset if you want them to stick.');
  }, [
    lastKnownGoodProfile,
    advancedOverrides,
    setTuningMode,
    setAdvancedOverrides,
    setContextLengthTokens,
    backendId,
    recordBackendDecision,
  ]);

  const handleApplyWorkbenchSession = useCallback((session = {}) => {
    resetAdvancedOverrides();
    const safeOverrides = session.advancedOverrides && typeof session.advancedOverrides === 'object'
      ? session.advancedOverrides
      : {};
    setTuningMode('advanced');
    setTaskIntent(session.taskIntent || 'auto');
    setAdvancedOverrides(safeOverrides);
    setContextLengthTokens(session.contextLengthTokens || safeOverrides.num_ctx || null);
    setBackendOverride(session.backendOverride || null);
  }, [
    resetAdvancedOverrides,
    setTuningMode,
    setTaskIntent,
    setAdvancedOverrides,
    setContextLengthTokens,
    setBackendOverride,
  ]);

  const handleSaveTuningPreset = useCallback(async () => {
    if (!state.model) {
      useToastStore.getState().error('No model selected', 'Select a model before saving tuning defaults.');
      return;
    }
    setIsSavingPreset(true);
    try {
      const presets = await safeCall('getModelPresets', [state.model, state.workspace], []);
      const activePreset = Array.isArray(presets)
        ? (presets.find((preset) => preset?.is_default) || presets[0] || null)
        : null;
      const advancedOptions = {
        ...(activePreset?.advanced_options && typeof activePreset.advanced_options === 'object'
          ? activePreset.advanced_options
          : {}),
        ...(advancedOverrides || {}),
      };
      for (const key of Object.keys(advancedOptions)) {
        if (advancedOptions[key] === undefined || advancedOptions[key] === null || advancedOptions[key] === '') {
          delete advancedOptions[key];
        }
      }

      const payload = {
        ...(activePreset || {}),
        model_name: state.model,
        workspace: state.workspace,
        is_default: true,
        temperature: advancedOverrides?.temperature ?? activePreset?.temperature ?? inferenceOptions?.temperature ?? 0.7,
        top_p: advancedOverrides?.top_p ?? activePreset?.top_p ?? inferenceOptions?.top_p ?? 0.9,
        top_k: advancedOverrides?.top_k ?? activePreset?.top_k ?? inferenceOptions?.top_k ?? 40,
        context_length: advancedOverrides?.num_ctx
          ?? contextLengthTokens
          ?? activePreset?.context_length
          ?? inferenceOptions?.num_ctx
          ?? null,
        system_prompt: activePreset?.system_prompt || '',
        device_pin: activePreset?.device_pin || null,
        task_intent: taskIntent || activePreset?.task_intent || 'auto',
        advanced_options: advancedOptions,
      };

      const result = await safeCall('saveModelPreset', [payload], { success: false });
      if (!result?.success) throw new Error(result?.error || 'Preset save failed');
      setActiveModelPreset(payload);
      useToastStore.getState().success('Preset saved', 'Advanced tuning is now the default for this model.');
    } catch (error) {
      useToastStore.getState().error('Preset not saved', error?.message || 'Could not save this tuning session.');
    } finally {
      setIsSavingPreset(false);
    }
  }, [state.model, state.workspace, advancedOverrides, inferenceOptions, contextLengthTokens, taskIntent]);

  const handleResetModelPreset = useCallback(async () => {
    if (!state.model) {
      useToastStore.getState().error('No model selected', 'Select a model before resetting model defaults.');
      return;
    }
    setIsResettingPreset(true);
    try {
      const payload = {
        ...(activeModelPreset || {}),
        model_name: state.model,
        workspace: state.workspace,
        is_default: true,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        context_length: null,
        system_prompt: activeModelPreset?.system_prompt || '',
        device_pin: null,
        task_intent: 'auto',
        advanced_options: {},
      };
      const result = await safeCall('saveModelPreset', [payload], { success: false });
      if (!result?.success) throw new Error(result?.error || 'Preset reset failed');
      setActiveModelPreset(payload);
      useToastStore.getState().success('Preset reset', 'Model tuning defaults are back to safe Autopilot values.');
    } catch (error) {
      useToastStore.getState().error('Preset not reset', error?.message || 'Could not reset this model preset.');
    } finally {
      setIsResettingPreset(false);
    }
  }, [state.model, state.workspace, activeModelPreset]);

  const controlMetadata = useMemo(() => ({
    ...(canUseWebSearch ? { webSearchEnabled } : {}),
    ...(thinkLongerEnabled ? { thinkLonger: true } : {}),
  }), [canUseWebSearch, webSearchEnabled, thinkLongerEnabled]);

  const handleRetrySameBackend = useCallback(async () => {
    const ok = await engine.retryLastGeneration(controlMetadata);
    if (!ok) useToastStore.getState().error('Retry unavailable', 'There is no failed generation to retry.');
  }, [engine, controlMetadata]);

  const handleRetryAutoFallback = useCallback(async () => {
    resetAdvancedOverrides();
    setAdvancedOverrides({});
    setContextLengthTokens(null);
    setBackendOverride(null);
    const ok = await engine.retryLastGeneration({
      ...controlMetadata,
      forceModelFallback: true,
    });
    if (!ok) {
      useToastStore.getState().error('Fallback unavailable', 'There is no failed generation to retry.');
    } else {
      void recordBackendDecision({
        eventType: 'fallback_selected',
        status: 'warning',
        backend: backendId,
        reason: 'Manual tuning cleared and Auto fallback retry started.',
        options: {},
      });
      useToastStore.getState().info('Fallback retry started', 'Manual tuning was cleared for this retry.');
    }
  }, [
    engine,
    controlMetadata,
    resetAdvancedOverrides,
    setAdvancedOverrides,
    setContextLengthTokens,
    setBackendOverride,
    backendId,
    recordBackendDecision,
  ]);

  const handleReloadAndRetry = useCallback(async () => {
    if (!state.model) {
      useToastStore.getState().error('No model selected', 'Choose or load a model before retrying.');
      return;
    }
    setIsWarmingModel(true);
    try {
      await Promise.all([
        safeCall('unloadModel', [], null),
        safeCall('unloadNpuModel', [], null),
      ]);
      await engine.warmupModel(state.model, { lane: 'lane_interactive' });
      const ok = await engine.retryLastGeneration(controlMetadata);
      if (!ok) {
        useToastStore.getState().error('Retry unavailable', 'The model reloaded, but there is no failed generation to retry.');
      }
    } finally {
      setIsWarmingModel(false);
      void engine.refreshRuntimeState(true);
    }
  }, [engine, state.model, controlMetadata]);

  return (
    <div className="h-full w-full bg-black text-zinc-100 flex flex-col">
      {/* ── Slim Header ── */}
      <div className="border-b border-white/[0.07] bg-[linear-gradient(180deg,#0c0e14_0%,#08090f_100%)]">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-2.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] font-medium"
            style={{
              borderColor: withAlpha(workspaceColor, '30'),
              background: withAlpha(workspaceColor, '10'),
              color: workspaceColor,
            }}
          >
            <WorkspaceIcon size={12} />
            {workspaceChrome.label}
          </span>

          <div className="min-w-0 flex-1 flex items-center gap-2.5">
            <span className="truncate text-sm font-semibold text-zinc-100">{title}</span>
            {perfLabel && (
              <span className="hidden sm:inline-flex rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                {perfLabel}
              </span>
            )}
            <button
              type="button"
              className={`hidden lg:inline-flex max-w-[24rem] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                autopilotWarnings.length > 0
                  ? 'border-amber-400/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                  : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15'
              }`}
              onClick={() => setAutopilotDetailsOpen((prev) => !prev)}
              title={[
                `Family ${autopilotFamily}`,
                `Intent ${autopilotIntent}`,
                autopilotContext ? `Context ${autopilotContext}` : null,
                autopilotBackend ? `Backend ${autopilotBackend}` : null,
                autopilotWarnings[0] || null,
              ].filter(Boolean).join(' | ')}
            >
              <BrainCircuit size={11} />
              <span className="truncate">
                Autopilot {autopilotIntent} / {autopilotFamily}
                {autopilotContext ? ` / ${Math.round(autopilotContext / 1024)}K` : ''}
              </span>
            </button>
            {ctxUsedLabel && (
              <span
                className={`hidden md:inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium ${ctxUsedClass}`}
                title="Approximate context use (chars÷4); budget from active ctx or model cap"
              >
                ctx {ctxUsedLabel}
              </span>
            )}
            <button
              type="button"
              className={`hidden md:inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${confidenceClassName}`}
              onClick={() => setModelHealthOpen((prev) => !prev)}
              title={confidenceWarnings[0] || preflightWarnings[0] || autopilotWarnings[0] || 'Load confidence ready'}
            >
              <ConfidenceIcon size={11} />
              <span className="truncate">
                Load {confidenceLabel}
                {backendId !== 'unknown' ? ` / ${backendId}` : ''}
              </span>
            </button>
            <button
              type="button"
              className={`hidden md:inline-flex max-w-[9rem] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                workbenchOpen
                  ? 'border-cyan-400/35 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/[0.08] bg-white/[0.03] text-zinc-500 hover:border-cyan-400/25 hover:text-cyan-200'
              }`}
              onClick={() => setWorkbenchOpen((prev) => !prev)}
              title="Open Model Experience Workbench"
            >
              <Sparkles size={11} />
              <span className="truncate">Workbench</span>
            </button>
            {executionMode && executionMode !== 'native_chat' && (
              <span className={`hidden md:inline-flex rounded-full border px-2 py-0.5 text-[10px] ${
                executionMode === 'fallback_model'
                  ? 'border-amber-400/25 bg-amber-500/10 text-amber-300'
                  : 'border-sky-400/25 bg-sky-500/10 text-sky-300'
              }`}>
                {executionBadgeLabel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {branches.length > 1 && (
              <div className="flex items-center gap-1.5" title={`Branch: ${activeBranch?.name || 'Main'}`}>
                <GitBranch size={12} className="text-zinc-500" />
                <select
                  className="h-7 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-[11px] text-zinc-300 outline-none transition focus:border-white/20"
                  value={state.currentBranchId || ''}
                  onChange={handleSwitchBranch}
                  aria-label="Select conversation branch"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            {branches.length <= 1 && (
              <span className="hidden text-[11px] text-zinc-500">Branch: {activeBranch?.name || 'Main'}</span>
            )}

            <button
              type="button"
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-all ${
                runtimePanelOpen
                  ? 'border-white/15 bg-white/[0.08] text-zinc-200'
                  : 'border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:text-zinc-300 hover:border-white/12'
              }`}
              onClick={() => setRuntimePanelOpen((prev) => !prev)}
              title="Toggle runtime details"
            >
              <Activity size={12} />
              <span className="hidden sm:inline">{backendId}</span>
              {latestEvidence?.verified && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>
        </div>

        {/* ── Collapsible Runtime Panel ── */}
        {runtimePanelOpen && (
          <div className="border-t border-white/[0.06] bg-[#070810]">
            <div className="mx-auto w-full max-w-6xl px-5 py-3">
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                <TelemetryCard
                  icon={Cpu}
                  label="Backend"
                  value={backendId}
                  detail={`Profile ${perfProfile}`}
                  color="#94a3b8"
                />
                <TelemetryCard
                  icon={Globe}
                  label="Search & Reasoning"
                  value={canUseWebSearch ? `${webSearchEnabled ? 'Web On' : 'Web Off'} · ${thinkLongerEnabled ? 'Long' : 'Normal'}` : `Thinking ${thinkLongerEnabled ? 'Long' : 'Normal'}`}
                  detail={modeReasons[0] || 'Live controls stay attached to this session.'}
                  color={canUseWebSearch && webSearchEnabled ? '#38bdf8' : '#6366f1'}
                />
                <TelemetryCard
                  icon={Activity}
                  label="Devices"
                  value={`GPU ${gpuLabel}`}
                  detail={`NPU ${npuLabel}`}
                  color={latestEvidence?.verified ? '#34d399' : '#f59e0b'}
                />
                <TelemetryCard
                  icon={Sparkles}
                  label="Execution"
                  value={offloadLabel}
                  detail={[
                    routingDetail,
                    optionsSummary || 'Default runtime options',
                    requestedCtx > 0 && activeCtx > 0 && requestedCtx !== activeCtx ? `req ctx ${requestedCtx}` : null,
                  ].filter(Boolean).join(' · ')}
                  color={latestEvidence?.verified ? '#34d399' : '#f59e0b'}
                />
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <ControlButton
                  icon={RefreshCw}
                  label={isRefreshingRuntime ? 'Refreshing...' : 'Refresh Runtime'}
                  color="#94a3b8"
                  onClick={handleRefreshRuntime}
                  disabled={isRefreshingRuntime}
                  busy={isRefreshingRuntime}
                />
                <ControlButton
                  icon={Cpu}
                  label={isWarmingModel ? 'Warming...' : 'Warmup GPU'}
                  color={workspaceColor}
                  active={Boolean(state.model) && !isWarmingModel}
                  onClick={handleWarmupModel}
                  disabled={isWarmingModel || !state.model}
                />
                <ControlButton
                  icon={Unplug}
                  label="Eject"
                  color="#f87171"
                  active={Boolean(state.model)}
                  onClick={handleEjectModel}
                  disabled={!state.model}
                />
              </div>
            </div>
          </div>
        )}

        {modelHealthOpen && (
          <div className="border-t border-emerald-400/10 bg-[#07100d]">
            <div className="mx-auto w-full max-w-6xl px-5 py-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Load Confidence</div>
                  <div className="mt-1 text-sm font-medium text-zinc-100">
                    {confidenceLabel} {Number.isFinite(Number(loadConfidence?.score)) ? `/ ${Math.round(Number(loadConfidence.score))}%` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-zinc-400">
                  {warmupResult?.status && (
                    <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1">
                      warmup {warmupResult.status}
                    </span>
                  )}
                  {lastKnownGoodProfile && (
                    <span className="rounded-md border border-emerald-400/15 bg-emerald-500/[0.06] px-2 py-1 text-emerald-200">
                      last good {lastKnownGoodProfile.backend || 'auto'}
                    </span>
                  )}
                  {lastKnownGoodProfile && (
                    <button
                      type="button"
                      className="rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-cyan-100 transition hover:bg-cyan-500/15"
                      onClick={handleUseLastGood}
                      title="Apply the last successful context, batch, KV cache, output cap, and soft backend hint to this chat only"
                    >
                      Use Last Good
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {confidenceChecks.map((check) => {
                  const ok = check.ok ?? check.status === 'ok';
                  const blocked = check.status === 'blocked';
                  return (
                  <div
                    key={check.label}
                    className={`rounded-lg border px-3 py-2 ${
                      ok
                        ? 'border-emerald-400/15 bg-emerald-500/[0.06]'
                        : blocked
                          ? 'border-red-400/20 bg-red-500/10'
                          : 'border-amber-400/20 bg-amber-500/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {ok
                        ? <CheckCircle size={11} className="text-emerald-300" />
                        : <AlertTriangle size={11} className={blocked ? 'text-red-300' : 'text-amber-300'} />}
                      {check.label}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-zinc-200" title={String(check.value || check.detail || '')}>
                      {check.value || check.detail}
                    </div>
                  </div>
                  );
                })}
              </div>

              {loadConfidence?.localGguf?.isLocalGguf && (
                <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Local GGUF</div>
                  <div className="mt-1 grid gap-1.5 text-[11px] leading-4 text-zinc-300 md:grid-cols-3">
                    <div className="truncate" title={loadConfidence.localGguf.path || ''}>
                      {loadConfidence.localGguf.exists ? 'file found' : 'file missing'} / {loadConfidence.localGguf.basename || 'unknown'}
                    </div>
                    <div>{loadConfidence.localGguf.paramBillions ? `${loadConfidence.localGguf.paramBillions}B` : 'size estimated'}</div>
                    <div>{loadConfidence.localGguf.quantization || 'quant estimated'}</div>
                  </div>
                </div>
              )}

              {confidenceFailureMemory.length > 0 && (
                <div className="mt-2 rounded-lg border border-red-400/15 bg-red-500/[0.06] px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-red-200">
                    <AlertTriangle size={11} />
                    Failure Memory
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {confidenceFailureMemory.slice(0, 3).map((failure) => (
                      <span
                        key={`${failure.backend}-${failure.lastFailureAt}`}
                        className="rounded-md border border-red-400/15 bg-black/20 px-2 py-1 text-[11px] text-red-100"
                        title={failure.lastError || ''}
                      >
                        {failure.backend || 'unknown'} failed {failure.failureCount}x
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    <Activity size={11} />
                    Backend Decision Timeline
                  </div>
                  <div className="text-[10px] text-zinc-600">local only</div>
                </div>
                <div className="mt-2 grid gap-1.5">
                  {(backendDecisionTimeline.length > 0 ? backendDecisionTimeline : [{
                    id: 'empty',
                    eventType: 'note',
                    status: 'info',
                    backend: backendId,
                    reason: 'No backend decisions recorded yet.',
                    createdAt: '',
                  }]).slice(0, 8).map((event) => {
                    const statusClass = event.status === 'success'
                      ? 'border-emerald-400/15 bg-emerald-500/[0.06] text-emerald-100'
                      : event.status === 'failed' || event.status === 'blocked'
                        ? 'border-red-400/15 bg-red-500/[0.06] text-red-100'
                        : event.status === 'warning'
                          ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                          : 'border-white/[0.08] bg-white/[0.03] text-zinc-300';
                    return (
                      <div
                        key={event.id || `${event.eventType}-${event.createdAt}`}
                        className={`grid gap-1 rounded-md border px-2 py-1.5 text-[11px] md:grid-cols-[10rem_7rem_1fr] ${statusClass}`}
                      >
                        <div className="font-medium">{formatTimelineEventType(event.eventType)}</div>
                        <div className="truncate text-zinc-400">{event.backend || 'auto'}</div>
                        <div className="truncate" title={event.reason || ''}>{event.reason || 'Recorded decision'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {(confidenceWarnings.length > 0 || preflightWarnings.length > 0 || autopilotWarnings.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...confidenceWarnings, ...preflightWarnings, ...autopilotWarnings].slice(0, 8).map((warning) => (
                    <span
                      key={warning}
                      className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200"
                    >
                      {warning}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Recovery</div>
                    <div className="mt-1 truncate text-[11px] text-zinc-300" title={recoveryState.explanation}>
                      {recoveryState.explanation}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2.5 text-[11px] text-emerald-100 transition hover:bg-emerald-500/15 disabled:opacity-40"
                      onClick={handleWarmupModel}
                      disabled={!state.model || isWarmingModel}
                    >
                      <Cpu size={12} />
                      {isWarmingModel ? 'Warming' : 'Warm'}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-40"
                      onClick={handleRetrySameBackend}
                      disabled={!recoveryState.canRetry}
                    >
                      <RefreshCw size={12} />
                      Retry
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 text-[11px] text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"
                      onClick={handleRetryAutoFallback}
                      disabled={!recoveryState.canRetry}
                    >
                      <RotateCcw size={12} />
                      Auto Fallback
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2.5 text-[11px] text-sky-100 transition hover:bg-sky-500/15 disabled:opacity-40"
                      onClick={handleReloadAndRetry}
                      disabled={!recoveryState.canReload || isWarmingModel}
                    >
                      <Unplug size={12} />
                      Reload
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2.5 text-[11px] text-cyan-100 transition hover:bg-cyan-500/15 disabled:opacity-40"
                      onClick={handleApplySafeFit}
                      disabled={!state.model || safeFitActive}
                      title="Lower context, batch, output cap, and KV cache for stability"
                    >
                      <SlidersHorizontal size={12} />
                      Safe Fit
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 text-[11px] text-red-100 transition hover:bg-red-500/15 disabled:opacity-40"
                      onClick={handleEjectModel}
                      disabled={!state.model}
                    >
                      <Unplug size={12} />
                      Unload
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08]"
                      onClick={handleResetTuningSession}
                    >
                      <RotateCcw size={12} />
                      Reset Auto
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {autopilotDetailsOpen && (
          <div className="border-t border-cyan-400/10 bg-[#071018]">
            <div className="mx-auto w-full max-w-6xl px-5 py-3">
              <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {autopilotDecisionCards.map((card) => (
                  <div
                    key={card.label}
                    className={`rounded-lg border px-3 py-2 ${
                      card.tone === 'amber'
                        ? 'border-amber-400/20 bg-amber-500/10'
                        : card.tone === 'emerald'
                          ? 'border-emerald-400/15 bg-emerald-500/[0.06]'
                          : card.tone === 'cyan'
                            ? 'border-cyan-400/20 bg-cyan-500/10'
                            : 'border-white/[0.08] bg-black/20'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{card.label}</div>
                    <div className="mt-1 truncate text-[12px] font-medium text-zinc-100" title={String(card.value)}>
                      {card.value}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-400" title={String(card.detail)}>
                      {card.detail}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {autopilotDetailRows.slice(0, 4).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
                    <div className="mt-1 truncate text-[12px] font-medium text-zinc-200" title={String(value)}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 grid gap-2 lg:grid-cols-3">
                {autopilotDetailRows.slice(4).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
                    <div className="mt-1 text-[11px] leading-4 text-zinc-300">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Why This Plan</div>
                <div className="mt-1 grid gap-1.5 text-[11px] leading-4 text-zinc-300 md:grid-cols-3">
                  <div>{summarizePlanSteps(autopilotOverrideTrace, 'Base model defaults')}</div>
                  <div>{activePresetSummary}</div>
                  <div>{autopilotBackendSource === 'forced' ? 'Strict backend pin is active.' : 'Backend preference stays advisory; fallback remains allowed.'}</div>
                </div>
              </div>

              {(autopilotWarnings.length > 0 || preflightWarnings.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...autopilotWarnings, ...preflightWarnings].slice(0, 6).map((warning) => (
                    <span
                      key={warning}
                      className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200"
                    >
                      {warning}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <ModelExperienceWorkbench
          open={workbenchOpen}
          onClose={() => setWorkbenchOpen(false)}
          model={state.model}
          workspace={state.workspace}
          experiencePlan={experiencePlan}
          runtimeState={runtimeState}
          warnings={[...preflightWarnings, ...autopilotWarnings]}
          onApplySession={handleApplyWorkbenchSession}
          onResetAuto={handleResetTuningSession}
        />
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-5" onScroll={handleMessagesScroll}>
        <div className="mx-auto flex w-full max-w-5xl flex-col">
          {!hasMessages && (
            <div className="flex min-h-full flex-col items-center justify-center py-12 px-4">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-2xl border"
                style={composerTagStyle}
              >
                <WorkspaceIcon size={22} />
              </span>
              <div className="mt-4 text-xl font-semibold tracking-tight text-white text-center">
                {workspaceChrome.label} workspace
              </div>
              <p className="mt-2 max-w-lg text-center text-sm leading-6 text-zinc-500">
                {workspaceChrome.description}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-500">
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">
                  {backendId}
                </span>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">
                  {canUseWebSearch ? (webSearchEnabled ? 'Web On' : 'Web Off') : 'Local only'}
                </span>
                {perfLabel && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/8 px-2.5 py-1 text-emerald-400">
                    {perfLabel}
                  </span>
                )}
              </div>

              <div className="mt-8 grid w-full max-w-2xl gap-2.5 sm:grid-cols-3">
                {starterPrompts.map((prompt) => (
                  <PromptCard
                    key={prompt.title}
                    title={prompt.title}
                    detail={prompt.detail}
                    prompt={prompt.prompt}
                    color={workspaceColor}
                    onClick={handleQuickPrompt}
                  />
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageRow
              key={msg.id}
              message={msg}
              onEditUser={handleEditUser}
              onBranchFrom={handleCreateBranchFrom}
              accentColor={workspaceColor}
            />
          ))}

          {state.isGenerating && (
            <div className="py-2">
              <div className="max-w-[80%] rounded-2xl border border-white/[0.07] bg-[#0c0e16] px-4 py-3 text-sm leading-relaxed break-words text-zinc-200">
                {state.streamingContent ? (
                  <Suspense fallback={<div className="whitespace-pre-wrap">{state.streamingContent}</div>}>
                    <StreamingMarkdown content={state.streamingContent} isStreaming />
                  </Suspense>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-pulse" />
                    <span className="text-zinc-500 text-[13px]">Thinking...</span>
                  </div>
                )}
                {(state.streamingStatus || reasoningStatus) && (
                  <div className="mt-2 space-y-1.5 border-t border-white/[0.05] pt-2 text-[11px] italic text-zinc-500">
                    {state.streamingStatus && (
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400/70 animate-pulse" />
                        <span>{state.streamingStatus}</span>
                      </div>
                    )}
                    {reasoningStatus && (
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70 animate-pulse" />
                        <span>{reasoningStatus}</span>
                      </div>
                    )}
                  </div>
                )}
                <WebSearchActivityFeed
                  activity={state.webSearchActivity}
                  active={state.isGenerating && /researching the web/i.test(String(state.streamingContent || ''))}
                />
                <ReasoningPanel reasoning={streamReasoningPanelData} className="mt-2" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {state.error && (
        <div role="alert" className="border-t border-red-400/15 bg-red-500/[0.06] px-4 py-2">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 text-[12px] text-red-300/90">
            <div className="min-w-0 flex-1">
              <div className="truncate">{state.error}</div>
              <div className="mt-0.5 truncate text-[11px] text-red-200/60">
                {recoveryHint}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-red-100/70">
                <AlertTriangle size={12} className="shrink-0 text-red-300/80" />
                <span className="truncate" title={recoveryState.explanation}>
                  {recoveryState.explanation}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-200 transition hover:bg-red-500/15 disabled:opacity-40"
                onClick={handleRetrySameBackend}
                disabled={!recoveryState.canRetry}
                title="Retry with the current model, backend, and tuning state"
              >
                <RefreshCw size={12} />
                Same
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 text-[11px] font-medium text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"
                onClick={handleRetryAutoFallback}
                disabled={!recoveryState.canRetry}
                title="Clear manual tuning and retry through the safe fallback path"
              >
                <RotateCcw size={12} />
                Fallback
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2.5 text-[11px] font-medium text-sky-100 transition hover:bg-sky-500/15 disabled:opacity-40"
                onClick={handleReloadAndRetry}
                disabled={!recoveryState.canReload || isWarmingModel}
                title="Unload, warm the selected model again, then retry"
              >
                <Unplug size={12} />
                {isWarmingModel ? 'Reloading' : 'Reload'}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2.5 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-500/15 disabled:opacity-40"
                onClick={handleApplySafeFit}
                disabled={!state.model || safeFitActive}
                title="Apply lower context, batch, output cap, and KV cache before retrying"
              >
                <SlidersHorizontal size={12} />
                Safe Fit
              </button>
              {recoveryState.manualTuningActive && (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] font-medium text-zinc-200 transition hover:bg-white/[0.08]"
                  onClick={handleResetTuningSession}
                  title="Clear this chat's advanced controls without retrying"
                >
                  <RotateCcw size={12} />
                  Auto
                </button>
              )}
              <button type="button" className="text-red-400/70 transition hover:text-red-300" onClick={() => engine.clearError()} aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {followUps.length > 0 && !state.isGenerating && (
        <div className="border-t border-white/[0.06] bg-[#08090f]">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap gap-1.5 px-4 py-2.5">
            {followUps.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-zinc-400 transition hover:text-zinc-200 hover:bg-white/[0.07] hover:border-white/14"
                onClick={() => handleQuickPrompt(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="border-t border-white/[0.07] bg-[linear-gradient(180deg,#0a0c12_0%,#070810_100%)] px-4 py-3" onSubmit={handleSubmit}>
        <div className="mx-auto w-full max-w-5xl">
          <AttachmentChips
            files={state.draftAttachments}
            onRemove={(id) => engine.removeDraftAttachment(id)}
          />

          {/* Composer toolbar — controls that affect the next message */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {canUseWebSearch && (
              <button
                type="button"
                className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-all ${
                  webSearchEnabled
                    ? 'border-sky-400/30 bg-sky-500/15 text-sky-300'
                    : 'border-white/[0.08] bg-white/[0.03] text-zinc-500 hover:text-zinc-300 hover:border-white/14'
                }`}
                onClick={() => setWebSearchEnabled((prev) => !prev)}
              >
                <Globe size={12} />
                {webSearchEnabled ? 'Web On' : 'Web Off'}
              </button>
            )}
            <button
              type="button"
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-all ${
                thinkLongerEnabled
                  ? 'border-amber-400/30 bg-amber-500/15 text-amber-300'
                  : 'border-white/[0.08] bg-white/[0.03] text-zinc-500 hover:text-zinc-300 hover:border-white/14'
              }`}
              onClick={() => setThinkLongerEnabled((prev) => !prev)}
            >
              <BrainCircuit size={12} />
              {thinkLongerEnabled ? 'Think Longer' : 'Standard'}
            </button>

            <label className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-[11px] text-zinc-400">
              <span className="text-zinc-500 shrink-0">Ctx</span>
              <select
                className="max-w-[5.5rem] bg-transparent text-[11px] text-zinc-200 outline-none"
                value={contextLengthTokens == null ? '' : String(contextLengthTokens)}
                onChange={(e) => {
                  const v = e.target.value;
                  setContextLengthTokens(v === '' ? null : Number(v));
                }}
                aria-label="Context length"
              >
                {CTX_LENGTH_CHOICES.map((c) => {
                  const disabled =
                    c.tokens != null && modelCtxCap > 0 && c.tokens > modelCtxCap;
                  return (
                    <option
                      key={c.label}
                      value={c.tokens == null ? '' : String(c.tokens)}
                      disabled={disabled}
                    >
                      {c.label}{disabled ? ' (cap)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            <label
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors ${
                backendOverride
                  ? 'border-violet-400/30 bg-violet-500/15 text-violet-200'
                  : 'border-white/[0.08] bg-white/[0.03] text-zinc-400'
              }`}
            >
              <span className="shrink-0">Backend</span>
              <select
                className="max-w-[8.5rem] bg-transparent text-[11px] outline-none"
                value={backendOverride || ''}
                onChange={(e) => setBackendOverride(e.target.value)}
                aria-label="Per-chat backend override"
                title="Force the orchestrator to route this conversation to a specific backend"
              >
                {BACKEND_OVERRIDE_CHOICES.map((opt) => (
                  <option key={opt.value || 'auto'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-all ${
                tuningMode === 'advanced' || advancedOpen
                  ? 'border-cyan-400/30 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/[0.08] bg-white/[0.03] text-zinc-500 hover:text-zinc-300 hover:border-white/14'
              }`}
              onClick={() => setAdvancedOpen((prev) => !prev)}
              title="Open power-user model controls"
            >
              <SlidersHorizontal size={12} />
              {tuningMode === 'advanced' ? 'Advanced' : 'Auto'}
            </button>

            <span className="mx-1 h-4 w-px bg-white/[0.06]" />

            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300 hover:border-white/14 disabled:opacity-40 disabled:pointer-events-none"
              onClick={() => engine.regenerateLastAssistant(controlMetadata)}
              disabled={state.isGenerating || messages.length === 0}
            >
              <Sparkles size={12} />
              Regenerate
            </button>
            {state.error && (
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-300 transition hover:bg-red-500/15 disabled:opacity-40 disabled:pointer-events-none"
                onClick={() => engine.retryLastGeneration(controlMetadata)}
                disabled={state.isGenerating}
              >
                <RefreshCw size={12} />
                Retry
              </button>
            )}
          </div>

          {advancedOpen && (
            <div className="mb-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1">
                  {tuningMode === 'advanced' ? 'Advanced session' : 'Auto session'}
                </span>
                <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1">
                  task {autopilotIntent}
                </span>
                <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1">
                  backend {autopilotBackend || backendId}
                </span>
                <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1" title={activePresetSummary}>
                  preset {activeModelPreset ? 'active' : 'none'}
                </span>
                {autopilotClampReasons.length > 0 && (
                  <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-amber-200">
                    {autopilotClampReasons[0]}
                  </span>
                )}
                {safeFitActive && (
                  <span className="rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                    Safe Fit active
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Mode</span>
                  <select
                    className="bg-transparent text-zinc-200 outline-none"
                    value={tuningMode}
                    onChange={(e) => setTuningMode(e.target.value)}
                    aria-label="Tuning mode"
                  >
                    <option value="auto">Auto</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Task</span>
                  <select
                    className="bg-transparent text-zinc-200 outline-none"
                    value={taskIntent || 'auto'}
                    onChange={(e) => setTaskIntent(e.target.value)}
                    aria-label="Task intent"
                  >
                    {TASK_INTENT_CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                  </select>
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Pref</span>
                  <select
                    className="max-w-[8rem] bg-transparent text-zinc-200 outline-none"
                    value={advancedOverrides?.softBackendPreference || ''}
                    onChange={(e) => handleAdvancedSelect('softBackendPreference', e.target.value)}
                    aria-label="Soft backend preference"
                  >
                    <option value="">Auto</option>
                    {BACKEND_OVERRIDE_CHOICES.filter((opt) => opt.value).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label.replace('Backend: ', '')}</option>
                    ))}
                  </select>
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Temp</span>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.05"
                    value={advancedOverrides?.temperature ?? ''}
                    onChange={(e) => handleAdvancedNumber('temperature', e.target.value)}
                    className="w-16 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.temperature ?? 0.6)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Top P</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={advancedOverrides?.top_p ?? ''}
                    onChange={(e) => handleAdvancedNumber('top_p', e.target.value)}
                    className="w-16 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.top_p ?? 0.9)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Top K</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={advancedOverrides?.top_k ?? ''}
                    onChange={(e) => handleAdvancedNumber('top_k', e.target.value)}
                    className="w-16 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.top_k ?? 40)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Repeat</span>
                  <input
                    type="number"
                    min="0.8"
                    max="2"
                    step="0.01"
                    value={advancedOverrides?.repeat_penalty ?? ''}
                    onChange={(e) => handleAdvancedNumber('repeat_penalty', e.target.value)}
                    className="w-16 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.repeat_penalty ?? 1.08)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Max</span>
                  <input
                    type="number"
                    min="16"
                    step="64"
                    value={advancedOverrides?.num_predict ?? ''}
                    onChange={(e) => handleAdvancedNumber('num_predict', e.target.value)}
                    className="w-20 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.num_predict ?? 1024)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Ctx</span>
                  <input
                    type="number"
                    min="256"
                    step="256"
                    value={advancedOverrides?.num_ctx ?? ''}
                    onChange={(e) => handleAdvancedNumber('num_ctx', e.target.value)}
                    className="w-20 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.num_ctx || activeCtx || 8192)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>Batch</span>
                  <input
                    type="number"
                    min="16"
                    step="16"
                    value={advancedOverrides?.num_batch ?? ''}
                    onChange={(e) => handleAdvancedNumber('num_batch', e.target.value)}
                    className="w-20 bg-transparent text-zinc-200 outline-none"
                    placeholder={String(inferenceOptions?.num_batch ?? 128)}
                  />
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <span>KV</span>
                  <select
                    className="bg-transparent text-zinc-200 outline-none"
                    value={advancedOverrides?.kv_cache_type || ''}
                    onChange={(e) => handleAdvancedSelect('kv_cache_type', e.target.value)}
                    aria-label="KV cache type"
                  >
                    <option value="">Auto</option>
                    <option value="q8_0">Q8</option>
                    <option value="q4_0">Q4</option>
                    <option value="f16">F16</option>
                  </select>
                </label>

                <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 text-[11px] text-zinc-400">
                  <input
                    type="checkbox"
                    checked={advancedOverrides?.flash_attn === true}
                    onChange={(e) => handleAdvancedToggle('flash_attn', e.target.checked)}
                  />
                  Flash
                </label>

                <button
                  type="button"
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2.5 text-[11px] text-emerald-200 transition hover:bg-emerald-500/15 disabled:opacity-40"
                  onClick={handleSaveTuningPreset}
                  disabled={isSavingPreset || !state.model}
                >
                  <Save size={12} />
                  {isSavingPreset ? 'Saving' : 'Save Preset'}
                </button>

                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2.5 text-[11px] text-cyan-100 transition hover:bg-cyan-500/15 disabled:opacity-40"
                  onClick={handleApplySafeFit}
                  disabled={!state.model || safeFitActive}
                  title="Lower context, batch, output cap, and KV cache for stability"
                >
                  <SlidersHorizontal size={12} />
                  Safe Fit
                </button>

                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11px] text-zinc-500 transition hover:text-zinc-300 hover:border-white/14"
                  onClick={handleResetTuningSession}
                >
                  <RotateCcw size={12} />
                  Reset Session
                </button>

                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 text-[11px] text-amber-100 transition hover:bg-amber-500/15 disabled:opacity-40"
                  onClick={handleResetModelPreset}
                  disabled={isResettingPreset || !state.model}
                >
                  <RotateCcw size={12} />
                  {isResettingPreset ? 'Resetting' : 'Reset Preset'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1.5 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.9)]">
            <div className="flex items-end gap-2">
              <div className="min-h-[56px] flex-1 rounded-xl bg-[#0c0e16] px-3.5 py-2.5">
                <textarea
                  ref={inputRef}
                  className="w-full min-h-[36px] max-h-40 resize-none bg-transparent text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 outline-none"
                  placeholder={state.isGenerating ? 'Type to steer the conversation...' : 'Type your message...'}
                  aria-label="Message input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                />
              </div>

              <div className="flex items-center gap-1.5 pb-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handlePickFiles}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200 disabled:opacity-40"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={state.isGenerating}
                  aria-label="Attach files"
                >
                  <Paperclip size={15} />
                </button>

                {state.isGenerating && (
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200"
                    onClick={() => engine.stop()}
                    aria-label="Stop generation"
                  >
                    <Square size={15} />
                  </button>
                )}

                <button
                  type="submit"
                  disabled={!canSend}
                  className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-35"
                  style={sendButtonStyle}
                  aria-label={isSteering ? 'Steer conversation' : 'Send message'}
                >
                  <Send size={15} />
                  <span className="hidden sm:inline">{isSteering ? 'Steer' : 'Send'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function buildFollowUps(state) {
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  if (messages.length === 0) return [];

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return [];

  const workspace = String(state?.workspace || 'casual');
  if (workspace === 'code') {
    return [
      'Turn that into a minimal patch plan.',
      'Show the exact code change.',
      'Add edge-case tests for this.',
    ];
  }
  if (workspace === 'work') {
    return [
      'Turn this into a prioritized action plan.',
      'Draft a concise stakeholder update.',
      'List risks and mitigations.',
    ];
  }
  if (workspace === 'research') {
    return [
      'Summarize findings with sources.',
      'Highlight conflicting evidence.',
      'What should I verify next?',
    ];
  }

  return [
    'Give me a concise summary.',
    'What should I do next?',
    'Explain this in simpler terms.',
  ];
}
