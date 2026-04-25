import React, { useEffect, useState } from 'react';

function formatNumber(value, suffix = '') {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'n/a';
  return `${num.toFixed(num >= 10 ? 1 : 3)}${suffix}`;
}

export function MosaicLab() {
  const [artifacts, setArtifacts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await window.electronAPI?.readMosaicArtifacts?.();
        if (cancelled) return;
        if (!result?.success) {
          setError(result?.error || 'Mosaic artifacts unavailable');
          setArtifacts(null);
          return;
        }
        setArtifacts(result);
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (error && !artifacts) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-md rounded-xl border border-amber-500/30 bg-black/90 p-4 text-xs text-amber-100 shadow-xl">
        <div className="font-semibold">MosaicLab</div>
        <div className="mt-1 opacity-80">{error}</div>
      </div>
    );
  }

  if (!artifacts) return null;
  const profiles = artifacts.profiles || {};
  const decision = artifacts.decision || null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[420px] max-h-[70vh] overflow-auto rounded-2xl border border-violet-500/30 bg-black/92 p-4 text-xs text-zinc-100 shadow-2xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-violet-200">MosaicLab</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">DEVFORGE_MOSAIC_DEV</div>
        </div>
        <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
          decision?.decision === 'pass' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
        }`}>
          {(decision?.decision || 'pending').toUpperCase()}
        </div>
      </div>

      {decision && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="font-medium">Gate 1 Projection</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-zinc-400">
            <div>Capacity</div>
            <div className="text-right text-zinc-100">{formatNumber(decision.capacityMultiplier, 'x')}</div>
            <div>Speed</div>
            <div className="text-right text-zinc-100">{formatNumber((decision.speedFraction || 0) * 100, '%')}</div>
            <div>Predicted TPS</div>
            <div className="text-right text-zinc-100">{formatNumber(decision.predictedTps)}</div>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {Object.entries(profiles).map(([name, profile]) => (
          <div key={name} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="flex justify-between gap-2">
              <span className="font-medium text-zinc-200">{name}</span>
              <span className="text-zinc-500">{profile?.runMeta?.source || 'unknown'}</span>
            </div>
            <div className="mt-1 text-zinc-400">
              {formatNumber(profile?.throughputTokensPerSecond)} tok/s
              {profile?.runMeta?.fallbackReason ? ` · ${profile.runMeta.fallbackReason}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MosaicLab;
