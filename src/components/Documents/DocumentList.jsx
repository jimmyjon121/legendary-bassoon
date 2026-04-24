import React, { useEffect, useState } from 'react';
import { Trash2, FileText, Loader } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function DocumentList() {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!window.electronAPI?.listDocuments) return;
    setLoading(true);
    setError(null);
    try {
      const list = await window.electronAPI.listDocuments(currentWorkspace);
      setDocs(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load documents:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentWorkspace]);

  const handleDelete = async (id) => {
    if (!window.electronAPI?.deleteDocument) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm('Delete this document and its indexed chunks?');
    if (!ok) return;
    try {
      const res = await window.electronAPI.deleteDocument(id);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to delete document');
      }
      await load();
    } catch (err) {
      console.error('Failed to delete document:', err);
      setError(err.message || String(err));
    }
  };

  return (
    <div className="border border-forge-border rounded-lg bg-forge-bg/40 max-h-64 overflow-y-auto">
      {loading && (
        <div className="p-3 text-xs text-text-muted flex items-center gap-2">
          <Loader className="w-4 h-4 animate-spin" />
          <span>Loading documents…</span>
        </div>
      )}
      {error && (
        <div className="p-3 text-xs text-status-error bg-status-error/10 border-b border-status-error/40">
          {error}
        </div>
      )}
      {!loading && !error && docs.length === 0 && (
        <div className="p-3 text-xs text-text-muted">
          No documents indexed yet for this workspace.
        </div>
      )}
      {!loading &&
        !error &&
        docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between px-3 py-2 border-t border-forge-border/60 text-xs text-text-secondary"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-3 h-3 text-text-muted flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-text-primary">{d.filename}</div>
                <div className="text-[10px] text-text-muted">
                  {d.chunk_count || 0} chunks •{' '}
                  {d.created_at ? new Date(d.created_at).toLocaleString() : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(d.id)}
              className="p-1 rounded text-text-muted hover:text-status-error"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
    </div>
  );
}

export default DocumentList;


