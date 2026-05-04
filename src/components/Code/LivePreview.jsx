import React, { useState, useRef } from 'react';
import { X, RefreshCw, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';

export function LivePreview({ onClose }) {
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef(null);

  // Refresh preview
  const handleRefresh = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      iframeRef.current.contentWindow.location.reload();
    }
  };

  // Handle iframe load
  const handleLoad = () => {
    setIsLoading(false);
  };

  return (
    <div className={`
      flex flex-col bg-forge-surface border border-forge-border rounded-lg overflow-hidden h-full
      ${isFullscreen ? 'fixed inset-4 z-50' : ''}
    `}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-forge-bg border-b border-forge-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">Live Preview</span>
          {isLoading && (
            <RefreshCw size={12} className="animate-spin text-workspace-code" />
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {/* URL Input */}
          <input
            type="text"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            className="w-48 px-2 py-1 text-xs bg-forge-surface border border-forge-border rounded text-text-primary focus:border-workspace-code/50 focus:outline-none"
            placeholder="http://localhost:3000"
          />
          
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded hover:bg-forge-hover text-text-muted hover:text-text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          
          <button
            onClick={() => window.electronAPI?.openExternal?.(previewUrl)}
            className="p-1.5 rounded hover:bg-forge-hover text-text-muted hover:text-text-primary transition-colors"
            title="Open in browser"
          >
            <ExternalLink size={14} />
          </button>
          
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-forge-hover text-text-muted hover:text-text-primary transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-forge-hover text-text-muted hover:text-red-400 transition-colors"
            title="Close preview"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 relative bg-white">
        <iframe
          ref={iframeRef}
          src={previewUrl}
          onLoad={handleLoad}
          className="w-full h-full border-0"
          title="Live Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
        
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-forge-bg/80 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw size={24} className="animate-spin text-workspace-code" />
              <span className="text-xs text-text-muted">Loading preview...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LivePreview;
