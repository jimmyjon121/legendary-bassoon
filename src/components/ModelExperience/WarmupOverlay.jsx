import React, { useMemo } from 'react';
import { Cpu, CheckCircle2, AlertTriangle, X, Loader2 } from 'lucide-react';
import { useModelWarmupStore } from '../../stores/modelWarmupStore';

const STAGE_LABEL = {
  preparing: 'Preparing runtime',
  'loading-weights': 'Loading weights',
  'verifying-first-token': 'Verifying first token',
  ready: 'Ready',
  error: 'Failed',
};

const STAGE_ORDER = ['preparing', 'loading-weights', 'verifying-first-token', 'ready'];

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIdx]}`;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return '0s';
  const totalSec = Math.round(value / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function WarmupOverlay() {
  const state = useModelWarmupStore();
  const dismiss = useModelWarmupStore((s) => s.dismiss);

  const visible = state.active || state.stage === 'error' || (state.stage === 'ready' && state.model);
  if (!visible) return null;

  const isError = state.stage === 'error';
  const isReady = !state.active && state.stage === 'ready';

  return (
    <WarmupCard
      state={state}
      isError={isError}
      isReady={isReady}
      onClose={dismiss}
    />
  );
}

function WarmupCard({ state, isError, isReady, onClose }) {
  const progressPct = Math.max(0, Math.min(100, Number(state.progress || 0)));
  const sizeLabel = state.sizeGiB > 0
    ? `${state.sizeGiB.toFixed(1)} GiB`
    : (state.sizeBytes > 0 ? formatBytes(state.sizeBytes) : 'size unknown');

  const tone = isError
    ? 'border-red-400/40 bg-red-500/[0.08]'
    : isReady
      ? 'border-emerald-400/30 bg-emerald-500/[0.06]'
      : 'border-cyan-400/30 bg-cyan-500/[0.06]';

  const accent = isError ? 'bg-red-500' : isReady ? 'bg-emerald-400' : 'bg-cyan-400';
  const Icon = isError ? AlertTriangle : isReady ? CheckCircle2 : Loader2;
  const iconClass = isError
    ? 'text-red-300'
    : isReady
      ? 'text-emerald-300'
      : 'animate-spin text-cyan-300';

  const stages = useMemo(() => STAGE_ORDER.map((stage) => {
    const currentIdx = STAGE_ORDER.indexOf(state.stage);
    const myIdx = STAGE_ORDER.indexOf(stage);
    let status = 'pending';
    if (isReady && stage === 'ready') status = 'done';
    else if (myIdx < currentIdx) status = 'done';
    else if (myIdx === currentIdx) status = isError ? 'error' : 'active';
    return { id: stage, label: STAGE_LABEL[stage], status };
  }), [state.stage, isError, isReady]);

  const heading = isError
    ? 'Model load failed'
    : isReady
      ? 'Model loaded'
      : 'Loading model';

  const subheading = state.model
    ? `${state.model}${state.family ? ` · ${state.family}` : ''}${state.quantization ? ` · ${state.quantization}` : ''}`
    : null;

  const elapsed = formatDuration(state.elapsedMs);
  const etaSeconds = state.etaMs && !isReady && !isError ? formatDuration(state.etaMs) : null;
  const closable = isReady || isError;
  const requirement = state.memoryRequirement || null;
  const verdict = state.memoryVerdict || null;
  const spark = state.sparkProfile || null;
  const isMoe = Boolean(state.moe?.isMoE || requirement?.isMoE);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[160] flex justify-center px-4">
      <div className={`pointer-events-auto w-full max-w-xl rounded-2xl border ${tone} bg-zinc-950/85 p-4 shadow-2xl shadow-black/40 backdrop-blur`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/30 ${iconClass}`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{heading}</p>
                {subheading ? (
                  <p className="mt-0.5 truncate text-[11px] text-white/55" title={subheading}>{subheading}</p>
                ) : null}
              </div>
              {closable ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1 text-white/45 transition hover:bg-white/[0.08] hover:text-white"
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.04]">
                <div
                  className={`h-full ${accent} transition-[width] duration-500 ease-out`}
                  style={{ width: `${isError ? Math.max(progressPct, 6) : progressPct}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/45">
                <span>{Math.round(progressPct)}%</span>
                <span>
                  {isError
                    ? state.error || 'Could not load model'
                    : isReady
                      ? `Loaded in ${elapsed}`
                      : `${state.message || 'Working...'}${etaSeconds ? ` · ETA ${etaSeconds}` : ''}`}
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stages.map((stage) => (
                <StageDot key={stage.id} label={stage.label} status={stage.status} />
              ))}
            </div>

            {(requirement || spark || isMoe) && (
              <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/25 p-2 text-[10px] text-white/55">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {requirement?.totalGiB ? (
                    <span>predicted {Number(requirement.totalGiB).toFixed(1)} GiB</span>
                  ) : null}
                  {spark?.memAvailableGiB ? (
                    <span>available {Number(spark.memAvailableGiB).toFixed(1)} GiB</span>
                  ) : null}
                  {verdict?.marginGiB != null ? (
                    <span>headroom {Number(verdict.marginGiB).toFixed(1)} GiB</span>
                  ) : null}
                </div>
                {isMoe ? (
                  <div className="mt-1 text-cyan-200/80">
                    MoE - Spark conservative profile active (ctx {requirement?.options?.num_ctx || 4096}, {requirement?.options?.kv_cache_type || 'q4_0'} KV)
                  </div>
                ) : null}
                {verdict?.guidance ? (
                  <div className="mt-1 text-white/45">{verdict.guidance}</div>
                ) : null}
                {state.expertTelemetry ? (
                  <div className="mt-1 text-cyan-200/70">
                    Expert {state.expertTelemetry.expertId}: {state.expertTelemetry.routedTokens} routed tokens
                  </div>
                ) : null}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/45">
              <span className="inline-flex items-center gap-1">
                <Cpu size={11} className="text-white/35" />
                {sizeLabel}
              </span>
              <span>elapsed {elapsed}</span>
              {state.estimateMs ? <span>est. {formatDuration(state.estimateMs)}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageDot({ label, status }) {
  const tone = status === 'done'
    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
    : status === 'active'
      ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100'
      : status === 'error'
        ? 'border-red-400/35 bg-red-500/10 text-red-200'
        : 'border-white/10 bg-white/[0.03] text-white/50';
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-[10px] ${tone}`}>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${
          status === 'done' ? 'bg-emerald-400'
            : status === 'active' ? 'bg-cyan-400 animate-pulse'
              : status === 'error' ? 'bg-red-400'
                : 'bg-white/30'
        }`} />
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}

export default WarmupOverlay;
