import React, { useState, useEffect, useCallback, memo } from 'react';
import { 
  Cpu, 
  HardDrive, 
  Monitor, 
  Thermometer, 
  Activity,
  ChevronDown,
  ChevronUp,
  Zap,
  Brain
} from 'lucide-react';
import { api } from '../../utils/electronAPI';
import { useInterval } from '../../hooks/useInterval';

// Alias for GPU icon (lucide-react doesn't have a Gpu icon)
const Gpu = Monitor;

// Utility to format bytes
const formatBytes = (gb) => {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  return `${gb} GB`;
};

// Neural-styled progress bar - pure CSS
function ProgressBar({ value, max = 100, size = 'sm', showLabel = false, colorScheme = 'auto' }) {
  const percentage = Math.min((value / max) * 100, 100);
  
  // Dynamic color based on percentage
  let barStyle = {};
  if (colorScheme === 'auto') {
    if (percentage > 80) {
      barStyle = { background: 'linear-gradient(90deg, #f43f5e 0%, #fb7185 100%)' };
    } else if (percentage > 60) {
      barStyle = { background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)' };
    } else {
      barStyle = { background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' };
    }
  } else if (colorScheme === 'purple') {
    barStyle = { 
      background: 'linear-gradient(90deg, #818cf8 0%, #a78bfa 50%, #c084fc 100%)',
      boxShadow: '0 0 8px rgba(129, 140, 248, 0.4)'
    };
  }

  const heightClass = size === 'sm' ? 'h-1' : size === 'md' ? 'h-1.5' : 'h-2';

  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 ${heightClass} bg-forge-bg/80 rounded-full overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out`}
          style={{ 
            width: `${percentage}%`,
            ...barStyle
          }}
        />
      </div>
      {showLabel && (
        <span className="text-[10px] text-text-muted w-8 text-right font-mono">{Math.round(percentage)}%</span>
      )}
    </div>
  );
}

// Compact hardware widget for sidebar - RAM-lite, CSS animations
export function HardwareMonitorCompact({ className = '' }) {
  const [stats, setStats] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.getHardwareStats();
      if (data) {
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch hardware stats:', error);
      setStats({
        error: 'unavailable',
        cpu: { usage: 0 },
        memory: { usagePercent: 0, used: 0, total: 0 },
        gpus: []
      });
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);
  
  // Polling with safe interval hook - 10 seconds when expanded, null (disabled) when collapsed
  useInterval(fetchStats, isExpanded ? 5000 : 30000);

  if (!stats) {
    return (
      <div className={`p-3 ${className}`}>
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <Activity size={14} className="animate-pulse" />
          <span className="font-mono text-[10px]">Loading...</span>
        </div>
      </div>
    );
  }

  if (stats.error) {
    return (
      <div className={`p-3 ${className}`}>
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <Cpu size={14} />
          <span className="text-[10px]">Hardware unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 hover:bg-forge-hover/50 transition-all duration-200 rounded-lg group"
      >
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Activity size={13} className="text-text-muted group-hover:text-workspace-casual transition-colors" />
              {/* Neural pulse indicator */}
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-workspace-casual/60 animate-pulse" />
            </div>
            <span className="text-[11px] text-text-secondary font-medium tracking-wide">System</span>
          </div>
          <ChevronDown 
            size={13} 
            className={`text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </div>

        {/* Compact view - neural style */}
        <div className="space-y-2.5">
          {/* CPU */}
          <div className="flex items-center gap-2">
            <Cpu size={12} className="text-text-muted flex-shrink-0" />
            <span className="text-[9px] text-text-muted w-7 font-mono uppercase">CPU</span>
            <ProgressBar value={stats.cpu?.usage || 0} size="sm" showLabel />
          </div>

          {/* RAM */}
          <div className="flex items-center gap-2">
            <HardDrive size={12} className="text-text-muted flex-shrink-0" />
            <span className="text-[9px] text-text-muted w-7 font-mono uppercase">RAM</span>
            <ProgressBar value={stats.memory?.usagePercent || 0} size="sm" showLabel />
          </div>

          {/* Primary GPU */}
          {stats.gpus?.[0] && (
            <div className="flex items-center gap-2">
              <Gpu size={12} className="text-text-muted flex-shrink-0" />
              <span className="text-[9px] text-text-muted w-7 font-mono uppercase">GPU</span>
              <ProgressBar value={stats.gpus[0].utilizationGpu || 0} size="sm" colorScheme="purple" showLabel />
            </div>
          )}
          
          {/* NPU Status */}
          {stats.npu && (
            <div className="flex items-center gap-2">
              <Brain size={12} className={`flex-shrink-0 ${
                stats.npu.modelLoaded ? 'text-status-success' : 
                stats.npu.serverRunning ? 'text-status-warning' : 
                'text-text-muted'
              }`} />
              <span className="text-[9px] text-text-muted w-7 font-mono uppercase">NPU</span>
              <div className="flex-1 flex items-center gap-2">
                <span className={`text-[10px] font-mono ${
                  stats.npu.modelLoaded ? 'text-status-success' : 
                  stats.npu.serverRunning ? 'text-status-warning animate-pulse' : 
                  'text-text-muted'
                }`}>
                  {stats.npu.modelLoaded ? 'Active' : stats.npu.serverRunning ? 'Loading' : 'Idle'}
                </span>
                {stats.npu.modelLoaded && (
                  <div className="flex gap-0.5">
                    {[...Array(4)].map((_, i) => (
                      <div 
                        key={`npu-bar-${i}`}
                        className="w-0.5 h-2 rounded-full bg-status-success"
                        style={{ 
                          animation: `neuralBarWave 1s ease-in-out ${i * 0.1}s infinite`,
                          opacity: 0.4 + (i * 0.2)
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </button>

      {/* Expanded view - CSS animated */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 pb-3 space-y-3 border-t border-forge-border/30 pt-3 mt-1">
          {/* CPU Details */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary font-medium">CPU</span>
              {stats.cpu?.temperature && (
                <span className="text-[10px] text-text-muted flex items-center gap-1 font-mono">
                  <Thermometer size={10} className="text-orange-400" />
                  {stats.cpu.temperature}°C
                </span>
              )}
            </div>
            <ProgressBar value={stats.cpu?.usage || 0} size="md" showLabel />
          </div>

          {/* Memory Details */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary font-medium">Memory</span>
              <span className="text-[10px] text-text-muted font-mono">
                {stats.memory?.used || 0}/{stats.memory?.total || 0}GB
              </span>
            </div>
            <ProgressBar value={stats.memory?.usagePercent || 0} size="md" showLabel />
          </div>

          {/* GPU Details */}
          {stats.gpus?.map((gpu, index) => (
            <div key={gpu.name || `gpu-${index}`} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary font-medium truncate max-w-[110px]" title={gpu.name}>
                  {gpu.name?.replace('NVIDIA ', '').replace('Intel ', '').substring(0, 12)}
                </span>
                {gpu.temperature && (
                  <span className="text-[10px] text-text-muted flex items-center gap-1 font-mono">
                    <Thermometer size={10} className="text-orange-400" />
                    {gpu.temperature}°C
                  </span>
                )}
              </div>
              <ProgressBar value={gpu.utilizationGpu || 0} size="md" showLabel colorScheme="purple" />
              {gpu.vramTotal > 0 && (
                <div className="text-[10px] text-text-muted font-mono">
                  VRAM: {gpu.vramUsed || 0}/{gpu.vramTotal}MB
                </div>
              )}
            </div>
          ))}

          {/* Ollama Loaded Models */}
          {stats.ollama?.models?.length > 0 && (
            <div className="pt-2 border-t border-forge-border/30">
              <div className="text-[10px] text-text-secondary font-medium mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <Brain size={10} className="text-workspace-casual" />
                Loaded Models ({stats.ollama.totalVramMB}MB VRAM)
              </div>
              {stats.ollama.models.slice(0, 3).map((model) => (
                <div key={model.name} className="flex items-center justify-between text-[10px] text-text-muted font-mono py-0.5">
                  <span className="truncate max-w-[90px]">{model.name}</span>
                  <span className="text-workspace-casual">{Math.round(model.sizeVram / (1024 * 1024))}MB</span>
                </div>
              ))}
            </div>
          )}
          
          {/* AI Processes */}
          {stats.processes?.ai?.length > 0 && (
            <div className="pt-2 border-t border-forge-border/30">
              <div className="text-[10px] text-text-secondary font-medium mb-1.5 uppercase tracking-wide">AI Processes</div>
              {stats.processes.ai.slice(0, 3).map((proc) => (
                <div key={proc.pid || proc.name} className="flex items-center justify-between text-[10px] text-text-muted font-mono py-0.5">
                  <span className="truncate max-w-[90px]">{proc.name}</span>
                  <span>{proc.cpu?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes neuralBarWave {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

// Full hardware monitor component for settings
export function HardwareMonitorFull() {
  const [hardware, setHardware] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialDelay, setInitialDelay] = useState(true);

  useEffect(() => {
    // Defer initial hardware detection slightly to not block tab render
    const timer = setTimeout(async () => {
      try {
        const data = await window.electronAPI?.detectHardware();
        setHardware(data);
      } catch (error) {
        console.error('Hardware detection failed:', error);
      } finally {
        setLoading(false);
        setInitialDelay(false);
      }
    }, 100); // Small delay for smoother tab switch
    
    return () => clearTimeout(timer);
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await window.electronAPI?.getHardwareStats();
      if (data && !data.error) {
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  // Initial fetch after hardware is detected
  useEffect(() => {
    if (!initialDelay) {
      fetchStats();
    }
  }, [fetchStats, initialDelay]);
  
  // Poll every 10 seconds in settings (slower but saves CPU, user can manually refresh)
  useInterval(fetchStats, initialDelay ? null : 10000);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Activity size={24} className="animate-spin text-workspace-casual" />
      </div>
    );
  }

  if (!hardware || hardware.error) {
    return (
      <div className="p-4 bg-status-error/20 border border-status-error/30 rounded-lg">
        <p className="text-status-error text-sm">
          Failed to detect hardware: {hardware?.error || 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Overview */}
      <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
        <h4 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <Cpu size={16} />
          System Overview
        </h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-text-muted">Device:</span>
            <p className="text-text-primary">{hardware.system?.manufacturer} {hardware.system?.model}</p>
          </div>
          <div>
            <span className="text-text-muted">CPU:</span>
            <p className="text-text-primary">{hardware.cpu?.brand}</p>
          </div>
          <div>
            <span className="text-text-muted">Memory:</span>
            <p className="text-text-primary">{formatBytes(hardware.memory?.total)} RAM</p>
          </div>
          <div>
            <span className="text-text-muted">Platform:</span>
            <p className="text-text-primary">{hardware.system?.platform} ({hardware.system?.arch})</p>
          </div>
        </div>
      </div>

      {/* GPUs */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Gpu size={16} />
          Graphics Processors
        </h4>
        {hardware.gpus?.map((gpu, index) => (
          <div key={gpu.name || `gpu-full-${index}`} className="p-4 bg-forge-bg border border-forge-border rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-text-primary font-medium">{gpu.name}</p>
                <p className="text-xs text-text-muted">{gpu.vendor} • Driver: {gpu.driver}</p>
              </div>
              <div className="flex items-center gap-2">
                {gpu.capabilities?.cuda && (
                  <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">CUDA</span>
                )}
                {gpu.capabilities?.vulkan && (
                  <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">Vulkan</span>
                )}
                {gpu.capabilities?.openvino && (
                  <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">OpenVINO</span>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-text-muted">VRAM:</span>
                <p className="text-text-primary">{gpu.vram} MB {gpu.vramDynamic && '(shared)'}</p>
              </div>
              <div>
                <span className="text-text-muted">Type:</span>
                <p className="text-text-primary capitalize">{gpu.type?.replace('-', ' ')}</p>
              </div>
            </div>

            {/* Real-time GPU stats */}
            {stats?.gpus?.[index] && (
              <div className="mt-3 pt-3 border-t border-forge-border">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-text-muted">GPU Usage</span>
                      <span className="text-text-secondary">{stats.gpus[index].utilizationGpu || 0}%</span>
                    </div>
                    <ProgressBar value={stats.gpus[index].utilizationGpu || 0} size="md" colorScheme="purple" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-text-muted">VRAM Usage</span>
                      <span className="text-text-secondary">{stats.gpus[index].vramPercent || 0}%</span>
                    </div>
                    <ProgressBar value={stats.gpus[index].vramPercent || 0} size="md" />
                  </div>
                </div>
                {stats.gpus[index].temperature && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-text-muted">
                    <Thermometer size={12} />
                    Temperature: {stats.gpus[index].temperature}°C
                  </div>
                )}
                
                {/* Show Ollama loaded models for this GPU */}
                {index === 0 && stats.ollama?.models?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-forge-border">
                    <div className="text-xs text-text-secondary font-medium mb-2 flex items-center gap-1">
                      <Brain size={12} className="text-workspace-casual" />
                      Models Loaded ({stats.ollama.totalVramMB}MB)
                    </div>
                    <div className="space-y-1">
                      {stats.ollama.models.map((model) => (
                        <div key={model.name} className="flex items-center justify-between text-[11px] text-text-muted bg-forge-bg/50 px-2 py-1 rounded">
                          <span className="font-mono truncate max-w-[150px]">{model.name}</span>
                          <span className="text-workspace-casual font-medium">{Math.round(model.sizeVram / (1024 * 1024))}MB</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* NPU */}
      {hardware.npu?.detected && (
        <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-workspace-casual" />
              <div>
                <p className="text-text-primary font-medium">{hardware.npu.name}</p>
                <p className="text-xs text-text-muted">Neural Processing Unit</p>
              </div>
            </div>
            <span className="px-2 py-0.5 text-xs bg-workspace-casual/20 text-workspace-casual rounded">
              {hardware.npu.tops} TOPS
            </span>
          </div>
          <p className="text-xs text-text-muted">
            NPU available for efficient AI inference. Requires OpenVINO runtime for activation.
          </p>
        </div>
      )}

      {/* Recommendations */}
      {hardware.recommendations && (
        <div className="p-4 bg-workspace-casual/10 border border-workspace-casual/30 rounded-lg">
          <h4 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
            <Zap size={16} className="text-workspace-casual" />
            Recommended Configuration
          </h4>
          <div className="space-y-2">
            {hardware.recommendations.notes?.map((note) => (
              <p key={note} className="text-xs text-text-secondary">• {note}</p>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-workspace-casual/30">
            <p className="text-xs text-text-muted">
              Primary backend: <span className="text-workspace-casual font-medium uppercase">{hardware.recommendations.primary}</span>
            </p>
          </div>
        </div>
      )}

      {/* Real-time CPU & Memory */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-secondary">CPU Usage</span>
              {stats.cpu?.temperature && (
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <Thermometer size={12} />
                  {stats.cpu.temperature}°C
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-text-primary mb-2">
              {stats.cpu?.usage || 0}%
            </div>
            <ProgressBar value={stats.cpu?.usage || 0} size="lg" />
          </div>

          <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-secondary">Memory Usage</span>
              <span className="text-xs text-text-muted">
                {stats.memory?.available || 0} GB free
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary mb-2">
              {stats.memory?.used || 0} / {stats.memory?.total || 0} GB
            </div>
            <ProgressBar value={stats.memory?.usagePercent || 0} size="lg" />
          </div>
        </div>
      )}
    </div>
  );
}

export default HardwareMonitorCompact;

