import React from 'react';
import { Copy, Check, ArrowDownRight } from 'lucide-react';

export function CompareResults({ results, onPromote }) {
  const [copiedId, setCopiedId] = React.useState(null);

  const handleCopy = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  if (!results || results.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 grid md:grid-cols-2 gap-4">
      {results.map((res) => (
        <div
          key={res.model}
          className="border border-forge-border rounded-lg bg-forge-bg/60 p-3 flex flex-col h-64"
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs font-medium text-text-primary flex items-center gap-1">
                <span>{res.model}</span>
                {res.error && (
                  <span className="text-status-error text-[10px]">(error)</span>
                )}
              </div>
              {typeof res.ms === 'number' && (
                <div className="text-[10px] text-text-muted">
                  {res.ms} ms
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleCopy(res.model, res.text)}
                className="p-1 rounded text-text-muted hover:text-text-secondary"
                title="Copy response"
              >
                {copiedId === res.model ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              {!res.error && (
                <button
                  type="button"
                  onClick={() => onPromote?.(res)}
                  className="p-1 rounded text-text-muted hover:text-workspace-code flex items-center gap-1 text-[11px]"
                  title="Use this as the assistant reply"
                >
                  <ArrowDownRight className="w-3 h-3" />
                  <span>Use</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto text-xs text-text-secondary whitespace-pre-wrap bg-forge-elevated/40 rounded p-2">
            {res.error ? (
              <span className="text-status-error">{res.error}</span>
            ) : (
              res.text || 'No response'
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default CompareResults;


