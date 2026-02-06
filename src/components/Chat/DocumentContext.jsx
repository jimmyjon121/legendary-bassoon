import React from 'react';
import { FileText } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function DocumentContext() {
  // Use selector to avoid re-rendering on every store change
  const ragContext = useAppStore(s => s.ragContext);

  if (!ragContext || ragContext.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-forge-border bg-forge-bg/60 p-3 text-xs">
      <div className="flex items-center gap-2 mb-2 text-text-muted">
        <FileText className="w-3 h-3" />
        <span>Answer grounded in the following document snippets:</span>
      </div>
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {ragContext.map((c, idx) => (
          <div key={`${c.id}-${idx}`} className="border border-forge-border/60 rounded px-2 py-1">
            <div className="flex items-center justify-between mb-1 text-[10px] text-text-muted">
              <span className="truncate max-w-[70%]">{c.filename}</span>
              <span>Score: {c.score?.toFixed(2) ?? '—'}</span>
            </div>
            <div className="text-[11px] text-text-primary whitespace-pre-wrap line-clamp-4">
              {c.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DocumentContext;


