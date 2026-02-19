import React, { useState } from 'react';
import { Monitor, Play } from 'lucide-react';

export function PreviewPane() {
  const [url, setUrl] = useState('http://localhost:5173');
  const [loadedUrl, setLoadedUrl] = useState('');
  const isElectron = Boolean(window?.electronAPI);

  const handleLoad = () => {
    if (!url.trim()) return;
    setLoadedUrl(url.trim());
  };

  return (
    <div className="border border-forge-border rounded-lg bg-black/40 text-white flex flex-col gap-2 p-4 min-h-[280px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor size={20} className="text-workspace-code" />
          <div>
            <p className="text-xs text-text-secondary">Live preview</p>
            <p className="text-[11px] text-text-muted">Point at your dev server</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input h-8 w-52 text-[12px]"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
          <button
            type="button"
            onClick={handleLoad}
            className="px-3 py-1.5 text-[11px] rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30 transition-colors flex items-center gap-1"
          >
            <Play size={12} />
            Load
          </button>
        </div>
      </div>

      {!isElectron && (
        <div className="flex-1 flex items-center justify-center text-[11px] text-text-muted">
          Preview webview available in the desktop app.
        </div>
      )}

      {isElectron && (
        <div className="flex-1 overflow-hidden rounded border border-forge-border bg-black/30">
          {loadedUrl ? (
            <webview
              src={loadedUrl}
              style={{ width: '100%', height: '100%', minHeight: '200px' }}
              allowpopups="true"
              preload=""
            />
          ) : (
            <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
              Enter a URL and press Load to embed the page.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PreviewPane;









