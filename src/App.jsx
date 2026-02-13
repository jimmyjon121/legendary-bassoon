import React, { useEffect, useState, lazy, Suspense, memo, useCallback } from 'react';
import { useAppStore } from './stores/appStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Layout } from './components/Layout/Layout';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatArea } from './components/Chat/ChatArea';
import { LockScreen } from './components/Workspaces/LockScreen';
import { ToastContainer } from './components/ui/Toast';
import { KeyboardShortcutsModal, useKeyboardShortcutsModal } from './components/ui/KeyboardShortcuts';
import { useCommandsStore } from './stores/commandsStore';
import { useAnimationStore } from './stores/animationStore';
import ErrorBoundary from './components/ErrorBoundary';
import { api, isElectron } from './utils/electronAPI';

// Soul Engine
import { SuggestionContainer } from './components/Soul/SoulIndicator';
import { useSoulStore } from './stores/soulStore';

// ===========================================
// LAZY LOADED COMPONENTS (Performance optimization)
// Only load these when actually needed
// ===========================================
const SettingsModal = lazy(() => import('./components/Settings/SettingsModal').then(m => ({ default: m.SettingsModal })));
const ImageGenModal = lazy(() => import('./components/ImageGen/ImageGenModal').then(m => ({ default: m.ImageGenModal })));
const ExportModal = lazy(() => import('./components/Export/ExportModal').then(m => ({ default: m.ExportModal })));
const ModelFinder = lazy(() => import('./components/Models/ModelFinder').then(m => ({ default: m.ModelFinder })));
const ModelLibrary = lazy(() => import('./components/Models/ModelLibrary').then(m => ({ default: m.ModelLibrary })));
const ModelManager = lazy(() => import('./components/Code/ModelManager').then(m => ({ default: m.ModelManager })));
const ModelHubPanel = lazy(() => import('./components/ModelHub/ModelHubPanel').then(m => ({ default: m.ModelHubPanel })));
const DownloadCenter = lazy(() => import('./components/Downloads/DownloadCenter').then(m => ({ default: m.DownloadCenter })));
const OnboardingWizard = lazy(() => import('./components/Onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
// StartupScreen is NOT lazy - it's the first thing users see, must be instant
import { StartupScreen } from './components/Startup/StartupScreen';
const CommandPalette = lazy(() => import('./components/CommandPalette/CommandPalette').then(m => ({ default: m.CommandPalette })));
const AnimationShowcase = lazy(() => import('./components/Demo/AnimationShowcase'));
const ForgeConsole = lazy(() => import('./components/ForgeConsole/ForgeConsole').then(m => ({ default: m.ForgeConsole })));
const FXOverlay = lazy(() => import('./components/FX/FXOverlay').then(m => ({ default: m.FXOverlay })));
const GlobalSearch = lazy(() => import('./components/Search/GlobalSearch').then(m => ({ default: m.GlobalSearch })));

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

function App() {
  // === SELECTIVE SUBSCRIPTIONS for optimal re-render performance ===
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const isLocked = useAppStore(s => s.isLocked);
  const showSettings = useAppStore(s => s.showSettings);
  const showImageGen = useAppStore(s => s.showImageGen);
  const showExportModal = useAppStore(s => s.showExportModal);
  const showModelFinder = useAppStore(s => s.showModelFinder);
  const showModelLibrary = useAppStore(s => s.showModelLibrary);
  const showModelHub = useAppStore(s => s.showModelHub);
  const showDownloadCenter = useAppStore(s => s.showDownloadCenter);
  
  // Actions - stable references
  const toggleModelFinder = useAppStore(s => s.toggleModelFinder);
  const initializeApp = useAppStore(s => s.initializeApp);
  const initializeDownloads = useAppStore(s => s.initializeDownloads);
  const createConversation = useAppStore(s => s.createConversation);
  const toggleSettings = useAppStore(s => s.toggleSettings);
  const toggleModelSelector = useAppStore(s => s.toggleModelSelector);
  const toggleImageGen = useAppStore(s => s.toggleImageGen);
  const toggleModelLibrary = useAppStore(s => s.toggleModelLibrary);
  const toggleModelHub = useAppStore(s => s.toggleModelHub);
  const toggleDownloadCenter = useAppStore(s => s.toggleDownloadCenter);
  const setWorkspace = useAppStore(s => s.setWorkspace);
  const stopGeneration = useAppStore(s => s.stopGeneration);
  const setModel = useAppStore(s => s.setModel);
  
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [showStartupScreen, setShowStartupScreen] = useState(true);
  const [showAnimationDemo, setShowAnimationDemo] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  
  // Animation store initialization
  const initializeAnimations = useAnimationStore(state => state.initialize);
  
  // Soul store initialization
  const initializeSoul = useSoulStore(state => state.initialize);
  
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
    
    // Initialize Soul Engine
    initializeSoul();

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
    
    // Listen for panic mode (only in Electron)
    let cleanup = null;
    if (isElectron() && window.electronAPI?.onPanicMode) {
      cleanup = window.electronAPI.onPanicMode(() => {
        useAppStore.getState().triggerPanic();
      });
    }
    
    return () => {
      // Cleanup global error handlers
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      
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
      // Will be wired to export modal in Phase 1.2
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
    'workspace-code': () => setWorkspace('code'),
    'workspace-private': () => setWorkspace('nsfw'),
    'global-search': () => {
      setShowGlobalSearch(true);
    },
    'forge-console': () => {
      useSoulStore.getState().toggleForgeConsole();
    },
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
      } else if (showModelFinder) {
        toggleModelFinder();
      } else if (showModelLibrary) {
        toggleModelLibrary();
      } else if (showModelHub) {
        toggleModelHub();
      } else if (showDownloadCenter) {
        toggleDownloadCenter();
      }
    },
    'command-palette': () => {
      const { toggle } = useCommandsStore.getState();
      toggle();
    },
    'animation-demo': () => {
      setShowAnimationDemo(true);
    },
  });

  // Show premium 3D startup screen during initial boot
  // NOT wrapped in Suspense - StartupScreen is directly imported for instant render
  if (showStartupScreen) {
    return <StartupScreen onComplete={() => setShowStartupScreen(false)} />;
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
              <ChatArea />
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
          {showModelFinder && (
            <ErrorBoundary level="component">
              <ModelFinder 
                onClose={toggleModelFinder}
                onImportComplete={(count) => console.log(`Imported ${count} models`)}
              />
            </ErrorBoundary>
          )}
          {showModelLibrary && (
            <ErrorBoundary level="component">
              {currentWorkspace === 'code' ? (
                <ModelManager onClose={toggleModelLibrary} />
              ) : (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="w-full max-w-4xl h-[85vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden">
                    <ModelLibrary
                      onClose={toggleModelLibrary}
                      onSelectModel={(model) => {
                        if (model?.source === 'ollama' && model.name) {
                          setModel(model.name);
                          toggleModelLibrary();
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </ErrorBoundary>
          )}
          {showModelHub && (
            <ErrorBoundary level="component">
              <ModelHubPanel isOpen={showModelHub} onClose={toggleModelHub} />
            </ErrorBoundary>
          )}
          {showDownloadCenter && (
            <ErrorBoundary level="component">
              <DownloadCenter isOpen={showDownloadCenter} onClose={toggleDownloadCenter} />
            </ErrorBoundary>
          )}
          <CommandPalette />
        </Suspense>
        
        <ToastContainer />
        <KeyboardShortcutsModal isOpen={showKeyboardShortcuts} onClose={closeKeyboardShortcuts} />
        
        {/* Heavy components - lazy loaded */}
        <Suspense fallback={null}>
          {showAnimationDemo && <AnimationShowcase onClose={() => setShowAnimationDemo(false)} />}
        </Suspense>
        
        {/* Soul Engine */}
        <SuggestionContainer />
        
        <Suspense fallback={null}>
          <ForgeConsole />
        </Suspense>
        
        {/* Global Search Modal (Cmd+K) */}
        <Suspense fallback={null}>
          <GlobalSearch 
            isOpen={showGlobalSearch} 
            onClose={() => setShowGlobalSearch(false)} 
          />
        </Suspense>
      </Layout>
      
      {/* Global FX Overlay - lazy loaded for performance */}
      <Suspense fallback={null}>
        <FXOverlay />
      </Suspense>
      </div>
    </ErrorBoundary>
  );
}

export default App;
