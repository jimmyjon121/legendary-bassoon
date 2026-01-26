/**
 * SidebarStats - Enhanced statistics and quick actions panel
 * Shows session data, model usage, and quick insights
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Brain, Zap, Clock, MessageSquare, TrendingUp,
  ChevronDown, ChevronUp, Sparkles, Database, BarChart2,
  History, Star, Target, Award, Layers
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSoulStore } from '../../stores/soulStore';
import { safeCall } from '../../utils/electronAPI';

export function SidebarStats() {
  const { currentWorkspace, currentModel } = useAppStore();
  const { ledgerStats, sessionId } = useSoulStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessionStats, setSessionStats] = useState(null);
  const [topModels, setTopModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load session statistics
  const loadStats = useCallback(async () => {
    try {
      const events = await safeCall('ledger:listEvents', [{ limit: 500 }], []);
      
      if (!events || events.length === 0) {
        setSessionStats({ messages: 0, generations: 0, duration: '0m' });
        setTopModels([]);
        setIsLoading(false);
        return;
      }

      // Calculate stats
      let messages = 0;
      let generations = 0;
      const modelCounts = {};
      let earliestTs = Date.now();

      for (const event of events) {
        if (event.type.includes('message_sent')) messages++;
        if (event.type.includes('generation_complete')) {
          generations++;
          const model = event.payload?.model;
          if (model) {
            modelCounts[model] = (modelCounts[model] || 0) + 1;
          }
        }
        const ts = new Date(event.ts).getTime();
        if (ts < earliestTs) earliestTs = ts;
      }

      // Session duration
      const durationMs = Date.now() - earliestTs;
      const durationMins = Math.round(durationMs / 60000);
      const duration = durationMins < 60 
        ? `${durationMins}m` 
        : `${Math.round(durationMins / 60)}h ${durationMins % 60}m`;

      setSessionStats({ messages, generations, duration });

      // Top models
      const sorted = Object.entries(modelCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
      setTopModels(sorted);

    } catch (error) {
      console.error('Failed to load session stats:', error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
    // Refresh every minute
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
  }, [loadStats]);

  return (
    <div className="border-t border-forge-border/40">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 hover:bg-forge-hover/50 transition-all group"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <BarChart2 size={13} className="text-text-muted group-hover:text-neural-pulse transition-colors" />
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-neural-pulse/60 animate-pulse" />
            </div>
            <span className="text-[11px] text-text-secondary font-medium tracking-wide">Session Stats</span>
          </div>
          <ChevronDown 
            size={13} 
            className={`text-text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
          />
        </div>

        {/* Quick Stats Grid */}
        {!isLoading && sessionStats && (
          <div className="grid grid-cols-3 gap-2">
            <StatPill icon={MessageSquare} value={sessionStats.messages} label="msgs" />
            <StatPill icon={Zap} value={sessionStats.generations} label="gens" />
            <StatPill icon={Clock} value={sessionStats.duration} label="time" />
          </div>
        )}
      </button>

      {/* Expanded View */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-forge-border/30 pt-3">
              {/* Current Model */}
              {currentModel && (
                <div className="p-2.5 rounded-lg bg-forge-surface/50 border border-forge-border/30">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Brain size={12} className="text-neural-pulse" />
                    <span className="text-[10px] text-text-muted uppercase tracking-wide">Active Model</span>
                  </div>
                  <p className="text-xs text-text-primary font-medium truncate">{currentModel}</p>
                </div>
              )}

              {/* Top Used Models */}
              {topModels.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Star size={10} className="text-amber-400" />
                    <span className="text-[10px] text-text-muted uppercase tracking-wide">Top Models</span>
                  </div>
                  <div className="space-y-1">
                    {topModels.map(([model, count], idx) => (
                      <div key={model} className="flex items-center justify-between">
                        <span className="text-[10px] text-text-secondary truncate max-w-[140px]">{model}</span>
                        <span className="text-[10px] text-text-muted font-mono">{count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ledger Stats */}
              {ledgerStats && (
                <div className="pt-2 border-t border-forge-border/30">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Database size={10} className="text-text-muted" />
                    <span className="text-[10px] text-text-muted uppercase tracking-wide">Ledger</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-center p-2 rounded bg-forge-hover/30">
                      <p className="text-sm font-bold text-text-primary">{ledgerStats.events || 0}</p>
                      <p className="text-[9px] text-text-muted">events</p>
                    </div>
                    <div className="text-center p-2 rounded bg-forge-hover/30">
                      <p className="text-sm font-bold text-text-primary">{ledgerStats.friction || 0}</p>
                      <p className="text-[9px] text-text-muted">friction</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="pt-2 border-t border-forge-border/30">
                <button
                  onClick={() => useSoulStore.getState().toggleForgeConsole()}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neural-pulse/10 text-neural-pulse text-xs hover:bg-neural-pulse/20 transition-colors"
                >
                  <Sparkles size={12} />
                  <span>Open Forge Console</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatPill({ icon: Icon, value, label }) {
  return (
    <div className="flex flex-col items-center p-1.5 rounded-md bg-forge-hover/30">
      <div className="flex items-center gap-1">
        <Icon size={10} className="text-text-muted" />
        <span className="text-[11px] font-bold text-text-primary">{value}</span>
      </div>
      <span className="text-[8px] text-text-muted uppercase">{label}</span>
    </div>
  );
}

export default SidebarStats;




