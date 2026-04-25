import React, { useState, useEffect, useCallback, memo, useMemo, useRef } from 'react';
import {
  Cpu, HardDrive, Monitor, Thermometer, Activity,
  ChevronDown, Zap, Brain, Layers, MemoryStick, Server
} from 'lucide-react';
import { api } from '../../utils/electronAPI';
import { useInterval } from '../../hooks/useInterval';

const Gpu = Monitor;
const formatBytes = (gb) => gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`;

function formatModelName(modelName = '') {
  const raw = String(modelName || '').trim();
  if (!raw) return 'model';
  if (/^npu:/i.test(raw)) {
    const target = raw.slice(4).trim();
    const parts = target.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'NPU model';
  }
  return raw.split(':')[0] || raw;
}

/**
 * Animated arc gauge — lightweight SVG mini-gauge.
 * Shows a colored arc from 0-100% with a smooth transition.
 */
function MiniGauge({ value = 0, size = 32, stroke = 3, color = 'emerald' }) {
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * radius; // Half-circle
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  const colorMap = {
    emerald: { main: '#10b981', glow: 'rgba(16,185,129,0.3)' },
    amber:   { main: '#f59e0b', glow: 'rgba(245,158,11,0.3)' },
    rose:    { main: '#f43f5e', glow: 'rgba(244,63,94,0.3)' },
    violet:  { main: '#8b5cf6', glow: 'rgba(139,92,246,0.3)' },
    cyan:    { main: '#06b6d4', glow: 'rgba(6,182,212,0.3)' },
    slate:   { main: '#64748b', glow: 'rgba(100,116,139,0.2)' },
  };

  // Auto-color by severity
  const effectiveColor = color === 'auto'
    ? (value > 85 ? 'rose' : value > 65 ? 'amber' : 'emerald')
    : color;

  const c = colorMap[effectiveColor] || colorMap.emerald;

  return (
    <svg width={size} height={size / 2 + 2} viewBox={`0 0 ${size} ${size / 2 + 2}`} className="flex-shrink-0">
      {/* Track */}
      <path
        d={`M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={`M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`}
        fill="none"
        stroke={c.main}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{
          transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease',
          filter: `drop-shadow(0 0 3px ${c.glow})`,
        }}
      />
    </svg>
  );
}

/**
 * Single metric row — icon + label + gauge + value
 */
