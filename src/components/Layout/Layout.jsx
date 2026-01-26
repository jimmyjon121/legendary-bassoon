import React, { useState, useEffect, useCallback, memo } from 'react';
import { Minus, Square, X, Maximize2, WifiOff, Globe, Cpu } from 'lucide-react';
import { useAppStore, WORKSPACES } from '../../stores/appStore';
import { SoulIndicator } from '../Soul/SoulIndicator';
import { useSoulStore } from '../../stores/soulStore';

// Workspace colors - simple object, no re-computation
const WORKSPACE_COLORS = {
  casual: '#818cf8',
  work: '#10b981',
  code: '#f59e0b',
  nsfw: '#f472b6',
};

// Memoized title bar to prevent re-renders
const TitleBar = memo(function TitleBar({ 
  workspace, 
  accentColor, 
  currentModel, 
  modelStatus, 
  sovereigntyStatus,
  onMinimize,
  onMaximize,
  onClose,
  isMaximized
}) {
  return (
    <header 
      className="titlebar relative z-20 h-12 flex items-center justify-between px-4 border-b bg-surface-0/95 border-border-subtle"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Left: App Info - no-drag for clickable elements */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
        <div 
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: accentColor }}
        >
          <span className="text-white text-xs font-bold">DF</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">DevForge</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-glass-2 text-text-muted font-mono">
            v0.1.0
          </span>
        </div>

        {sovereigntyStatus && (
          <div className={`flex items-center gap-1.5 ml-2 px-2 py-1 rounded-lg border ${
            sovereigntyStatus.localOnly 
              ? 'bg-accent-success/10 border-accent-success/20' 
              : 'bg-glass-2 border-border-subtle'
          }`}>
            {sovereigntyStatus.localOnly ? (
              <>
                <WifiOff size={11} className="text-accent-success" />
                <span className="text-[10px] text-accent-success font-medium">Local</span>
              </>
            ) : (
              <>
                <Globe size={11} className="text-text-muted" />
                <span className="text-[10px] text-text-muted">Network</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Center: Model Status - no-drag for potential click actions */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-glass-2 border border-border-subtle" style={{ WebkitAppRegion: 'no-drag' }}>
        <div className={`w-2 h-2 rounded-full ${
          modelStatus === 'online' ? 'bg-accent-success' :
          modelStatus === 'loading' ? 'bg-accent-warning' : 'bg-text-muted'
        }`} />
        <Cpu size={12} className="text-text-muted" />
        <span className="text-xs text-text-secondary font-medium">
          {currentModel?.split(':')[0] || 'No model'}
        </span>
      </div>

      {/* Right: Controls - no-drag so buttons are clickable */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
        <SoulIndicator onClick={() => useSoulStore.getState().toggleForgeConsole()} />
        
        {/* Workspace badge */}
        <div 
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg ml-1 border"
          style={{
            background: `${accentColor}15`,
            borderColor: `${accentColor}30`
          }}
        >
          <div 
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: accentColor }}
          />
          <span className="text-[11px] font-medium" style={{ color: accentColor }}>
            {workspace?.name}
          </span>
        </div>
        
        {/* Window controls */}
        <div className="flex items-center ml-2">
          <button
            onClick={onMinimize}
            className="w-9 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-3 transition-colors"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={onMaximize}
            className="w-9 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-3 transition-colors"
          >
            {isMaximized ? <Square size={11} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={onClose}
            className="w-9 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-white hover:bg-red-500/80 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  );
});

// Error Toast - memoized
const ErrorToast = memo(function ErrorToast({ error, onClear }) {
  if (!error) return null;
  
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 anim-slide-up">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-accent-error/15 border border-accent-error/30">
        <span className="text-sm text-accent-error font-medium">{error}</span>
        <button 
          onClick={onClear}
          className="p-1 rounded-lg hover:bg-accent-error/20 text-accent-error/70 hover:text-accent-error"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
});

export function Layout({ children }) {
  const currentWorkspace = useAppStore(state => state.currentWorkspace);
  const modelStatus = useAppStore(state => state.modelStatus);
  const currentModel = useAppStore(state => state.currentModel);
  const error = useAppStore(state => state.error);
  const clearError = useAppStore(state => state.clearError);
  
  const [isMaximized, setIsMaximized] = useState(false);
  const [sovereigntyStatus, setSovereigntyStatus] = useState(null);
  
  const workspace = WORKSPACES[currentWorkspace];
  const accentColor = WORKSPACE_COLORS[currentWorkspace] || WORKSPACE_COLORS.casual;

  const checkMaximized = useCallback(async () => {
    const maximized = await window.electronAPI?.isMaximized();
    setIsMaximized(maximized);
  }, []);

  useEffect(() => {
    checkMaximized();

    // Check sovereignty status less frequently
    const refreshSovereignty = async () => {
      if (window.electronAPI?.getSovereigntyStatus) {
        try {
          const status = await window.electronAPI.getSovereigntyStatus();
          setSovereigntyStatus(status);
        } catch (e) {
          // Silently fail
        }
      }
    };

    refreshSovereignty();
    // Check every 30 seconds instead of 15
    const interval = setInterval(refreshSovereignty, 30000);

    return () => clearInterval(interval);
  }, [checkMaximized]);

  const handleMinimize = useCallback(() => window.electronAPI?.minimizeWindow(), []);
  const handleMaximize = useCallback(async () => {
    await window.electronAPI?.maximizeWindow();
    setIsMaximized(prev => !prev);
  }, []);
  const handleClose = useCallback(() => window.electronAPI?.closeWindow(), []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-base">
      <TitleBar 
        workspace={workspace}
        accentColor={accentColor}
        currentModel={currentModel}
        modelStatus={modelStatus}
        sovereigntyStatus={sovereigntyStatus}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
        isMaximized={isMaximized}
      />

      <ErrorToast error={error} onClear={clearError} />

      <div className="flex-1 overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}
