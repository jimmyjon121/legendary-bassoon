import React from 'react';

/**
 * Simple Diff Viewer
 * Expects `diff` string (unified diff) or `before`/`after` content.
 * Optionally renders approve/reject buttons via callbacks.
 */
export function DiffViewer({
  title = 'Proposed Change',
  diff,
  before,
  after,
  onApprove,
  onReject,
  disableActions,
}) {
  const renderContent = () => {
    if (diff) {
      return diff;
    }
    if (before !== undefined || after !== undefined) {
      return [
        '--- before\n',
        before ?? '',
        '\n+++ after\n',
        after ?? '',
      ].join('');
    }
    return 'No diff available.';
  };

  return (
    <div className="border border-forge-border rounded-lg bg-forge-bg/70 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/60">
        <span className="text-sm text-text-primary font-medium truncate">{title}</span>
        {!disableActions && (
          <div className="flex items-center gap-2 text-xs">
            {onReject && (
              <button
                type="button"
                onClick={onReject}
                className="px-2 py-1 rounded bg-forge-bg hover:bg-forge-hover text-text-muted"
              >
                Reject
              </button>
            )}
            {onApprove && (
              <button
                type="button"
                onClick={onApprove}
                className="px-2 py-1 rounded bg-workspace-code text-white hover:bg-workspace-code/80"
              >
                Apply
              </button>
            )}
          </div>
        )}
      </div>
      <pre className="text-xs leading-relaxed whitespace-pre overflow-auto p-3 bg-black/30 text-text-primary">
{renderContent()}
      </pre>
    </div>
  );
}

export default DiffViewer;