const MetricRow = memo(function MetricRow({ icon: Icon, label, value, unit = '%', detail, color = 'auto', iconColor }) {
  const displayVal = typeof value === 'number' ? Math.round(value) : 0;
  const effectiveColor = color === 'auto'
    ? (displayVal > 85 ? 'text-rose-400' : displayVal > 65 ? 'text-amber-400' : 'text-emerald-400')
    : `text-${color}-400`;

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon size={13} className={iconColor || 'text-white/30'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/50 font-medium uppercase tracking-wider">{label}</span>
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-semibold tabular-nums ${effectiveColor}`}>
              {displayVal}{unit}
            </span>
          </div>
        </div>
        {detail && (
          <p className="text-[9px] text-white/25 mt-0.5 truncate">{detail}</p>
        )}
      </div>
      <MiniGauge value={displayVal} size={28} stroke={2.5} color={color} />
    </div>
  );
});

/**
 * NPU status pill
 */
const NpuStatus = memo(function NpuStatus({ npu }) {
  if (!npu) return null;

  const isActive = npu.modelLoaded;
  const isReady = npu.serverRunning && !npu.modelLoaded;
  const isIdle = !npu.serverRunning;
  const deviceStr = String(npu.device || '');
  const isUnifiedBrain = deviceStr.startsWith('HETERO:') || deviceStr.startsWith('MULTI:') || deviceStr.startsWith('AUTO:');

  if (isUnifiedBrain) {
    return (
      <div className="flex items-center gap-2.5 py-1.5">
        <Brain size={13} className={isActive ? 'text-violet-400' : isReady ? 'text-violet-400/70' : 'text-white/30'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-violet-400/80 font-medium uppercase tracking-wider">Unified Brain</span>
            <div className="flex items-center gap-1.5">
              {isActive && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                  <span className="text-[10px] text-violet-400 font-medium">Active</span>
                </span>
              )}
              {isReady && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400/70" />
                  <span className="text-[10px] text-violet-400/70 font-medium">Ready</span>
                </span>
              )}
              {isIdle && (
                <span className="text-[10px] text-white/30 font-medium">Standby</span>
              )}
            </div>
          </div>
          <p className="text-[9px] text-white/25 mt-0.5">GPU+NPU · {deviceStr}{npu.tops ? ` · ${npu.tops} TOPS` : ''}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Brain size={13} className={isActive ? 'text-cyan-400' : isReady ? 'text-emerald-400' : 'text-white/30'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/50 font-medium uppercase tracking-wider">NPU</span>
          <div className="flex items-center gap-1.5">
            {isActive && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-[10px] text-cyan-400 font-medium">Active</span>
              </span>
            )}
            {isReady && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-medium">Ready</span>
              </span>
            )}
            {isIdle && (
              <span className="text-[10px] text-white/30 font-medium">Standby</span>
            )}
          </div>
        </div>
        {npu.tops && (
          <p className="text-[9px] text-white/25 mt-0.5">{npu.name || 'Intel NPU'} · {npu.tops} TOPS</p>
        )}
      </div>
    </div>
  );
});

/**
 * HardwareMonitorCompact — Sidebar system monitor widget.
 *
 * Design: clean metric rows with mini arc gauges, smooth transitions,
 * expandable detail panel with VRAM breakdown and loaded models.
 */
export function HardwareMonitorCompact({ className = '' }) {
  const [stats, setStats] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const fetchInFlightRef = useRef(false);
  const lastStatsRef = useRef(null);

  const shouldAcceptStatsUpdate = useCallback((prev, next) => {
    if (!prev) return true;
    if (!next) return false;

    const cpuDelta = Math.abs((next.cpu?.usage || 0) - (prev.cpu?.usage || 0));
    const memDelta = Math.abs((next.memory?.usagePercent || 0) - (prev.memory?.usagePercent || 0));
    const prevGpu = prev.gpus?.[0];
    const nextGpu = next.gpus?.[0];
    const gpuDelta = Math.abs((nextGpu?.utilizationGpu || 0) - (prevGpu?.utilizationGpu || 0));
    const vramDelta = Math.abs((nextGpu?.vramPercent || 0) - (prevGpu?.vramPercent || 0));
    const prevNpu = prev.npu || {};
    const nextNpu = next.npu || {};
    const npuChanged =
      Boolean(prevNpu.serverRunning) !== Boolean(nextNpu.serverRunning) ||
      Boolean(prevNpu.modelLoaded) !== Boolean(nextNpu.modelLoaded) ||
      (prevNpu.device || '') !== (nextNpu.device || '');

    // Ignore tiny metric jitter to reduce unnecessary re-renders.
    return cpuDelta >= 1 || memDelta >= 1 || gpuDelta >= 1 || vramDelta >= 1 || npuChanged;
  }, []);

  const fetchStats = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      const data = await api.getHardwareStats();
      if (data && shouldAcceptStatsUpdate(lastStatsRef.current, data)) {
        lastStatsRef.current = data;
        setStats(data);
      }
    } catch {
      setStats({ error: true, cpu: { usage: 0 }, memory: { usagePercent: 0, used: 0, total: 0 }, gpus: [] });
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [shouldAcceptStatsUpdate]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useInterval(fetchStats, isExpanded ? 8000 : 30000);

  if (!stats) {
    return (
      <div className={`px-3 py-3 ${className}`}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border border-white/10 border-t-indigo-400 animate-spin" />
          <span className="text-[10px] text-white/30">Monitoring...</span>
        </div>
      </div>
    );
  }

  if (stats.error) {
    return (
      <div className={`px-3 py-3 ${className}`}>
        <div className="flex items-center gap-2 text-white/25 text-[10px]">
          <Activity size={12} />
          <span>System monitor unavailable</span>
        </div>
      </div>
    );
  }

  const gpu = stats.gpus?.[0];
  const gpuUtil = gpu?.utilizationGpu || 0;
  const vramUsed = gpu?.vramUsed || gpu?.ollamaVramUsed || 0;
  const vramTotal = gpu?.vramTotal || 0;
  const vramPct = vramTotal > 0 ? Math.round((vramUsed / vramTotal) * 100) : 0;

  return (
    <div className={className}>
      {/* Header / toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 pt-2 pb-1 flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <Activity size={10} className="text-white/30 group-hover:text-indigo-400/70 transition-colors" />
          <span className="text-[9px] text-white/35 font-medium tracking-wider uppercase">System</span>
        </div>
        <ChevronDown
          size={10}
          className={`text-white/20 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Metrics */}
      <div className="px-3 pb-2 space-y-0.5">
        <MetricRow
          icon={Cpu}
          label="CPU"
          value={stats.cpu?.usage || 0}
          detail={stats.cpu?.temperature ? `${stats.cpu.temperature}°C` : undefined}
          color="auto"
        />
        <MetricRow
          icon={MemoryStick}
          label="RAM"
          value={stats.memory?.usagePercent || 0}
          detail={`${stats.memory?.used || 0} / ${stats.memory?.total || 0} GB`}
          color="auto"
        />
        {gpu && (
          <MetricRow
            icon={Gpu}
            label="GPU"
            value={gpuUtil}
            detail={vramTotal > 0 ? `VRAM ${vramUsed}/${vramTotal} MB` : gpu?.name?.replace('NVIDIA ', '').replace('Intel ', '')}
            color="violet"
            iconColor="text-violet-400/50"
          />
        )}
        {stats.npu && <NpuStatus npu={stats.npu} />}
      </div>

      {/* Expanded detail panel */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${
        isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
      }`}>
        <div className="px-3 pb-3 pt-2 space-y-3 border-t border-white/[0.04] mx-2">

          {/* VRAM gauge (if GPU detected) */}
          {gpu && vramTotal > 0 && (
            <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider">VRAM</span>
                <span className="text-[10px] text-violet-400 font-semibold tabular-nums">{vramPct}%</span>
              </div>
              {/* Full-width VRAM bar */}
              <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${vramPct}%`,
                    background: 'linear-gradient(90deg, #8b5cf6, #a78bfa, #c4b5fd)',
                    boxShadow: '0 0 8px rgba(139,92,246,0.3)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[9px] text-white/25">{vramUsed} MB used</span>
                <span className="text-[9px] text-white/25">{vramTotal} MB total</span>
              </div>
            </div>
          )}

          {/* GPU Temperature */}
          {gpu?.temperature && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Thermometer size={11} className="text-orange-400/60" />
                <span className="text-[10px] text-white/35">GPU Temp</span>
              </div>
              <span className={`text-[10px] font-semibold tabular-nums ${
                gpu.temperature > 80 ? 'text-rose-400' : gpu.temperature > 60 ? 'text-amber-400' : 'text-emerald-400'
              }`}>{gpu.temperature}°C</span>
            </div>
          )}

          {/* CPU Temperature */}
          {stats.cpu?.temperature && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Thermometer size={11} className="text-orange-400/60" />
                <span className="text-[10px] text-white/35">CPU Temp</span>
              </div>
              <span className={`text-[10px] font-semibold tabular-nums ${
                stats.cpu.temperature > 85 ? 'text-rose-400' : stats.cpu.temperature > 65 ? 'text-amber-400' : 'text-emerald-400'
              }`}>{stats.cpu.temperature}°C</span>
            </div>
          )}

          {/* Loaded models */}
          {stats.ollama?.models?.length > 0 && (
            <div className="pt-2 border-t border-white/[0.04]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Layers size={10} className="text-indigo-400/60" />
                  <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider">Loaded Models</span>
                </div>
                <span className="text-[9px] text-indigo-400/70 font-mono">{stats.ollama.totalVramMB} MB</span>
              </div>
              <div className="space-y-1">
                {stats.ollama.models.slice(0, 4).map((model) => (
                  <div key={model.name} className="flex items-center justify-between py-1 px-2 rounded-md bg-white/[0.015]">
                    <span className="text-[10px] text-white/45 font-mono truncate max-w-[110px]">{formatModelName(model.name)}</span>
                    <span className="text-[10px] text-indigo-400/60 font-mono">{Math.round(model.sizeVram / (1024 * 1024))}MB</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NPU / Unified Brain detail (expanded) */}
          {stats.npu?.detected && (() => {
            const devStr = String(stats.npu.device || '');
            const isUni = devStr.startsWith('HETERO:') || devStr.startsWith('MULTI:') || devStr.startsWith('AUTO:');
            return (
              <div className="pt-2 border-t border-white/[0.04]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Brain size={10} className={isUni ? 'text-violet-400/60' : 'text-cyan-400/60'} />
                  <span className={`text-[10px] font-medium uppercase tracking-wider ${isUni ? 'text-violet-400/60' : 'text-white/40'}`}>
                    {isUni ? 'Unified Brain' : 'Neural Processing Unit'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-md bg-white/[0.015]">
                    <p className="text-[9px] text-white/25 uppercase">Status</p>
                    <p className={`text-[10px] font-medium ${
                      stats.npu.modelLoaded ? (isUni ? 'text-violet-400' : 'text-cyan-400') :
                      stats.npu.serverRunning ? 'text-emerald-400' : 'text-white/35'
                    }`}>
                      {stats.npu.modelLoaded ? 'Active' : stats.npu.serverRunning ? 'Ready' : 'Standby'}
                    </p>
                  </div>
                  <div className="p-2 rounded-md bg-white/[0.015]">
                    <p className="text-[9px] text-white/25 uppercase">{isUni ? 'Device' : 'Performance'}</p>
                    <p className={`text-[10px] font-medium ${isUni ? 'text-violet-400/80' : 'text-cyan-400/80'}`}>
                      {isUni ? devStr : `${stats.npu.tops || '—'} TOPS`}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ====== FULL HARDWARE MONITOR (Settings page) ======

export function HardwareMonitorFull() {
  const [hardware, setHardware] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deviceActivity, setDeviceActivity] = useState(null);
  const [activityExpanded, setActivityExpanded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const data = await window.electronAPI?.detectHardware();
        setHardware(data);
      } catch (error) {
        console.error('Hardware detection failed:', error);
      } finally {
        setLoading(false);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await window.electronAPI?.getHardwareStats();
      if (data && !data.error) setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  const fetchDeviceActivity = useCallback(async () => {
    try {
      const data = await window.electronAPI?.getDeviceUtilization?.(60000);
      if (data && data.available !== false) setDeviceActivity(data);
    } catch (error) {
      // Non-blocking — the card simply won't render if activity is unavailable.
    }
  }, []);

  useEffect(() => { if (!loading) { fetchStats(); fetchDeviceActivity(); } }, [fetchStats, fetchDeviceActivity, loading]);
  useInterval(fetchStats, loading ? null : 5000);
  useInterval(fetchDeviceActivity, loading ? null : 5000);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-indigo-400 animate-spin" />
        <span className="text-sm text-white/40">Detecting hardware...</span>
      </div>
    );
  }

  if (!hardware || hardware.error) {
    return (
      <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
        <p className="text-rose-400 text-sm">
          Failed to detect hardware: {hardware?.error || 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* System Overview */}
      <div className="p-5 bg-white/[0.02] border border-white/[0.06] rounded-xl">
        <h4 className="text-sm font-semibold text-white/90 mb-4 flex items-center gap-2">
          <Server size={15} className="text-indigo-400" />
          System Overview
        </h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <InfoCell label="Device" value={`${hardware.system?.manufacturer} ${hardware.system?.model}`} />
          <InfoCell label="CPU" value={hardware.cpu?.brand} />
          <InfoCell label="Memory" value={`${formatBytes(hardware.memory?.total)} RAM`} />
          <InfoCell label="Platform" value={`${hardware.system?.platform} (${hardware.system?.arch})`} />
        </div>
      </div>

      {/* Real-time metrics */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="CPU Usage" value={`${stats.cpu?.usage || 0}%`} progress={stats.cpu?.usage || 0} color="auto" temp={stats.cpu?.temperature} />
          <StatCard label="Memory" value={`${stats.memory?.used || 0} / ${stats.memory?.total || 0} GB`} progress={stats.memory?.usagePercent || 0} color="auto" detail={`${stats.memory?.available || 0} GB free`} />
        </div>
      )}

      {/* GPUs */}
      {hardware.gpus?.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white/90 flex items-center gap-2">
            <Gpu size={15} className="text-violet-400" />
            Graphics
          </h4>
          {hardware.gpus.map((gpu, i) => (
            <div key={gpu.name || `gpu-${i}`} className="p-5 bg-white/[0.02] border border-white/[0.06] rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm text-white/90 font-medium">{gpu.name}</p>
                  <p className="text-[11px] text-white/35">{gpu.vendor} · Driver: {gpu.driver}</p>
                </div>
                <div className="flex gap-1.5">
                  {gpu.capabilities?.cuda && <Badge text="CUDA" color="emerald" />}
                  {gpu.capabilities?.vulkan && <Badge text="Vulkan" color="blue" />}
                  {gpu.capabilities?.openvino && <Badge text="OpenVINO" color="violet" />}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InfoCell label="VRAM" value={`${gpu.vram} MB${gpu.vramDynamic ? ' (shared)' : ''}`} />
                <InfoCell label="Type" value={gpu.type?.replace('-', ' ')} />
              </div>
              {stats?.gpus?.[i] && (
                <div className="mt-4 pt-4 border-t border-white/[0.04] grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className="text-white/40">Utilization</span>
                      <span className="text-violet-400 font-semibold tabular-nums">{stats.gpus[i].utilizationGpu || 0}%</span>
                    </div>
                    <BarFull value={stats.gpus[i].utilizationGpu || 0} color="violet" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className="text-white/40">VRAM</span>
                      <span className="text-white/60 font-semibold tabular-nums">{stats.gpus[i].vramPercent || 0}%</span>
                    </div>
                    <BarFull value={stats.gpus[i].vramPercent || 0} color="auto" />
                  </div>
                  {stats.gpus[i].temperature && (
                    <div className="col-span-2 flex items-center gap-1.5 text-[11px] text-white/35">
                      <Thermometer size={12} className="text-orange-400/60" />
                      Temperature: <span className="font-semibold text-white/60">{stats.gpus[i].temperature}°C</span>
                    </div>
                  )}
                </div>
              )}
              {/* Ollama models */}
              {i === 0 && stats?.ollama?.models?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/[0.04]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-white/50 font-medium">
                      <Layers size={12} className="text-indigo-400/60" />
                      Loaded Models
                    </div>
                    <span className="text-[10px] text-indigo-400/60 font-mono">{stats.ollama.totalVramMB} MB</span>
                  </div>
                  {stats.ollama.models.map((model) => (
                    <div key={model.name} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-md bg-white/[0.02] mb-1">
                      <span className="text-white/45 font-mono truncate max-w-[170px]">{model.name}</span>
                      <span className="text-indigo-400/60 font-mono">{Math.round(model.sizeVram / (1024 * 1024))} MB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* NPU / Unified Brain */}
      {hardware.npu?.detected && (() => {
        const npuDevice = String(stats?.npu?.device || '');
        const isUnified = npuDevice.startsWith('HETERO:') || npuDevice.startsWith('MULTI:') || npuDevice.startsWith('AUTO:');
        return (
          <div className={`p-5 border rounded-xl ${isUnified ? 'bg-gradient-to-br from-violet-500/[0.04] to-indigo-500/[0.04] border-violet-500/15' : 'bg-white/[0.02] border-white/[0.06]'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <Brain size={16} className={isUnified ? 'text-violet-400' : 'text-cyan-400'} />
                <div>
                  <p className="text-sm text-white/90 font-medium">
                    {isUnified ? 'Unified Brain (GPU+NPU)' : hardware.npu.name}
                  </p>
                  <p className="text-[11px] text-white/35">
                    {isUnified ? `${npuDevice} — One model, two chips` : 'Neural Processing Unit'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isUnified && <Badge text="Unified" color="violet" />}
                <Badge text={`${hardware.npu.tops} TOPS`} color={isUnified ? 'violet' : 'cyan'} />
              </div>
            </div>
            {stats?.npu && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <p className="text-[9px] text-white/30 uppercase mb-0.5">Status</p>
                  <p className={`text-[11px] font-medium ${
                    stats.npu.modelLoaded ? (isUnified ? 'text-violet-400' : 'text-cyan-400') :
                    stats.npu.serverRunning ? 'text-emerald-400' : 'text-white/30'
                  }`}>
                    {stats.npu.modelLoaded ? 'Active' : stats.npu.serverRunning ? 'Ready' : 'Standby'}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <p className="text-[9px] text-white/30 uppercase mb-0.5">Model</p>
                  <p className={`text-[11px] font-medium ${stats.npu.modelLoaded ? (isUnified ? 'text-violet-400' : 'text-cyan-400') : 'text-white/30'}`}>
                    {stats.npu.modelLoaded ? 'Loaded' : 'None'}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <p className="text-[9px] text-white/30 uppercase mb-0.5">Device</p>
                  <p className={`text-[11px] font-medium ${isUnified ? 'text-violet-400' : 'text-white/50'}`}>
                    {stats.npu.device || 'NPU'}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Device Activity (Phase 1) — per-chip work over the last 60s */}
      {deviceActivity?.devices?.length > 0 && (
        <div className="p-5 bg-white/[0.02] border border-white/[0.06] rounded-xl">
          <button
            type="button"
            onClick={() => setActivityExpanded((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <h4 className="text-sm font-semibold text-white/90 flex items-center gap-2">
              <Activity size={15} className="text-emerald-400" />
              Device Activity
              <span className="text-[10px] font-normal text-white/35">last 60s</span>
            </h4>
            <ChevronDown
              size={14}
              className={`text-white/40 transition-transform ${activityExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          {activityExpanded && (
            <div className="mt-4 space-y-2">
              {deviceActivity.devices.map((dev) => {
                const isWarm = dev.device === 'npu' && deviceActivity.warmloop?.active;
                const warmloopTransitionCount = dev.device === 'npu'
                  ? (Array.isArray(deviceActivity.streams?.warmloopTransitions)
                      ? deviceActivity.streams.warmloopTransitions.length
                      : 0)
                  : 0;
                const jobs = dev.jobs || 0;
                const lastAgo = dev.lastActivityAt
                  ? Math.max(0, Math.round((Date.now() - dev.lastActivityAt) / 1000))
                  : null;
                return (
                  <div key={dev.device} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] text-white/70 font-medium w-16">{dev.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${jobs > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.04] text-white/30'}`}>
                        {jobs > 0 ? `${jobs} ${jobs === 1 ? 'job' : 'jobs'}` : 'idle'}
                      </span>
                      {isWarm && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300" title="NPU warm-loop keeps a small model resident">
                          warm
                        </span>
                      )}
                      {dev.device === 'npu' && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300"
                          title="Warm-loop active/inactive transitions seen in this window"
                        >
                          transitions {warmloopTransitionCount}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-white/40 font-mono tabular-nums truncate">
                      {dev.lastWorkload && (
                        <span className="truncate max-w-[110px]" title={dev.lastWorkload}>{dev.lastWorkload}</span>
                      )}
                      {lastAgo !== null && jobs > 0 && (
                        <span>{lastAgo}s ago</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-white/70 font-medium w-16">Last stream</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">
                    first token {
                      Number.isFinite(Number(deviceActivity.streams?.last?.firstTokenMs))
                        ? `${Math.round(Number(deviceActivity.streams.last.firstTokenMs))}ms`
                        : 'n/a'
                    }
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                    {
                      Number.isFinite(Number(deviceActivity.streams?.last?.tokensPerSecond))
                        ? `${Number(deviceActivity.streams.last.tokensPerSecond).toFixed(1)} tok/s`
                        : '0.0 tok/s'
                    }
                  </span>
                  {deviceActivity.streams?.last?.abort?.code && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">
                      abort {deviceActivity.streams.last.abort.code}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-white/40 font-mono tabular-nums">
                  {deviceActivity.streams?.last?.updatedAt
                    ? `${Math.max(0, Math.round((Date.now() - Number(deviceActivity.streams.last.updatedAt)) / 1000))}s ago`
                    : 'no stream yet'}
                </div>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-white/70 font-medium w-16">Aborts 60s</span>
                  {Object.keys(deviceActivity.streams?.aborts || {}).length > 0 ? (
                    Object.entries(deviceActivity.streams.aborts).map(([code, count]) => (
                      <span key={code} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                        {code}:{count}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40">none</span>
                  )}
                </div>
                <div className="text-[10px] text-white/35">window 60s</div>
              </div>
              {deviceActivity.warmloop?.available && deviceActivity.warmloop?.lastDecision && (
                <p className="text-[10px] text-white/35 mt-2">
                  Warm-loop: {deviceActivity.warmloop.active ? 'active' : `idle (${deviceActivity.warmloop.lastDecision.reason})`}
                  {deviceActivity.warmloop.warmModel ? ` · ${deviceActivity.warmloop.warmModel.split('/').pop()}` : ''}
                </p>
              )}
              {deviceActivity.streams?.specDecode && Array.isArray(deviceActivity.streams.specDecode.pairs) && (
                <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-[11px] text-white/70 font-medium w-16">Spec decode</span>
                    {deviceActivity.streams.specDecode.pairs.length === 0 ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-white/40">no spec turns yet</span>
                    ) : (
                      deviceActivity.streams.specDecode.pairs.map((entry) => (
                        <span
                          key={entry.pair}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${entry.autoDisabled
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-violet-500/15 text-violet-300'}`}
                          title={`${entry.accepted}/${entry.total} accepted across ${entry.count} turns`}
                        >
                          {entry.pair.split('|')[0].split(':').slice(-1)[0]}:{Math.round(entry.acceptanceRate * 100)}%
                          {entry.autoDisabled ? ' off' : ''}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="text-[10px] text-white/35">
                    last {Math.round((deviceActivity.streams.specDecode.lastAcceptanceRate || 0) * 100)}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recommendations */}
      {hardware.recommendations?.notes?.length > 0 && (
        <div className="p-5 bg-indigo-500/[0.06] border border-indigo-500/20 rounded-xl">
          <h4 className="text-sm font-semibold text-white/90 mb-3 flex items-center gap-2">
            <Zap size={15} className="text-indigo-400" />
            Recommendations
          </h4>
          <div className="space-y-1.5">
            {hardware.recommendations.notes.map((note) => (
              <p key={note} className="text-[11px] text-white/50 leading-relaxed">• {note}</p>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-indigo-500/15">
            <p className="text-[11px] text-white/35">
              Primary backend: <span className="text-indigo-400 font-semibold uppercase">{hardware.recommendations.primary}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ====== SHARED SUB-COMPONENTS ======

function InfoCell({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-[12px] text-white/70 capitalize">{value || '—'}</p>
    </div>
  );
}

function Badge({ text, color = 'emerald' }) {
  const colors = {
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    violet: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-medium rounded-md border ${colors[color] || colors.emerald}`}>
      {text}
    </span>
  );
}

function BarFull({ value = 0, color = 'auto' }) {
  const pct = Math.min(value, 100);
  const gradient = color === 'violet'
    ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
    : color === 'auto'
      ? pct > 85 ? 'linear-gradient(90deg, #f43f5e, #fb7185)' : pct > 65 ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #10b981, #34d399)'
      : 'linear-gradient(90deg, #818cf8, #a78bfa)';

  return (
    <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, background: gradient }}
      />
    </div>
  );
}

function StatCard({ label, value, progress, color, temp, detail }) {
  return (
    <div className="p-4 bg-white/[0.02] border border-white/[0.06] rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-white/45 font-medium">{label}</span>
        {temp && (
          <span className="text-[10px] text-white/30 flex items-center gap-1">
            <Thermometer size={10} className="text-orange-400/60" />
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-white/85 mb-2 tabular-nums">{value}</p>
      <BarFull value={progress} color={color} />
      {detail && <p className="text-[10px] text-white/25 mt-1.5">{detail}</p>}
    </div>
  );
}

export default HardwareMonitorCompact;
