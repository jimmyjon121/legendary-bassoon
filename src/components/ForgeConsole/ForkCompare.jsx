/**
 * Fork Compare
 * 
 * UI for comparing counterfactual decision paths.
 * Shows side-by-side comparison of alternatives with predicted outcomes.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, GitBranch, ArrowRight, Clock, AlertTriangle, 
  CheckCircle, TrendingUp, TrendingDown, Minus,
  Sparkles, Brain, Zap
} from 'lucide-react';
import { isElectron, safeCall } from '../../utils/electronAPI';

/**
 * Fork Compare Modal
 */
export function ForkCompare({ isOpen, onClose, forkId = null }) {
  const [forks, setForks] = useState([]);
  const [selectedFork, setSelectedFork] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      loadForks();
    }
  }, [isOpen, forkId]);
  
  const loadForks = async () => {
    setIsLoading(true);
    try {
      // Load forks from ledger
      const events = await safeCall('ledger:listEvents', [{ 
        types: ['fork_created'], 
        limit: 20 
      }], []);
      
      // Transform to fork objects
      const forkData = events.map(event => ({
        id: event.id,
        forkPoint: event.payload?.forkPoint || 'Unknown decision',
        timestamp: event.ts,
        alternatives: event.payload?.alternatives || [],
        chosen: event.payload?.chosenId,
        predictions: event.payload?.predicted || {},
      }));
      
      setForks(forkData);
      
      if (forkId) {
        const target = forkData.find(f => f.id === forkId);
        if (target) setSelectedFork(target);
      }
    } catch (error) {
      console.error('Failed to load forks:', error);
    }
    setIsLoading(false);
  };
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-8"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        
        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-5xl max-h-[85vh] rounded-2xl bg-forge-bg border border-forge-border shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-400/10">
                <GitBranch size={18} className="text-violet-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Decision Forks</h2>
                <p className="text-xs text-text-muted">Compare alternative paths and outcomes</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-forge-hover transition-colors"
            >
              <X size={18} className="text-text-muted" />
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Fork List */}
            <div className="w-64 border-r border-forge-border overflow-y-auto p-4 space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase mb-3">Decision Points</h3>
              
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                </div>
              ) : forks.length === 0 ? (
                <div className="text-center py-8">
                  <GitBranch size={24} className="text-text-muted mx-auto mb-2" />
                  <p className="text-xs text-text-secondary">No forks recorded</p>
                  <p className="text-[10px] text-text-muted mt-1">
                    Create forks when facing important decisions
                  </p>
                </div>
              ) : (
                forks.map(fork => (
                  <button
                    key={fork.id}
                    onClick={() => setSelectedFork(fork)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedFork?.id === fork.id
                        ? 'border-violet-400/50 bg-violet-400/10'
                        : 'border-forge-border hover:bg-forge-hover'
                    }`}
                  >
                    <p className="text-sm text-text-primary truncate">{fork.forkPoint}</p>
                    <p className="text-[10px] text-text-muted mt-1">
                      {fork.alternatives?.length || 0} alternatives • {new Date(fork.timestamp).toLocaleDateString()}
                    </p>
                  </button>
                ))
              )}
              
              {/* Create New Fork */}
              <button className="w-full p-3 rounded-lg border border-dashed border-forge-border hover:border-violet-400/50 hover:bg-violet-400/5 transition-colors text-center">
                <span className="text-xs text-text-muted">+ Record New Fork</span>
              </button>
            </div>
            
            {/* Fork Detail */}
            <div className="flex-1 overflow-y-auto p-6">
              {selectedFork ? (
                <ForkDetail fork={selectedFork} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <GitBranch size={48} className="text-text-muted mb-4" />
                  <p className="text-text-secondary">Select a fork to compare alternatives</p>
                  <p className="text-xs text-text-muted mt-2 max-w-sm">
                    Decision forks let you explore "what if" scenarios and compare 
                    predicted outcomes for different choices.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Fork Detail View
 */
function ForkDetail({ fork }) {
  return (
    <div className="space-y-6">
      {/* Fork Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{fork.forkPoint}</h3>
        <p className="text-xs text-text-muted mt-1">
          <Clock size={12} className="inline mr-1" />
          {new Date(fork.timestamp).toLocaleString()}
        </p>
      </div>
      
      {/* Alternatives Comparison */}
      {fork.alternatives && fork.alternatives.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fork.alternatives.map((alt, idx) => (
            <AlternativeCard
              key={alt.id || idx}
              alternative={alt}
              isChosen={fork.chosen === alt.id}
              prediction={fork.predictions?.[alt.id]}
            />
          ))}
        </div>
      ) : (
        <EmptyAlternatives />
      )}
      
      {/* Outcome Analysis */}
      {fork.actual && (
        <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
          <h4 className="text-sm font-medium text-text-primary mb-3">Actual Outcome</h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <MetricCard label="Time Spent" value={fork.actual.time || '--'} />
            <MetricCard label="Success" value={fork.actual.success ? 'Yes' : 'No'} />
            <MetricCard label="Satisfaction" value={fork.actual.satisfaction || '--'} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Alternative Card
 */
function AlternativeCard({ alternative, isChosen, prediction }) {
  return (
    <div className={`p-4 rounded-xl border ${
      isChosen 
        ? 'border-emerald-400/50 bg-emerald-400/5' 
        : 'border-forge-border bg-forge-surface/50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-medium text-text-primary">
            {alternative.label || `Option ${alternative.id}`}
          </h4>
          {isChosen && (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 mt-1">
              <CheckCircle size={10} />
              Chosen path
            </span>
          )}
        </div>
        <GitBranch size={14} className="text-text-muted" />
      </div>
      
      {/* Description */}
      {alternative.description && (
        <p className="text-xs text-text-secondary mb-3">
          {alternative.description}
        </p>
      )}
      
      {/* Predictions */}
      {prediction && (
        <div className="space-y-2 pt-3 border-t border-forge-border/50">
          <p className="text-[10px] text-text-muted uppercase">Predicted Outcomes</p>
          
          <div className="grid grid-cols-3 gap-2">
            <PredictionMetric
              label="Time"
              value={prediction.time || '?'}
              trend={prediction.timeTrend}
            />
            <PredictionMetric
              label="Risk"
              value={prediction.risk || 'Med'}
              trend={prediction.riskTrend}
            />
            <PredictionMetric
              label="Value"
              value={prediction.value || '?'}
              trend={prediction.valueTrend}
            />
          </div>
          
          {prediction.notes && (
            <p className="text-[10px] text-text-muted italic mt-2">
              "{prediction.notes}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Prediction Metric
 */
function PredictionMetric({ label, value, trend }) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-text-muted';
  
  return (
    <div className="text-center p-2 rounded bg-forge-bg">
      <p className="text-[10px] text-text-muted">{label}</p>
      <div className="flex items-center justify-center gap-1 mt-1">
        <span className="text-xs font-medium text-text-primary">{value}</span>
        {trend && <TrendIcon size={10} className={trendColor} />}
      </div>
    </div>
  );
}

/**
 * Metric Card
 */
function MetricCard({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-text-muted">{label}</p>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}

/**
 * Empty Alternatives Placeholder
 */
function EmptyAlternatives() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {[1, 2].map(i => (
        <div 
          key={i}
          className="p-4 rounded-xl border border-dashed border-forge-border text-center"
        >
          <Sparkles size={20} className="text-text-muted mx-auto mb-2" />
          <p className="text-xs text-text-secondary">Add Alternative {i}</p>
          <button className="mt-2 px-3 py-1 rounded text-[10px] bg-forge-hover text-text-muted hover:text-text-secondary transition-colors">
            Generate with AI
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Hook for creating forks from messages
 */
export function useCreateFork() {
  const [isCreating, setIsCreating] = useState(false);
  
  const createFork = async (forkPoint, alternatives = []) => {
    if (!isElectron()) return null;
    
    setIsCreating(true);
    try {
      const result = await safeCall('ledger:createDecisionFork', [{
        forkPoint,
        alternatives,
        predicted: {},
      }], null);
      
      return result;
    } catch (error) {
      console.error('Failed to create fork:', error);
      return null;
    } finally {
      setIsCreating(false);
    }
  };
  
  return { createFork, isCreating };
}

export default ForkCompare;




