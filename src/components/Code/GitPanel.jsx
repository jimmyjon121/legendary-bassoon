import React, { useEffect, useState } from 'react';
import { GitBranch, RefreshCw, AlertTriangle } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import gitService from '../../services/gitService';

export function GitPanel() {
  const { rootPath } = useEditorStore((state) => ({
    rootPath: state.rootPath,
  }));
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadStatus = async () => {
    if (!rootPath) return;
    setIsLoading(true);
    const next = await gitService.getGitStatus(rootPath);
    setStatus(next);
    setIsLoading(false);
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  if (!rootPath) {
    return (
      <div className="border border-dashed border-forge-border rounded-lg p-3 text-[11px] text-text-muted">
        Load a project to view git status.
      </div>
    );
  }

  return (
    <div className="border border-forge-border rounded-lg p-3 bg-forge-bg/70">
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-2 text-text-primary font-semibold">
          <GitBranch size={12} />
          {status?.branch || 'branch'}
        </div>
        <button
          type="button"
          className="text-text-muted hover:text-text-primary"
          onClick={loadStatus}
          disabled={isLoading}
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {status?.error && (
        <div className="flex items-center gap-1 text-[11px] text-amber-400 mb-2">
          <AlertTriangle size={12} />
          {status.error}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-text-muted mb-2">
        <span>↑ {status?.ahead ?? 0}</span>
        <span>↓ {status?.behind ?? 0}</span>
        <span>{status?.files?.length || 0} files</span>
      </div>

      <div className="space-y-1 max-h-32 overflow-auto text-[11px] text-text-secondary">
        {(status?.files || []).slice(0, 6).map((file) => (
          <div key={`${file.path}-${file.status}`} className="flex items-center gap-2 truncate">
            <span className="font-mono text-[10px] text-workspace-code">{file.status}</span>
            <span className="truncate">{file.path}</span>
          </div>
        ))}
        {status?.files?.length > 6 && (
          <div className="text-[10px] text-text-muted">+{status.files.length - 6} more…</div>
        )}
      </div>
    </div>
  );
}

export default GitPanel;













