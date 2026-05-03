/**
 * SparkModelHubPanel
 * DevForge-local model command center for DGX Spark + Ollama + LM Studio GGUF + Continue.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Code2,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Loader2,
  MemoryStick,
  Monitor,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';

const callHub = async (method, ...args) => {
  const api = window?.electronAPI;
  if (!api?.[method]) throw new Error(`Missing electronAPI.${method}. Add the Spark Model Hub preload wiring.`);
  return api[method](...args);
};

const fitStyles = {
  excellent: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  good: 'border-lime-400/30 bg-lime-500/10 text-lime-200',
  tight: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  blocked: 'border-red-400/30 bg-red-500/10 text-red-200',
  unknown: 'border-white/10 bg-white/5 text-white/70',
};

const categoryLabels = {
  daily: 'Daily',
  coding: 'Coding',
  reasoning: 'Reasoning',
  heavy: 'Heavy',
  embedding: 'RAG / Embeddings',
};

function getRecommendedUse(model = {}) {
  const haystack = `${model.name || ''} ${model.model || ''} ${model.title || ''} ${model.family || ''}`.toLowerCase();
  if (haystack.includes('obliterated') || haystack.includes('experimental')) return 'Experimental';
  if (haystack.includes('devstral')) return 'Agent / Codebase Work';
  if (haystack.includes('gpt-oss')) return 'Reasoning';
  if (haystack.includes('qwen') || haystack.includes('coder')) return 'Coding';
  if (haystack.includes('gemma')) return 'Daily Assistant';
  if (haystack.includes('mistral')) return 'Heavy Reasoning / General';
  return 'Local Model';
}

function formatParameterSize(model = {}) {
  if (model.parameterSize) return model.parameterSize;
  if (Number.isFinite(Number(model.parametersB))) return `${Number(model.parametersB)}B`;
  return model.details?.parameter_size || 'unknown';
}

function formatModifiedAt(value) {
  if (!value) return 'unknown';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatCard({ icon: Icon, label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'border-white/10 bg-white/[0.04]',
    good: 'border-emerald-400/20 bg-emerald-500/10',
    warn: 'border-amber-400/20 bg-amber-500/10',
    bad: 'border-red-400/20 bg-red-500/10',
  };
  return (
    <div className={`rounded-2xl border ${tones[tone]} p-4 shadow-xl shadow-black/20`}>
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-black/30 p-2 text-cyan-200">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
          <div className="truncate text-lg font-semibold text-white">{value ?? '-'}</div>
          {sub ? <div className="truncate text-xs text-white/45">{sub}</div> : null}
        </div>
      </div>
    </div>
  );
}

function FitBadge({ fit }) {
  const label = fit?.label || 'unknown';
  const className = fitStyles[label] || fitStyles.unknown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${className}`}>
      {fit?.canRunNow === false ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
      {label}
    </span>
  );
}

function ActionButton({ children, onClick, disabled, tone = 'primary', icon: Icon }) {
  const tones = {
    primary: 'bg-cyan-500 text-black hover:bg-cyan-300 disabled:bg-cyan-500/30',
    soft: 'bg-white/10 text-white hover:bg-white/15 disabled:bg-white/5 disabled:text-white/30',
    danger: 'bg-red-500/20 text-red-100 hover:bg-red-500/30 disabled:bg-red-500/10 disabled:text-red-200/30',
    green: 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 disabled:bg-emerald-500/10 disabled:text-emerald-200/30',
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${tones[tone]} disabled:cursor-not-allowed`}
    >
      {Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}

function isMoeCandidateName(value = '') {
  const lower = String(value || '').toLowerCase();
  return lower.includes('gpt-oss') || lower.includes('mixtral') || lower.includes('moe') || /qwen.*a\d+b/.test(lower);
}

function ModelCard({ model, onRun, onStop, onDelete, onSetCoding, onImport, onApplySparkPreset, installed, loaded }) {
  const name = model.name || model.title || model.model;
  const required = model.requiredGiB ? `${model.requiredGiB.toFixed(1)} GiB est.` : 'estimate unknown';
  const status = loaded ? 'Loaded' : model.status || (installed ? 'Downloaded' : 'Ready to pull');
  const recommendedUse = getRecommendedUse(model);
  const family = model.family || model.details?.family || 'unknown';
  const parameterSize = formatParameterSize(model);
  const quantization = model.quantization || model.details?.quantization_level || 'unknown';
  const modifiedAt = formatModifiedAt(model.modifiedAt || model.modified_at);
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4 shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-white">{name}</h3>
            <FitBadge fit={model.fit} />
            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100">Recommended Use: {recommendedUse}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60">{status}</span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-2 xl:grid-cols-3">
            <span className="rounded-lg bg-white/[0.04] px-2 py-1">Family: <b className="font-medium text-white/80">{family}</b></span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1">Parameters: <b className="font-medium text-white/80">{parameterSize}</b></span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1">Quant: <b className="font-medium text-white/80">{quantization}</b></span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1">Size: <b className="font-medium text-white/80">{model.sizeLabel || 'unknown'}</b></span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1">Modified: <b className="font-medium text-white/80">{modifiedAt}</b></span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1">Memory: <b className="font-medium text-white/80">{model.memoryImpact || required}</b></span>
          </div>
        </div>
      </div>

      {model.fit?.message ? <p className="mt-3 rounded-xl bg-black/30 p-3 text-sm text-white/70">{model.fit.message}</p> : null}
      {model.fit?.guidance ? <p className="mt-2 text-sm text-cyan-100/70">{model.fit.guidance}</p> : null}
      {model.notes ? <p className="mt-2 text-sm leading-relaxed text-white/55">{model.notes}</p> : null}

      {model.bestFor?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {model.bestFor.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-white/60">{tag}</span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {onImport ? <ActionButton icon={Package} tone="green" onClick={() => onImport(model)}>Import GGUF</ActionButton> : null}
        {onRun ? <ActionButton icon={Play} disabled={model.fit?.canRunNow === false} onClick={() => onRun(model.model || model.name)}>Run / Test</ActionButton> : null}
        {onStop ? <ActionButton icon={Square} tone="soft" onClick={() => onStop(model.model || model.name)}>Stop</ActionButton> : null}
        {onSetCoding ? <ActionButton icon={Code2} tone="soft" onClick={() => onSetCoding(model.model || model.name, model.title || model.name)}>Add to Cursor/Continue</ActionButton> : null}
        {onDelete ? <ActionButton icon={Trash2} tone="danger" onClick={() => onDelete(model.model || model.name)}>Delete</ActionButton> : null}
      </div>
      {onApplySparkPreset && isMoeCandidateName(name) ? (
        <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.05] p-3">
          <div className="mb-2 text-xs font-medium text-cyan-100">Spark quality preset</div>
          <div className="flex flex-wrap gap-2">
            {['stable', 'recommended', 'aggressive'].map((level) => (
              <ActionButton key={level} tone="soft" onClick={() => onApplySparkPreset(model.model || model.name, level)}>
                {level[0].toUpperCase() + level.slice(1)}
              </ActionButton>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JobRow({ job }) {
  const latest = job.log?.slice(-1)?.[0]?.text?.trim();
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{job.label || job.id}</div>
          <div className="text-xs text-white/45">{job.status} {job.progressPct != null ? `- ${job.progressPct}%` : ''}</div>
        </div>
        {job.status === 'running' ? <Loader2 size={16} className="animate-spin text-cyan-300" /> : <CheckCircle2 size={16} className="text-emerald-300" />}
      </div>
      {job.progressPct != null ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-cyan-400" style={{ width: `${job.progressPct}%` }} />
        </div>
      ) : null}
      {latest ? <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-xs text-white/50">{latest}</pre> : null}
    </div>
  );
}

export function SparkModelHubPanel({ embedded = false, onClose }) {
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [customPull, setCustomPull] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await callHub('sparkModelHubDashboard');
      setDashboard(data);
    } catch (err) {
      setError(err.message || String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    let cleanup;
    try {
      cleanup = window?.electronAPI?.onSparkModelHubJob?.((job) => {
        setDashboard((prev) => (prev ? { ...prev, jobs: [job, ...(prev.jobs || []).filter((item) => item.id !== job.id)] } : prev));
      });
    } catch {
      // Preload may be unavailable in browser preview.
    }
    return () => {
      clearInterval(interval);
      cleanup?.();
    };
  }, [refresh]);

  const installed = dashboard?.ollama?.installed || [];
  const loaded = dashboard?.ollama?.loaded || [];
  const lmstudio = dashboard?.lmstudio?.models || [];
  const recommendations = dashboard?.recommendations || [];
  const jobs = dashboard?.jobs || [];
  const loadedNames = useMemo(() => new Set(loaded.map((model) => model.name || model.model)), [loaded]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filter = (items) => (!q ? items : items.filter((model) => JSON.stringify(model).toLowerCase().includes(q)));
    return {
      installed: filter(installed),
      lmstudio: filter(lmstudio),
      recommendations: filter(recommendations),
    };
  }, [query, installed, lmstudio, recommendations]);

  const doAction = async (label, fn) => {
    setBusy(label);
    setError(null);
    setLastAction(null);
    try {
      const res = await fn();
      if (res?.success === false) throw new Error(res.guidance || res.error || `${label} failed`);
      setLastAction(res?.message || `${label} started/completed.`);
      await refresh();
      return res;
    } catch (err) {
      setError(err.message || String(err));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runModel = (model) => doAction(`Run ${model}`, () => callHub('sparkModelHubRunModel', model));
  const stopModel = (model) => doAction(`Stop ${model}`, () => callHub('sparkModelHubStopModel', model));
  const deleteModel = (model) => doAction(`Delete ${model}`, () => callHub('sparkModelHubDeleteModel', model));
  const pullModel = (model) => doAction(`Pull ${model}`, () => callHub('sparkModelHubPullModel', model));
  const setCoding = (model, title) => doAction('Set coding model', () => callHub('sparkModelHubSetContinueModel', {
    model,
    title,
    apiBase: 'http://localhost:11434',
    contextLength: 8192,
    temperature: 0.2,
  }));
  const applySparkPreset = (modelName, level = 'recommended') => doAction(`Apply Spark ${level}`, () => {
    const profiles = {
      stable: { context_length: 4096, advanced_options: { num_ctx: 4096, num_batch: 48, kv_cache_type: 'q4_0', num_gpu: -1, flash_attn: true, num_predict: 768 } },
      recommended: { context_length: 8192, advanced_options: { num_ctx: 8192, num_batch: 64, kv_cache_type: 'q4_0', num_gpu: -1, flash_attn: true, num_predict: 1024 } },
      aggressive: { context_length: 12288, advanced_options: { num_ctx: 12288, num_batch: 96, kv_cache_type: 'q4_0', num_gpu: -1, flash_attn: true, num_predict: 1536 } },
    };
    const profile = profiles[level] || profiles.recommended;
    return window.electronAPI?.saveModelPreset?.({
      model_name: modelName,
      workspace: 'casual',
      is_default: true,
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
      context_length: profile.context_length,
      task_intent: 'reasoning',
      advanced_options: profile.advanced_options,
    });
  });
  const restartOllama = () => doAction('Restart Ollama', () => callHub('sparkModelHubRestartOllama'));
  const startOllamaProvider = () => doAction('Start Ollama', () => window?.electronAPI?.startOllama?.());
  const stopOllamaProvider = () => doAction('Stop Ollama', () => window?.electronAPI?.stopOllama?.());
  const installOllamaProvider = () => doAction('Install Ollama', () => window?.electronAPI?.installOllama?.());
  const importGguf = (model) => doAction(`Import ${model.name}`, () => callHub('sparkModelHubImportGgufToOllama', {
    filePath: model.primaryPath,
    modelName: model.name,
    contextLength: 8192,
    temperature: 0.2,
  }));
  const openWebUi = () => {
    const url = dashboard?.openWebui?.url || 'http://localhost:12000';
    window?.electronAPI?.openExternal?.(url);
  };
  const handleCustomPull = async (event) => {
    event?.preventDefault?.();
    const name = String(customPull || '').trim();
    if (!name) return;
    await pullModel(name);
    setCustomPull('');
  };

  const sys = dashboard?.system;
  const summary = dashboard?.runtimeSummary || {};
  const ollamaHealthy = dashboard?.ollama?.health?.running;
  const container = embedded ? 'w-full h-full' : 'fixed inset-0 z-[9999] bg-black/80 p-4';
  const blockedModels = filtered.installed.filter((model) => model.fit?.canRunNow === false);

  return (
    <div className={container}>
      <div className="mx-auto flex h-full max-h-[96vh] max-w-7xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#08090d] shadow-2xl shadow-black">
        <header className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-cyan-500/10 via-violet-500/10 to-emerald-500/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-400/15 p-3 text-cyan-200">
              <Sparkles size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Model Hub / AI Runtime Manager</h2>
              <p className="text-sm text-white/50">Local Ollama models, runtime state, memory, and coding assistant control.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ActionButton icon={RefreshCw} tone="soft" onClick={refresh} disabled={Boolean(busy)}>Refresh</ActionButton>
            {onClose ? <button onClick={onClose} className="rounded-xl bg-white/10 p-2 text-white/70 hover:bg-white/15"><X size={18} /></button> : null}
          </div>
        </header>

        <div className="grid flex-1 grid-cols-[240px_1fr] overflow-hidden">
          <aside className="border-r border-white/10 bg-black/25 p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-2.5 text-white/30" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-cyan-400/50"
              />
            </div>
            {[
              ['overview', Monitor, 'Overview'],
              ['installed', Package, 'Installed'],
              ['discover', Download, 'Recommended'],
              ['lmstudio', Database, 'LM Studio GGUFs'],
              ['coding', Code2, 'Coding Setup'],
              ['jobs', Activity, 'Jobs / Downloads'],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${activeTab === id ? 'bg-cyan-400/15 text-cyan-100' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
              >
                <span className="flex items-center gap-2"><Icon size={16} />{label}</span>
                <ChevronRight size={14} />
              </button>
            ))}

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
              <div className="mb-2 flex items-center gap-2 font-medium text-white/70"><Server size={14} /> Runtime</div>
              <div>Ollama: <span className={ollamaHealthy ? 'text-emerald-300' : 'text-red-300'}>{ollamaHealthy ? 'online' : 'offline'}</span></div>
              <div className="truncate">API: <span className="text-white/70">localhost:11434</span></div>
              <div>Continue: <span className="text-white/70">{dashboard?.continue?.currentModel || 'not set'}</span></div>
              <div>Open WebUI: <span className="text-white/70">optional external UI</span></div>
            </div>
          </aside>

          <main className="overflow-y-auto p-5">
            {error ? <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-100"><AlertTriangle className="mr-2 inline" size={16} />{error}</div> : null}
            {lastAction ? <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-emerald-100"><CheckCircle2 className="mr-2 inline" size={16} />{lastAction}</div> : null}
            {busy ? <div className="mb-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-cyan-100"><Loader2 className="mr-2 inline animate-spin" size={16} />{busy}</div> : null}

            {!dashboard && !error ? (
              <div className="flex h-96 items-center justify-center text-white/50"><Loader2 className="mr-2 animate-spin" />Loading Runtime Center...</div>
            ) : null}

            {dashboard && activeTab === 'overview' ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <StatCard icon={Bot} label="Ollama" value={ollamaHealthy ? 'Running' : 'Offline'} sub={dashboard?.ollama?.health?.version || dashboard?.ollama?.health?.error} tone={ollamaHealthy ? 'good' : 'bad'} />
                  <StatCard icon={ExternalLink} label="Open WebUI" value="Optional" sub="Separate app login; not needed for DevForge" />
                  <StatCard icon={Code2} label="Coding Model" value={dashboard?.continue?.currentModel || 'Not set'} sub={dashboard?.continue?.apiBase || dashboard?.continue?.path} />
                  <StatCard icon={MemoryStick} label="Memory available" value={sys?.memory?.availableLabel} sub={`${sys?.memory?.totalLabel || ''} total`} tone={(sys?.memory?.availableGiB || 0) > 95 ? 'good' : (sys?.memory?.availableGiB || 0) > 55 ? 'warn' : 'bad'} />
                  <StatCard icon={Package} label="Loaded Models" value={summary.loadedModelCount || 0} sub={summary.topLoadedModel?.name || 'Nothing resident'} />
                  <StatCard icon={Cpu} label="GPU / Spark" value={sys?.gpu?.available ? (sys.gpu.name || 'NVIDIA GPU') : 'Unknown'} sub={sys?.gpu?.available ? `${sys.gpu.utilizationGpuPct ?? '-'}% load` : sys?.gpu?.error} />
                </div>

                <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Providers</h3>
                      <p className="text-sm text-white/45">Ollama, Open WebUI, and Continue. Start, stop, and configure without the terminal.</p>
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                      <div className="flex items-center gap-2">
                        <Bot size={16} className="text-cyan-200" />
                        <div className="font-semibold text-white">Ollama</div>
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${ollamaHealthy ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border border-red-400/30 bg-red-500/10 text-red-200'}`}>
                          {ollamaHealthy ? 'running' : 'offline'}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-white/45">{dashboard?.ollama?.health?.host || 'http://127.0.0.1:11434'}{dashboard?.ollama?.health?.version ? ` - v${dashboard.ollama.health.version}` : ''}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {ollamaHealthy ? (
                          <>
                            <ActionButton tone="soft" icon={RefreshCw} onClick={restartOllama}>Restart</ActionButton>
                            <ActionButton tone="soft" icon={Square} onClick={stopOllamaProvider}>Stop</ActionButton>
                          </>
                        ) : (
                          <>
                            <ActionButton tone="green" icon={Play} onClick={startOllamaProvider}>Start</ActionButton>
                            <ActionButton tone="soft" icon={Download} onClick={installOllamaProvider}>Install</ActionButton>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                      <div className="flex items-center gap-2">
                        <ExternalLink size={16} className="text-cyan-200" />
                        <div className="font-semibold text-white">Open WebUI</div>
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${summary.openWebuiRunning ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
                          optional
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-white/45">
                        {dashboard?.openWebui?.url || 'http://localhost:12000'} - separate login, not required for local model control.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton tone="soft" icon={ExternalLink} onClick={openWebUi}>Open optional UI</ActionButton>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                      <div className="flex items-center gap-2">
                        <Code2 size={16} className="text-cyan-200" />
                        <div className="font-semibold text-white">Continue (Cursor)</div>
                        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${dashboard?.continue?.currentModel ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
                          {dashboard?.continue?.currentModel ? 'configured' : 'unset'}
                        </span>
                      </div>
                      <div className="mt-2 truncate text-xs text-white/45">Model: {dashboard?.continue?.currentModel || 'not set'}</div>
                      <div className="truncate text-xs text-white/35">{dashboard?.continue?.path}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton tone="soft" icon={Code2} onClick={() => setActiveTab('coding')}>Set / change model</ActionButton>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white">What needs attention</h3>
                      <p className="text-sm text-white/45">Plain-English guidance for memory, loaded models, and runtime state.</p>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {blockedModels.slice(0, 4).map((model) => (
                      <div key={model.id || model.name} className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
                        <div className="font-semibold">{model.name}</div>
                        <div className="mt-1 text-red-100/75">{model.fit.message}</div>
                        <div className="mt-1 text-red-100/60">{model.fit.guidance}</div>
                      </div>
                    ))}
                    {!blockedModels.length ? (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">No obvious memory blockers right now.</div>
                    ) : null}
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
                      <div className="font-semibold text-white">Loaded models</div>
                      <div className="mt-1">{summary.loadedModelCount || 0} loaded. {summary.topLoadedModel?.name ? `${summary.topLoadedModel.name} is the largest resident model.` : 'Nothing is resident right now.'}</div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-lg font-semibold text-white">Loaded models</h3>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {loaded.length ? loaded.map((model) => <ModelCard key={model.name} model={model} loaded onStop={stopModel} onSetCoding={setCoding} onApplySparkPreset={applySparkPreset} />) : <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/50">No Ollama models currently loaded.</div>}
                  </div>
                </section>
              </div>
            ) : null}

            {dashboard && activeTab === 'installed' ? (
              filtered.installed.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {filtered.installed.map((model) => <ModelCard key={model.name} model={model} installed loaded={loadedNames.has(model.name)} onRun={runModel} onStop={stopModel} onSetCoding={setCoding} onDelete={deleteModel} onApplySparkPreset={applySparkPreset} />)}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-white/60">
                  <div className="font-semibold text-white">No local Ollama models found.</div>
                  <div className="mt-1 text-sm text-white/45">Start Ollama and pull a model, then refresh this screen.</div>
                  <form onSubmit={handleCustomPull} className="mt-4 flex flex-wrap gap-2">
                    <input
                      value={customPull}
                      onChange={(event) => setCustomPull(event.target.value)}
                      placeholder="qwen2.5-coder:7b"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
                    />
                    <ActionButton icon={Download} onClick={handleCustomPull} disabled={!customPull.trim() || Boolean(busy)}>Pull Model</ActionButton>
                  </form>
                </div>
              )
            ) : null}

            {dashboard && activeTab === 'discover' ? (
              <div className="space-y-5">
                <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Pull any Ollama model</h3>
                      <p className="text-sm text-white/45">Type any tag from the Ollama library, like <code className="rounded bg-black/40 px-1 py-0.5 text-cyan-200">qwen2.5-coder:7b</code> or <code className="rounded bg-black/40 px-1 py-0.5 text-cyan-200">llama3.2:3b</code>. Progress shows in Jobs.</p>
                    </div>
                  </div>
                  <form onSubmit={handleCustomPull} className="mt-3 flex flex-wrap gap-2">
                    <input
                      value={customPull}
                      onChange={(event) => setCustomPull(event.target.value)}
                      placeholder="model name, e.g. qwen2.5-coder:7b"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
                    />
                    <ActionButton icon={Plus} onClick={handleCustomPull} disabled={!customPull.trim() || Boolean(busy)}>Pull</ActionButton>
                  </form>
                </section>

                {Object.entries(categoryLabels).map(([cat, label]) => {
                  const items = filtered.recommendations.filter((model) => model.category === cat);
                  if (!items.length) return null;
                  return (
                    <section key={cat}>
                      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white"><Wand2 size={18} />{label}</h3>
                      <div className="grid gap-4 lg:grid-cols-2">
                        {items.map((model) => <ModelCard key={model.id} model={model} installed={model.installed} loaded={model.loaded} onRun={model.installed ? runModel : null} onStop={model.installed ? stopModel : null} onSetCoding={model.installed ? setCoding : null} onDelete={model.installed ? deleteModel : null} onApplySparkPreset={applySparkPreset} />)}
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {items.filter((model) => !model.installed && model.command).map((model) => (
                          <div key={`${model.id}-download`} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                            <div className="font-semibold text-white">Download {model.title}</div>
                            <div className="mt-1 text-xs text-white/40">{model.command}</div>
                            <div className="mt-3"><ActionButton icon={Download} onClick={() => pullModel(model.model.replace(':latest', ''))}>Download</ActionButton></div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : null}

            {dashboard && activeTab === 'lmstudio' ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                  These are GGUF files already downloaded by LM Studio. Importing creates an Ollama tag without redownloading.
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {filtered.lmstudio.map((model) => <ModelCard key={model.id} model={model} onImport={importGguf} />)}
                </div>
              </div>
            ) : null}

            {dashboard && activeTab === 'coding' ? (
              <div className="space-y-5">
                <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">Coding model for Cursor / Continue</h3>
                      <p className="mt-1 text-sm leading-relaxed text-white/55">
                        Pick a local model. DevForge will write Continue&apos;s <code className="rounded bg-black/40 px-1 py-0.5 text-cyan-200">~/.continue/config.yaml</code> and back up the existing file. No terminal required.
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] ${dashboard?.continue?.currentModel ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
                      {dashboard?.continue?.currentModel ? `Active: ${dashboard.continue.currentModel}` : 'Not set'}
                    </span>
                  </div>
                  <div className="mt-4 rounded-2xl bg-black/40 p-4 font-mono text-xs text-white/60">
                    apiBase: {dashboard?.continue?.apiBase || 'http://localhost:11434'}<br />
                    model: {dashboard?.continue?.currentModel || 'not set'}<br />
                    config: {dashboard?.continue?.path}
                  </div>
                </section>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-white/70">Click "Add to Cursor/Continue" on any installed model</h4>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {filtered.installed.length ? (
                      filtered.installed.map((model) => <ModelCard key={model.name} model={model} installed loaded={loadedNames.has(model.name)} onSetCoding={setCoding} onRun={runModel} onStop={stopModel} onApplySparkPreset={applySparkPreset} />)
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/50">No installed models yet. Pull one from <button type="button" className="underline" onClick={() => setActiveTab('discover')}>Recommended</button>.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {dashboard && activeTab === 'jobs' ? (
              <div className="space-y-4">
                {jobs.length ? jobs.map((job) => <JobRow key={job.id} job={job} />) : <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-white/50">No model runtime jobs yet.</div>}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

export default SparkModelHubPanel;
