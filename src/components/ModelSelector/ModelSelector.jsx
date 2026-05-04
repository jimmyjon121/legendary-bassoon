import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  FolderSearch,
  Info,
  Layers,
  List,
  Loader,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'framer-motion';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAppStore } from '../../stores/appStore';
import { api as electronAPI } from '../../utils/electronAPI';
import { triggerWarmupWithProgress } from '../../stores/modelWarmupStore';
import { ModelExperienceWorkbench } from '../../chat-v2/ui/ModelExperienceWorkbench';
import { isVaultWorkspace } from '../../core/types';
import {
  DEVICE_PIN_OPTIONS,
  buildLibraryIndex,
  estimateFit,
  formatBytes,
  groupModels,
  hasEnoughSuccessfulOutcomes,
  normalizeSelectorModel,
  scoreModel,
} from './modelSelectorCatalogue';

const QUANT_FILTERS = ['all', 'Q4', 'Q5', 'Q6', 'Q8', 'F16'];
const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'recent', label: 'Recent' },
  { id: 'added', label: 'Added' },
  { id: 'speed', label: 'Speed' },
  { id: 'size', label: 'Size' },
  { id: 'name', label: 'Name' },
];
const SOURCE_FILTERS = [
  { id: 'all', label: 'All sources' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'llamanode', label: 'Imported GGUF' },
  { id: 'npu', label: 'OpenVINO NPU' },
];
const ADDED_FILTERS = [
  { id: 'all', label: 'Any added date' },
  { id: '24h', label: 'Added today' },
  { id: '7d', label: 'Added 7 days' },
  { id: '30d', label: 'Added 30 days' },
  { id: 'unknown', label: 'Unknown date' },
];
const ADDED_FILTER_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function recordSelectorEvent(type, payload = {}) {
  try {
    const key = 'devforge:modelSelectorTelemetry';
    const current = JSON.parse(window.localStorage.getItem(key) || '[]');
    current.push({ type, payload, at: Date.now() });
    window.localStorage.setItem(key, JSON.stringify(current.slice(-200)));
  } catch (_) {
    // Local-only telemetry is best-effort.
  }
}

function renderToken(value, fallback = 'auto') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    return String(value.id || value.name || value.label || value.type || fallback);
  }
  return fallback;
}

function parseModelTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getModelAddedInfo(model) {
  const candidates = [
    ['Added', model.library?.addedAt],
    ['Added', model.meta?.addedAt],
    ['Registered', model.meta?.registeredAt],
    ['Modified', model.meta?.modifiedAt],
    ['Modified', model.meta?.modified_at],
    ['Updated', model.library?.updatedAt],
    ['Last used', model.library?.lastUsed],
    ['Last used', model.meta?.lastUsedAt],
    ['Last tested', model.insight?.outcomeSummary?.lastSuccessAt],
  ];
  for (const [label, value] of candidates) {
    const time = parseModelTime(value);
    if (time > 0) return { label, time, value };
  }
  return { label: 'Added', time: 0, value: null };
}

