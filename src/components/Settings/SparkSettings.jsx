export function SparkSettings({ visible, sparkProbe, sparkProbeBusy, onRunSparkProbe }) {
  if (!visible) return null;

  return (
    <div className="rounded-lg border border-[#76b900]/25 bg-[#76b900]/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[#d8ffb0]">Spark Runtime Alignment</h3>
          <p className="mt-1 text-xs leading-5 text-[#d8ffb0]/70">
            Anvil detected NVIDIA Spark-style unified memory. MoE-safe guardrails are active:
            ctx 4096 for heavy MoE loads, q4_0 KV cache, one loaded model, and live unified-memory telemetry.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#d8ffb0]/65">
            <span>GPU: {sparkProbe?.gpuName || 'NVIDIA GB10'}</span>
            {sparkProbe?.memAvailableGiB ? <span>Available: {Number(sparkProbe.memAvailableGiB).toFixed(1)} GiB</span> : null}
            {sparkProbe?.unifiedMemoryGiB ? <span>Unified: {Number(sparkProbe.unifiedMemoryGiB).toFixed(1)} GiB</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRunSparkProbe}
          disabled={sparkProbeBusy}
          className="shrink-0 rounded-lg border border-[#76b900]/30 bg-[#76b900]/15 px-3 py-2 text-xs font-medium text-[#d8ffb0] transition hover:bg-[#76b900]/25 disabled:opacity-50"
        >
          {sparkProbeBusy ? 'Probing...' : 'Run Spark Probe'}
        </button>
      </div>
    </div>
  );
}

export default SparkSettings;
