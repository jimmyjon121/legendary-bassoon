/**
 * Hardware Panel Component
 * 
 * Comprehensive display of system hardware and compatibility
 * for AI model inference.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, HardDrive, Monitor, Zap, MemoryStick, Server,
  Gauge, Thermometer, Activity, CheckCircle, XCircle,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw,
  Layers, Box, Database, Eye, Palette, Info,
} from 'lucide-react';

const isElectron = () => typeof window !== 'undefined' && window.electronAPI;

export function HardwarePanel({ onHardwareChange }) {
  const [hardware, setHardware] = useState(null);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load hardware info
  const loadHardware = async () => {
    if (!isElectron()) return;
    
    setRefreshing(true);
    try {
      const [hw, st] = await Promise.all([
        window.electronAPI.detectHardware(),
        window.electronAPI.getHardwareStats?.() || null,
      ]);
      
      setHardware(hw);
      setStats(st);
      
      // Notify parent of hardware capabilities
      if (onHardwareChange && hw) {
        onHardwareChange({
          vramGB: hw.gpus?.[0]?.vram ? Math.round(hw.gpus[0].vram / 1024) : 0,
          ramGB: hw.memory?.total ? Math.round(hw.memory.total / (1024 * 1024 * 1024)) : 16,
          cpuCores: hw.cpu?.cores || 8,
          hasNpu: hw.npu?.available || false,
          hasCuda: hw.gpus?.some(g => g.cuda) || false,
          gpuName: hw.gpus?.[0]?.name || 'Unknown GPU',
        });
      }
    } catch (error) {
      console.error('Hardware detection error:', error);
    }
    setIsLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    loadHardware();
    
    // Refresh stats periodically if expanded
    const interval = setInterval(() => {
      if (isExpanded && isElectron() && window.electronAPI.getHardwareStats) {
        window.electronAPI.getHardwareStats().then(setStats).catch(() => {});
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [isExpanded]);

  if (isLoading) {
    return (
      <div className="p-4 border-b border-forge-border">
        <div className="flex items-center gap-2 text-text-muted">
          <RefreshCw size={14} className="animate-spin" />
          <span className="text-xs">Detecting hardware...</span>
        </div>
      </div>
    );
  }

  if (!hardware) {
    return (
      <div className="p-4 border-b border-forge-border">
        <div className="flex items-center gap-2 text-yellow-400">
          <AlertTriangle size={14} />
          <span className="text-xs">Hardware detection unavailable</span>
        </div>
      </div>
    );
  }

  const gpu = hardware.gpus?.[0];
  const cpu = hardware.cpu;
  const memory = hardware.memory;
  const npu = hardware.npu;

  // Calculate capabilities
  const vramGB = gpu?.vram ? Math.round(gpu.vram / 1024) : 0;
  const ramGB = memory?.total ? Math.round(memory.total / (1024 * 1024 * 1024)) : 0;
  const availableRamGB = memory?.available ? Math.round(memory.available / (1024 * 1024 * 1024)) : 0;

  // Determine what models can run
  const capabilities = getCapabilities(vramGB, ramGB, cpu?.cores || 0, !!npu?.available);

  return (
    <div className="border-b border-forge-border">
      {/* Compact View */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-forge-hover/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-blue-500/20 flex items-center justify-center">
            <Server size={16} className="text-green-400" />
          </div>
          <div className="text-left">
            <p className="text-xs font-medium text-text-primary">Your Hardware</p>
            <p className="text-[10px] text-text-muted">
              {gpu?.name || 'CPU Only'} • {ramGB}GB RAM
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Quick Stats */}
          <div className="flex items-center gap-2">
            {vramGB > 0 && (
              <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px]">
                {vramGB}GB VRAM
              </span>
            )}
            {npu?.available && (
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px]">
                NPU
              </span>
            )}
          </div>
          
          {isExpanded ? (
            <ChevronUp size={14} className="text-text-muted" />
          ) : (
            <ChevronDown size={14} className="text-text-muted" />
          )}
        </div>
      </button>

      {/* Expanded View */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* GPU Section */}
              <div className="p-3 rounded-lg bg-forge-bg border border-forge-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1">
                    <Monitor size={12} />
                    GPU
                  </span>
                  {gpu?.cuda && (
                    <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[9px]">
                      CUDA
                    </span>
                  )}
                </div>
                
                {gpu ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-text-primary">{gpu.name}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-text-muted">VRAM</p>
                        <p className="text-text-primary font-medium">{vramGB} GB</p>
                      </div>
                      {gpu.cudaCores && (
                        <div>
                          <p className="text-text-muted">CUDA Cores</p>
                          <p className="text-text-primary font-medium">{gpu.cudaCores.toLocaleString()}</p>
                        </div>
                      )}
                      {stats?.gpu?.temperature && (
                        <div>
                          <p className="text-text-muted">Temperature</p>
                          <p className={`font-medium ${stats.gpu.temperature > 80 ? 'text-red-400' : stats.gpu.temperature > 60 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {stats.gpu.temperature}°C
                          </p>
                        </div>
                      )}
                      {stats?.gpu?.utilization !== undefined && (
                        <div>
                          <p className="text-text-muted">Utilization</p>
                          <p className="text-text-primary font-medium">{stats.gpu.utilization}%</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">No dedicated GPU detected</p>
                )}
              </div>

              {/* CPU Section */}
              <div className="p-3 rounded-lg bg-forge-bg border border-forge-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1">
                    <Cpu size={12} />
                    CPU
                  </span>
                  {cpu?.avx2 && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[9px]">
                      AVX2
                    </span>
                  )}
                </div>
                
                {cpu ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-text-primary">{cpu.brand || cpu.manufacturer}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-text-muted">Cores</p>
                        <p className="text-text-primary font-medium">{cpu.cores} ({cpu.physicalCores} physical)</p>
                      </div>
                      <div>
                        <p className="text-text-muted">Speed</p>
                        <p className="text-text-primary font-medium">{cpu.speed || cpu.speedMax} GHz</p>
                      </div>
                      {stats?.cpu?.usage !== undefined && (
                        <div>
                          <p className="text-text-muted">Usage</p>
                          <p className="text-text-primary font-medium">{Math.round(stats.cpu.usage)}%</p>
                        </div>
                      )}
                      {stats?.cpu?.temperature && (
                        <div>
                          <p className="text-text-muted">Temperature</p>
                          <p className={`font-medium ${stats.cpu.temperature > 80 ? 'text-red-400' : stats.cpu.temperature > 60 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {stats.cpu.temperature}°C
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">CPU info unavailable</p>
                )}
              </div>

              {/* Memory Section */}
              <div className="p-3 rounded-lg bg-forge-bg border border-forge-border">
                <span className="text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1 mb-2">
                  <MemoryStick size={12} />
                  System Memory
                </span>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">{ramGB} GB Total</span>
                    <span className="text-xs text-text-muted">{availableRamGB} GB Available</span>
                  </div>
                  
                  {/* Memory bar */}
                  <div className="h-2 bg-forge-surface rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all"
                      style={{ width: `${((ramGB - availableRamGB) / ramGB) * 100}%` }}
                    />
                  </div>
                  
                  <p className="text-[10px] text-text-muted">
                    {ramGB - availableRamGB} GB in use • {Math.round((ramGB - availableRamGB) / ramGB * 100)}%
                  </p>
                </div>
              </div>

              {/* NPU Section (if available) */}
              {npu && (
                <div className="p-3 rounded-lg bg-forge-bg border border-forge-border">
                  <span className="text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1 mb-2">
                    <Zap size={12} />
                    Neural Processing Unit
                  </span>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">
                      {npu.name || 'Intel NPU'}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] ${
                      npu.available 
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {npu.available ? 'Available' : 'Not Available'}
                    </span>
                  </div>
                  
                  {npu.available && (
                    <p className="text-[10px] text-text-muted mt-1">
                      OpenVINO acceleration enabled
                    </p>
                  )}
                </div>
              )}

              {/* Capabilities Summary */}
              <div className="p-3 rounded-lg bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20">
                <span className="text-[10px] uppercase tracking-wider text-indigo-400 flex items-center gap-1 mb-3">
                  <Activity size={12} />
                  What You Can Run
                </span>
                
                <div className="grid grid-cols-2 gap-2">
                  {capabilities.map((cap) => (
                    <div 
                      key={cap.name}
                      className={`p-2 rounded border ${
                        cap.supported 
                          ? 'bg-green-500/10 border-green-500/20'
                          : 'bg-forge-bg border-forge-border opacity-50'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        {cap.supported ? (
                          <CheckCircle size={10} className="text-green-400" />
                        ) : (
                          <XCircle size={10} className="text-text-muted" />
                        )}
                        <span className={`text-[10px] font-medium ${cap.supported ? 'text-green-400' : 'text-text-muted'}`}>
                          {cap.name}
                        </span>
                      </div>
                      <p className="text-[9px] text-text-muted">{cap.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Refresh Button */}
              <button
                onClick={loadHardware}
                disabled={refreshing}
                className="w-full py-2 rounded-lg border border-forge-border text-xs text-text-muted hover:text-text-primary hover:bg-forge-hover flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                Refresh Hardware Info
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Determine what the hardware can run
function getCapabilities(vramGB, ramGB, cpuCores, hasNpu) {
  return [
    {
      name: '7B Models',
      description: 'Llama 3.2, Mistral, Qwen',
      supported: vramGB >= 6 || ramGB >= 16,
    },
    {
      name: '13B Models',
      description: 'Llama 2 13B, CodeLlama',
      supported: vramGB >= 10 || ramGB >= 24,
    },
    {
      name: '34B+ Models',
      description: 'Large flagship models',
      supported: vramGB >= 24 || ramGB >= 48,
    },
    {
      name: '70B Models',
      description: 'Llama 3.1 70B, etc.',
      supported: vramGB >= 48 || ramGB >= 96,
    },
    {
      name: 'Vision Models',
      description: 'LLaVA, Moondream',
      supported: vramGB >= 8 || ramGB >= 16,
    },
    {
      name: 'SDXL Images',
      description: 'Stable Diffusion XL',
      supported: vramGB >= 10,
    },
    {
      name: 'FLUX Images',
      description: 'FLUX.1 models',
      supported: vramGB >= 16,
    },
    {
      name: 'NPU Acceleration',
      description: 'Intel OpenVINO',
      supported: hasNpu,
    },
  ];
}

export default HardwarePanel;