function formatModelAddedInfo(model) {
  const info = getModelAddedInfo(model);
  if (!info.time) return 'Added date unknown';
  const date = new Date(info.time);
  return `${info.label} ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function matchesAddedFilter(model, filter) {
  if (filter === 'all') return true;
  const addedTime = getModelAddedInfo(model).time;
  if (filter === 'unknown') return !addedTime;
  const range = ADDED_FILTER_MS[filter];
  if (!range || !addedTime) return false;
  return Date.now() - addedTime <= range;
}

function isSparkMoeCandidate(value = '') {
  const lower = String(value || '').toLowerCase();
  return lower.includes('gpt-oss') || lower.includes('mixtral') || lower.includes('moe') || /qwen.*a\d+b/.test(lower);
}

async function saveSparkPreset(modelName, level = 'recommended') {
  const profiles = {
    stable: { context_length: 4096, advanced_options: { num_ctx: 4096, num_batch: 48, kv_cache_type: 'q4_0', num_gpu: -1, flash_attn: true, num_predict: 768 } },
    recommended: { context_length: 8192, advanced_options: { num_ctx: 8192, num_batch: 64, kv_cache_type: 'q4_0', num_gpu: -1, flash_attn: true, num_predict: 1024 } },
    aggressive: { context_length: 12288, advanced_options: { num_ctx: 12288, num_batch: 96, kv_cache_type: 'q4_0', num_gpu: -1, flash_attn: true, num_predict: 1536 } },
  };
  const profile = profiles[level] || profiles.recommended;
  return electronAPI.saveModelPreset?.({
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
}

function FitBar({ fit }) {
  const pct = fit?.availableGb > 0 ? Math.min(100, (fit.projectedGb / fit.availableGb) * 100) : 0;
  const tone = fit?.status === 'comfortable'
    ? 'bg-emerald-400'
    : fit?.status === 'tight'
      ? 'bg-amber-400'
      : fit?.status === 'blocked'
        ? 'bg-rose-500'
        : 'bg-sky-400';
  return (
    <div className="min-w-[140px]">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${tone}`} style={{ width: `${pct || 12}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-text-muted">
        {fit?.label || 'Fit unknown'}
        {fit?.projectedGb > 0 && fit?.availableGb > 0
          ? ` · ${fit.projectedGb.toFixed(1)}/${fit.availableGb.toFixed(1)} GB`
          : ''}
      </div>
    </div>
  );
}

function CapabilityBadges({ caps = [], limit = 4 }) {
  return (
    <div className="flex flex-wrap gap-1">
      {caps.slice(0, limit).map((cap) => (
        <span key={cap} className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-text-secondary">
          {cap}
        </span>
      ))}
    </div>
  );
}

function VariantRow({
  model,
  active,
  focused,
  compareActive,
  onUse,
  onDetails,
  onCompare,
  onWorkbench,
  onPin,
  onAlias,
}) {
  const insight = model.insight || {};
  const outcome = insight.outcomeSummary || {};
  const plan = insight.experiencePlan?.plan || {};
  const specPair = insight.specPair;
  return (
    <div
      role="option"
      aria-selected={focused || active}
      className={`rounded-lg border p-3 transition ${
        active
          ? 'border-cyan-400/35 bg-cyan-500/10'
          : focused
            ? 'border-white/25 bg-white/[0.06]'
            : 'border-white/10 bg-black/15 hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
          {model.source === 'npu' ? <Zap size={18} className="text-violet-300" /> : <Bot size={18} className="text-cyan-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-semibold text-text-primary">{model.displayName}</p>
                {active && <Check size={14} className="shrink-0 text-cyan-300" />}
                {model.alias && <Star size={13} className="shrink-0 text-amber-300" />}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted" title={model.rawName}>
                {model.rawName}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-200">
                {model.score}
              </span>
              <button type="button" onClick={() => onDetails(model)} className="rounded-md p-1.5 text-text-muted hover:bg-white/10 hover:text-text-primary" title="Details">
                <Info size={14} />
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-text-secondary">{model.variantLabel}</span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-text-secondary">{formatBytes(model.sizeBytes)}</span>
            {model.contextLength && (
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-text-secondary">ctx {model.contextLength.toLocaleString()}</span>
            )}
            {specPair?.draftModelId && (
              <span title={`Draft: ${specPair.draftModelId}`} className="inline-flex items-center gap-1 rounded-md border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-200">
                <Zap size={10} /> Spec
              </span>
            )}
            <CapabilityBadges caps={model.capabilities} />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <p className="line-clamp-2 text-[12px] leading-5 text-text-secondary">{model.description}</p>
              <p className="mt-1 truncate text-[11px] text-text-muted">
                Autopilot: {renderToken(plan.explicitBackendPin || plan.softBackendPreference)} · ctx {renderToken(plan.effectiveOptions?.num_ctx || model.contextLength)}
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                {formatModelAddedInfo(model)} · Last runs: {outcome.successCount || 0} success / {outcome.failureCount || 0} fail
                {outcome.avgTokensPerSecond ? ` · ${outcome.avgTokensPerSecond.toFixed(1)} TPS` : ''}
                {outcome.avgFirstTokenMs ? ` · ${Math.round(outcome.avgFirstTokenMs)} ms TTFT` : ''}
              </p>
            </div>
            <FitBar fit={model.fit} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onUse(model)} className="btn btn-primary px-3 py-1.5 text-xs">
              <Play size={13} /> Use
            </button>
            <button type="button" onClick={() => onWorkbench(model)} className="btn btn-secondary px-3 py-1.5 text-xs">
              <BarChart3 size={13} /> Workbench
            </button>
            <button type="button" onClick={() => onCompare(model)} className={`btn btn-secondary px-3 py-1.5 text-xs ${compareActive ? 'border-cyan-400/35 text-cyan-200' : ''}`}>
              <Layers size={13} /> Compare
            </button>
            <button type="button" onClick={() => onPin(model)} className="btn btn-secondary px-3 py-1.5 text-xs">
              <Pin size={13} /> Pin
            </button>
            <button type="button" onClick={() => onAlias(model)} className="btn btn-secondary px-3 py-1.5 text-xs">
              <Star size={13} /> Alias
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StateBanner({ state, selectorError, onStartOllama, onOpenHub, onUseLocal, onRefresh }) {
  if (state === 'online-enriched' && !selectorError) return null;
  const copy = {
    loading: ['Loading catalogue', 'Checking local runtimes and cached metadata.'],
    empty: ['No models found', 'Start Ollama, open the hub, or register a local GGUF.'],
    'offline-cached': ['Offline catalogue', 'Using cached and installed metadata only.'],
    'installed-only': ['Installed catalogue', 'Online enrichment is cache-only or unavailable.'],
    'source-error': ['Partial catalogue', selectorError || 'One or more model sources failed to refresh.'],
  }[state] || ['Catalogue status', selectorError || 'Ready'];
  return (
    <div className="mx-4 mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3">
      <p className="text-xs font-semibold text-amber-100">{copy[0]}</p>
      <p className="mt-1 text-xs text-text-secondary">{copy[1]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onStartOllama} className="btn btn-secondary px-3 py-1.5 text-xs">Start Ollama</button>
        <button type="button" onClick={onOpenHub} className="btn btn-secondary px-3 py-1.5 text-xs">Open Model Hub</button>
        <button type="button" onClick={onUseLocal} className="btn btn-secondary px-3 py-1.5 text-xs">Use local GGUF</button>
        <button type="button" onClick={onRefresh} className="btn btn-secondary px-3 py-1.5 text-xs"><RefreshCw size={12} /> Refresh</button>
      </div>
    </div>
  );
}

function AddModelMenu({ open, onToggle, onOpenHub, onUseLocal, onOpenNpu }) {
  const run = (action) => {
    onToggle(false);
    action?.();
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        className="btn btn-secondary px-3 py-2 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={14} /> Add model
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Add model"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-lg border border-forge-border bg-surface-2 shadow-2xl"
        >
          <button type="button" role="menuitem" onClick={() => run(onOpenHub)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05]">
            <Download size={15} className="mt-0.5 text-cyan-300" />
            <span>
              <span className="block text-xs font-medium text-text-primary">Pull Ollama variant</span>
              <span className="block text-[11px] text-text-muted">Open the Models runtime center to pull and manage models.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenHub)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05]">
            <Download size={15} className="mt-0.5 text-violet-300" />
            <span>
              <span className="block text-xs font-medium text-text-primary">HuggingFace GGUF</span>
              <span className="block text-[11px] text-text-muted">Open the browser/download flow already used by Hub.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onUseLocal)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05]">
            <Upload size={15} className="mt-0.5 text-emerald-300" />
            <span>
              <span className="block text-xs font-medium text-text-primary">Import local GGUF</span>
              <span className="block text-[11px] text-text-muted">Register a model file from disk.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenNpu)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.05]">
            <Settings size={15} className="mt-0.5 text-amber-300" />
            <span>
              <span className="block text-xs font-medium text-text-primary">Open NPU converter</span>
              <span className="block text-[11px] text-text-muted">Launch the existing Settings converter surface.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={() => run(onOpenHub)} className="flex w-full items-start gap-3 border-t border-forge-border px-3 py-2.5 text-left hover:bg-white/[0.05]">
            <FolderSearch size={15} className="mt-0.5 text-text-secondary" />
            <span>
              <span className="block text-xs font-medium text-text-primary">Open Runtime Center</span>
              <span className="block text-[11px] text-text-muted">Manage installed, loaded, and recommended models.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function CompareDrawer({ models, onClose, onUse, onWorkbench }) {
  if (!models.length) return null;
  return (
    <div role="dialog" aria-label="Compare selected models" className="absolute inset-y-0 right-0 z-20 w-full max-w-xl border-l border-forge-border bg-surface-2 shadow-2xl">
      <div className="flex items-center justify-between border-b border-forge-border p-4">
        <div>
          <p className="text-sm font-semibold text-text-primary">Compare</p>
          <p className="text-xs text-text-muted">{models.length} selected variants</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-2 text-text-muted hover:bg-white/10 hover:text-text-primary" aria-label="Close compare drawer">
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
        {models.map((model) => {
          const outcome = model.insight?.outcomeSummary || {};
          return (
            <div key={model.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="truncate text-sm font-semibold text-text-primary">{model.displayName}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-text-muted">{model.rawName}</p>
              <div className="mt-3 space-y-1 text-xs text-text-secondary">
                <p>Variant: {model.variantLabel}</p>
                <p>Source: {model.sourceLabel}</p>
                <p>Size: {formatBytes(model.sizeBytes)}</p>
                <p>Context: {model.contextLength ? model.contextLength.toLocaleString() : 'unknown'}</p>
                <p>Fit: {model.fit?.label || 'unknown'}</p>
                <p>History: {outcome.successCount || 0} success / {outcome.failureCount || 0} fail</p>
                <p>Speed: {outcome.avgTokensPerSecond ? `${outcome.avgTokensPerSecond.toFixed(1)} TPS` : 'no runs yet'}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => onUse(model)} className="btn btn-primary flex-1 px-2 py-1.5 text-xs">Use</button>
                <button type="button" onClick={() => onWorkbench(model)} className="btn btn-secondary flex-1 px-2 py-1.5 text-xs">Workbench</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailsDrawer({ model, onClose, onCopy, onAlias, onFavorite, onRate }) {
  if (!model) return null;
  return (
    <div role="dialog" aria-label="Model details" className="absolute inset-y-0 right-0 z-20 w-full max-w-lg border-l border-forge-border bg-surface-2 shadow-2xl">
      <div className="flex items-center justify-between border-b border-forge-border p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text-primary">{model.displayName}</p>
          <p className="truncate font-mono text-[11px] text-text-muted">{model.rawName}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-2 text-text-muted hover:bg-white/10 hover:text-text-primary" aria-label="Close details drawer">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-4 overflow-y-auto p-4 text-sm">
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">What it does</p>
          <p className="mt-1 text-text-secondary">{model.description}</p>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Identity</p>
          <div className="mt-2 space-y-1 text-xs text-text-secondary">
            <p>Family: {model.familyName}</p>
            <p>Variant: {model.variantLabel}</p>
            <p>Parent/base: {model.parentModel || 'none recorded'}</p>
            <p>Source: {model.sourceLabel}</p>
            <p>Format: {model.format || 'unknown'}</p>
          </div>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Raw ID</p>
          <button type="button" onClick={() => onCopy(model.rawId)} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2 text-left font-mono text-[11px] text-text-secondary hover:border-white/20">
            <Copy size={13} /> <span className="truncate">{model.rawId}</span>
          </button>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Caveats</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(model.caveats.length ? model.caveats : ['No caveats recorded.']).map((caveat) => (
              <span key={caveat} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-text-secondary">{caveat}</span>
            ))}
          </div>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Your rating</p>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Model rating">
            {[1, 2, 3, 4, 5].map((value) => {
              const active = Number(model.library?.rating || 0) >= value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onRate(model, value)}
                  className={`rounded-md border px-2 py-1 text-xs ${active ? 'border-amber-400/35 bg-amber-500/10 text-amber-200' : 'border-white/10 text-text-muted hover:bg-white/[0.04]'}`}
                  title={`${value} star${value === 1 ? '' : 's'}`}
                >
                  <Star size={13} />
                </button>
              );
            })}
          </div>
        </section>
        <div className="flex gap-2">
          <button type="button" onClick={() => onAlias(model)} className="btn btn-secondary flex-1 text-xs">Alias</button>
          <button type="button" onClick={() => onFavorite(model)} className="btn btn-secondary flex-1 text-xs">Favorite</button>
        </div>
      </div>
    </div>
  );
}

function PinDialog({ model, onClose, onSave }) {
  const [pin, setPin] = useState(model?.insight?.activePreset?.device_pin || '');
  if (!model) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-label="Pin model device" className="w-full max-w-sm rounded-xl border border-forge-border bg-surface-2 p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">Pin device</p>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-white/10"><X size={14} /></button>
        </div>
        <p className="mt-1 truncate text-xs text-text-muted">{model.displayName}</p>
        <select value={pin} onChange={(event) => setPin(event.target.value)} className="input mt-4 w-full py-2 text-sm">
          {DEVICE_PIN_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-xs">Cancel</button>
          <button type="button" onClick={() => onSave(model, pin)} className="btn btn-primary text-xs">Save</button>
        </div>
      </div>
    </div>
  );
}

function AliasDialog({ model, onClose, onSave }) {
  const [alias, setAlias] = useState(model?.alias || '');
  if (!model) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-label="Edit model alias" className="w-full max-w-sm rounded-xl border border-forge-border bg-surface-2 p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">Model alias</p>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-white/10"><X size={14} /></button>
        </div>
        <p className="mt-1 truncate font-mono text-[11px] text-text-muted">{model.rawName}</p>
        <input value={alias} onChange={(event) => setAlias(event.target.value)} className="input mt-4 w-full py-2 text-sm" placeholder="Friendly name" autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-xs">Cancel</button>
          <button type="button" onClick={() => onSave(model, alias)} className="btn btn-primary text-xs">Save</button>
        </div>
      </div>
    </div>
  );
}

export function ModelSelector({ onClose }) {
  const currentModel = useAppStore((s) => s.currentModel);
  const availableModels = useAppStore((s) => s.availableModels);
  const error = useAppStore((s) => s.error);
  const llmHealth = useAppStore((s) => s.llmHealth);
  const currentModelInfo = useAppStore((s) => s.currentModelInfo);
  const llmRuntimeState = useAppStore((s) => s.llmRuntimeState);
  const setModel = useAppStore((s) => s.setModel);
  const refreshModels = useAppStore((s) => s.refreshModels);
  const setPreferredBackend = useAppStore((s) => s.setPreferredBackend);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const hydrateModelCatalog = useAppStore((s) => s.hydrateModelCatalog);
  const invalidateModelCatalog = useAppStore((s) => s.invalidateModelCatalog);
  const modelCatalog = useAppStore((s) => s.modelCatalog);
  const modelCatalogStatus = useAppStore((s) => s.modelCatalogStatus);
  const modelCatalogLastError = useAppStore((s) => s.modelCatalogLastError);
  const storeNpuStatus = useAppStore((s) => s.npuStatus);
  const toggleModelHub = useAppStore((s) => s.toggleModelHub);
  const toggleSettings = useAppStore((s) => s.toggleSettings);

  const [searchQuery, setSearchQuery] = useState('');
  const [quantFilter, setQuantFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [addedFilter, setAddedFilter] = useState('all');
  const [sortKey, setSortKey] = useState('recent');
  const [viewMode, setViewMode] = useState('catalogue');
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  const [modelTab, setModelTab] = useState(currentWorkspace === 'research' ? 'agentic' : 'all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [localModels, setLocalModels] = useState([]);
  const [lmStudioModels, setLmStudioModels] = useState([]);
  const [npuModels, setNpuModels] = useState([]);
  const [npuStatus, setNpuStatus] = useState({ npuAvailable: false, openvinoInstalled: false });
  const [ollamaRuntimeStatus, setOllamaRuntimeStatus] = useState(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);
  const [isScanningLMStudio, setIsScanningLMStudio] = useState(false);
  const [isLoadingNpu, setIsLoadingNpu] = useState(true);
  const [isCreatingFromLocal, setIsCreatingFromLocal] = useState(false);
  const [creatingModelName, setCreatingModelName] = useState(null);
  const [vramTotalMB, setVramTotalMB] = useState(0);
  const [vramFreeMB, setVramFreeMB] = useState(0);
  const [libraryModels, setLibraryModels] = useState([]);
  const [insights, setInsights] = useState({});
  const [networkMode, setNetworkMode] = useState(currentWorkspace === 'nsfw' ? 'cache-only' : 'on');
  const [compareIds, setCompareIds] = useState([]);
  const [detailModel, setDetailModel] = useState(null);
  const [pinModel, setPinModel] = useState(null);
  const [aliasModel, setAliasModel] = useState(null);
  const [workbenchModel, setWorkbenchModel] = useState(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const listParentRef = useRef(null);

  const selectorError = localError || modelCatalogLastError || (String(error || '').trim() || null);

  const loadLocalModels = React.useCallback(async () => {
    setIsLoadingLocal(true);
    try {
      const modelsDirectory = await electronAPI.getSettings('modelsDirectory');
      if (modelsDirectory) {
        await window.electronAPI?.scanModels?.(modelsDirectory);
      }
      const ggufModels = await window.electronAPI?.getModelsByFormat?.('gguf');
      setLocalModels(Array.isArray(ggufModels) ? ggufModels : []);
    } catch (err) {
      console.error('Failed to load local models:', err);
      setLocalModels([]);
    } finally {
      setIsLoadingLocal(false);
    }
  }, []);

  const scanLMStudio = React.useCallback(async () => {
    setIsScanningLMStudio(true);
    try {
      const result = await electronAPI.scanLMStudioModels();
      setLmStudioModels(Array.isArray(result?.models) ? result.models : []);
    } catch (err) {
      console.error('Failed to scan LM Studio:', err);
      setLmStudioModels([]);
    } finally {
      setIsScanningLMStudio(false);
    }
  }, []);

  const loadNpuModels = React.useCallback(async (options = {}) => {
    setIsLoadingNpu(true);
    try {
      const status = await electronAPI.getNpuStatus({ force: options.force === true });
      setNpuStatus({
        npuAvailable: Boolean(status?.npuAvailable),
        openvinoInstalled: Boolean(status?.openvinoInstalled),
        serverRunning: Boolean(status?.serverRunning),
        configuredModel: status?.model || status?.modelPath || null,
      });
      const configured = status?.model || status?.modelPath;
      setNpuModels(configured ? [{
        id: `npu:${configured}`,
        name: String(configured).split(/[\\/]/).pop().replace(/-ov$/, '').replace(/-fp16$/, ''),
        fullId: configured,
        serverRunning: Boolean(status?.serverRunning),
      }] : []);
      return status || null;
    } catch (err) {
      console.error('[ModelSelector] Failed to load NPU status:', err);
      setNpuStatus({ npuAvailable: false, openvinoInstalled: false, serverRunning: false, configuredModel: null });
      setNpuModels([]);
      return null;
    } finally {
      setIsLoadingNpu(false);
    }
  }, []);

  const refreshLibrary = React.useCallback(async () => {
    const rows = await electronAPI.libraryGetAllModels({ sortBy: 'lastUsed', sortDir: 'desc', limit: 500 });
    setLibraryModels(Array.isArray(rows) ? rows : []);
  }, []);

  const loadOllamaRuntimeStatus = React.useCallback(async () => {
    try {
      const status = await electronAPI.getOllamaStatus();
      setOllamaRuntimeStatus(status || null);
      return status || null;
    } catch (_) {
      setOllamaRuntimeStatus(null);
      return null;
    }
  }, []);

  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    setLocalError(null);
    try {
      invalidateModelCatalog?.();
      const [result, ollamaStatus] = await Promise.all([
        refreshModels(),
        loadOllamaRuntimeStatus(),
        loadLocalModels(),
        scanLMStudio(),
        loadNpuModels({ force: true }),
        refreshLibrary(),
        hydrateModelCatalog?.({ force: true }),
      ]);
      const health = result?.llmHealth || useAppStore.getState().llmHealth || llmHealth;
      if (!health?.healthy && ollamaStatus?.running !== false) {
        setLocalError(health?.error || 'Ollama backend is not available.');
      }
      recordSelectorEvent('refresh-all');
    } catch (err) {
      console.error('Failed to refresh models:', err);
      setLocalError(err.message || 'Failed to refresh models.');
    } finally {
      setIsRefreshing(false);
    }
  }, [hydrateModelCatalog, invalidateModelCatalog, llmHealth, loadLocalModels, loadNpuModels, loadOllamaRuntimeStatus, refreshLibrary, refreshModels, scanLMStudio]);

  useEffect(() => {
    const onMouseDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await electronAPI.getSettings('modelSelectorPrefs');
        if (cancelled || !prefs || typeof prefs !== 'object') return;
        if (SORT_OPTIONS.some((option) => option.id === prefs.sort)) setSortKey(prefs.sort);
        if (typeof prefs.groupingEnabled === 'boolean') setGroupingEnabled(prefs.groupingEnabled);
      } catch (_) {}
    })();
    hydrateModelCatalog?.({ force: false }).catch((err) => console.warn('[ModelSelector] Catalog hydrate failed:', err?.message || err));
    loadLocalModels();
    loadOllamaRuntimeStatus();
    scanLMStudio();
    loadNpuModels({ force: false });
    refreshLibrary();
    electronAPI.getHardwareStats().then((stats) => {
      if (cancelled) return;
      const gpu = stats?.gpus?.[0];
      if (gpu?.vramTotal > 0) setVramTotalMB(gpu.vramTotal);
      if (gpu?.vramFree > 0) setVramFreeMB(gpu.vramFree);
      if (!gpu?.vramFree && gpu?.vramTotal && gpu?.vramUsed) setVramFreeMB(Math.max(0, gpu.vramTotal - gpu.vramUsed));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [hydrateModelCatalog, loadLocalModels, loadNpuModels, loadOllamaRuntimeStatus, refreshLibrary, scanLMStudio]);

  useEffect(() => {
    if (!storeNpuStatus) return;
    setNpuStatus({
      npuAvailable: Boolean(storeNpuStatus.npuAvailable),
      openvinoInstalled: Boolean(storeNpuStatus.openvinoInstalled),
      serverRunning: Boolean(storeNpuStatus.serverRunning),
      configuredModel: storeNpuStatus.model || storeNpuStatus.modelPath || null,
    });
  }, [storeNpuStatus]);

  const persistPrefs = React.useCallback(async (patch) => {
    try {
      const prev = await electronAPI.getSettings('modelSelectorPrefs');
      await electronAPI.setSettings('modelSelectorPrefs', { ...(prev || {}), ...patch });
    } catch (_) {}
  }, []);

  const rawEntries = useMemo(() => {
    const map = new Map();
    const add = (entry) => {
      if (!entry?.id && !entry?.name) return;
      const key = String(entry.id || entry.name);
      if (!map.has(key)) map.set(key, entry);
      else map.set(key, { ...map.get(key), ...entry, meta: { ...(map.get(key).meta || {}), ...(entry.meta || {}) } });
    };
    availableModels.forEach((model) => add({
      id: model.name || model.id,
      name: model.name || model.id,
      source: 'ollama',
      sizeBytes: model.size ?? null,
      meta: model.details ? { details: model.details } : {},
    }));
    Array.from(modelCatalog.values()).forEach(add);
    localModels.forEach((model) => add({
      id: model.id || (model.path ? `gguf:${model.path}` : model.name),
      name: model.name || model.filename || model.path,
      source: 'llamanode',
      sizeBytes: model.sizeBytes || model.size || null,
      meta: { path: model.path, filename: model.filename },
    }));
    lmStudioModels.forEach((model) => add({
      id: model.path ? `lmstudio:${model.path}` : `lmstudio:${model.name}`,
      name: model.name || model.filename,
      source: 'lmstudio',
      sizeBytes: model.size || null,
      meta: { path: model.path, filename: model.filename, parentFolder: model.parentFolder },
    }));
    npuModels.forEach((model) => add({
      id: `npu:${model.fullId}`,
      name: model.name,
      source: 'npu',
      meta: { fullId: model.fullId, serverRunning: model.serverRunning, format: 'OpenVINO' },
    }));
    return Array.from(map.values());
  }, [availableModels, lmStudioModels, localModels, modelCatalog, npuModels]);

  useEffect(() => {
    let cancelled = false;
    if (rawEntries.length === 0) return undefined;
    const compact = rawEntries.slice(0, 250).map((entry) => ({
      id: entry.id,
      name: entry.name,
      source: entry.source,
      sizeBytes: entry.sizeBytes,
      meta: entry.meta,
    }));
    electronAPI.getModelSelectorInsights({ models: compact, workspace: currentWorkspace }).then((result) => {
      if (cancelled) return;
      if (result?.success) {
        setInsights(result.insights || {});
        setNetworkMode(result.networkMode || (currentWorkspace === 'nsfw' ? 'cache-only' : 'on'));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentWorkspace, rawEntries]);

  const libraryIndex = useMemo(() => buildLibraryIndex(libraryModels), [libraryModels]);
  const enoughHistory = hasEnoughSuccessfulOutcomes(insights);
  const effectiveSortKey = sortKey === 'recommended' && !enoughHistory ? 'recent' : sortKey;

  const normalizedModels = useMemo(() => {
    const contextTokens = llmRuntimeState?.effectiveOptions?.num_ctx || currentModelInfo?.effectiveContextLength || currentModelInfo?.contextLength || 4096;
    const models = rawEntries.map((entry) => {
      const normalized = normalizeSelectorModel(entry, { libraryIndex });
      const insight = insights[normalized.id] || insights[normalized.rawName] || {};
      const fit = estimateFit(normalized, contextTokens, vramFreeMB, vramTotalMB);
      const score = scoreModel({ ...normalized, insight, fit }, {
        preset: effectiveSortKey === 'speed' ? 'recommended' : 'recommended',
        insights,
        workspace: currentWorkspace,
        contextTokens,
        freeVramMB: vramFreeMB,
        totalVramMB: vramTotalMB,
      });
      return { ...normalized, insight, fit, score };
    });
    return models;
  }, [currentModelInfo, currentWorkspace, effectiveSortKey, insights, libraryIndex, llmRuntimeState, rawEntries, vramFreeMB, vramTotalMB]);

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let list = normalizedModels.filter((model) => {
      const matchesQuery = !query
        || model.displayName.toLowerCase().includes(query)
        || model.rawName.toLowerCase().includes(query)
        || model.familyName.toLowerCase().includes(query)
        || model.capabilities.some((cap) => cap.toLowerCase().includes(query));
      const matchesQuant = quantFilter === 'all' || model.quant?.startsWith(quantFilter);
      const matchesSource = sourceFilter === 'all' || model.source === sourceFilter;
      const matchesAdded = matchesAddedFilter(model, addedFilter);
      const matchesTab = modelTab !== 'agentic' || model.capabilities.some((cap) => ['Code', 'Reasoning'].includes(cap)) || model.score >= 60;
      const vaultOpen = !isVaultWorkspace(currentWorkspace) || model.insight?.catalogEnrichment?.vaultModelGating !== 'allowlist' || model.insight?.activePreset?.vault_allowed === true;
      return matchesQuery && matchesQuant && matchesSource && matchesAdded && matchesTab && vaultOpen;
    });
    if (effectiveSortKey === 'name') list = list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else if (effectiveSortKey === 'size') list = list.sort((a, b) => Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0));
    else if (effectiveSortKey === 'speed') list = list.sort((a, b) => Number(b.insight?.outcomeSummary?.avgTokensPerSecond || 0) - Number(a.insight?.outcomeSummary?.avgTokensPerSecond || 0));
    else if (effectiveSortKey === 'added') {
      list = list.sort((a, b) => {
        const tb = getModelAddedInfo(b).time;
        const ta = getModelAddedInfo(a).time;
        if (tb !== ta) return tb - ta;
        return b.score - a.score;
      });
    }
    else if (effectiveSortKey === 'recent') {
      list = list.sort((a, b) => {
        const tb = new Date(b.library?.lastUsed || b.meta?.lastUsedAt || b.insight?.outcomeSummary?.lastSuccessAt || 0).getTime();
        const ta = new Date(a.library?.lastUsed || a.meta?.lastUsedAt || a.insight?.outcomeSummary?.lastSuccessAt || 0).getTime();
        if (tb !== ta) return tb - ta;
        return b.score - a.score;
      });
    } else {
      list = list.sort((a, b) => b.score - a.score);
    }
    return list;
  }, [addedFilter, currentWorkspace, effectiveSortKey, modelTab, normalizedModels, quantFilter, searchQuery, sourceFilter]);

  const familyGroups = useMemo(() => groupModels(filteredModels), [filteredModels]);
  const focusedModel = filteredModels[Math.min(focusedIndex, Math.max(0, filteredModels.length - 1))] || null;
  const currentNormalized = normalizedModels.find((model) => model.id === currentModel || model.rawName === currentModel) || null;
  const suggested = filteredModels[0] || null;
  // alternatives: kept for downstream insight components if needed; primary UI uses the active strip + suggested button.
  // eslint-disable-next-line no-unused-vars
  const alternatives = filteredModels.filter((model) => model.id !== suggested?.id).slice(0, 3);

  const catalogueItems = groupingEnabled ? familyGroups : filteredModels;
  const virtualizer = useVirtualizer({
    count: catalogueItems.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => groupingEnabled ? 236 : 178,
    overscan: 5,
    getItemKey: (index) => groupingEnabled ? familyGroups[index]?.key || index : filteredModels[index]?.id || index,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    setFocusedIndex(0);
  }, [addedFilter, groupingEnabled, quantFilter, searchQuery, sourceFilter, viewMode]);

  const useLocalGgufPath = React.useCallback(async () => {
    const filePath = await electronAPI.selectFile({
      filters: [{ name: 'GGUF models', extensions: ['gguf'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (!filePath) return;
    await handleUseLocalModel({ path: filePath, name: filePath.split(/[\\/]/).pop()?.replace(/\.gguf$/i, '') || 'local-model' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUseLocalModel = React.useCallback(async (model) => {
    setIsCreatingFromLocal(true);
    setCreatingModelName(model.name || model.filename || model.displayName);
    setLocalError(null);
    try {
      const displayName = model.name || model.filename || model.displayName || 'local-model';
      const res = await electronAPI.loadLocalGguf({
        displayName,
        name: displayName,
        path: model.path,
      });
      if (!res?.success) throw new Error(res?.error || 'Failed to register local GGUF');
      const finalModelId = res.id || (res.path ? `gguf:${res.path}` : null);
      if (!finalModelId) throw new Error('Local GGUF registered without a selectable model id');
      await Promise.all([
        loadLocalModels(),
        hydrateModelCatalog?.({ force: true, sources: ['llamanode'] }),
      ]);
      const setResult = await setModel(finalModelId);
      if (setResult?.success !== false) onClose();
      recordSelectorEvent('use-local-gguf', { model: displayName });
    } catch (err) {
      console.error('Failed to use local model:', err);
      setLocalError(err.message || 'Failed to register local GGUF');
    } finally {
      setIsCreatingFromLocal(false);
      setCreatingModelName(null);
    }
  }, [hydrateModelCatalog, loadLocalModels, onClose, setModel]);

  const handleUseModel = React.useCallback(async (model) => {
    if (!model) return;
    try {
      if (model.source === 'lmstudio') {
        await handleUseLocalModel({ path: model.path, name: model.displayName, filename: model.rawName });
        return;
      }
      if (model.source === 'npu') {
        await setPreferredBackend?.('openvino-npu');
        const fullId = model.meta?.fullId || model.rawId?.replace(/^npu:/, '');
        if (!model.meta?.serverRunning) await electronAPI.startNpuServer({ device: 'NPU' });
        const result = await setModel(`npu:${fullId}`);
        if (result?.success !== false) onClose();
        return;
      }
      const result = await setModel(model.rawId || model.rawName);
      if (result?.success !== false) onClose();
      recordSelectorEvent('use-model', { source: model.source, family: model.familyKey });
    } catch (err) {
      console.error('[ModelSelector] Failed to use model:', err);
      setLocalError(err.message || 'Failed to use model');
    }
  }, [handleUseLocalModel, onClose, setModel, setPreferredBackend]);

  const toggleCompare = React.useCallback((model) => {
    if (!model) return;
    setCompareIds((prev) => {
      if (prev.includes(model.id)) return prev.filter((id) => id !== model.id);
      return [...prev, model.id].slice(-3);
    });
    recordSelectorEvent('compare-toggle', { model: model.familyKey });
  }, []);

  const savePin = React.useCallback(async (model, pin) => {
    const active = model.insight?.activePreset || {};
    const preset = {
      ...active,
      id: active.id || `selector-pin-${Date.now()}`,
      model_name: model.rawId || model.rawName,
      workspace: currentWorkspace,
      is_default: true,
      device_pin: pin || null,
      task_intent: active.task_intent || 'auto',
      advanced_options: active.advanced_options || {},
    };
    await electronAPI.saveModelPreset(preset);
    setPinModel(null);
    const result = await electronAPI.getModelSelectorInsights({ models: rawEntries, workspace: currentWorkspace });
    if (result?.success) setInsights(result.insights || {});
    recordSelectorEvent('pin-device', { pin });
  }, [currentWorkspace, rawEntries]);

  const saveAlias = React.useCallback(async (model, alias) => {
    const trimmed = String(alias || '').trim();
    if (model.library?.id) {
      await electronAPI.libraryUpdateModel(model.library.id, { alias: trimmed || null });
    } else {
      await electronAPI.libraryAddModel({
        name: model.rawName,
        path: model.path || null,
        filename: model.path ? model.path.split(/[\\/]/).pop() : model.rawName,
        size: model.sizeBytes || 0,
        format: model.format || null,
        modelType: model.capabilities?.[0] || 'chat',
        provider: model.source,
        providerId: model.rawId,
        alias: trimmed || null,
        tags: model.capabilities || [],
      });
    }
    await refreshLibrary();
    setAliasModel(null);
    recordSelectorEvent('alias-save', { hasAlias: Boolean(trimmed) });
  }, [refreshLibrary]);

  const favoriteModel = React.useCallback(async (model) => {
    if (model.library?.id) {
      await electronAPI.libraryUpdateModel(model.library.id, { favorite: !model.library.favorite });
    } else {
      await electronAPI.libraryAddModel({
        name: model.rawName,
        path: model.path || null,
        filename: model.path ? model.path.split(/[\\/]/).pop() : model.rawName,
        size: model.sizeBytes || 0,
        format: model.format || null,
        modelType: model.capabilities?.[0] || 'chat',
        provider: model.source,
        providerId: model.rawId,
        favorite: true,
        tags: model.capabilities || [],
      });
    }
    await refreshLibrary();
  }, [refreshLibrary]);

  const rateModel = React.useCallback(async (model, rating) => {
    const safeRating = Math.max(0, Math.min(5, Number(rating) || 0));
    if (model.library?.id) {
      await electronAPI.libraryUpdateModel(model.library.id, { rating: safeRating });
    } else {
      await electronAPI.libraryAddModel({
        name: model.rawName,
        path: model.path || null,
        filename: model.path ? model.path.split(/[\\/]/).pop() : model.rawName,
        size: model.sizeBytes || 0,
        format: model.format || null,
        modelType: model.capabilities?.[0] || 'chat',
        provider: model.source,
        providerId: model.rawId,
        rating: safeRating,
        tags: model.capabilities || [],
      });
    }
    await refreshLibrary();
    recordSelectorEvent('rate-model', { rating: safeRating });
  }, [refreshLibrary]);

  const openHub = React.useCallback(() => {
    toggleModelHub?.();
    onClose();
    recordSelectorEvent('open-hub');
  }, [onClose, toggleModelHub]);

  const openSettings = React.useCallback(() => {
    toggleSettings?.();
    onClose();
  }, [onClose, toggleSettings]);

  const handleKeyDown = React.useCallback((event) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === '/' && document.activeElement !== searchRef.current) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (document.activeElement === searchRef.current) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((idx) => Math.min(filteredModels.length - 1, idx + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((idx) => Math.max(0, idx - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      handleUseModel(focusedModel);
    } else if (event.key === ' ') {
      event.preventDefault();
      toggleCompare(focusedModel);
    } else if (event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (focusedModel) setPinModel(focusedModel);
    } else if (event.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (focusedModel) setWorkbenchModel(focusedModel);
    }
  }, [filteredModels.length, focusedModel, handleUseModel, onClose, toggleCompare]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const compareModels = compareIds.map((id) => normalizedModels.find((model) => model.id === id)).filter(Boolean);
  const isOllamaOffline = Boolean(ollamaRuntimeStatus?.installed && ollamaRuntimeStatus?.running === false);
  const state = modelCatalogStatus === 'loading'
    ? 'loading'
    : filteredModels.length === 0
      ? 'empty'
      : isOllamaOffline
        ? 'offline-cached'
      : selectorError
        ? 'source-error'
        : networkMode === 'cache-only' || networkMode === 'off'
          ? 'installed-only'
          : 'online-enriched';

  return (
    <ErrorBoundary>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      >
        <div
          ref={containerRef}
          className="relative flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-forge-border bg-surface-2 shadow-2xl"
        >
          <header className="border-b border-forge-border bg-surface-1 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-text-primary">Switch Model</h2>
                  <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200">
                    Quick switcher
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  Pick the active model for chat. For installs, downloads, and runtime control, open the <button type="button" onClick={openHub} className="text-cyan-300 underline-offset-2 hover:underline">Manage hub</button>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-text-secondary">
                  Network: {networkMode}
                </span>
                <AddModelMenu
                  open={addMenuOpen}
                  onToggle={setAddMenuOpen}
                  onOpenHub={openHub}
                  onUseLocal={useLocalGgufPath}
                  onOpenNpu={openSettings}
                />
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="rounded-md p-2 text-text-muted transition hover:bg-forge-hover hover:text-text-primary disabled:opacity-50"
                  title="Refresh catalogue"
                >
                  <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
                <button type="button" onClick={onClose} className="rounded-md p-2 text-text-muted transition hover:bg-forge-hover hover:text-text-primary" aria-label="Close model selector">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="input w-full py-2 pl-9 text-sm"
                  placeholder="Search names, raw IDs, capabilities..."
                  autoFocus
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-[10px] font-medium uppercase text-text-muted">
                  {filteredModels.length} shown
                </span>
                <select
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value)}
                  className="input h-8 w-[150px] px-2 py-1 text-xs"
                  title="Filter by model source"
                >
                  {SOURCE_FILTERS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={addedFilter}
                  onChange={(event) => setAddedFilter(event.target.value)}
                  className="input h-8 w-[150px] px-2 py-1 text-xs"
                  title="Filter by when the model was added"
                >
                  {ADDED_FILTERS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={sortKey}
                  onChange={(event) => {
                    setSortKey(event.target.value);
                    persistPrefs({ sort: event.target.value });
                  }}
                  className="input h-8 w-[120px] px-2 py-1 text-xs"
                  title="Sort models"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <div className="ml-auto flex items-center gap-1 rounded-lg border border-forge-border bg-surface-base p-1">
                  <button type="button" onClick={() => setViewMode('catalogue')} className={`h-7 rounded-md px-2 text-xs ${viewMode === 'catalogue' ? 'bg-cyan-500/15 text-cyan-200' : 'text-text-muted hover:text-text-primary'}`}>
                    <Layers size={13} className="inline" /> Catalogue
                  </button>
                  <button type="button" onClick={() => setViewMode('browse')} className={`h-7 rounded-md px-2 text-xs ${viewMode === 'browse' ? 'bg-cyan-500/15 text-cyan-200' : 'text-text-muted hover:text-text-primary'}`}>
                    <List size={13} className="inline" /> Browse All
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {QUANT_FILTERS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setQuantFilter(chip)}
                  className={`h-7 rounded-md px-2 text-[10px] font-medium ${
                    quantFilter === chip
                      ? 'border border-sky-500/35 bg-sky-500/20 text-sky-200'
                      : 'border border-transparent text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {chip === 'all' ? 'All quants' : chip}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setGroupingEnabled((prev) => {
                    persistPrefs({ groupingEnabled: !prev });
                    return !prev;
                  });
                }}
                className="h-7 rounded-md border border-white/10 px-2 text-[10px] text-text-secondary hover:bg-white/[0.04]"
              >
                {groupingEnabled ? 'Grouped variants' : 'Flat rows'}
              </button>
              <button
                type="button"
                onClick={() => setModelTab((prev) => (prev === 'agentic' ? 'all' : 'agentic'))}
                className={`h-7 rounded-md border px-2 text-[10px] ${modelTab === 'agentic' ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-text-secondary'}`}
              >
                Agentic Research
              </button>
              <span className="ml-auto rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
                Sources ready
              </span>
            </div>
          </header>

          <StateBanner
            state={state}
            selectorError={selectorError}
            onStartOllama={async () => { await electronAPI.startOllama(); await handleRefresh(); }}
            onOpenHub={openHub}
            onUseLocal={useLocalGgufPath}
            onRefresh={handleRefresh}
          />

          {viewMode === 'catalogue' && (
            <>
              <section className="flex flex-wrap items-center gap-3 border-b border-forge-border bg-surface-1 px-4 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="rounded-md bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Active</span>
                  <span className="truncate text-sm font-semibold text-text-primary">{currentNormalized?.displayName || currentModel || 'No model selected'}</span>
                  <span className="hidden truncate text-[11px] text-text-muted md:inline">
                    {renderToken(llmRuntimeState?.currentBackend)} · ctx {renderToken(llmRuntimeState?.effectiveOptions?.num_ctx || currentModelInfo?.effectiveContextLength)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => triggerWarmupWithProgress(currentModel)}
                    className="btn btn-secondary px-2 py-1 text-[11px]"
                  >
                    Warmup
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await Promise.all([
                        electronAPI.unloadModel(currentModel),
                        electronAPI.unloadNpuModel?.(),
                      ]);
                    }}
                    className="btn btn-secondary px-2 py-1 text-[11px]"
                  >
                    Eject
                  </button>
                  {currentModel && window?.electronAPI?.sparkModelHubSetContinueModel && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await window.electronAPI.sparkModelHubSetContinueModel({
                            model: currentModel,
                            title: currentNormalized?.displayName || currentModel,
                            apiBase: 'http://localhost:11434',
                            contextLength: 8192,
                            temperature: 0.2,
                          });
                        } catch (_) {
                          // Surface in toast handled by store on success path; ignore here.
                        }
                      }}
                      className="btn btn-secondary px-2 py-1 text-[11px]"
                      title="Set this model as the Continue / Cursor coding model"
                    >
                      Set for Coding
                    </button>
                  )}
                  {isSparkMoeCandidate(currentModel) && (
                    <div className="flex items-center gap-1 rounded-md border border-cyan-400/15 bg-cyan-500/[0.06] px-1 py-0.5">
                      {['stable', 'recommended', 'aggressive'].map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => saveSparkPreset(currentModel, level)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-cyan-100/80 hover:bg-cyan-400/10"
                          title={`Apply Spark ${level} preset`}
                        >
                          {level[0].toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                  {suggested && suggested.id !== currentNormalized?.id && (
                    <button type="button" onClick={() => handleUseModel(suggested)} className="btn btn-primary px-2 py-1 text-[11px]" title={`Suggested: ${suggested.displayName}`}>
                      Use suggested
                    </button>
                  )}
                </div>
              </section>

              <main ref={listParentRef} role="listbox" aria-label="Model catalogue" className="min-h-0 flex-1 overflow-y-auto p-4">
                {catalogueItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-forge-border p-8 text-center">
                    <Cpu size={28} className="mx-auto text-text-muted" />
                    <p className="mt-3 text-sm font-medium text-text-secondary">No matching models</p>
                    <p className="mt-1 text-xs text-text-muted">Try a different search, quant filter, or source refresh.</p>
                  </div>
                ) : (
                  <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                    {virtualItems.map((virtualRow) => {
                      if (groupingEnabled) {
                        const group = familyGroups[virtualRow.index];
                        if (!group) return null;
                        const expanded = detailModel?.familyKey === group.key;
                        const variants = expanded ? group.variants : group.variants.slice(0, 4);
                        return (
                          <div
                            key={virtualRow.key}
                            ref={virtualizer.measureElement}
                            data-index={virtualRow.index}
                            className="absolute left-0 top-0 w-full pb-3"
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                          >
                            <section className="rounded-xl border border-white/10 bg-black/15 p-3">
                              <button type="button" onClick={() => setDetailModel(expanded ? null : group.variants[0])} className="mb-3 flex w-full items-center justify-between gap-3 text-left">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {expanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                                    <p className="truncate text-sm font-semibold text-text-primary">{group.familyName}</p>
                                    <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-text-muted">{group.variants.length} variants</span>
                                  </div>
                                  <p className="mt-1 line-clamp-1 text-xs text-text-muted">{group.description}</p>
                                </div>
                                <CapabilityBadges caps={group.capabilities} limit={3} />
                              </button>
                              <div className="space-y-2">
                                {variants.map((model) => (
                                  <VariantRow
                                    key={model.id}
                                    model={model}
                                    active={currentModel === model.rawId || currentModel === model.rawName}
                                    focused={focusedModel?.id === model.id}
                                    compareActive={compareIds.includes(model.id)}
                                    onUse={handleUseModel}
                                    onDetails={setDetailModel}
                                    onCompare={toggleCompare}
                                    onWorkbench={setWorkbenchModel}
                                    onPin={setPinModel}
                                    onAlias={setAliasModel}
                                  />
                                ))}
                              </div>
                            </section>
                          </div>
                        );
                      }
                      const model = filteredModels[virtualRow.index];
                      if (!model) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          ref={virtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="absolute left-0 top-0 w-full pb-3"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <VariantRow
                            model={model}
                            active={currentModel === model.rawId || currentModel === model.rawName}
                            focused={focusedModel?.id === model.id}
                            compareActive={compareIds.includes(model.id)}
                            onUse={handleUseModel}
                            onDetails={setDetailModel}
                            onCompare={toggleCompare}
                            onWorkbench={setWorkbenchModel}
                            onPin={setPinModel}
                            onAlias={setAliasModel}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </main>
            </>
          )}

          {viewMode === 'browse' && (
            <main className="min-h-0 flex-1 overflow-y-auto p-4">
              {[
                { id: 'ollama', title: modelTab === 'agentic' ? 'Agentic Research Models' : 'Ollama Models', models: filteredModels.filter((model) => model.source === 'ollama') },
                { id: 'lmstudio', title: 'LM Studio Models', models: filteredModels.filter((model) => model.source === 'lmstudio'), action: scanLMStudio, busy: isScanningLMStudio },
                { id: 'npu', title: 'NPU Models (OpenVINO)', models: filteredModels.filter((model) => model.source === 'npu'), hidden: !npuStatus.openvinoInstalled, busy: isLoadingNpu },
                { id: 'llamanode', title: 'DevForge Imported Models', models: filteredModels.filter((model) => model.source === 'llamanode'), busy: isLoadingLocal || isCreatingFromLocal },
              ].filter((section) => !section.hidden).map((section) => (
                <section key={section.id} className="mb-4 rounded-xl border border-white/10 bg-black/15 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-text-secondary">{section.title}</p>
                      <p className="text-[10px] text-text-muted">{section.models.length} visible</p>
                    </div>
                    {section.action && (
                      <button type="button" onClick={section.action} className="rounded-md p-1.5 text-text-muted hover:bg-white/10 hover:text-text-primary">
                        {section.busy ? <Loader size={14} className="animate-spin" /> : <FolderSearch size={14} />}
                      </button>
                    )}
                  </div>
                  {section.models.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/10 p-4 text-xs text-text-muted">
                      {section.id === 'ollama' ? 'No Ollama models found. Start Ollama, refresh, or open the Runtime Center.' : `No ${section.title.toLowerCase()} found.`}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {section.models.map((model) => (
                        <VariantRow
                          key={model.id}
                          model={model}
                          active={currentModel === model.rawId || currentModel === model.rawName}
                          focused={focusedModel?.id === model.id}
                          compareActive={compareIds.includes(model.id)}
                          onUse={handleUseModel}
                          onDetails={setDetailModel}
                          onCompare={toggleCompare}
                          onWorkbench={setWorkbenchModel}
                          onPin={setPinModel}
                          onAlias={setAliasModel}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
              {!npuStatus.openvinoInstalled && (
                <section className="rounded-xl border border-white/10 bg-black/15 p-3">
                  <p className="text-xs font-semibold text-text-secondary">NPU Models (OpenVINO)</p>
                  <p className="mt-2 text-xs text-text-muted">OpenVINO is not configured yet. Use Settings to activate the NPU model converter.</p>
                  <button type="button" onClick={openSettings} className="btn btn-secondary mt-3 text-xs">
                    <Settings size={13} /> Open Settings
                  </button>
                </section>
              )}
            </main>
          )}

          <footer className="border-t border-forge-border bg-surface-1 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
              <span>
                {availableModels.length} Ollama · {lmStudioModels.length} LM Studio · {localModels.length} imported{npuModels.length ? ` · ${npuModels.length} NPU` : ''}
                {isCreatingFromLocal && creatingModelName ? ` · registering ${creatingModelName}` : ''}
              </span>
              <span>
                Keyboard: / search · arrows navigate · Enter use · Space compare · P pin · W workbench
              </span>
            </div>
          </footer>

          {compareModels.length > 0 && (
            <CompareDrawer models={compareModels} onClose={() => setCompareIds([])} onUse={handleUseModel} onWorkbench={setWorkbenchModel} />
          )}
          <DetailsDrawer
            model={detailModel && !compareModels.length ? detailModel : null}
            onClose={() => setDetailModel(null)}
            onCopy={(text) => navigator.clipboard?.writeText?.(text)}
            onAlias={setAliasModel}
            onFavorite={favoriteModel}
            onRate={rateModel}
          />
          <PinDialog model={pinModel} onClose={() => setPinModel(null)} onSave={savePin} />
          <AliasDialog model={aliasModel} onClose={() => setAliasModel(null)} onSave={saveAlias} />
          <ModelExperienceWorkbench
            open={Boolean(workbenchModel)}
            onClose={() => setWorkbenchModel(null)}
            model={workbenchModel?.rawId || workbenchModel?.rawName}
            workspace={currentWorkspace}
            experiencePlan={workbenchModel?.insight?.experiencePlan?.plan || null}
            runtimeState={llmRuntimeState}
            warnings={workbenchModel?.insight?.experiencePlan?.warnings || []}
            onApplySession={() => {}}
            onResetAuto={() => {}}
          />
        </div>
      </motion.div>
    </ErrorBoundary>
  );
}
