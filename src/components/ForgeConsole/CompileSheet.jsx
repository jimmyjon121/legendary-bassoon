/**
 * Compile Sheet
 * 
 * UI for Intent → Actions compilation and execution.
 * Shows plan preview, risk assessment, and execution controls.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Play, Pause, RotateCcw, Check, AlertTriangle, 
  ChevronRight, Code, Terminal, FileText, Search,
  MessageSquare, GitBranch, Zap, Clock, Shield
} from 'lucide-react';
import { isElectron, safeCall } from '../../utils/electronAPI';

// Step type icons
const STEP_ICONS = {
  edit_file: Code,
  create_file: FileText,
  delete_file: X,
  run_command: Terminal,
  search_docs: Search,
  search_codebase: Search,
  checkpoint: GitBranch,
  verify: Check,
  ask_clarification: MessageSquare,
  llm_generate: Zap,
  conditional: GitBranch,
};

// Step status colors
const STATUS_COLORS = {
  pending: 'text-text-muted',
  running: 'text-amber-400',
  completed: 'text-emerald-400',
  failed: 'text-rose-400',
  skipped: 'text-text-muted',
};

/**
 * Main Compile Sheet Modal
 */
export function CompileSheet({ isOpen, onClose, initialIntent = '' }) {
  const [intent, setIntent] = useState(initialIntent);
  const [isCompiling, setIsCompiling] = useState(false);
  const [plan, setPlan] = useState(null);
  const [complexity, setComplexity] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [stepStatuses, setStepStatuses] = useState({});
  const [error, setError] = useState(null);
  
  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setPlan(null);
      setComplexity(null);
      setExecutionResult(null);
      setStepStatuses({});
      setError(null);
    }
  }, [isOpen]);
  
  // Compile intent to plan
  const handleCompile = async () => {
    if (!intent.trim()) return;
    
    setIsCompiling(true);
    setError(null);
    setPlan(null);
    
    try {
      const result = await safeCall('intent:compile', [{ intent: intent.trim() }], null);
      
      if (result?.error) {
        setError(result.error);
      } else if (result?.plan) {
        setPlan(result.plan);
        setComplexity(result.complexity);
      }
    } catch (err) {
      setError(err.message || 'Compilation failed');
    }
    
    setIsCompiling(false);
  };
  
  // Execute the plan
  const handleExecute = async () => {
    if (!plan) return;
    
    setIsExecuting(true);
    setExecutionResult(null);
    
    // Initialize step statuses
    const initialStatuses = {};
    plan.steps.forEach((_, idx) => {
      initialStatuses[idx] = 'pending';
    });
    setStepStatuses(initialStatuses);
    
    try {
      const result = await safeCall('intent:execute', [{ plan }], null);
      
      // Update step statuses from result
      if (result?.context?.stepOutputs) {
        const newStatuses = {};
        result.context.stepOutputs.forEach((output, idx) => {
          newStatuses[idx] = output?.status || 'completed';
        });
        setStepStatuses(newStatuses);
      }
      
      setExecutionResult(result);
    } catch (err) {
      setError(err.message || 'Execution failed');
    }
    
    setIsExecuting(false);
  };
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-8"
        onClick={(e) => e.target === e.currentTarget && !isExecuting && onClose()}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        
        {/* Sheet */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-3xl max-h-[85vh] rounded-2xl bg-forge-bg border border-forge-border shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-400/10">
                <Zap size={18} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Intent Compiler</h2>
                <p className="text-xs text-text-muted">Describe what you want → Get executable plan</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isExecuting}
              className="p-2 rounded-lg hover:bg-forge-hover transition-colors disabled:opacity-50"
            >
              <X size={18} className="text-text-muted" />
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Intent Input */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                What do you want to do?
              </label>
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="Example: Add a loading spinner to the submit button in LoginForm.jsx"
                rows={3}
                disabled={isCompiling || isExecuting}
                className="w-full px-4 py-3 rounded-xl bg-forge-surface border border-forge-border text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-amber-400/50 disabled:opacity-50"
              />
              <button
                onClick={handleCompile}
                disabled={!intent.trim() || isCompiling || isExecuting}
                className="mt-3 px-4 py-2 rounded-lg bg-amber-400/20 text-amber-400 text-sm font-medium hover:bg-amber-400/30 transition-colors disabled:opacity-50"
              >
                {isCompiling ? 'Compiling...' : 'Compile to Plan'}
              </button>
            </div>
            
            {/* Error */}
            {error && (
              <div className="p-4 rounded-xl bg-rose-400/10 border border-rose-400/30">
                <div className="flex items-center gap-2 text-rose-400">
                  <AlertTriangle size={16} />
                  <span className="text-sm font-medium">Error</span>
                </div>
                <p className="text-sm text-text-secondary mt-1">{error}</p>
              </div>
            )}
            
            {/* Plan Preview */}
            {plan && (
              <div className="space-y-4">
                {/* Complexity Badge */}
                {complexity && (
                  <div className="flex items-center gap-4">
                    <ComplexityBadge label="Complexity" value={complexity.complexityLabel} />
                    <ComplexityBadge label="Risk" value={complexity.riskLabel} />
                    <div className="text-xs text-text-muted">
                      {complexity.stepCount} step{complexity.stepCount !== 1 ? 's' : ''}
                      {complexity.canRollback && (
                        <span className="ml-2 text-emerald-400">• Rollback available</span>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Steps */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-text-secondary">Execution Plan</h3>
                  {plan.steps.map((step, idx) => (
                    <StepCard
                      key={idx}
                      step={step}
                      index={idx}
                      status={stepStatuses[idx]}
                    />
                  ))}
                </div>
                
                {/* Risk Warnings */}
                {complexity?.risks?.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-400/10 border border-amber-400/30">
                    <div className="flex items-center gap-2 text-amber-400 mb-2">
                      <Shield size={14} />
                      <span className="text-xs font-medium">Risk Notes</span>
                    </div>
                    <ul className="space-y-1">
                      {complexity.risks.map((risk, idx) => (
                        <li key={idx} className="text-xs text-text-secondary">
                          • {risk.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            
            {/* Execution Result */}
            {executionResult && (
              <div className={`p-4 rounded-xl border ${
                executionResult.success 
                  ? 'bg-emerald-400/10 border-emerald-400/30' 
                  : 'bg-rose-400/10 border-rose-400/30'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {executionResult.success ? (
                    <>
                      <Check size={16} className="text-emerald-400" />
                      <span className="text-sm font-medium text-emerald-400">Execution Complete</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={16} className="text-rose-400" />
                      <span className="text-sm font-medium text-rose-400">Execution Failed</span>
                    </>
                  )}
                </div>
                {executionResult.error && (
                  <p className="text-xs text-text-secondary">{executionResult.error}</p>
                )}
                {executionResult.runId && (
                  <p className="text-[10px] text-text-muted mt-2 font-mono">
                    Run ID: {executionResult.runId}
                  </p>
                )}
              </div>
            )}
          </div>
          
          {/* Footer */}
          {plan && !executionResult && (
            <div className="px-6 py-4 border-t border-forge-border bg-forge-surface/50 flex items-center justify-between">
              <p className="text-xs text-text-muted">
                Review the plan before executing. Changes can be rolled back from checkpoints.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPlan(null)}
                  disabled={isExecuting}
                  className="px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-forge-hover transition-colors disabled:opacity-50"
                >
                  Edit Intent
                </button>
                <button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {isExecuting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Executing...</span>
                    </>
                  ) : (
                    <>
                      <Play size={14} />
                      <span>Execute Plan</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Step Card Component
 */
function StepCard({ step, index, status }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = STEP_ICONS[step.type] || Zap;
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.pending;
  
  return (
    <div className={`rounded-lg border transition-colors ${
      status === 'completed' ? 'border-emerald-400/30 bg-emerald-400/5' :
      status === 'failed' ? 'border-rose-400/30 bg-rose-400/5' :
      status === 'running' ? 'border-amber-400/30 bg-amber-400/5' :
      'border-forge-border bg-forge-surface/50'
    }`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center justify-center w-6 h-6 rounded bg-forge-bg text-xs font-mono text-text-muted">
          {index + 1}
        </div>
        <Icon size={14} className={statusColor} />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-text-primary">{step.description || step.type}</span>
          <span className="ml-2 text-xs text-text-muted">{step.type}</span>
        </div>
        {status && status !== 'pending' && (
          <StatusIndicator status={status} />
        )}
        <ChevronRight 
          size={14} 
          className={`text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-forge-border/50 px-4 py-3"
          >
            <pre className="text-xs text-text-secondary bg-forge-bg rounded p-2 overflow-x-auto">
              {JSON.stringify(step.params, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Status Indicator
 */
function StatusIndicator({ status }) {
  switch (status) {
    case 'completed':
      return <Check size={14} className="text-emerald-400" />;
    case 'failed':
      return <X size={14} className="text-rose-400" />;
    case 'running':
      return <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />;
    default:
      return null;
  }
}

/**
 * Complexity Badge
 */
function ComplexityBadge({ label, value }) {
  const color = value === 'Low' ? 'text-emerald-400 bg-emerald-400/10' :
                value === 'Medium' ? 'text-amber-400 bg-amber-400/10' :
                'text-rose-400 bg-rose-400/10';
  
  return (
    <div className={`px-2 py-1 rounded text-xs font-medium ${color}`}>
      {label}: {value}
    </div>
  );
}

export default CompileSheet;




