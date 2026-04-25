import React, { useEffect, useState, lazy, Suspense, memo } from 'react';
import { useAppStore } from './stores/appStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Layout } from './components/Layout/Layout';
import { Sidebar } from './components/Sidebar/Sidebar';
import { LockScreen } from './components/Workspaces/LockScreen';
import { ToastContainer } from './components/ui/Toast';
import { KeyboardShortcutsModal, useKeyboardShortcutsModal } from './components/ui/KeyboardShortcuts';
import { useAnimationStore } from './stores/animationStore';
import ErrorBoundary from './components/ErrorBoundary';
import { api, isElectron } from './utils/electronAPI';
import { ModelHubPanel as ModelHubDirectInner } from './components/ModelHub/ModelHubPanel';

class ModelHubErrorCatcher extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ModelHub] CRASH:', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80" onClick={this.props.onClose}>
          <div className="bg-red-900 text-white p-8 rounded-xl max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-2">ModelHub crashed</h2>
            <pre className="text-xs whitespace-pre-wrap break-all">{this.state.error?.message}{'\n'}{this.state.error?.stack}</pre>
            <button onClick={this.props.onClose} className="mt-4 px-4 py-2 bg-red-600 text-white rounded">Close</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ModelHubDirect({ isOpen, onClose }) {
  return (
    <ModelHubErrorCatcher onClose={onClose}>
      <ModelHubDirectInner isOpen={isOpen} onClose={onClose} />
    </ModelHubErrorCatcher>
  );
}

