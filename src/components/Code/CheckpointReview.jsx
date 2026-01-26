import React from 'react';
import { X, RotateCcw, History } from 'lucide-react';

export function CheckpointReview({ checkpoints = [], onRestore, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-forge-bg border border-forge-border rounded-lg w-[520px] max-h-[80vh] overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <div className="flex items-center gap-2">
            <History size={16} className="text-workspace-code" />
            <div>
              <div className="text-sm text-text-primary font-semibold">Checkpoints</div>
              <div className="text-[11px] text-text-muted">Restore or review recent snapshots</div>
            </div>
          </div>
          <button type="button" className="p-1 rounded hover:bg-forge-hover text-text-muted" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-2 overflow-auto max-h-[60vh]">
          {checkpoints.length === 0 && (
            <div className="text-[12px] text-text-muted">No checkpoints captured yet.</div>
          )}
          {checkpoints.map((cp) => (
            <div
              key={cp.id || cp.message || cp.index}
              className="flex items-center justify-between px-3 py-2 rounded bg-forge-elevated border border-forge-border/60"
            >
              <div className="flex flex-col">
                <span className="text-xs text-text-primary">{cp.message || cp.name}</span>
                {cp.id && <span className="text-[10px] text-text-muted">{cp.id}</span>}
              </div>
              {onRestore && (
                <button
                  type="button"
                  className="text-[11px] px-2 py-1 rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30 flex items-center gap-1"
                  onClick={() => onRestore(cp)}
                >
                  <RotateCcw size={12} />
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CheckpointReview;




