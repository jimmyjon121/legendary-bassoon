import React, { useState, useEffect, useCallback, memo } from 'react';
import { WifiOff, Globe, RotateCcw, X, Minus, Square, Unplug } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { pollingCoordinator } from '../../services/pollingCoordinator';
import { api } from '../../utils/electronAPI';
import { WarmupOverlay } from '../ModelExperience/WarmupOverlay';

// Workspace colors - simple object, no re-computation
const WORKSPACE_COLORS = {
  casual: '#818cf8',
  work: '#10b981',
  research: '#38bdf8',
  code: '#f59e0b',
  nsfw: '#f472b6',
};

function formatCurrentModelLabel(currentModel) {
  const raw = String(currentModel || '').trim();
  if (!raw) return 'No model';
  if (/^npu:/i.test(raw)) {
    const target = raw.slice(4).trim();
    const parts = target.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'NPU model';
  }
  return raw.split(':')[0] || raw;
}

function normalizeModelKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:latest$/i, '');
}

// Memoized title bar to prevent re-renders
const TitleBar = memo(function TitleBar({ 
  accentColor, 
  currentModel, 
  modelStatus, 
  isActiveModelLoaded,
  sovereigntyStatus,
  showDevRefresh,
  showWindowControls,
  isWindowMaximized,
  onRestartApp,
  isRestartingApp,
  isEjectingModel,
  onWindowMinimize,
  onWindowMaximize,
  onWindowClose,
  onEjectModel,
}) {
  const hasActiveModel = Boolean(String(currentModel || '').trim());
  const statusTone = hasActiveModel
    ? (isActiveModelLoaded ? 'loaded' : 'unloaded')
    : 'none';

  return (
    <header 
      className="titlebar relative z-20 h-10 flex items-center justify-between px-3 border-b bg-[#0a0b10]/95 border-white/[0.06]"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Left: App branding */}
      <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: 'no-drag' }}>
        <div 
          className="w-6 h-6 rounded-md flex items-center justify-center"
          style={{ background: accentColor }}
        >
          <span className="text-white text-[10px] font-bold">DF</span>
        </div>
        
        <span className="text-[13px] font-semibold text-text-primary">DevForge</span>

        {sovereigntyStatus && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            sovereigntyStatus.localOnly 
              ? 'text-emerald-400/80' 
              : 'text-text-muted/60'
          }`}>
            {sovereigntyStatus.localOnly ? (
              <>
                <WifiOff size={10} />
                Local
              </>
            ) : (
              <>
                <Globe size={10} />
                Network
              </>
            )}
          </span>
        )}
      </div>

      {/* Center: Model status */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06]" style={{ WebkitAppRegion: 'no-drag' }}>
        <div className={`w-1.5 h-1.5 rounded-full ${
          modelStatus === 'loading' || modelStatus === 'warming'
            ? 'bg-amber-400'
            : statusTone === 'loaded'
              ? 'bg-emerald-400'
              : 'bg-zinc-600'
        }`} />
        <span className="text-[11px] text-zinc-400 font-medium">
          {formatCurrentModelLabel(currentModel)}
        </span>
        {hasActiveModel && (
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
            statusTone === 'loaded'
              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
              : 'border-zinc-500/35 bg-zinc-500/10 text-zinc-300'
          }`}>
            {statusTone === 'loaded' ? 'Loaded' : 'Unloaded'}
          </span>
        )}
        {hasActiveModel && (
          <button
            type="button"
            onClick={onEjectModel}
            disabled={isEjectingModel}
            className="inline-flex h-5 items-center gap-1 rounded border border-red-400/20 bg-red-500/[0.08] px-1.5 text-[10px] font-medium text-red-200 transition hover:bg-red-500/[0.14] disabled:cursor-wait disabled:opacity-60"
            title="Eject current model from active runtimes (GPU/NPU)"
          >
            <Unplug size={10} />
            <span>{isEjectingModel ? 'Ejecting' : 'Eject'}</span>
          </button>
        )}
      </div>

      {/* Right: Restart is prominent because it relaunches the full Electron
          app and picks up renderer, main-process, IPC, and native changes. */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
        {showDevRefresh && (
          <button
            type="button"
            onClick={onRestartApp}
            disabled={isRestartingApp}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-amber-300/90 hover:text-amber-200 hover:bg-amber-500/[0.12] border border-amber-500/[0.15] hover:border-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="Restart app — full Electron relaunch. Picks up renderer, electron/, native module, orchestrator, and IPC changes."
          >
            <RotateCcw size={13} className={isRestartingApp ? 'animate-spin' : ''} />
            <span className="text-[11px] font-medium">{isRestartingApp ? 'Restarting...' : 'Restart'}</span>
          </button>
        )}
        {showDevRefresh && showWindowControls && (
          <div className="w-px h-5 bg-white/[0.1] mx-1.5" aria-hidden />
        )}
        {showWindowControls && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onWindowMinimize}
              className="flex h-7 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] transition-colors"
              title="Minimize"
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              onClick={onWindowMaximize}
              className="flex h-7 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05] transition-colors"
              title={isWindowMaximized ? 'Restore' : 'Maximize'}
            >
              <Square size={12} className={isWindowMaximized ? 'scale-90' : ''} />
            </button>
            <button
              type="button"
              onClick={onWindowClose}
              className="flex h-7 w-8 items-center justify-center rounded text-zinc-500 hover:text-red-300 hover:bg-red-500/20 transition-colors"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        )}
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
  const llmRuntimeState = useAppStore(state => state.llmRuntimeState);
  const error = useAppStore(state => state.error);
  const clearError = useAppStore(state => state.clearError);
  
  const [sovereigntyStatus, setSovereigntyStatus] = useState(null);
  const [showDevRefresh, setShowDevRefresh] = useState(
    typeof window !== 'undefined' && Boolean(window.electronAPI)
  );
  const [showWindowControls, setShowWindowControls] = useState(
    typeof window !== 'undefined' && Boolean(window.electronAPI)
  );
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isRestartingApp, setIsRestartingApp] = useState(false);
  const [isEjectingModel, setIsEjectingModel] = useState(false);
  const [isActiveModelLoaded, setIsActiveModelLoaded] = useState(false);
  
  const accentColor = WORKSPACE_COLORS[currentWorkspace] || WORKSPACE_COLORS.casual;

  useEffect(() => {
    let mounted = true;
    const resolveDevRefreshVisibility = () => {
      if (mounted) {
        setShowDevRefresh(typeof window !== 'undefined' && Boolean(window.electronAPI));
      }
    };

    resolveDevRefreshVisibility();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const canUseWindowApi = typeof window !== 'undefined' && Boolean(window.electronAPI);
    setShowWindowControls(canUseWindowApi);
    if (!canUseWindowApi) return undefined;

    const syncWindowState = async () => {
      const maximized = await api.isMaximized();
      if (mounted) setIsWindowMaximized(Boolean(maximized));
    };

    syncWindowState();
    window.addEventListener('resize', syncWindowState);
    window.addEventListener('focus', syncWindowState);

    return () => {
      mounted = false;
      window.removeEventListener('resize', syncWindowState);
      window.removeEventListener('focus', syncWindowState);
    };
  }, []);

  const handleWindowMinimize = async () => {
    await api.minimizeWindow();
  };

  const handleWindowMaximize = async () => {
    await api.maximizeWindow();
    const maximized = await api.isMaximized();
    setIsWindowMaximized(Boolean(maximized));
  };

  const handleWindowClose = async () => {
    await api.closeWindow();
  };

  const refreshLoadedStatus = useCallback(async () => {
    const modelName = String(currentModel || '').trim();
    if (!modelName) {
      setIsActiveModelLoaded(false);
      return;
    }

    const currentKey = normalizeModelKey(modelName);
    try {
      if (window?.electronAPI?.sparkModelHubLoadedModels) {
        const loaded = await window.electronAPI.sparkModelHubLoadedModels();
        const loadedModels = Array.isArray(loaded?.models) ? loaded.models : [];
        const isLoaded = loadedModels.some((entry) => {
          const candidate = String(entry?.name || entry?.model || '').trim();
          return normalizeModelKey(candidate) === currentKey;
        });
        setIsActiveModelLoaded(Boolean(isLoaded));
        return;
      }
    } catch (_) {
      // Fall through to runtime-state heuristic.
    }

    const effective = normalizeModelKey(
      llmRuntimeState?.effectiveModel || llmRuntimeState?.requestedModel || ''
    );
    setIsActiveModelLoaded(Boolean(effective && effective === currentKey && modelStatus === 'online'));
  }, [currentModel, llmRuntimeState, modelStatus]);

  const handleEjectModel = async () => {
    if (!currentModel || isEjectingModel) return;
    setIsEjectingModel(true);
    try {
      await Promise.all([
        api.unloadModel(currentModel),
        api.unloadNpuModel(),
      ]);
      setIsActiveModelLoaded(false);
    } finally {
      setIsEjectingModel(false);
      void refreshLoadedStatus();
    }
  };

  // Full-app restart: relaunches Electron, so main-process changes
  // (new IPC handlers, orchestrator updates, native modules like
  // node-llama-cpp) actually take effect. Slower than a refresh
  // but picks up everything.
  const handleRestartApp = async () => {
    if (typeof window === 'undefined' || isRestartingApp) return;
    setIsRestartingApp(true);

    try {
      window.sessionStorage?.setItem('devforge:startup-complete', '1');
    } catch { /* non-blocking */ }

    try {
      if (window.electronAPI?.restartApp) {
        await window.electronAPI.restartApp();
        return; // electron exits + relaunches; we won't reach here
      }
      // Fallback: no electron bridge — best we can do is a hard reload.
      window.location.reload();
    } catch (error) {
      console.warn('[Layout] Restart failed:', error?.message || error);
      window.location.reload();
    } finally {
      setIsRestartingApp(false);
    }
  };

  useEffect(() => {
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
    const unsubscribePolling = pollingCoordinator.subscribe('layout:sovereignty-status', {
      run: refreshSovereignty,
      intervalMs: 30000,
      hiddenIntervalMs: 120000,
    });

    return () => unsubscribePolling?.();
  }, []);

  useEffect(() => {
    void refreshLoadedStatus();
    const unsubscribePolling = pollingCoordinator.subscribe('layout:model-loaded-status', {
      run: refreshLoadedStatus,
      intervalMs: 8000,
      hiddenIntervalMs: 30000,
    });
    return () => unsubscribePolling?.();
  }, [refreshLoadedStatus]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-base">
      <TitleBar 
        accentColor={accentColor}
        currentModel={currentModel}
        modelStatus={modelStatus}
        isActiveModelLoaded={isActiveModelLoaded}
        sovereigntyStatus={sovereigntyStatus}
        showDevRefresh={showDevRefresh}
        showWindowControls={showWindowControls}
        isWindowMaximized={isWindowMaximized}
        onRestartApp={handleRestartApp}
        isRestartingApp={isRestartingApp}
        isEjectingModel={isEjectingModel}
        onWindowMinimize={handleWindowMinimize}
        onWindowMaximize={handleWindowMaximize}
        onWindowClose={handleWindowClose}
        onEjectModel={handleEjectModel}
      />

      <ErrorToast error={error} onClear={clearError} />

      <div className="flex-1 overflow-hidden relative">
        {children}
      </div>

      <WarmupOverlay />
    </div>
  );
}