// ===========================================
// LAZY LOADED COMPONENTS (Performance optimization)
// Only load these when actually needed
// ===========================================
const SettingsModal = lazy(() => import('./components/Settings/SettingsModal').then(m => ({ default: m.SettingsModal })));
const ImageGenModal = lazy(() => import('./components/ImageGen/ImageGenModal').then(m => ({ default: m.ImageGenModal })));
const ExportModal = lazy(() => import('./components/Export/ExportModal').then(m => ({ default: m.ExportModal })));
const DownloadCenter = lazy(() => import('./components/Downloads/DownloadCenter').then(m => ({ default: m.DownloadCenter })));
const OnboardingWizard = lazy(() => import('./components/Onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const ModelSelector = lazy(() => import('./components/ModelSelector/ModelSelector').then(m => ({ default: m.ModelSelector })));
// StartupScreen is NOT lazy - it's the first thing users see, must be instant
import { StartupScreen } from './components/Startup/StartupScreen';
const ChatV2Harness = lazy(() => import('./chat-v2/ui/ChatV2Harness').then(m => ({ default: m.ChatV2Harness })));
const CodeWorkbench = lazy(() => import('./components/Code/CodeWorkbench').then(m => ({ default: m.CodeWorkbench })));
const ResearchWorkspace = lazy(() => import('./components/Research/ResearchWorkspace').then(m => ({ default: m.ResearchWorkspace })));
const MosaicLab = lazy(() => import('./components/Dev/MosaicLab').then(m => ({ default: m.MosaicLab || m.default })));

// Minimal loading fallback - PURE BLACK to prevent any flash
// Uses inline styles because CSS may not be loaded yet
const LoadingFallback = memo(() => (
  <div style={{
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    background: '#000000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }}>
    <div style={{
      width: 24,
      height: 24,
      border: '2px solid #8b5cf6',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }} />
  </div>
));

const STARTUP_COMPLETE_SESSION_KEY = 'devforge:startup-complete';

function shouldShowStartupScreenOnBoot() {
  if (typeof window === 'undefined') return true;
  try {
    return window.sessionStorage?.getItem(STARTUP_COMPLETE_SESSION_KEY) !== '1';
  } catch {
    return true;
  }
}

function App() {
  // === SELECTIVE SUBSCRIPTIONS for optimal re-render performance ===
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const isLocked = useAppStore(s => s.isLocked);
  const showSettings = useAppStore(s => s.showSettings);
  const showImageGen = useAppStore(s => s.showImageGen);
  const showExportModal = useAppStore(s => s.showExportModal);
  const showModelHub = useAppStore(s => s.showModelHub);
  const showDownloadCenter = useAppStore(s => s.showDownloadCenter);
  const showModelSelector = useAppStore(s => s.showModelSelector);
  
  // Actions - stable references
  const initializeApp = useAppStore(s => s.initializeApp);
  const initializeDownloads = useAppStore(s => s.initializeDownloads);
  const createConversation = useAppStore(s => s.createConversation);
  const toggleSettings = useAppStore(s => s.toggleSettings);
  const toggleModelSelector = useAppStore(s => s.toggleModelSelector);
  const toggleImageGen = useAppStore(s => s.toggleImageGen);
  const toggleModelHub = useAppStore(s => s.toggleModelHub);
  const toggleDownloadCenter = useAppStore(s => s.toggleDownloadCenter);
  const setWorkspace = useAppStore(s => s.setWorkspace);
  const stopGeneration = useAppStore(s => s.stopGeneration);
  
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [showStartupScreen, setShowStartupScreen] = useState(() => shouldShowStartupScreenOnBoot());
  const [mosaicDevEnabled, setMosaicDevEnabled] = useState(() => {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MOSAIC_DEV === '1') return true;
    if (typeof window !== 'undefined' && window.__DEVFORGE_MOSAIC_DEV__ === true) return true;
    return false;
  });
  
  
  // Animation store initialization
  const initializeAnimations = useAnimationStore(state => state.initialize);
  
  // Keyboard shortcuts modal
  const { isOpen: showKeyboardShortcuts, close: closeKeyboardShortcuts } = useKeyboardShortcutsModal();

  useEffect(() => {
    const isDynamicImportFailure = (err) => {
      const message = err?.message || String(err || '');
      return (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed') ||
        message.includes('ChunkLoadError')
      );
    };

    const recoverDynamicImportFailure = () => {
      try {
        const reloadKey = 'devforge:chunk-reload-once';
        if (!sessionStorage.getItem(reloadKey)) {
          sessionStorage.setItem(reloadKey, '1');
          window.location.reload();
          return true;
        }
      } catch (e) {
        // Ignore storage errors and fall through to normal handling.
      }
      return false;
    };

    // Global error handler - catches uncaught errors
    const handleGlobalError = (event) => {
      if (isDynamicImportFailure(event.error)) {
        recoverDynamicImportFailure();
      }
      console.error('DevForge Global Error:', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        error: event.error
      });
      // Prevent default browser error handling
      event.preventDefault();
    };

    // Unhandled promise rejection handler
    const handleUnhandledRejection = (event) => {
      if (isDynamicImportFailure(event.reason)) {
        recoverDynamicImportFailure();
      }
      console.error('DevForge Unhandled Promise Rejection:', event.reason);
      // Prevent default browser handling
      event.preventDefault();
    };

    // Register global error handlers
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Initialize animation system
    initializeAnimations();
    
    // Check if user has completed onboarding
    const checkOnboarding = async () => {
      try {
        const hasOnboarded = await api.getSettings('hasOnboarded');
        setShowOnboarding(!hasOnboarded);
        setIsCheckingOnboarding(false);
        
        if (hasOnboarded) {
          await initializeApp();
          // Initialize download listeners early so downloads are tracked
          initializeDownloads?.();
        }
      } catch (error) {
        console.error('Onboarding check failed:', error);
        setShowOnboarding(true);
        setIsCheckingOnboarding(false);
      }
    };
    
    checkOnboarding();

    if (isElectron() && window.electronAPI?.isMosaicDevEnabled) {
      window.electronAPI.isMosaicDevEnabled()
        .then((res) => {
          if (res?.enabled) {
            window.__DEVFORGE_MOSAIC_DEV__ = true;
            setMosaicDevEnabled(true);
          }
        })
        .catch(() => {});
    }

    // Listen for panic mode (only in Electron)
    let cleanup = null;
    if (isElectron() && window.electronAPI?.onPanicMode) {
      cleanup = window.electronAPI.onPanicMode(() => {
        useAppStore.getState().triggerPanic();
      });
    }

    // Hardcoded Shift+Escape panic key -- always works, even from inputs/textareas.
    // Also serves as global idle auto-lock for the vault workspace.
    const panicHandler = (e) => {
      if (e.shiftKey && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        useAppStore.getState().triggerPanic();
      }
    };
    window.addEventListener('keydown', panicHandler, true);

    // Auto-lock vault workspace after 5 minutes of inactivity
    let idleTimer = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const state = useAppStore.getState();
        if (state.currentWorkspace === 'nsfw' && !state.isLocked) {
          state.lockNsfw();
        }
      }, 5 * 60 * 1000);
    };
    const idleEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    idleEvents.forEach(evt => window.addEventListener(evt, resetIdle, { passive: true }));
    resetIdle();

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('keydown', panicHandler, true);
      idleEvents.forEach(evt => window.removeEventListener(evt, resetIdle));
      if (idleTimer) clearTimeout(idleTimer);
      if (cleanup && typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [initializeApp, initializeAnimations, initializeDownloads]);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    'new-chat': () => {
      createConversation();
    },
    'open-model-selector': () => {
      toggleModelSelector();
    },
    'open-settings': () => {
      if (!showSettings) {
        toggleSettings();
      }
    },
    'export-conversation': () => {
      const openExportModal = useAppStore.getState().openExportModal;
      if (openExportModal) {
        openExportModal();
      }
    },
    'panic-mode': () => {
      const { triggerPanic } = useAppStore.getState();
      triggerPanic();
    },
    'workspace-casual': () => setWorkspace('casual'),
    'workspace-work': () => setWorkspace('work'),
    'workspace-research': () => setWorkspace('research'),
    'workspace-code': () => setWorkspace('code'),
    'cancel-or-close': () => {
      const { isGenerating } = useAppStore.getState();
      if (isGenerating) {
        stopGeneration();
        return;
      }

      // Close most specific modal first
      if (showSettings) {
        toggleSettings();
      } else if (showImageGen) {
        toggleImageGen();
      } else if (showModelHub) {
        toggleModelHub();
      } else if (showDownloadCenter) {
        toggleDownloadCenter();
      }
    },
  });

  // Show premium 3D startup screen during initial boot
  // NOT wrapped in Suspense - StartupScreen is directly imported for instant render
  if (showStartupScreen) {
    return <StartupScreen onComplete={() => {
      try {
        window.sessionStorage?.setItem(STARTUP_COMPLETE_SESSION_KEY, '1');
      } catch {
        // Non-blocking
      }
      setShowStartupScreen(false);
    }} />;
  }

  if (isCheckingOnboarding) {
    // Pure black with inline styles - CSS may not be loaded yet
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        background: '#000000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#606078'
      }}>
        Loading...
      </div>
    );
  }

  // Show onboarding wizard
  if (showOnboarding) {
    return <OnboardingWizard onComplete={() => {
      setShowOnboarding(false);
      initializeApp();
      initializeDownloads?.();
    }} />;
  }

  // Show lock screen for NSFW workspace
  if (isLocked && currentWorkspace === 'nsfw') {
    return <LockScreen />;
  }

  return (
    <ErrorBoundary>
      <div data-workspace={currentWorkspace} className="workspace-transition">
      <Layout>
        <div className="flex h-full workspace-bg">
          {/* Sidebar */}
          <ErrorBoundary level="component">
            <Sidebar />
          </ErrorBoundary>
          
          {/* Main Content */}
          <main className="flex-1 flex flex-col min-w-0">
            <ErrorBoundary level="component">
              <Suspense fallback={<LoadingFallback />}>
                {currentWorkspace === 'code' ? (
                  <CodeWorkbench />
                ) : currentWorkspace === 'research' ? (
                  <ResearchWorkspace workspace={currentWorkspace} />
                ) : (
                  <ChatV2Harness />
                )}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>

        {/* Modals - All lazy loaded with Suspense */}
        <Suspense fallback={null}>
          {showSettings && (
            <ErrorBoundary level="component">
              <SettingsModal />
            </ErrorBoundary>
          )}
          {showImageGen && (
            <ErrorBoundary level="component">
              <ImageGenModal />
            </ErrorBoundary>
          )}
          {showExportModal && (
            <ErrorBoundary level="component">
              <ExportModal onClose={() => useAppStore.getState().closeExportModal()} />
            </ErrorBoundary>
          )}
          {showModelSelector && (
            <ErrorBoundary level="component">
              <ModelSelector onClose={() => toggleModelSelector()} />
            </ErrorBoundary>
          )}
          {showModelHub && (
            <ErrorBoundary level="component" scope="ModelHub">
              <ModelHubDirect isOpen={showModelHub} onClose={toggleModelHub} />
            </ErrorBoundary>
          )}
          {showDownloadCenter && (
            <ErrorBoundary level="component">
              <DownloadCenter isOpen={showDownloadCenter} onClose={toggleDownloadCenter} />
            </ErrorBoundary>
          )}
        </Suspense>
        
        <ToastContainer />
        <KeyboardShortcutsModal isOpen={showKeyboardShortcuts} onClose={closeKeyboardShortcuts} />
        {mosaicDevEnabled && (
          <Suspense fallback={null}>
            <MosaicLab />
          </Suspense>
        )}
      </Layout>
      </div>
    </ErrorBoundary>
  );
}

export default App;
