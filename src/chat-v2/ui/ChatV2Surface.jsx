import { useCallback, useEffect, useMemo, useRef, useState, memo, lazy, Suspense } from 'react';
import {
  Activity,
  BrainCircuit,
  Briefcase,
  Code2,
  Compass,
  Cpu,
  GitBranch,
  Globe,
  MessageCircle,
  Paperclip,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

const StreamingMarkdown = lazy(() =>
  import('./StreamingMarkdown').then((m) => ({
    default: m.StreamingMarkdown || m.default,
  }))
);

const WEB_SEARCH_PREF_KEY = 'researchWebSearchEnabled';
const THINK_LONGER_PREF_KEY = 'chatV2ThinkLongerEnabled';

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
  const inferenceOptions = state.effectiveInferenceOptions || state.activeInferenceOptions || {};
  const activeCtx = Number(inferenceOptions?.num_ctx || 0);
  const activeBatch = Number(inferenceOptions?.num_batch || 0);
  const activeGpuLayers = Number.isFinite(Number(inferenceOptions?.num_gpu))
    ? Number(inferenceOptions.num_gpu)
    : null;
  const requestedModel = state.requestedModel || state.model || runtimeState?.requestedModel || null;
  const effectiveModel = state.effectiveModel || runtimeState?.effectiveModel || requestedModel;
  const executionMode = state.executionMode || runtimeState?.lastExecutionMode || null;
  const modeReasons = Array.isArray(state.modeReasons) && state.modeReasons.length > 0
    ? state.modeReasons
    : (Array.isArray(runtimeState?.modeReasons) ? runtimeState.modeReasons : []);
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

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const value = input.trim();
    if (!value) return;
    setInput('');
    if (state.isGenerating) {
      await engine.steer(value, sendMetadataRef.current);
    } else {
      await engine.sendUserMessage(value, sendMetadataRef.current);
    }
  }, [input, engine, state.isGenerating]);

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
    setInput('');
    if (state.isGenerating) {
      await engine.steer(value, sendMetadataRef.current);
    } else {
      await engine.sendUserMessage(value, sendMetadataRef.current);
    }
  }, [engine, state.isGenerating]);

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
    try {
      await engine.warmupModel(state.model, { lane: 'lane_interactive' });
    } finally {
      setIsWarmingModel(false);
    }
  }, [engine, state.model]);

  const controlMetadata = useMemo(() => ({
    ...(canUseWebSearch ? { webSearchEnabled } : {}),
    ...(thinkLongerEnabled ? { thinkLonger: true } : {}),
  }), [canUseWebSearch, webSearchEnabled, thinkLongerEnabled]);

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
              </div>
            </div>
          </div>
        )}
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
                <ReasoningPanel reasoning={streamReasoningPanelData} className="mt-2" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {state.error && (
        <div role="alert" className="border-t border-red-400/15 bg-red-500/[0.06] px-4 py-2">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 text-[12px] text-red-300/90">
            <span className="truncate">{state.error}</span>
            <button type="button" className="shrink-0 text-red-400/70 hover:text-red-300 transition" onClick={() => engine.clearError()} aria-label="Dismiss error">
              <X size={14} />
            </button>
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
