import React from 'react';
import { Loader2, CheckCircle, XCircle, X } from 'lucide-react';
import { useProgressStore } from '../../stores/progressStore';
import { ProgressBar } from './ProgressBar';

/**
 * Global progress indicator that shows all active operations
 * Can be placed in a status bar or as a floating panel
 */
export function GlobalProgressIndicator({ variant = 'compact' }) {
  const { operations, removeOperation } = useProgressStore();
  const activeOps = Object.values(operations);

  if (activeOps.length === 0) return null;

  if (variant === 'compact') {
    // Show just a small indicator with count
    const runningCount = activeOps.filter((op) => op.status === 'running').length;
    const latestOp = activeOps[activeOps.length - 1];

    if (runningCount === 0 && !latestOp) return null;

    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-forge-bg/80 border border-forge-border/50">
        {runningCount > 0 ? (
          <>
            <Loader2 size={12} className="animate-spin text-workspace-code" />
            <span className="text-[10px] text-text-muted">
              {runningCount} task{runningCount > 1 ? 's' : ''} running
            </span>
            {latestOp && (
              <span className="text-[10px] text-text-primary truncate max-w-32">
                {latestOp.label}
              </span>
            )}
          </>
        ) : latestOp?.status === 'complete' ? (
          <>
            <CheckCircle size={12} className="text-emerald-400" />
            <span className="text-[10px] text-emerald-400">{latestOp.message}</span>
          </>
        ) : latestOp?.status === 'error' ? (
          <>
            <XCircle size={12} className="text-red-400" />
            <span className="text-[10px] text-red-400 truncate max-w-32">{latestOp.message}</span>
          </>
        ) : null}
      </div>
    );
  }

  // Full panel view
  return (
    <div className="fixed bottom-4 right-4 w-80 bg-forge-surface border border-forge-border rounded-xl shadow-xl overflow-hidden z-50">
      <div className="p-3 border-b border-forge-border bg-forge-bg/50">
        <h3 className="text-sm font-medium text-text-primary">Active Operations</h3>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {activeOps.map((op) => (
          <div key={op.id} className="p-3 border-b border-forge-border/50 last:border-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {op.status === 'running' ? (
                  <Loader2 size={14} className="animate-spin text-workspace-code flex-shrink-0" />
                ) : op.status === 'complete' ? (
                  <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                ) : (
                  <XCircle size={14} className="text-red-400 flex-shrink-0" />
                )}
                <span className="text-xs font-medium text-text-primary truncate">{op.label}</span>
              </div>
              <button
                onClick={() => removeOperation(op.id)}
                className="p-0.5 hover:bg-forge-border/50 rounded text-text-muted hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
            
            {op.status === 'running' && (
              <ProgressBar
                progress={op.progress}
                sublabel={op.message}
                size="sm"
                showPercentage
              />
            )}
            
            {op.status !== 'running' && op.message && (
              <p className={`text-[10px] ${op.status === 'error' ? 'text-red-400' : 'text-text-muted'}`}>
                {op.message}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mini progress indicator for inline use
 */
export function MiniProgressIndicator() {
  const { operations } = useProgressStore();
  const runningOps = Object.values(operations).filter((op) => op.status === 'running');

  if (runningOps.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <Loader2 size={12} className="animate-spin text-workspace-code" />
      <span className="text-[10px] text-text-muted">{runningOps.length}</span>
    </div>
  );
}

export default GlobalProgressIndicator;













