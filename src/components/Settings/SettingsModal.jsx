import React, { useState, useEffect, Suspense, lazy, memo } from 'react';
import { X, Settings, Server, Image, Shield, Keyboard, FolderOpen, Loader, Cpu, Zap, Bug, Search, Monitor } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../utils/electronAPI';
import { triggerWarmupWithProgress } from '../../stores/modelWarmupStore';
import { useShortcutsStore } from '../../stores/shortcutsStore';
import { useThemeStore } from '../../stores/themeStore';
import { pollingCoordinator } from '../../services/pollingCoordinator';
import { DocumentUploader } from '../Documents/DocumentUploader';
import { DocumentList } from '../Documents/DocumentList';
import { ModelPresets } from './ModelPresets';
import { BackupSettings } from './BackupSettings';
import { motion } from 'framer-motion';
import { shallow } from 'zustand/shallow';

import { Database, Trash2, Download, HardDrive, Brain, BarChart2 } from 'lucide-react';

// Lazy load heavy components for faster initial render
const HardwareMonitorFull = lazy(() => 
  import('../HardwareMonitor/HardwareMonitor').then(m => ({ default: m.HardwareMonitorFull }))
);
const DataManagementTab = lazy(() => 
  import('./DataManagementTab').then(m => ({ default: m.DataManagementTab }))
);

// Loading fallback for lazy components
const TabLoader = () => (
  <div className="flex items-center justify-center py-12">
    <Loader size={24} className="animate-spin text-accent-primary" />
  </div>
);

const TABS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'hardware', label: 'Hardware', icon: Cpu },
  { id: 'llm', label: 'LLM Backend', icon: Server },
  { id: 'image', label: 'Image Gen', icon: Image },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'research', label: 'Research', icon: Search },
  { id: 'data', label: 'Data & Storage', icon: Database },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'debug', label: 'Debug', icon: Bug },
];

export function SettingsModal() {
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState({
    llmEndpoint: 'http://localhost:11434',
    imageGenEndpoint: 'http://localhost:8188',
    modelsDirectory: '',
    theme: 'dark',
    fontSize: 14,
    streamingEnabled: true,
    saveHistory: true,
    // 'auto' uses the active performance profile's default keep_alive.
    // 'always' keeps the model loaded forever (LM Studio-style).
    // 'timed' releases after 30 minutes of idle so other apps can reuse the GPU.
    keepModelLoaded: 'auto',

    ollamaBinary: '',
    imageStartCommand: '',
    imageStopCommand: '',
    llamaQuantizePath: '',
    pythonPath: '',
    searxngUrl: '',
    discoveryNetworkAccess: 'on',
    vaultModelGating: 'open',
  });

  useEffect(() => {
    // Load all settings in a single batched IPC call for performance
    const loadSettings = async () => {
      try {
        const batch = await window.electronAPI?.getSettingsBatch?.([
          'llmEndpoint',
          'imageGenEndpoint', 
          'modelsDirectory',
          'theme',
          'ollamaBinary',
          'imageBackendStartCommand',
          'imageBackendStopCommand',
          'tools.llamaQuantizePath',
          'tools.pythonPath',
          'searxngUrl',
          'keepModelLoaded',
          'discoveryNetworkAccess',
          'vaultModelGating',
        ]);
        
        if (batch) {
          setSettings(prev => ({
            ...prev,
            llmEndpoint: batch.llmEndpoint || prev.llmEndpoint,
            imageGenEndpoint: batch.imageGenEndpoint || prev.imageGenEndpoint,
            modelsDirectory: batch.modelsDirectory || prev.modelsDirectory,
            theme: batch.theme?.mode || prev.theme,
            fontSize: batch.theme?.fontSize || prev.fontSize,
            ollamaBinary: batch.ollamaBinary || '',
            imageStartCommand: batch.imageBackendStartCommand || '',
            imageStopCommand: batch.imageBackendStopCommand || '',
            llamaQuantizePath: batch['tools.llamaQuantizePath'] || '',
            pythonPath: batch['tools.pythonPath'] || '',
            searxngUrl: batch.searxngUrl || '',
            keepModelLoaded: ['auto', 'always', 'timed'].includes(batch.keepModelLoaded) ? batch.keepModelLoaded : 'auto',
            discoveryNetworkAccess: ['on', 'cache-only', 'off'].includes(batch.discoveryNetworkAccess) ? batch.discoveryNetworkAccess : 'on',
            vaultModelGating: ['open', 'allowlist'].includes(batch.vaultModelGating) ? batch.vaultModelGating : 'open',
          }));
        }
      } catch (error) {
        console.warn('Failed to load settings batch, settings will use defaults:', error);
      }
    };
    loadSettings();
  }, []);

  const openModelsDirectory = async () => {
    if (!settings.modelsDirectory) return;
    const result = await api.openPath(settings.modelsDirectory);
    if (result?.success === false) {
      console.error('Failed to open models directory:', result.error);
    }
  };

  const handleSave = async () => {
    let saved = false;
    // Save all settings in a single batched IPC call for performance
    try {
      await window.electronAPI?.setSettingsBatch?.({
        llmEndpoint: settings.llmEndpoint,
        imageGenEndpoint: settings.imageGenEndpoint,
        modelsDirectory: settings.modelsDirectory,
        ollamaBinary: settings.ollamaBinary || null,
        imageBackendStartCommand: settings.imageStartCommand || null,
        imageBackendStopCommand: settings.imageStopCommand || null,
        'tools.llamaQuantizePath': settings.llamaQuantizePath || '',
        'tools.pythonPath': settings.pythonPath || '',
        searxngUrl: settings.searxngUrl || '',
        keepModelLoaded: settings.keepModelLoaded || 'auto',
        discoveryNetworkAccess: settings.discoveryNetworkAccess || 'on',
        vaultModelGating: settings.vaultModelGating || 'open',
      });
      saved = true;
    } catch (error) {
      console.error('Failed to save settings:', error);
    }



    // Persist theme settings and apply immediately
    setTheme({
      mode: settings.theme,
      fontSize: settings.fontSize,
    });

    toggleSettings();
  };

  const handleSelectFolder = async () => {
    const folder = await window.electronAPI?.selectFolder();
    if (folder) {
      setSettings(prev => ({ ...prev, modelsDirectory: folder }));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && toggleSettings()}
    >
      {/* Backdrop - removed blur for performance */}
      <div className="absolute inset-0 bg-black/70" />
      
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="relative w-full max-w-3xl max-h-[85vh] bg-surface-1 border border-border-muted rounded-xl shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] overflow-hidden"
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-16 bg-accent-primary/5 blur-2xl pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-primary/15 flex items-center justify-center">
              <Settings size={16} className="text-accent-primary" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          </div>
          <button
            onClick={toggleSettings}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-3 transition-all duration-150"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative flex h-[550px]">
          {/* Sidebar */}
          <div className="w-52 border-r border-border-subtle p-2.5 bg-surface-0/50">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 rounded-lg mb-1
                  transition-all duration-150 text-sm
                  ${activeTab === tab.id 
                    ? 'bg-accent-primary/12 text-accent-primary border border-accent-primary/20' 
                    : 'text-text-secondary hover:bg-glass-3 hover:text-text-primary'
                  }
                `}
              >
                <tab.icon size={16} className={activeTab === tab.id ? 'text-accent-primary' : ''} />
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto scrollbar-premium">
            {activeTab === 'general' && (
              <GeneralSettings settings={settings} setSettings={setSettings} />
            )}
            {activeTab === 'hardware' && (
              <HardwareSettings />
            )}
            {activeTab === 'llm' && (
              <LLMSettings 
                settings={settings} 
                setSettings={setSettings}
                onSelectFolder={handleSelectFolder}
                onOpenModelsDirectory={openModelsDirectory}
              />
            )}
            {activeTab === 'image' && (
              <ImageSettings settings={settings} setSettings={setSettings} />
            )}
            {activeTab === 'memory' && (
              <Suspense fallback={<TabLoader />}>
                <MemoryTab />
              </Suspense>
            )}
            {activeTab === 'research' && (
              <ResearchSettings settings={settings} setSettings={setSettings} />
            )}
            {activeTab === 'data' && (
              <Suspense fallback={<TabLoader />}>
                <DataManagementTab />
              </Suspense>
            )}
            {activeTab === 'privacy' && (
              <PrivacySettings settings={settings} setSettings={setSettings} />
            )}
            {activeTab === 'shortcuts' && (
              <ShortcutsSettings />
            )}
            {activeTab === 'debug' && (
              <DebugSettings />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="relative flex items-center justify-between px-6 py-4 border-t border-border-subtle bg-surface-0/30">
          <p className="text-xs text-text-muted">
            Changes take effect immediately
          </p>
          <div className="flex items-center gap-3">
            <button 
              onClick={toggleSettings} 
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary rounded-lg hover:bg-glass-3 transition-all duration-150"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-all duration-150 hover:opacity-95"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                boxShadow: '0 14px 28px -18px rgba(99, 102, 241, 0.75)'
              }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function GeneralSettings({ settings, setSettings }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Appearance</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Theme</label>
            <select 
              value={settings.theme}
              onChange={(e) => setSettings(prev => ({ ...prev, theme: e.target.value }))}
              className="input"
            >
              <option value="dark">Dark</option>
              <option value="light">Light (Coming Soon)</option>
              <option value="system">System</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-2">Font Size</label>
            <input
              type="range"
              min="12"
              max="18"
              value={settings.fontSize}
              onChange={(e) => setSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
              className="w-full"
            />
            <span className="text-xs text-text-muted">{settings.fontSize}px</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Behavior</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.streamingEnabled}
              onChange={(e) => setSettings(prev => ({ ...prev, streamingEnabled: e.target.checked }))}
              className="w-4 h-4 rounded border-forge-border bg-forge-bg text-workspace-casual focus:ring-workspace-casual/50"
            />
            <span className="text-sm text-text-secondary">Enable streaming responses</span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={settings.saveHistory}
              onChange={(e) => setSettings(prev => ({ ...prev, saveHistory: e.target.checked }))}
              className="w-4 h-4 rounded border-forge-border bg-forge-bg text-workspace-casual focus:ring-workspace-casual/50"
            />
          <span className="text-sm text-text-secondary">Save conversation history</span>
          </label>


        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Updates</h3>
        <button
          type="button"
          className="btn btn-secondary text-xs"
          onClick={async () => {
            try {
              const res = await window.electronAPI?.checkForUpdates();
              if (!res) return;
              if (!res.supported) {
                // eslint-disable-next-line no-alert
                alert('Auto-update is not configured in this build.');
                return;
              }
              if (!res.updateAvailable) {
                // eslint-disable-next-line no-alert
                alert('You are on the latest version of DevForge.');
                return;
              }
              // eslint-disable-next-line no-alert
              const ok = window.confirm(
                `Update ${res.version} is available. Download and install now?`,
              );
              if (!ok) return;
              await window.electronAPI?.downloadUpdate();
              await window.electronAPI?.installUpdate();
            } catch (error) {
              // eslint-disable-next-line no-alert
              alert(`Failed to check or install updates: ${error.message || error}`);
            }
          }}
        >
          Check for updates
        </button>
      </div>
    </div>
  );
}

function LLMSettings({ settings, setSettings, onSelectFolder, onOpenModelsDirectory }) {
  const [isChecking, setIsChecking] = React.useState(false);
  const [ollamaBusy, setOllamaBusy] = React.useState(false);
  const currentWorkspace = useAppStore((state) => state.currentWorkspace);
  const ragInfluence = useAppStore((state) => state.ragInfluence || 0);
  const setRagInfluence = useAppStore((state) => state.setRagInfluence);
  const currentModel = useAppStore((state) => state.currentModel);
  const currentModelInfo = useAppStore((state) => state.currentModelInfo);
  const llmRuntimeState = useAppStore((state) => state.llmRuntimeState);
  const hydrateModelState = useAppStore((state) => state.hydrateModelState);
  const llmHealth = useAppStore((state) => state.llmHealth);
  const llmBootstrapStatus = useAppStore((state) => state.llmBootstrapStatus);
  const ollamaStatus = useAppStore((state) => state.ollamaStatus);
  const refreshLlmRuntime = useAppStore((state) => state.refreshLlmRuntime);
  const fastChatMode = useAppStore((state) => Boolean(state.fastChatMode));
  const setFastChatMode = useAppStore((state) => state.setFastChatMode);
  const [knowledgeMessage, setKnowledgeMessage] = React.useState(null);
  const [isCheckingModel, setIsCheckingModel] = React.useState(false);
  const platform = window.electronAPI?.getPlatform?.();

  const checkHealth = React.useCallback(async () => {
    setIsChecking(true);
    try {
      await refreshLlmRuntime?.({
        requestedModel: currentModel ?? undefined,
        refreshModels: true,
        hydrateSelection: false,
        persistResolvedSelection: false,
        updateError: false,
        skipStatus: true,
      });
    } catch (error) {
      console.error('Failed to refresh LLM health:', error);
    } finally {
      setIsChecking(false);
    }
  }, [currentModel, refreshLlmRuntime]);

  const rerunModelHealthCheck = React.useCallback(async () => {
    if (!currentModel || !hydrateModelState) return;
    setIsCheckingModel(true);
    try {
      await hydrateModelState(currentModel, {
        warmup: false,
        persist: false,
        refreshRuntime: true,
        forceRefresh: true,
      });
    } finally {
      setIsCheckingModel(false);
    }
  }, [currentModel, hydrateModelState]);

  React.useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const healthStatus = React.useMemo(() => ({
    status: isChecking || llmBootstrapStatus === 'loading'
      ? 'checking'
      : (llmHealth?.healthy ? 'online' : 'offline'),
    models: llmHealth?.models || 0,
    error: llmHealth?.error || null,
  }), [isChecking, llmBootstrapStatus, llmHealth]);

  const handleOllamaAction = async (action) => {
    if (!window.electronAPI) return;
    setOllamaBusy(true);
    try {
      if (action === 'install') {
        await window.electronAPI.installOllama();
      } else if (action === 'start') {
        await window.electronAPI.startOllama();
      } else if (action === 'stop') {
        await window.electronAPI.stopOllama();
      }
      await checkHealth();
    } catch (error) {
      console.error('Ollama action failed:', error);
    } finally {
      setOllamaBusy(false);
    }
  };

  const handleKnowledgeExport = async () => {
    try {
      const res = await window.electronAPI?.exportKnowledgePack(currentWorkspace);
      if (res?.success) {
        setKnowledgeMessage(`Exported ${res.count || 0} documents to ${res.filePath}`);
      } else if (!res?.canceled) {
        setKnowledgeMessage('Export failed.');
      }
    } catch (error) {
      setKnowledgeMessage(`Export failed: ${error.message}`);
    }
  };

  const handleKnowledgeImport = async () => {
    try {
      const res = await window.electronAPI?.importKnowledgePack(currentWorkspace);
      if (res?.success) {
        setKnowledgeMessage(`Imported ${res.imported || 0} documents.`);
      } else if (!res?.canceled) {
        setKnowledgeMessage('Import failed.');
      }
    } catch (error) {
      setKnowledgeMessage(`Import failed: ${error.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Backend Configuration</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Ollama Endpoint</label>
            <div className="flex gap-2">
            <input
              type="text"
              value={settings.llmEndpoint}
              onChange={(e) => setSettings(prev => ({ ...prev, llmEndpoint: e.target.value }))}
              placeholder="http://localhost:11434"
                className="input flex-1"
            />
              <button 
                onClick={checkHealth}
                disabled={isChecking}
                className="btn btn-secondary"
                title="Test connection"
              >
                {isChecking ? <Loader size={16} className="animate-spin" /> : <Server size={16} />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              URL where Ollama is running. Default: http://localhost:11434
            </p>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-2">Models Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.modelsDirectory}
                onChange={(e) => setSettings(prev => ({ ...prev, modelsDirectory: e.target.value }))}
                placeholder="Path to models folder"
                className="input flex-1"
              />
              <button
                onClick={onOpenModelsDirectory}
                className="btn btn-secondary"
                title="Open models folder"
                disabled={!settings.modelsDirectory}
              >
                Open
              </button>
              <button onClick={onSelectFolder} className="btn btn-secondary">
                <FolderOpen size={16} />
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Directory containing your GGUF model files
            </p>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-2">Ollama Binary (optional)</label>
            <input
              type="text"
              value={settings.ollamaBinary}
              onChange={(e) => setSettings((prev) => ({ ...prev, ollamaBinary: e.target.value }))}
              placeholder="Path to ollama.exe (leave blank to use PATH)"
              className="input"
            />
            <p className="text-xs text-text-muted mt-1">
              Set this if Ollama isn&apos;t on your PATH or you installed it somewhere custom.
            </p>
          </div>
        </div>
      </div>

      {/* Model residency + chat responsiveness */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Model Residency & Responsiveness</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Keep model loaded</label>
            <select
              value={settings.keepModelLoaded || 'auto'}
              onChange={(e) => setSettings((prev) => ({ ...prev, keepModelLoaded: e.target.value }))}
              className="input"
            >
              <option value="auto">Auto (follow performance profile)</option>
              <option value="always">Always (LM Studio-style, never unload)</option>
              <option value="timed">Release after 30 minutes idle</option>
            </select>
            <p className="text-xs text-text-muted mt-1">
              Keeps a model warm in memory so the next turn starts instantly.
              &ldquo;Always&rdquo; matches LM Studio; &ldquo;Timed&rdquo; releases the GPU after idle so other apps can use it.
            </p>
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={fastChatMode}
              onChange={(e) => setFastChatMode?.(e.target.checked)}
              className="w-4 h-4 mt-1 rounded border-forge-border bg-forge-bg text-workspace-casual focus:ring-workspace-casual/50"
            />
            <span>
              <span className="block text-sm text-text-secondary">Fast chat mode (casual workspace)</span>
              <span className="block text-xs text-text-muted mt-1">
                Caps context to 4K and max-tokens to 768 for snappier short-turn replies.
                Off by default so long context works out of the box. Ignored when a model preset is active.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* LM Studio Model Scanner */}
      <LMStudioScanner />

      {/* NPU Model Converter */}
      <NPUModelConverter />

      <div className={`p-4 rounded-lg border ${
        healthStatus.status === 'online' 
          ? 'bg-status-success/20 border-status-success/30'
          : healthStatus.status === 'checking'
          ? 'bg-forge-bg border-forge-border'
          : 'bg-status-error/20 border-status-error/30'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-text-primary">Connection Status</h4>
          {healthStatus.status === 'checking' && (
            <Loader size={14} className="animate-spin text-text-muted" />
          )}
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className={`status-dot ${healthStatus.status}`} />
          <span className="text-sm text-text-secondary">
            {healthStatus.status === 'online' 
              ? `Connected to Ollama (${healthStatus.models} model${healthStatus.models !== 1 ? 's' : ''} available)`
              : healthStatus.status === 'checking'
              ? 'Checking connection...'
              : 'Not connected to Ollama'
            }
          </span>
        </div>
        {healthStatus.error && (
          <p className="text-xs text-status-error mt-2">{healthStatus.error}</p>
        )}
        {healthStatus.status === 'offline' && (
          <div className="mt-3 text-xs text-text-muted bg-forge-bg p-3 rounded">
            <p className="mb-1"><strong>Make sure Ollama is running:</strong></p>
            <p>1. Open terminal and run: <code className="bg-forge-elevated px-1 rounded">ollama serve</code></p>
            <p>2. Verify it's accessible at: {settings.llmEndpoint}</p>
          </div>
        )}
      </div>

      {currentModel && (
        <div className="p-4 rounded-lg border border-forge-border space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="text-sm font-medium text-text-primary">Active Model Mode</h4>
              <p className="text-xs text-text-muted">
                {currentModel}
              </p>
            </div>
            <button
              type="button"
              onClick={rerunModelHealthCheck}
              disabled={isCheckingModel}
              className="btn btn-secondary text-xs"
            >
              {isCheckingModel ? 'Checking...' : 'Re-run model health check'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded border border-forge-border bg-forge-bg">
              template: {currentModelInfo?.templateMode === 'raw_prompt' ? 'raw prompt' : 'native chat'}
            </span>
            <span className="px-2 py-0.5 rounded border border-forge-border bg-forge-bg">
              context: {Number(currentModelInfo?.effectiveContextLength || currentModelInfo?.contextLength || 0) || 'unknown'}
            </span>
            <span className={`px-2 py-0.5 rounded border ${
              currentModelInfo?.baselineStatus === 'unstable'
                ? 'border-amber-400/35 bg-amber-500/10 text-amber-200'
                : currentModelInfo?.baselineStatus === 'caution'
                  ? 'border-sky-400/35 bg-sky-500/10 text-sky-200'
                  : 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
            }`}>
              baseline: {currentModelInfo?.baselineStatus || 'healthy'}
            </span>
            {llmRuntimeState?.lastExecutionMode && (
              <span className="px-2 py-0.5 rounded border border-forge-border bg-forge-bg">
                runtime mode: {llmRuntimeState.lastExecutionMode}
              </span>
            )}
            {llmRuntimeState?.effectiveModel && llmRuntimeState.effectiveModel !== currentModel && (
              <span className="px-2 py-0.5 rounded border border-amber-400/35 bg-amber-500/10 text-amber-200">
                effective model: {llmRuntimeState.effectiveModel}
              </span>
            )}
          </div>
          {Array.isArray(currentModelInfo?.warnings) && currentModelInfo.warnings.length > 0 && (
            <div className="text-xs text-amber-100 bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-2 space-y-1">
              {currentModelInfo.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <ConversionToolsPanel settings={settings} setSettings={setSettings} />

      <div className="p-4 rounded-lg border border-forge-border">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-medium text-text-primary">Ollama Service</h4>
            <p className="text-xs text-text-muted">
              Installed: {ollamaStatus?.installed ? 'Yes' : 'No'} | Running:{' '}
              {ollamaStatus?.running ? 'Yes' : 'No'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleOllamaAction('install')}
              className="btn btn-secondary text-xs"
              disabled={ollamaBusy}
            >
              Install
            </button>
            <button
              type="button"
              onClick={() => handleOllamaAction('start')}
              className="btn btn-primary text-xs"
              disabled={ollamaBusy || ollamaStatus?.running}
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => handleOllamaAction('stop')}
              className="btn btn-secondary text-xs"
              disabled={ollamaBusy || !ollamaStatus?.running}
            >
              Stop
            </button>
          </div>
        </div>
        <p className="text-[11px] text-text-muted mt-2">
          One-click controls for the local Ollama daemon. DevForge will use {settings.llmEndpoint}{' '}
          to send requests once it&apos;s running.
        </p>
      </div>

      <ModelPresets />
      <div className="mt-6 space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Document Knowledge (RAG)</h3>
        <p className="text-xs text-text-muted">
          Upload documents to ground answers in your own knowledge. Currently uses local embeddings
          via Ollama&apos;s <code className="bg-forge-elevated px-1 rounded">nomic-embed-text</code>{' '}
          model when available.
        </p>
        <DocumentUploader />
        <DocumentList />
        <div>
          <label className="text-xs text-text-secondary mb-1 block">
            RAG Influence ({Math.round((ragInfluence || 0) * 100)}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round((ragInfluence || 0) * 100)}
            onChange={(e) => setRagInfluence(e.target.value / 100)}
            className="w-full"
          />
          <p className="text-[11px] text-text-muted mt-1">
            0% disables document context, 100% strongly prefers it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleKnowledgeExport} className="btn btn-secondary text-xs">
            Export knowledge pack
          </button>
          <button type="button" onClick={handleKnowledgeImport} className="btn btn-secondary text-xs">
            Import knowledge pack
          </button>
        </div>
        {knowledgeMessage && (
          <p className="text-[11px] text-text-muted bg-forge-bg border border-forge-border rounded px-2 py-1">
            {knowledgeMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// LM Studio Model Scanner Component
function LMStudioScanner() {
  const [scanning, setScanning] = React.useState(false);
  const [models, setModels] = React.useState([]);
  const [scannedPaths, setScannedPaths] = React.useState([]);
  const [importing, setImporting] = React.useState(null);
  const [importResults, setImportResults] = React.useState([]);
  const [batchImporting, setBatchImporting] = React.useState(false);
  const [batchProgress, setBatchProgress] = React.useState({ current: 0, total: 0, currentModel: '' });

  const scanLMStudio = async () => {
    setScanning(true);
    setModels([]);
    setImportResults([]);
    try {
      const result = await window.electronAPI?.scanLMStudioModels();
      if (result) {
        setModels(result.models || []);
        setScannedPaths(result.scannedPaths || []);
      }
    } catch (error) {
      console.error('LM Studio scan failed:', error);
    } finally {
      setScanning(false);
    }
  };

  const importModel = async (model, isBatch = false) => {
    setImporting(model.path);
    try {
      const result = await window.electronAPI?.importModel(model.path, { 
        copy: false, // Link instead of copy to save space
        format: 'gguf'
      });
      if (result?.success) {
        setImportResults(prev => [...prev, { path: model.path, success: true }]);
      } else {
        setImportResults(prev => [...prev, { path: model.path, success: false, error: result?.error }]);
      }
    } catch (error) {
      setImportResults(prev => [...prev, { path: model.path, success: false, error: error.message }]);
    } finally {
      if (!isBatch) {
        setImporting(null);
      }
    }
  };

  const importAll = async () => {
    const modelsToImport = models.filter(m => !importResults.find(r => r.path === m.path));
    if (modelsToImport.length === 0) return;
    
    setBatchImporting(true);
    setBatchProgress({ current: 0, total: modelsToImport.length, currentModel: '' });
    
    for (let i = 0; i < modelsToImport.length; i++) {
      const model = modelsToImport[i];
      setBatchProgress({ 
        current: i + 1, 
        total: modelsToImport.length, 
        currentModel: model.name 
      });
      await importModel(model, true);
    }
    
    setBatchImporting(false);
    setImporting(null);
  };

  const successCount = importResults.filter(r => r.success).length;
  const failCount = importResults.filter(r => !r.success).length;

  return (
    <div className="p-4 rounded-lg border border-forge-border space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <span className="text-lg">[LM]</span> LM Studio Models
          </h4>
          <p className="text-xs text-text-muted">
            Scan and import models from your LM Studio installation
          </p>
        </div>
        <button 
          onClick={scanLMStudio}
          disabled={scanning || batchImporting}
          className="btn btn-primary text-xs"
        >
          {scanning ? (
            <>
              <Loader size={14} className="animate-spin mr-1" />
              Scanning...
            </>
          ) : (
            'Scan LM Studio'
          )}
        </button>
      </div>

      {scannedPaths.length > 0 && (
        <div className="text-[10px] text-text-muted">
          Scanned: {scannedPaths.join(', ')}
        </div>
      )}

      {models.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">
              Found {models.length} model{models.length !== 1 ? 's' : ''}
              {successCount > 0 && (
                <span className="text-status-success ml-2">({successCount} imported)</span>
              )}
              {failCount > 0 && (
                <span className="text-status-error ml-1">({failCount} failed)</span>
              )}
            </span>
            <button 
              onClick={importAll}
              className="btn btn-secondary text-xs"
              disabled={importing || batchImporting}
            >
              {batchImporting ? 'Importing...' : 'Import All to DevForge'}
            </button>
          </div>

          {/* Batch Import Progress */}
          {batchImporting && (
            <div className="bg-forge-bg border border-forge-border rounded p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">
                  Importing {batchProgress.current} of {batchProgress.total}
                </span>
                <span className="text-text-muted">
                  {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-2 bg-forge-elevated rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <div className="text-[10px] text-text-muted truncate">
                Current: {batchProgress.currentModel}
              </div>
            </div>
          )}
          
          <div className="max-h-48 overflow-y-auto space-y-1 bg-forge-bg rounded p-2">
            {models.map((model) => {
              const result = importResults.find(r => r.path === model.path);
              const isCurrentlyImporting = importing === model.path;
              return (
                <div 
                  key={model.path || model.name}
                  className={`flex items-center justify-between gap-2 p-2 rounded transition-colors ${
                    isCurrentlyImporting 
                      ? 'bg-blue-500/10 border border-blue-500/30' 
                      : 'bg-forge-elevated hover:bg-forge-elevated/80'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary font-medium truncate">
                      {model.name}
                    </div>
                    <div className="text-[10px] text-text-muted flex items-center gap-2">
                      <span>{model.sizeFormatted}</span>
                      <span className="opacity-50">|</span>
                      <span className="truncate">{model.parentFolder}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result?.success ? (
                      <span className="text-status-success text-xs flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full bg-status-success/20 flex items-center justify-center">OK</span>
                        Imported
                      </span>
                    ) : result ? (
                      <span className="text-status-error text-xs flex items-center gap-1" title={result.error}>
                        <span className="w-4 h-4 rounded-full bg-status-error/20 flex items-center justify-center">X</span>
                        Failed
                      </span>
                    ) : isCurrentlyImporting ? (
                      <span className="text-blue-400 text-xs flex items-center gap-1">
                        <Loader size={12} className="animate-spin" />
                        Importing...
                      </span>
                    ) : (
                      <button
                        onClick={() => importModel(model)}
                        className="text-xs text-forge-accent hover:underline"
                        disabled={batchImporting}
                      >
                        Import
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!scanning && models.length === 0 && scannedPaths.length > 0 && (
        <div className="text-xs text-text-muted italic">
          No models found in LM Studio folders.
        </div>
      )}
    </div>
  );
}

// NPU Model Converter Component
// Recommended models that work well on NPU
// preConverted = already in OpenVINO format on HuggingFace, downloads instantly without conversion step
const NPU_RECOMMENDED_MODELS = [
  {
    id: 'OpenVINO/Qwen2.5-1.5B-Instruct-fp16-ov',
    name: 'Qwen 2.5 1.5B',
    size: '3 GB',
    badge: '⚡ Pre-converted',
    badgeColor: 'text-status-success',
    description: 'Best for everyday chat. Already in NPU format — loads in seconds, no conversion needed.',
    preConverted: true,
  },
  {
    id: 'OpenVINO/phi-2-fp16-ov',
    name: 'Phi-2 2.7B',
    size: '5.4 GB',
    badge: '⚡ Pre-converted',
    badgeColor: 'text-status-success',
    description: 'Microsoft\'s fast general-purpose model. Great for coding help and Q&A.',
    preConverted: true,
  },
  {
    id: 'microsoft/phi-2',
    name: 'Phi-2 (convert)',
    size: '~5 GB',
    badge: 'Needs conversion',
    badgeColor: 'text-amber-400',
    description: 'Converts from HuggingFace to OpenVINO format. Takes 10–20 min on first run.',
    preConverted: false,
  },
  {
    id: 'Qwen/Qwen2.5-1.5B-Instruct',
    name: 'Qwen 2.5 1.5B (convert)',
    size: '~3 GB',
    badge: 'Needs conversion',
    badgeColor: 'text-amber-400',
    description: 'Strong multilingual chat model. Converts from HuggingFace — takes 5–15 min.',
    preConverted: false,
  },
];

// Conversion steps for progress
const CONVERSION_STEPS = [
  { id: 'init', label: 'Initializing', desc: 'Setting up environment' },
  { id: 'download', label: 'Downloading', desc: 'Fetching from HuggingFace' },
  { id: 'convert', label: 'Converting', desc: 'OpenVINO transformation' },
  { id: 'quantize', label: 'Quantizing', desc: 'Compressing weights' },
  { id: 'save', label: 'Saving', desc: 'Writing to disk' },
  { id: 'done', label: 'Complete', desc: 'Ready for NPU' },
];

function ConversionToolsPanel({ settings, setSettings }) {
  const [detecting, setDetecting] = React.useState(false);
  const [detected, setDetected] = React.useState(null);

  const autoDetect = React.useCallback(async () => {
    setDetecting(true);
    try {
      const status = await window.electronAPI?.getNpuStatus?.();
      if (status?.openvinoInstalled && status?.diagnostics?.pythonExecutable) {
        const pythonPath = status.diagnostics.pythonExecutable;
        setSettings(prev => ({ ...prev, pythonPath }));
        setDetected({ pythonPath, version: status.openvinoVersion });
      } else {
        setDetected({ error: 'OpenVINO environment not found. Click "Activate NPU" in the Hardware tab first.' });
      }
    } catch (e) {
      setDetected({ error: e.message });
    } finally {
      setDetecting(false);
    }
  }, [setSettings]);

  // Auto-detect on first render
  React.useEffect(() => {
    if (!settings.pythonPath) autoDetect();
  }, []);

  const pythonReady = !!settings.pythonPath && settings.pythonPath !== 'py' && settings.pythonPath !== 'python3';

  return (
    <div className="p-4 rounded-lg border border-forge-border space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-text-primary">Conversion Environment</h4>
          <p className="text-xs text-text-muted mt-0.5">
            DevForge automatically finds the bundled OpenVINO Python environment. No manual setup needed.
          </p>
        </div>
        <button
          type="button"
          onClick={autoDetect}
          disabled={detecting}
          className="btn btn-secondary text-xs shrink-0"
        >
          {detecting ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {detecting ? 'Detecting…' : 'Re-detect'}
        </button>
      </div>

      {/* Python / OpenVINO status */}
      <div className="rounded-lg border border-forge-border bg-forge-bg p-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${pythonReady ? 'bg-status-success' : 'bg-status-warning'}`} />
          <span className="text-text-muted">OpenVINO Python:</span>
          <span className={`font-mono truncate ${pythonReady ? 'text-text-primary' : 'text-status-warning'}`}>
            {pythonReady ? settings.pythonPath : 'Not detected — run "Activate NPU" first'}
          </span>
        </div>
        {detected?.version && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-success shrink-0" />
            <span className="text-text-muted">OpenVINO version:</span>
            <span className="text-status-success">{detected.version}</span>
          </div>
        )}
        {detected?.error && (
          <div className="text-status-warning text-[11px]">{detected.error}</div>
        )}
      </div>

      {/* What these tools do — plain English */}
      <div className="rounded-lg border border-forge-border bg-forge-bg p-3 space-y-2 text-[11px] text-text-muted">
        <p className="font-medium text-text-secondary text-xs">What the tools do:</p>
        <p><span className="text-amber-400 font-medium">NPU Model Converter</span> — Downloads a model from HuggingFace and converts it into OpenVINO format so the NPU chip can run it. One-time process per model.</p>
        <p><span className="text-purple-400 font-medium">llama-quantize</span> — Optional tool from llama.cpp that compresses GGUF models to smaller sizes (e.g., Q8 → Q4). Only needed if you want to shrink an already-downloaded GGUF file.</p>
        <p>For most users: just use the <span className="text-amber-400">NPU Model Converter</span> above with a HuggingFace model ID like <code className="bg-forge-elevated px-1 rounded">microsoft/phi-2</code>.</p>
      </div>
    </div>
  );
}

function NPUModelConverter() {
  const { setModel, setPreferredBackend } = useAppStore((state) => ({
    setModel: state.setModel,
    setPreferredBackend: state.setPreferredBackend,
  }), shallow);

  const llmRuntimeSpark = useAppStore((state) =>
    Boolean(
      state.llmRuntimeState?.hardware?.spark?.isSpark
      || state.llmRuntimeState?.deviceUtilization?.spark?.isSpark,
    ));
  const [probeSparkHost, setProbeSparkHost] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api.sparkProbe({ force: false }).then((r) => {
      if (!cancelled && r?.profile?.isSpark) setProbeSparkHost(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Intel/OpenVINO NPU path — not offered on NVIDIA DGX Spark.
  if (probeSparkHost || llmRuntimeSpark) {
    return null;
  }

  const [modelInput, setModelInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionResult, setActionResult] = React.useState(null);
  const [precision, setPrecision] = React.useState('int4');
  const [showRecommended, setShowRecommended] = React.useState(true);
  const [step, setStep] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [activeModelId, setActiveModelId] = React.useState(null);
  const timerRef = React.useRef(null);

  // Check which model is currently configured for the NPU
  React.useEffect(() => {
    const check = async () => {
      const status = await window.electronAPI?.getNpuStatus?.();
      const configuredModel = status?.model || status?.modelPath;
      if (configuredModel) setActiveModelId(configuredModel);
    };
    check();
  }, []);

  const syncAppSelection = React.useCallback(async (modelId) => {
    const backendResult = await setPreferredBackend?.('openvino-npu');
    if (backendResult?.success === false) {
      throw new Error(backendResult.error || 'Failed to switch backend to OpenVINO NPU');
    }

    const modelResult = await setModel?.(`npu:${modelId}`);
    if (modelResult?.success === false) {
      throw new Error(modelResult.error || `Failed to activate ${modelId}`);
    }
  }, [setModel, setPreferredBackend]);

  const activateNpuModel = React.useCallback(async (modelId, options = {}) => {
    const targetPrecision = options.precision || 'fp16';
    const showProgress = options.showProgress !== false;

    if (showProgress) setStep(1);
    const configResult = await window.electronAPI?.configureNpuModel?.({
      modelPath: modelId,
      device: 'NPU',
      precision: targetPrecision,
      enableAutoStart: true,
    });
    if (!configResult?.configured && configResult?.error && !/already configured/i.test(configResult.error)) {
      throw new Error(`Config failed: ${configResult.error}`);
    }

    if (showProgress) setStep(2);
    const status = await window.electronAPI?.getNpuStatus?.();
    if (status?.serverRunning) {
      const serverStatus = await window.electronAPI?.getNpuServerStatus?.();
      const alreadyLoaded = serverStatus?.model_loaded && serverStatus?.model_path === modelId;
      if (alreadyLoaded) {
        setActiveModelId(modelId);
        await syncAppSelection(modelId);
        return { message: `${modelId.split(/[\\/]/).pop()} is already loaded on the NPU.` };
      }

      const loadResult = await window.electronAPI?.loadNpuModel?.({
        modelPath: modelId,
        precision: targetPrecision,
      });
      if (loadResult?.success) {
        setActiveModelId(modelId);
        await syncAppSelection(modelId);
        return { message: `${modelId.split(/[\\/]/).pop()} loaded on the NPU and ready to use.` };
      }
      // Fall through to a clean restart if hot-load fails.
    }

    if (showProgress) setStep(3);
    if (status?.serverRunning) {
      await window.electronAPI?.stopNpuServer?.();
      await new Promise(r => setTimeout(r, 1000));
    }
    const startResult = await window.electronAPI?.startNpuServer?.({ device: 'NPU' });
    if (!startResult?.success) {
      throw new Error(startResult?.error || 'Server failed to start');
    }

    setActiveModelId(modelId);
    await syncAppSelection(modelId);
    return { message: `${modelId.split(/[\\/]/).pop()} is now loaded on the NPU and ready to use.` };
  }, [syncAppSelection]);

  React.useEffect(() => {
    if (busy) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - start) / 1000);
        setElapsed(secs);
        if (secs < 3) setStep(0);
        else if (secs < 15) setStep(1);
        else if (secs < 60) setStep(2);
        else if (secs < 90) setStep(3);
        else setStep(4);
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [busy]);

  // Load a pre-converted OpenVINO model — configure the path then hot-load or restart
  const loadPreConverted = async (modelId) => {
    setBusy(true);
    setActionResult(null);
    setElapsed(0);
    setStep(0);
    try {
      if (window.electronAPI?.configureNpuModel) {
        const result = await activateNpuModel(modelId, { precision: 'fp16', showProgress: true });
        setActionResult({ success: true, message: result.message });
        return;
      }

      // Step 1: Write model path to openvino-model.json
      setStep(1);
      const configResult = await window.electronAPI?.configureNpuModel?.({
        modelPath: modelId,
        device: 'NPU',
        precision: 'fp16',
        enableAutoStart: true,
      });
      if (!configResult?.configured && configResult?.error && !/already configured/i.test(configResult.error)) {
        setActionResult({ success: false, error: `Config failed: ${configResult.error}` });
        return;
      }

      // Step 2: Check if server is already running — if so, hot-swap or skip if already loaded
      setStep(2);
      const status = await window.electronAPI?.getNpuStatus?.();
      if (status?.serverRunning) {
        const serverStatus = await window.electronAPI?.getNpuServerStatus?.();
        const alreadyLoaded = serverStatus?.model_loaded && serverStatus?.model_path === modelId;
        if (alreadyLoaded) {
          setActiveModelId(modelId);
          await syncAppSelection(modelId);
          setActionResult({ success: true, message: `${modelId.split('/').pop()} is already loaded on the NPU.` });
          return;
        }
        const loadResult = await window.electronAPI?.loadNpuModel?.({ modelPath: modelId });
        if (loadResult?.success) {
          setActiveModelId(modelId);
          await syncAppSelection(modelId);
          setActionResult({ success: true, message: `${modelId.split('/').pop()} loaded on the NPU and ready to use.` });
          return;
        }
        // Hot-load failed — fall through to restart
      }

      // Step 3: Start (or restart) the server — it reads the config we just wrote
      setStep(3);
      if (status?.serverRunning) {
        await window.electronAPI?.stopNpuServer?.();
        await new Promise(r => setTimeout(r, 1000));
      }
      const startResult = await window.electronAPI?.startNpuServer?.({ device: 'NPU' });
      if (!startResult?.success) {
        setActionResult({ success: false, error: startResult?.error || 'Server failed to start' });
        return;
      }

      setActiveModelId(modelId);
      await syncAppSelection(modelId);
      setActionResult({ success: true, message: `${modelId.split('/').pop()} is now loaded on the NPU and ready to use.` });
    } catch (err) {
      setActionResult({ success: false, error: err.message });
    } finally {
      setBusy(false);
      clearInterval(timerRef.current);
    }
  };

  // Convert a HuggingFace model to OpenVINO format
  const convertToNPU = async (modelId = modelInput) => {
    if (!modelId) return;
    setBusy(true);
    setActionResult(null);
    setStep(0);
    setElapsed(0);
    try {
      if (window.electronAPI?.convertModelToNPU && window.electronAPI?.configureNpuModel) {
        const result = await window.electronAPI.convertModelToNPU({ inputPath: modelId, precision });
        if (!result?.success) {
          setStep(5);
          setActionResult(result);
          return;
        }

        const resolvedModelId = result.outputPath || modelId;
        const activation = await activateNpuModel(resolvedModelId, {
          precision,
          showProgress: false,
        });
        setStep(5);
        setModelInput(resolvedModelId);
        setActionResult({
          success: true,
          outputPath: result.outputPath,
          message: activation.message.replace('loaded on the NPU', 'converted and loaded on the NPU'),
        });
        return;
      }

      const result = await window.electronAPI?.convertModelToNPU({ inputPath: modelId, precision });
      setStep(5);
      setActionResult(result);
      if (result?.success) setActiveModelId(modelId);
    } catch (error) {
      setActionResult({ success: false, error: error.message });
    } finally {
      setBusy(false);
      clearInterval(timerRef.current);
    }
  };

  const handleModelCard = (model) => {
    setModelInput(model.id);
    setActionResult(null);
    if (model.preConverted) {
      loadPreConverted(model.id);
    } else {
      convertToNPU(model.id);
    }
  };

  // For the manual input field — detect if it looks like a pre-converted OV repo
  const isPreConverted = (id) => /^OpenVINO\//i.test(id) || /-ov$/.test(id) || /openvino/i.test(id);
  const converting = busy && !isPreConverted(modelInput);
  const loading = busy && isPreConverted(modelInput);

  return (
    <div className="p-4 rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5 space-y-3">
      <div>
        <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Zap size={16} className="text-amber-400" /> NPU Model Converter
        </h4>
        <p className="text-xs text-text-muted">
          Convert HuggingFace models to OpenVINO format for Intel NPU acceleration
        </p>
      </div>

      {/* Info about GGUF */}
      <div className="bg-forge-bg border border-forge-border rounded p-2 text-[11px] text-text-muted">
        <strong className="text-amber-400">Note:</strong> GGUF files cannot be directly converted. 
        Use the original HuggingFace model ID instead (e.g., &quot;microsoft/phi-2&quot;).
      </div>

      {/* Progress */}
      {busy && (() => {
        const steps = loading
          ? [
              { id: 'cfg',   label: 'Configuring',   desc: 'Writing model path' },
              { id: 'check', label: 'Checking server', desc: 'Is NPU server running?' },
              { id: 'load',  label: 'Loading model',  desc: 'Sending model to NPU' },
            ]
          : CONVERSION_STEPS;
        const color = loading ? 'text-status-success' : 'text-amber-400';
        const barColor = loading ? 'from-status-success to-emerald-500' : 'from-amber-500 to-orange-500';
        return (
          <div className="bg-forge-bg border border-forge-border rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Loader size={14} className={`animate-spin ${color}`} />
                {loading ? `Loading: ${modelInput.split('/').pop()}` : `Converting: ${modelInput.split('/').pop()}`}
              </span>
              <span className="text-xs text-text-muted font-mono">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </span>
            </div>
            {loading && step >= 2 && (
              <p className="text-[11px] text-amber-400/90">
                First-time load can take 5–15 min for a 3GB model. The server is downloading from HuggingFace — not stuck.
              </p>
            )}
            <div className="space-y-1">
              {steps.map((s, i) => (
                <div key={s.id} className={`flex items-center gap-2 p-1.5 rounded text-xs transition-all ${
                  i === step ? `bg-forge-elevated ${color}` :
                  i < step ? 'text-status-success' : 'text-text-muted opacity-40'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    i < step ? 'bg-status-success text-white' :
                    i === step ? 'bg-forge-elevated border border-current animate-pulse' : 'bg-forge-elevated'
                  }`}>
                    {i < step ? '✓' : i + 1}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[10px] text-text-muted">{s.desc}</span>
                  {i === step && <Loader size={10} className="ml-auto animate-spin" />}
                </div>
              ))}
            </div>
            <div className="w-full h-1.5 bg-forge-elevated rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                style={{ width: `${Math.min(100, ((step + 1) / steps.length) * 100)}%` }}
              />
            </div>
          </div>
        );
      })()}

      {/* Recommended models */}
      {showRecommended && !busy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary font-medium">Recommended NPU Models</span>
            <button
              onClick={() => setShowRecommended(false)}
              className="text-[10px] text-text-muted hover:text-text-secondary"
            >
              Hide
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            <span className="text-status-success font-medium">⚡ Pre-converted</span> models are already in NPU format — just click to load, no conversion wait.
            <span className="text-amber-400 font-medium"> Needs conversion</span> models get downloaded &amp; converted automatically (takes 5–20 min once).
          </p>
          <div className="grid grid-cols-1 gap-2">
            {NPU_RECOMMENDED_MODELS.map((model) => {
              // Exact match OR the stored path ends with the repo name — avoid cross-matching similar names
              const modelBasename = model.id.split('/').pop();
              const activeBasename = activeModelId ? activeModelId.split('/').pop() : '';
              const isActive = activeModelId && (
                activeModelId === model.id ||
                activeBasename === modelBasename
              );
              const actionLabel = model.preConverted ? 'Load on NPU' : 'Convert + Load';
              return (
                <button
                  key={model.id}
                  onClick={() => handleModelCard(model)}
                  disabled={busy}
                  className={`p-3 rounded-lg border text-left transition-colors group ${
                    isActive
                      ? 'bg-status-success/10 border-status-success/40'
                      : 'bg-forge-elevated hover:bg-forge-hover border-forge-border'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-text-primary flex items-center gap-1.5">
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-status-success inline-block" />}
                      {model.name}
                      {isActive && <span className="text-[10px] text-status-success">(active)</span>}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-text-muted">{model.size}</span>
                      <span className={`text-[10px] font-medium ${model.badgeColor}`}>{model.badge}</span>
                      {!isActive && (
                        <span className="text-[10px] text-workspace-casual opacity-0 group-hover:opacity-100 transition-opacity">
                          {actionLabel} →
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-text-muted">{model.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!busy && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">HuggingFace Model ID</label>
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder="e.g., microsoft/phi-2"
              className="input text-sm font-mono"
            />
          </div>

          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Precision</label>
              <select
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
                className="input text-sm"
              >
                <option value="int4">INT4 (Best for NPU)</option>
                <option value="int8">INT8 (Balanced)</option>
                <option value="fp16">FP16 (Higher quality)</option>
                <option value="fp32">FP32 (Full precision)</option>
              </select>
            </div>
            
            <div className="flex-1" />
            
            <button
              onClick={() => {
                if (isPreConverted(modelInput)) {
                  loadPreConverted(modelInput);
                } else {
                  convertToNPU();
                }
              }}
              disabled={!modelInput || busy}
              className="btn btn-primary flex items-center gap-2"
            >
              <Zap size={14} />
              {isPreConverted(modelInput) ? 'Load on NPU' : 'Convert to NPU'}
            </button>
          </div>
        </div>
      )}

      {actionResult && (
        <div className={`p-3 rounded text-xs ${
            actionResult.success
              ? 'bg-status-success/20 border border-status-success/30'
              : actionResult.needsSetup
              ? 'bg-amber-500/20 border border-amber-500/30'
              : 'bg-status-error/20 border border-status-error/30'
          }`}>
            {actionResult.success ? (
              <div>
                <div className="font-medium text-status-success mb-1">
                  {actionResult.message ? '✓ ' + actionResult.message : 'Success!'}
                </div>
                {actionResult.outputPath && (
                  <div className="text-text-muted">
                    Saved to: <code className="bg-forge-bg px-1 rounded">{actionResult.outputPath}</code>
                  </div>
                )}
                <p className="text-[10px] mt-2 text-text-muted">
                  Model is ready. Your next chat will run on the NPU.
                </p>
              </div>
            ) : actionResult.needsSetup ? (
              <div>
                <div className="font-medium text-amber-400 mb-1">OpenVINO Setup Required</div>
                <div className="text-text-muted mb-2">
                  {actionResult.error}
                </div>
                <button
                  onClick={async () => {
                    try {
                      await window.electronAPI?.runTerminalCommand('powershell -ExecutionPolicy Bypass -File scripts/setup-openvino.ps1');
                    } catch (e) {
                      console.error('Failed to run setup:', e);
                    }
                  }}
                  className="btn btn-secondary text-xs"
                >
                  Run OpenVINO Setup
                </button>
              </div>
            ) : (
              <div>
                <div className="font-medium text-status-error mb-1">Failed</div>
                <div className="text-text-muted whitespace-pre-wrap">{actionResult.error}</div>
                {actionResult.stderr && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-text-muted hover:text-text-secondary">
                      Show details
                    </summary>
                    <pre className="mt-1 text-[9px] bg-forge-bg p-2 rounded overflow-x-auto max-h-32">
                      {actionResult.stderr}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        <div className="text-[10px] text-text-muted bg-forge-bg rounded p-2">
          <strong>Note:</strong> NPU conversion requires OpenVINO to be installed. 
          Run <code className="bg-forge-elevated px-1 rounded">scripts/setup-openvino.ps1</code> to set up the environment.
          Converted models will work with Intel Core Ultra processors.
        </div>
    </div>
  );
}

function ImageSettings({ settings, setSettings }) {
  const [backendStatus, setBackendStatus] = React.useState(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isDetecting, setIsDetecting] = React.useState(false);
  const [imageBusy, setImageBusy] = React.useState(false);

  React.useEffect(() => {
    detectBackend();
  }, []);

  const detectBackend = async () => {
    setIsDetecting(true);
    try {
      const status = await window.electronAPI?.getImageStatus();
      setBackendStatus(status);
    } catch (error) {
      console.error('Failed to detect image backend:', error);
      setBackendStatus({ running: false, error: error.message });
    } finally {
      setIsDetecting(false);
    }
  };

  const checkHealth = async () => {
    setIsChecking(true);
    try {
      const health = await window.electronAPI?.checkImageHealth();
      setBackendStatus(prev => ({
        ...prev,
        running: health?.healthy,
        backendName: health?.backend || prev?.backendName
      }));
    } catch (error) {
      setBackendStatus(prev => ({ ...prev, running: false, error: error.message }));
    } finally {
      setIsChecking(false);
    }
  };

  const handleImageAction = async (action) => {
    if (!window.electronAPI) return;
    setImageBusy(true);
    try {
      if (action === 'install') {
        await window.electronAPI.openExternal?.('https://github.com/comfyanonymous/ComfyUI/releases');
      } else if (action === 'start') {
        await window.electronAPI.startImageBackend?.(settings.imageStartCommand);
        await new Promise(resolve => setTimeout(resolve, 3000));
        await detectBackend();
      } else if (action === 'stop') {
        await window.electronAPI.stopImageBackend?.(settings.imageStopCommand);
        await detectBackend();
      }
    } catch (error) {
      console.error('Image backend action failed:', error);
    } finally {
      setImageBusy(false);
    }
  };

  const isOnline = backendStatus?.running;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className={`p-4 rounded-lg border ${
        isOnline 
          ? 'bg-status-success/10 border-status-success/30'
          : 'bg-forge-bg border-forge-border'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-status-success' : 'bg-text-muted'}`} />
            <h4 className="text-sm font-medium text-text-primary">
              {isDetecting ? 'Detecting...' : isOnline ? `Connected to ${backendStatus?.backendName || 'Image Backend'}` : 'No Image Backend Detected'}
            </h4>
          </div>
          <button 
            onClick={detectBackend}
            disabled={isDetecting}
            className="btn btn-secondary text-xs"
          >
            {isDetecting ? <Loader size={14} className="animate-spin" /> : 'Refresh'}
          </button>
        </div>
        
        {isOnline && backendStatus?.models?.length > 0 && (
          <div className="text-xs text-text-muted">
            <span className="text-status-success font-medium">{backendStatus.models.length}</span> models available
            {backendStatus.models.slice(0, 3).map((m) => (
              <span key={typeof m === 'object' ? m.name : m} className="ml-2 px-1.5 py-0.5 bg-forge-elevated rounded text-text-secondary">
                {typeof m === 'object' ? m.name : m}
              </span>
            ))}
            {backendStatus.models.length > 3 && <span className="ml-1">+{backendStatus.models.length - 3} more</span>}
          </div>
        )}

        {!isOnline && !isDetecting && (
          <div className="text-xs text-text-muted">
            Start ComfyUI or another image backend to enable image generation.
          </div>
        )}
      </div>

      {/* Endpoint Configuration */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Backend Configuration</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Endpoint URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.imageGenEndpoint}
                onChange={(e) => setSettings(prev => ({ ...prev, imageGenEndpoint: e.target.value }))}
                placeholder="http://localhost:8188"
                className="input flex-1"
              />
              <button 
                onClick={checkHealth}
                disabled={isChecking}
                className="btn btn-secondary"
                title="Test connection"
              >
                {isChecking ? <Loader size={16} className="animate-spin" /> : <Server size={16} />}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              DevForge auto-detects ComfyUI (8188), A1111 (7860), and Fooocus (7865)
            </p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-2">Start Command</label>
              <input
                type="text"
                value={settings.imageStartCommand}
                onChange={(e) => setSettings(prev => ({ ...prev, imageStartCommand: e.target.value }))}
                placeholder='C:\ComfyUI\run_nvidia_gpu.bat'
                className="input text-xs"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-2">Stop Command</label>
              <input
                type="text"
                value={settings.imageStopCommand}
                onChange={(e) => setSettings(prev => ({ ...prev, imageStopCommand: e.target.value }))}
                placeholder="taskkill /F /IM python.exe"
                className="input text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-4 rounded-lg border border-forge-border">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-medium text-text-primary">Backend Control</h4>
            <p className="text-xs text-text-muted">
              {settings.imageStartCommand ? 'Commands configured' : 'Configure start/stop commands above'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleImageAction('install')}
              className="btn btn-secondary text-xs"
              disabled={imageBusy}
            >
              Get ComfyUI
            </button>
            <button
              type="button"
              onClick={() => handleImageAction('start')}
              className="btn btn-primary text-xs"
              disabled={imageBusy || isOnline || !settings.imageStartCommand}
            >
              {imageBusy ? <Loader size={12} className="animate-spin" /> : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => handleImageAction('stop')}
              className="btn btn-secondary text-xs"
              disabled={imageBusy || !isOnline || !settings.imageStopCommand}
            >
              Stop
            </button>
          </div>
        </div>
      </div>

      {/* Supported Backends Info */}
      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
        <h4 className="text-sm font-medium text-text-primary mb-3">Supported Backends</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-2 rounded bg-forge-surface border border-forge-border">
            <div className="text-xs font-medium text-text-primary">ComfyUI</div>
            <div className="text-[10px] text-text-muted">Port 8188 | Recommended</div>
          </div>
          <div className="p-2 rounded bg-forge-surface border border-forge-border">
            <div className="text-xs font-medium text-text-primary">A1111 WebUI</div>
            <div className="text-[10px] text-text-muted">Port 7860 | Use --api flag</div>
          </div>
          <div className="p-2 rounded bg-forge-surface border border-forge-border">
            <div className="text-xs font-medium text-text-primary">Fooocus</div>
            <div className="text-[10px] text-text-muted">Port 7865 | Simple UI</div>
          </div>
        </div>
      </div>

      {/* Model Types */}
      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
        <h4 className="text-sm font-medium text-text-primary mb-3">Supported Model Types</h4>
        <div className="text-xs text-text-muted space-y-2">
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">SD 1.5</span>
            <span>512x512 | 20 steps | CFG 7</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">SDXL</span>
            <span>1024x1024 | 25 steps | CFG 7</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">Flux</span>
            <span>1024x1024 | 20 steps | CFG 1</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">SD 3</span>
            <span>1024x1024 | 28 steps | CFG 4.5</span>
          </div>
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          DevForge auto-detects model type from filename and applies optimal settings.
        </p>
      </div>
    </div>
  );
}

function ResearchSettings({ settings, setSettings }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Web Search Configuration</h3>
        <p className="text-sm text-text-muted mb-4">
          Configure search providers for the Deep Research feature. SearXNG is recommended for private, self-hosted search.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">SearXNG Instance URL</label>
          <input
            type="text"
            value={settings.searxngUrl || ''}
            onChange={(e) => setSettings(prev => ({ ...prev, searxngUrl: e.target.value }))}
            placeholder="http://localhost:8888"
            className="input w-full"
          />
          <p className="text-xs text-text-muted mt-1.5">
            URL of your SearXNG instance. Leave blank to use environment variable SEARXNG_URL, or fall back to Bing/DuckDuckGo.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-1/50 border border-border-subtle space-y-2">
          <h4 className="text-sm font-medium">Provider Priority</h4>
          <p className="text-xs text-text-muted">
            Research will try providers in this order: <strong>SearXNG</strong> -&gt; Bing RSS -&gt; DuckDuckGo -&gt; Brave -&gt; Serper.
            SearXNG, Bing RSS, and DuckDuckGo work without API keys.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-1/50 border border-border-subtle space-y-2">
          <h4 className="text-sm font-medium">Quick Setup: SearXNG</h4>
          <p className="text-xs text-text-muted">
            Run SearXNG locally with Docker:
          </p>
          <code className="block text-xs bg-surface-0/80 p-2 rounded font-mono text-text-secondary">
            docker run -d --name searxng -p 8888:8080 searxng/searxng
          </code>
          <p className="text-xs text-text-muted mt-1">
            Then set the URL above to <strong>http://localhost:8888</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

function PrivacySettings({ settings, setSettings, onClose }) {
  const lockNsfw = useAppStore((s) => s.lockNsfw);
  const isLocked = useAppStore((s) => s.isLocked);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const unlockNsfw = useAppStore((s) => s.unlockNsfw);
  const checkNsfwPasswordExists = useAppStore((s) => s.checkNsfwPasswordExists);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const [sovereignty, setSovereignty] = React.useState(null);
  const [localOnly, setLocalOnly] = React.useState(false);
  const [updatingLocalOnly, setUpdatingLocalOnly] = React.useState(false);
  
  // Hidden vault access state
  const [showVaultAccess, setShowVaultAccess] = React.useState(false);
  const [vaultPassword, setVaultPassword] = React.useState('');
  const [vaultError, setVaultError] = React.useState('');
  const [isUnlocking, setIsUnlocking] = React.useState(false);
  const [hasPassword, setHasPassword] = React.useState(false);

  React.useEffect(() => {
    const loadStatus = async () => {
      try {
        const status = await api.getSovereigntyStatus();
        setSovereignty(status);
        setLocalOnly(!!status?.localOnly);
        
        // Check if password exists for vault
        const pwExists = await checkNsfwPasswordExists?.();
        setHasPassword(pwExists);
      } catch (e) {
        console.warn('Failed to load sovereignty status', e);
      }
    };
    loadStatus();
  }, [checkNsfwPasswordExists]);

  React.useEffect(() => {
    const handleSecretVaultToggle = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key === '.') {
        event.preventDefault();
        setShowVaultAccess((prev) => !prev);
        setVaultError('');
        setVaultPassword('');
      }
    };

    window.addEventListener('keydown', handleSecretVaultToggle);
    return () => window.removeEventListener('keydown', handleSecretVaultToggle);
  }, []);

  const handleToggleLocalOnly = async () => {
    setUpdatingLocalOnly(true);
    try {
      const next = !localOnly;
      const result = await api.setLocalOnlyMode(next);
      if (result) {
        setLocalOnly(!!result.localOnly);
        // Refresh status snapshot
        const status = await api.getSovereigntyStatus();
        setSovereignty(status);
      }
    } catch (e) {
      console.warn('Failed to update local-only mode', e);
    } finally {
      setUpdatingLocalOnly(false);
    }
  };
  
  // Handle vault access
  const handleVaultAccess = async () => {
    if (!vaultPassword.trim()) {
      setVaultError('Enter your password');
      return;
    }
    
    setIsUnlocking(true);
    setVaultError('');
    
    try {
      const result = await unlockNsfw(vaultPassword);
      if (result?.success) {
        // Success! Close settings and navigate to private workspace
        setWorkspace('nsfw');
        toggleSettings?.(); // Close the settings modal
      } else {
        setVaultError(result?.error || 'Incorrect password');
      }
    } catch (e) {
      setVaultError('Failed to unlock');
    } finally {
      setIsUnlocking(false);
    }
  };

  const externalCount = sovereignty?.network?.externalRequests || 0;
  const blockedExternal = sovereignty?.network?.blockedExternalRequests || 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Data</h3>
        <BackupSettings />
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Sovereignty & Network</h3>
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-text-primary">Local-only mode</p>
                <p className="text-xs text-text-muted mt-1">
                  When enabled, DevForge will block all non-localhost network requests.
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleLocalOnly}
                disabled={updatingLocalOnly}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  localOnly
                    ? 'bg-status-success/20 border-status-success/40 text-status-success'
                    : 'bg-forge-bg border-forge-border text-text-secondary'
                }`}
              >
                {updatingLocalOnly ? 'Updating...' : localOnly ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-4">
            <div>
              <label className="block text-sm text-text-primary mb-2">Catalogue discovery network access</label>
              <select
                value={settings.discoveryNetworkAccess || 'on'}
                onChange={(event) => setSettings((prev) => ({ ...prev, discoveryNetworkAccess: event.target.value }))}
                className="input"
              >
                <option value="on">On - online plus cache</option>
                <option value="cache-only">Cache-only</option>
                <option value="off">Off - installed metadata only</option>
              </select>
              <p className="text-xs text-text-muted mt-1">
                Controls whether the model catalogue enriches installed models with online provider metadata.
              </p>
            </div>

            <div>
              <label className="block text-sm text-text-primary mb-2">Vault model gating</label>
              <select
                value={settings.vaultModelGating || 'open'}
                onChange={(event) => setSettings((prev) => ({ ...prev, vaultModelGating: event.target.value }))}
                className="input"
              >
                <option value="open">Open - show all installed models</option>
                <option value="allowlist">Allow-list only</option>
              </select>
              <p className="text-xs text-text-muted mt-1">
                Vault enrichment stays cache-only. Allow-list mode only shows models marked as vault allowed.
              </p>
            </div>
          </div>

          {sovereignty && (
            <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-2">
              <p className="text-xs text-text-muted">
                <span className="font-medium text-text-secondary">Data locations:</span>
              </p>
              <div className="text-[11px] text-text-muted space-y-1">
                {sovereignty.data?.userDataPath && (
                  <p>User data: <code className="break-all">{sovereignty.data.userDataPath}</code></p>
                )}
                {sovereignty.data?.databasePath && (
                  <p>Database: <code className="break-all">{sovereignty.data.databasePath}</code></p>
                )}
                {sovereignty.data?.modelsDirectory && (
                  <p>Models: <code className="break-all">{sovereignty.data.modelsDirectory}</code></p>
                )}
              </div>

              <div className="mt-3 text-[11px] text-text-muted">
                <span className="font-medium text-text-secondary">Network summary:</span>{' '}
                {externalCount === 0 ? (
                  <span>No external connections recorded this session.</span>
                ) : (
                  <span>
                    {externalCount} external request{externalCount !== 1 && 's'};{' '}
                    {blockedExternal} blocked by local-only mode.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {!isLocked && (
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-4">Vault Safety</h3>
          <VaultSafetySettings />
        </div>
      )}

      {!isLocked && (
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-4">Audio Layer</h3>
          <AudioLayerSettings />
        </div>
      )}

      {!isLocked && (
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-4">Haptic Bridge</h3>
          <HapticBridgeSettings />
        </div>
      )}

      {/* Spacer to push vault access to bottom */}
      <div className="flex-1" />

      {showVaultAccess && (
        <div className="pt-8 mt-8 border-t border-forge-border/30">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500/50" />
              <span>Secure Access</span>
              {!isLocked && (
                <span className="ml-auto text-[10px] text-emerald-500">Unlocked</span>
              )}
            </div>

            {isLocked ? (
              <div className="space-y-2">
                <input
                  type="password"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVaultAccess()}
                  placeholder={hasPassword ? "Enter password..." : "Create password..."}
                  className="w-full px-3 py-2 text-sm bg-forge-bg border border-forge-border rounded-lg outline-none focus:border-pink-500/30"
                  autoComplete="off"
                />
                {vaultError && (
                  <p className="text-[10px] text-red-400">{vaultError}</p>
                )}
                <button
                  onClick={handleVaultAccess}
                  disabled={isUnlocking}
                  className="w-full px-3 py-2 text-xs bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isUnlocking ? 'Unlocking...' : hasPassword ? 'Enter' : 'Create & Enter'}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setWorkspace('nsfw');
                    toggleSettings?.();
                  }}
                  className="flex-1 px-3 py-2 text-xs bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 rounded-lg transition-colors"
                >
                  Open
                </button>
                <button
                  onClick={lockNsfw}
                  className="px-3 py-2 text-xs bg-forge-bg hover:bg-forge-hover text-text-muted rounded-lg transition-colors"
                >
                  Lock
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutsSettings() {
  const {
    shortcuts,
    initialize,
    setShortcutCombo,
    resetShortcut,
    resetAll,
  } = useShortcutsStore((state) => ({
    shortcuts: state.shortcuts,
    initialize: state.initialize,
    setShortcutCombo: state.setShortcutCombo,
    resetShortcut: state.resetShortcut,
    resetAll: state.resetAll,
  }), shallow);

  React.useEffect(() => {
    // Initialize from persisted settings
    initialize();
  }, [initialize]);

  const sortedShortcuts = React.useMemo(() => {
    const values = Object.values(shortcuts || {});
    values.sort((a, b) => {
      if (a.category === b.category) return a.label.localeCompare(b.label);
      return a.category.localeCompare(b.category);
    });
    return values;
  }, [shortcuts]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-4">Keyboard Shortcuts</h3>
        <p className="text-xs text-text-muted mb-3">
          Customize global keyboard shortcuts. Use modifiers like Ctrl, Alt, Shift, e.g. <code>Ctrl+N</code>.
        </p>

        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-text-muted">
            Changes are saved automatically. Some combinations may be reserved by the OS.
          </span>
          <button
            onClick={resetAll}
            className="text-xs text-status-error hover:underline"
          >
            Reset all to defaults
          </button>
        </div>

        <div className="space-y-2">
          {sortedShortcuts.map((shortcut) => (
            <div 
              key={shortcut.id}
              className="flex items-center gap-3 py-2 border-b border-forge-border"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-primary truncate">
                    {shortcut.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-text-muted ml-2">
                    {shortcut.category}
                  </span>
                </div>
                {shortcut.description && (
                  <p className="text-xs text-text-muted mt-0.5">
                    {shortcut.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={shortcut.combo || shortcut.defaultCombo}
                  onChange={(e) => setShortcutCombo(shortcut.id, e.target.value)}
                  className="w-32 px-2 py-1 text-xs font-mono bg-forge-bg border border-forge-border rounded outline-none focus:border-workspace-casual/60"
                  spellCheck={false}
                />
                <button
                  onClick={() => resetShortcut(shortcut.id)}
                  className="text-[10px] text-text-muted hover:text-text-secondary"
                >
                  Reset
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DebugSettings() {
  const appError = useAppStore((state) => state.error);
  const [running, setRunning] = React.useState(false);
  const [report, setReport] = React.useState(null);
  const [error, setError] = React.useState(null);

  const runDiagnostics = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const unwrap = (result) => {
        if (!result) return null;
        if (result.status === 'fulfilled') return result.value;
        return {
          error:
            result.reason?.message ||
            (typeof result.reason === 'string' ? result.reason : 'failed'),
        };
      };

      const results = await Promise.allSettled([
        window.electronAPI?.checkLLMHealth?.(),
        window.electronAPI?.getOllamaStatus?.(),
        window.electronAPI?.getNpuStatus?.(),
        window.electronAPI?.getImageBackendStatus?.(),
        window.electronAPI?.detectHardware?.(),
        window.electronAPI?.getHardwareStats?.(),
        api.getSovereigntyStatus().catch((e) => {
          throw e;
        }),
      ]);

      const [
        llmHealth,
        ollamaStatus,
        npuStatus,
        imageStatus,
        hardware,
        hardwareStats,
        sovereignty,
      ] = results;

      setReport({
        timestamp: new Date().toISOString(),
        appError: appError || null,
        llmHealth: unwrap(llmHealth),
        ollamaStatus: unwrap(ollamaStatus),
        npuStatus: unwrap(npuStatus),
        imageStatus: unwrap(imageStatus),
        hardware: unwrap(hardware),
        hardwareStats: unwrap(hardwareStats),
        sovereignty: unwrap(sovereignty),
      });
    } catch (e) {
      console.error('Diagnostics failed:', e);
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  const copyToClipboard = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    } catch (e) {
      console.warn('Failed to copy diagnostics to clipboard:', e);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-2">Debug Console</h3>
        <p className="text-xs text-text-muted">
          Run a one-click health check for all backends and copy the report when something
          isn&apos;t working. You can paste it into chat or an issue for deeper debugging.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runDiagnostics}
          disabled={running}
          className="btn btn-primary text-xs"
        >
          {running ? (
            <>
              <Loader size={14} className="animate-spin" />
              Running diagnostics...
            </>
          ) : (
            <>
              <Bug size={14} />
              Run diagnostics
            </>
          )}
        </button>
        <button
          type="button"
          onClick={copyToClipboard}
          disabled={!report}
          className="btn btn-secondary text-xs"
        >
          Copy report
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-status-error bg-status-error/10 border border-status-error/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {report && (
        <div className="mt-2">
          <p className="text-[11px] text-text-muted mb-1">
            Latest diagnostics ({report.timestamp}):
          </p>
          <pre className="text-[11px] text-text-secondary bg-forge-bg border border-forge-border rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(report, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function resolveHardwareProfile({ sparkProbe, runtimeState }) {
  const sparkRuntime = runtimeState?.hardware?.spark || runtimeState?.deviceUtilization?.spark || null;
  if (sparkProbe?.isSpark || sparkRuntime?.isSpark) {
    return {
      id: 'spark',
      label: 'NVIDIA DGX Spark',
      shortLabel: 'Spark',
      accentName: 'NVIDIA Green',
      icon: Zap,
      shell: 'border-[#76b900]/30 bg-[#76b900]/10',
      title: 'text-[#b8ff5f]',
      text: 'text-[#d8ffb0]/75',
      muted: 'text-[#d8ffb0]/55',
      pill: 'border-[#76b900]/30 bg-[#76b900]/15 text-[#d8ffb0]',
      button: 'border-[#76b900]/30 bg-[#76b900]/15 text-[#d8ffb0] hover:bg-[#76b900]/25',
      focus: 'focus:border-[#76b900]/50',
      description: 'Spark profile active: CUDA-first routing, unified-memory telemetry, MoE guardrails, and one loaded model by default.',
    };
  }

  const platform = String(navigator?.platform || navigator?.userAgent || '').toLowerCase();
  if (platform.includes('mac')) {
    return {
      id: 'mac',
      label: 'Mac',
      shortLabel: 'Mac',
      accentName: 'Apple Blue',
      icon: Monitor,
      shell: 'border-sky-400/25 bg-sky-500/10',
      title: 'text-sky-100',
      text: 'text-sky-100/70',
      muted: 'text-sky-100/50',
      pill: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
      button: 'border-sky-400/25 bg-sky-500/10 text-sky-100 hover:bg-sky-500/15',
      focus: 'focus:border-sky-400/40',
      description: 'Mac profile: keep the existing local runtime settings and avoid Spark-only unified-memory controls.',
    };
  }

  if (platform.includes('win')) {
    return {
      id: 'windows',
      label: 'Windows PC',
      shortLabel: 'Windows',
      accentName: 'Windows Blue',
      icon: Monitor,
      shell: 'border-blue-400/25 bg-blue-500/10',
      title: 'text-blue-100',
      text: 'text-blue-100/70',
      muted: 'text-blue-100/50',
      pill: 'border-blue-400/25 bg-blue-500/10 text-blue-100',
      button: 'border-blue-400/25 bg-blue-500/10 text-blue-100 hover:bg-blue-500/15',
      focus: 'focus:border-blue-400/40',
      description: 'Windows profile: keep existing GPU/runtime options and use standard VRAM-based telemetry.',
    };
  }

  return {
    id: 'linux',
    label: 'Linux Workstation',
    shortLabel: 'Linux',
    accentName: 'Neutral',
    icon: Server,
    shell: 'border-white/10 bg-white/[0.04]',
    title: 'text-text-primary',
    text: 'text-text-secondary',
    muted: 'text-text-muted',
    pill: 'border-white/10 bg-white/[0.05] text-text-secondary',
    button: 'border-white/10 bg-white/[0.06] text-text-secondary hover:bg-white/[0.1]',
    focus: 'focus:border-white/20',
    description: 'Linux profile: use existing GPU/runtime options unless Spark hardware is detected.',
  };
}

function HardwareSettings() {
  const [powerMode, setPowerMode] = React.useState(false);
  const [npuStatus, setNpuStatus] = React.useState(null);
  const [npuBusy, setNpuBusy] = React.useState(false);
  const [laptopBusy, setLaptopBusy] = React.useState(false);
  const [profileLoading, setProfileLoading] = React.useState(true);
  const [imageStatus, setImageStatus] = React.useState(null);
  const [runningModels, setRunningModels] = React.useState([]);
  const [warmingUp, setWarmingUp] = React.useState(false);
  const [warmupModel, setWarmupModel] = React.useState('');
  const [warmupReport, setWarmupReport] = React.useState(null);
  const [benchmarkRunning, setBenchmarkRunning] = React.useState(false);
  const [benchmarkResult, setBenchmarkResult] = React.useState(null);
  const [hybridCaps, setHybridCaps] = React.useState(null);
  const [hybridStatus, setHybridStatus] = React.useState(null);
  const [hybridLoading, setHybridLoading] = React.useState(false);
  const [hybridAdvanced, setHybridAdvanced] = React.useState(false);
  const [autoWarmupOnLaunch, setAutoWarmupOnLaunchState] = React.useState(false);
  const [sparkProbe, setSparkProbe] = React.useState(null);
  const [sparkProbeBusy, setSparkProbeBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await window.electronAPI?.getSettings?.('autoWarmupOnLaunch');
        if (!cancelled) setAutoWarmupOnLaunchState(stored === true);
      } catch (_) {
        if (!cancelled) setAutoWarmupOnLaunchState(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleToggleAutoWarmupOnLaunch = React.useCallback(async (next) => {
    setAutoWarmupOnLaunchState(Boolean(next));
    try {
      await window.electronAPI?.setSettings?.('autoWarmupOnLaunch', Boolean(next));
    } catch (error) {
      console.warn('[Settings] Failed to persist autoWarmupOnLaunch:', error?.message || error);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    api.sparkProbe({ force: false }).then((result) => {
      if (!cancelled) setSparkProbe(result?.profile || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const {
    currentModel,
    availableModels,
    backend,
    backends,
    profile,
    ollamaStatus,
    runtimeState,
    refreshLlmRuntime,
    setPreferredBackend,
    setPerformanceProfile,
  } = useAppStore((state) => ({
    currentModel: state.currentModel,
    availableModels: state.availableModels,
    backend: state.preferredBackend,
    backends: state.llmBackends,
    profile: state.performanceProfile,
    ollamaStatus: state.ollamaStatus,
    runtimeState: state.llmRuntimeState,
    refreshLlmRuntime: state.refreshLlmRuntime,
    setPreferredBackend: state.setPreferredBackend,
    setPerformanceProfile: state.setPerformanceProfile,
  }), shallow);

  const handleRunSparkProbe = React.useCallback(async () => {
    setSparkProbeBusy(true);
    try {
      const result = await api.sparkProbe({ force: true });
      setSparkProbe(result?.profile || null);
      if (result?.profile?.isSpark) {
        await setPerformanceProfile?.('spark');
      }
    } catch (error) {
      console.warn('[Settings] Spark probe failed:', error?.message || error);
    } finally {
      setSparkProbeBusy(false);
    }
  }, [setPerformanceProfile]);

  const hardwareProfile = React.useMemo(
    () => resolveHardwareProfile({ sparkProbe, runtimeState }),
    [sparkProbe, runtimeState],
  );
  const isSparkHardware = hardwareProfile.id === 'spark';
  const intelAcceleratorRelevant = !isSparkHardware;

  const formatBytes = React.useCallback((bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIdx = 0;
    while (size >= 1024 && unitIdx < units.length - 1) {
      size /= 1024;
      unitIdx += 1;
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIdx]}`;
  }, []);

  const refreshRuntimeState = React.useCallback(async () => {
    if (!refreshLlmRuntime) return;
    try {
      await refreshLlmRuntime({
        requestedModel: currentModel ?? undefined,
        refreshModels: false,
        hydrateSelection: false,
        persistResolvedSelection: false,
        updateError: false,
        skipStatus: true,
      });
    } catch (error) {
      console.warn('Failed to refresh runtime state:', error);
    }
  }, [currentModel, refreshLlmRuntime]);

  /** Spark hosts never use Intel/OpenVINO — fix stale settings from other machines */
  React.useEffect(() => {
    if (!isSparkHardware || !setPerformanceProfile) return;
    if (profile !== 'laptop' && profile !== 'efficiency') return;
    void setPerformanceProfile('spark').catch(() => {});
  }, [isSparkHardware, profile, setPerformanceProfile]);

  React.useEffect(() => {
    if (!isSparkHardware || !setPreferredBackend) return;
    const intelBackends = new Set(['openvino-npu', 'openvino-hybrid', 'llamacpp-vulkan']);
    if (!intelBackends.has(backend)) return;
    void (async () => {
      try {
        await setPreferredBackend('ollama-cuda');
        await refreshRuntimeState();
      } catch (_) {
        /* non-fatal */
      }
    })();
  }, [isSparkHardware, backend, setPreferredBackend, refreshRuntimeState]);

  const refreshNpuStatus = React.useCallback(async (force = false) => {
    if (!window.electronAPI?.getNpuStatus) return null;
    try {
      const status = await window.electronAPI.getNpuStatus({ force });
      setNpuStatus(status || null);
      return status || null;
    } catch (error) {
      console.warn('Failed to refresh NPU status:', error);
      return null;
    }
  }, []);

  const loadStaticHardwareSettings = React.useCallback(async () => {
    try {
      const status = await window.electronAPI?.getPowerModeStatus?.();
      if (status) {
        setPowerMode(status.enabled);
      }
      await refreshLlmRuntime?.({
        requestedModel: currentModel ?? undefined,
        refreshModels: false,
        hydrateSelection: false,
        persistResolvedSelection: false,
        updateError: false,
        skipStatus: true,
      });
    } catch (error) {
      console.error('Failed to load hardware static settings:', error);
    } finally {
      setProfileLoading(false);
    }
  }, [currentModel, refreshLlmRuntime]);

  const refreshHardwareStatus = React.useCallback(async (forceNpu = false) => {
    const tasks = [];

    if (intelAcceleratorRelevant) {
      tasks.push(refreshNpuStatus(forceNpu));
    }
    tasks.push(refreshRuntimeState());

    if (window.electronAPI?.getImageBackendStatus) {
      tasks.push(
        window.electronAPI.getImageBackendStatus()
          .then((status) => setImageStatus(status))
          .catch((error) => console.warn('Failed to refresh image backend status:', error)),
      );
    }

    if (window.electronAPI?.getRunningModels) {
      tasks.push(
        window.electronAPI.getRunningModels()
          .then((running) => setRunningModels(running || []))
          .catch((error) => console.warn('Failed to refresh running models:', error)),
      );
    }

    if (intelAcceleratorRelevant && window.electronAPI?.getHybridCapabilities) {
      tasks.push(
        window.electronAPI.getHybridCapabilities()
          .then((caps) => setHybridCaps(caps || null))
          .catch((error) => console.warn('Failed to fetch hybrid capabilities:', error)),
      );
    }
    if (intelAcceleratorRelevant && window.electronAPI?.getHybridStatus) {
      tasks.push(
        window.electronAPI.getHybridStatus()
          .then((status) => setHybridStatus(status || null))
          .catch((error) => console.warn('Failed to fetch hybrid status:', error)),
      );
    }

    await Promise.all(tasks);
  }, [intelAcceleratorRelevant, refreshNpuStatus, refreshRuntimeState]);

  React.useEffect(() => {
    let disposed = false;

    const bootstrap = async () => {
      await loadStaticHardwareSettings();
      if (!disposed) {
        await refreshHardwareStatus(false);
      }
    };

    void bootstrap();

    const unsubscribePolling = pollingCoordinator.subscribe('settings:hardware-status', {
      intervalMs: 15000,
      hiddenIntervalMs: 60000,
      immediate: false,
      run: () => refreshHardwareStatus(false),
    });

    return () => {
      disposed = true;
      unsubscribePolling();
    };
  }, [loadStaticHardwareSettings, refreshHardwareStatus]);
  
  // Warmup/preload model onto GPU
  const handleWarmupModel = async (modelName) => {
    if (!modelName || warmingUp) return;
    setWarmingUp(true);
    setWarmupModel(modelName);
    const syntheticModel = /^npu:/i.test(String(modelName || '').trim());
    try {
      // Show the global progress overlay alongside the existing offload-verify
      // result. Synthetic NPU models still go through the legacy path because
      // the progress IPC currently focuses on Ollama warmups.
      if (!syntheticModel) {
        void triggerWarmupWithProgress(modelName);
      }
      const result = await window.electronAPI?.warmupModel(modelName);
      setWarmupReport(result || null);
      if (result?.success) {
        // Refresh running models
        const running = await window.electronAPI?.getRunningModels();
        setRunningModels(running || []);
        await refreshRuntimeState();
        const vram = result?.offloadEvidence?.sizeVram || 0;
        const backendLabel = result?.backend || 'backend';
        const evidenceLabel = result?.offloadEvidence?.verified
          ? (syntheticModel
            ? `Verified runtime warmup on ${backendLabel}`
            : `Verified GPU offload (${formatBytes(vram)} in VRAM)`)
          : `Warmup finished on ${backendLabel}`;
        // eslint-disable-next-line no-alert
        alert(`Model "${modelName}" warmup completed.\n${evidenceLabel}`);
      } else {
        await refreshRuntimeState();
        const reason = result?.fallbackReason || result?.error || 'Unknown error';
        // eslint-disable-next-line no-alert
        alert(`${syntheticModel ? 'Warmup did not verify the active runtime.' : 'Warmup did not verify GPU offload.'}\nReason: ${reason}`);
      }
    } catch (error) {
      console.error('Warmup failed:', error);
      await refreshRuntimeState();
      // eslint-disable-next-line no-alert
      alert(`Warmup failed: ${error.message}`);
    } finally {
      setWarmingUp(false);
      setWarmupModel('');
    }
  };

  const handlePowerModeToggle = async () => {
    try {
      if (powerMode) {
        await window.electronAPI?.disablePowerMode?.();
      } else {
        await window.electronAPI?.enablePowerMode?.();
      }
      setPowerMode(!powerMode);
    } catch (error) {
      console.error('Failed to toggle power mode:', error);
    }
  };

  const handleBackendChange = async (newBackend) => {
    try {
      await setPreferredBackend?.(newBackend);
      await refreshRuntimeState();
    } catch (error) {
      console.error('Failed to change backend:', error);
    }
  };

  const handleProfileChange = async (value) => {
    try {
      await setPerformanceProfile?.(value);
      await refreshRuntimeState();
    } catch (error) {
      console.error('Failed to change performance profile:', error);
    }
  };

  const handleHybridToggle = async (modeId) => {
    setHybridLoading(true);
    try {
      if (modeId) {
        const result = await window.electronAPI?.enableHybridMode?.(modeId);
        if (result?.setupRequired) {
          // eslint-disable-next-line no-alert
          alert('OpenVINO is not installed. Please run OpenVINO Setup in the Hardware tab first.');
        } else if (result?.success) {
          setHybridStatus({ enabled: true, mode: modeId, device: result.device || 'HETERO:GPU,NPU' });
          await setPreferredBackend?.('openvino-hybrid');
          if (result.modelError) {
            // eslint-disable-next-line no-alert
            alert(`Unified Brain is active, but model needs attention: ${result.modelError}`);
          }
        } else {
          // eslint-disable-next-line no-alert
          alert(`Failed to enable Unified Brain: ${result?.error || 'Unknown error'}`);
        }
      } else {
        const result = await window.electronAPI?.disableHybridMode?.();
        if (result?.success) {
          setHybridStatus({ enabled: false, mode: null, device: null });
          await setPreferredBackend?.('ollama-cuda');
        }
      }
      await refreshHardwareStatus(true);
    } catch (error) {
      console.error('Failed to toggle hybrid mode:', error);
      // eslint-disable-next-line no-alert
      alert(`Hybrid toggle failed: ${error.message || error}`);
    } finally {
      setHybridLoading(false);
    }
  };

  const handleLaptopDailyTune = async () => {
    setLaptopBusy(true);
    try {
      const targetProfile = 'laptop';
      await setPerformanceProfile?.(targetProfile);

      const caps = await window.electronAPI?.getHybridCapabilities?.();
      if (caps?.canHetero) {
        const hybridResult = await window.electronAPI?.enableHybridMode?.('hetero-gpu-npu');
        if (hybridResult?.success) {
          setHybridStatus({ enabled: true, mode: 'hetero-gpu-npu', device: 'HETERO:GPU,NPU' });
          await setPreferredBackend?.('openvino-hybrid');
        }
      } else {
        await setPreferredBackend?.('openvino-npu');
      }

      let status = await refreshNpuStatus(true);
      let configResult = null;
      if (status?.openvinoInstalled && status?.npuAvailable && window.electronAPI?.autoConfigureNpuModel) {
        configResult = await window.electronAPI.autoConfigureNpuModel({
          enableAutoStart: false,
          workload: 'chat',
          profile: targetProfile,
          forceReconfigure: true,
          forceStatusRefresh: true,
          maxModelSizeB: 3,
          targetModelSizeB: 1.5,
        });
      }

      if (status?.openvinoInstalled && status?.npuAvailable && !status?.serverRunning && window.electronAPI?.startNpuServer) {
        const device = caps?.canHetero ? 'HETERO:GPU,NPU' : 'NPU';
        await window.electronAPI.startNpuServer({ device });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await window.electronAPI?.clearNpuCache?.();
        await window.electronAPI?.clearHardwareCache?.();
        status = await refreshNpuStatus(true);
      }

      await refreshRuntimeState();
      const selectedModel = configResult?.model || 'unchanged';
      const brainMode = caps?.canHetero ? 'Unified Brain (Intel GPU+NPU)' : 'NPU';
      // eslint-disable-next-line no-alert
      alert(
        `Laptop Daily Driver profile applied.\n\n` +
          `Profile: laptop\n` +
          `Mode: ${brainMode}\n` +
          `NPU: ${status?.npuAvailable ? 'available' : 'not detected'}\n` +
          `Server: ${status?.serverRunning ? 'running' : 'not running'}\n` +
          `NPU model: ${selectedModel}`
      );
    } catch (error) {
      console.error('Failed to apply laptop profile:', error);
      // eslint-disable-next-line no-alert
      alert(`Laptop tune-up failed: ${error.message || error}`);
    } finally {
      setLaptopBusy(false);
    }
  };

  const handleRunBenchmark = async () => {
    if (!currentModel || benchmarkRunning) return;
    if (!window.electronAPI?.runLlmBenchmark) return;
    setBenchmarkRunning(true);
    setBenchmarkResult(null);
    try {
      const result = await window.electronAPI.runLlmBenchmark({
        model: currentModel,
        samples: 3,
        lane: 'lane_maintenance',
        numPredict: 96,
        numCtx: 4096,
        prompt: 'Write one concise sentence about local AI coding assistants.',
      });
      setBenchmarkResult(result || null);
      await refreshRuntimeState();
    } catch (error) {
      setBenchmarkResult({ ok: false, error: error.message || 'Benchmark failed' });
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const handleNpuOptimize = async () => {
    if (!window.electronAPI?.getNpuStatus) {
      console.error('NPU API not available');
      return;
    }

    const formatSetupFailure = (result) => {
      const stderrTail = String(result?.stderr || '')
        .trim()
        .split(/\r?\n/)
        .slice(-8)
        .join('\n');
      const stdoutTail = String(result?.stdout || '')
        .trim()
        .split(/\r?\n/)
        .slice(-4)
        .join('\n');
      const diagnosticText = result?.diagnostics
        ? `\n\nDiagnostics: ${JSON.stringify(result.diagnostics)}`
        : '';
      const scriptText = result?.scriptPath
        ? `\nScript: ${result.scriptPath}`
        : '';
      const stderrText = stderrTail ? `\n\nstderr tail:\n${stderrTail}` : '';
      const stdoutText = stdoutTail ? `\n\nstdout tail:\n${stdoutTail}` : '';
      return `${result?.error || 'Unknown error'}${scriptText}${diagnosticText}${stderrText}${stdoutText}`;
    };

    const runOpenVinoSetup = async () => {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        'DevForge will now set up Intel NPU acceleration. This includes:\n\n' +
          '- Installing OpenVINO runtime\n' +
          '- Configuring the NPU inference server\n' +
          '- Auto-selecting an optimized model\n\n' +
          'This may take a few minutes. Continue?',
      );
      if (!ok) {
        return { success: false, cancelled: true };
      }

      const result = await window.electronAPI.setupNpu();
      if (!result?.success) {
        // eslint-disable-next-line no-alert
        alert(
          `OpenVINO setup did not complete.\n\nYou can still use CPU / GPU backends.\n\nDetails: ${formatSetupFailure(result)}`,
        );
        return { success: false, cancelled: false };
      }

      await window.electronAPI?.clearNpuCache?.();
      await window.electronAPI?.clearHardwareCache?.();
      return { success: true, cancelled: false };
    };

    console.log('[NPU Optimize] Starting NPU start/setup flow...');
    setNpuBusy(true);

    try {
      await window.electronAPI?.clearNpuCache?.();
      await window.electronAPI?.clearHardwareCache?.();
      let status = await refreshNpuStatus(true);
      console.log('[NPU Optimize] Initial status:', status);

      // Step 1: Install OpenVINO only when it is actually missing.
      if (!status?.openvinoInstalled || status.setupRequired) {
        const setupResult = await runOpenVinoSetup();
        if (setupResult.cancelled) {
          return;
        }
        if (!setupResult.success) {
          return;
        }

        status = await refreshNpuStatus(true);
        console.log('[NPU Optimize] Status after setup:', status);
      }

      if (!status?.openvinoInstalled) {
        // eslint-disable-next-line no-alert
        alert('OpenVINO is still not detected after setup. Please restart DevForge and try again.');
        return;
      }

      if (!status?.npuAvailable) {
        const devices = Array.isArray(status?.devices) ? status.devices.map((d) => d?.id).filter(Boolean) : [];
        const deviceText = devices.length ? `\n\nDetected devices: ${devices.join(', ')}` : '';
        // eslint-disable-next-line no-alert
        alert(
          `OpenVINO is installed, but no NPU device is currently available.${deviceText}\n\n` +
            'You can still use CPU / GPU backends.',
        );
        return;
      }

      // Step 2: Keep model configuration best-effort and non-blocking.
      if (window.electronAPI.autoConfigureNpuModel) {
        try {
          console.log('[NPU Optimize] Auto-configuring NPU model...');
          const configResult = await window.electronAPI.autoConfigureNpuModel({
            enableAutoStart: true,
            workload: 'chat',
            profile,
            forceReconfigure: true,
            forceStatusRefresh: true,
          });
          console.log('[NPU Optimize] Model config result:', configResult);
        } catch (configError) {
          console.warn('[NPU Optimize] Auto-configure skipped:', configError);
        }
      }

      // Step 3: Restart only when already running; otherwise start.
      if (status?.serverRunning && window.electronAPI.stopNpuServer) {
        console.log('[NPU Optimize] Restart requested - stopping current server first...');
        await window.electronAPI.stopNpuServer();
        await new Promise((resolve) => setTimeout(resolve, 800));
        status = await refreshNpuStatus(true);
      }

      if (!status?.serverRunning && window.electronAPI.startNpuServer) {
        const startDevice = hybridStatus?.enabled ? (hybridStatus.device || 'HETERO:GPU,NPU') : 'NPU';
        console.log('[NPU Optimize] Starting NPU server with device:', startDevice);
        let serverResult = await window.electronAPI.startNpuServer({
          device: startDevice,
        });
        console.log('[NPU Optimize] Server start result:', serverResult);

        if (!serverResult?.success && (serverResult?.setupRequired || /OpenVINO/i.test(String(serverResult?.error || '')))) {
          const setupResult = await runOpenVinoSetup();
          if (setupResult.success) {
            await window.electronAPI?.clearNpuCache?.();
            await window.electronAPI?.clearHardwareCache?.();
            serverResult = await window.electronAPI.startNpuServer({ device: startDevice });
            console.log('[NPU Optimize] Server start retry result:', serverResult);
          }
        }

        if (!serverResult?.success) {
          const startDetails = String(serverResult?.error || 'Unknown error')
            .trim()
            .split(/\r?\n/)
            .slice(-8)
            .join('\n');
          // eslint-disable-next-line no-alert
          alert(
            `NPU server failed to start.\n\nDetails:\n${startDetails}\n\nYou can still use CPU / GPU backends.`
          );
          setNpuBusy(false);
          return;
        }

        // Wait a moment for server to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await window.electronAPI?.clearNpuCache?.();
        await window.electronAPI?.clearHardwareCache?.();
        status = await refreshNpuStatus(true);
        console.log('[NPU Optimize] Status after server start:', status);
      }

      status = await refreshNpuStatus(true);
      await refreshRuntimeState();

      // Step 4: Switch backend routing to NPU and report final status.
      if (status?.serverRunning) {
        // Actually switch to the NPU backend so inference routes there
        try {
          await setPreferredBackend?.('openvino-npu');
          await refreshRuntimeState();
        } catch (switchErr) {
          console.warn('[NPU Optimize] Backend switch error (non-fatal):', switchErr);
        }
        // eslint-disable-next-line no-alert
        alert(
          'NPU is now active!\n\n' +
            '[OK] OpenVINO installed\n' +
            '[OK] NPU server running\n' +
            '[OK] NPU device detected\n' +
            '[OK] Backend switched to OpenVINO NPU\n\n' +
            'Your next chat will run on the NPU. To go back to Ollama+GPU, change the Backend dropdown to "Standard (Ollama + GPU)".',
        );
      } else if (status?.npuAvailable) {
        // eslint-disable-next-line no-alert
        alert('NPU is detected but server failed to start. Check the diagnostics or try again.');
      } else {
        // eslint-disable-next-line no-alert
        alert('NPU is not detected on this system. Using GPU/CPU backends instead.');
      }
    } catch (error) {
      console.error('Failed to optimize NPU:', error);
      // eslint-disable-next-line no-alert
      alert(`NPU optimization failed: ${error.message || error}`);
    } finally {
      setNpuBusy(false);
    }
  };

  const queueState = runtimeState?.queue || {};
  const lanes = queueState?.lanes || {};
  const evidenceRows = Array.isArray(runtimeState?.offloadEvidence) ? runtimeState.offloadEvidence : [];
  const recentEvidence = evidenceRows.slice(-4).reverse();
  const verifiedEvidenceCount = evidenceRows.filter((row) => row?.verified).length;
  const runtimeBackend = runtimeState?.currentBackend?.id || backend || 'auto';
  const preferredBackend = runtimeState?.preferredBackendId || backend || 'auto';
  const lastBackendDecision = runtimeState?.lastBackendDecision || null;
  const backendAligned = preferredBackend === 'auto' || preferredBackend === runtimeBackend;
  const primaryRejectedCandidate = Array.isArray(lastBackendDecision?.rejectedCandidates)
    ? lastBackendDecision.rejectedCandidates[0]
    : null;
  const npuActionLabel = npuBusy
    ? 'Activating...'
    : npuStatus?.openvinoInstalled === false
      ? 'Install OpenVINO + Activate'
      : (backend === 'openvino-npu' && npuStatus?.serverRunning)
        ? 'Restart NPU'
        : 'Activate NPU';
  const npuDeviceLabel = npuStatus?.openvinoInstalled === false
    ? 'Pending OpenVINO setup'
    : npuStatus?.npuAvailable === true
      ? 'Detected'
      : npuStatus?.error
        ? 'Unavailable (check diagnostics)'
        : 'Not detected';
  const activeLaneLabels = Object.entries(lanes)
    .filter(([, laneInfo]) => Number(laneInfo?.active || 0) > 0 || Number(laneInfo?.queued || 0) > 0)
    .map(([laneName, laneInfo]) => `${laneName.replace('lane_', '')}: ${laneInfo.active || 0}/${laneInfo.queued || 0}`);
  const backendOptions = React.useMemo(() => {
    const labelById = {
      'ollama-cuda': 'Standard (Ollama + GPU)',
      'llamacpp-spark': 'Unified Brain (Spark)',
      'openvino-hybrid': 'Unified Brain (Intel GPU+NPU)',
      'llamacpp-vulkan': 'Vulkan (Intel Arc)',
      'openvino-npu': 'OpenVINO NPU Only',
      'ollama-cpu': 'CPU Only (Fallback)',
    };
    const rows = Array.isArray(backends) ? backends : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const preferredOrder = ['ollama-cuda', 'llamacpp-spark', 'openvino-hybrid', 'llamacpp-vulkan', 'openvino-npu', 'ollama-cpu'];
    const orderedIds = [
      ...preferredOrder.filter((id) => byId.has(id)),
      ...rows.map((row) => row.id).filter((id) => !preferredOrder.includes(id)),
    ];
    const options = orderedIds.map((id) => {
      const row = byId.get(id) || {};
      return {
        id,
        label: labelById[id] || row.name || id,
        available: row.available !== false,
      };
    });

    if (backend && !options.some((option) => option.id === backend)) {
      options.unshift({
        id: backend,
        label: labelById[backend] || backend,
        available: false,
      });
    }

    if (options.length > 0) {
      let filtered = options.filter((option) => hybridCaps?.canHetero || option.id !== 'openvino-hybrid');
      if (isSparkHardware) {
        filtered = filtered.filter((o) =>
          !['openvino-hybrid', 'openvino-npu', 'llamacpp-vulkan'].includes(o.id),
        );
      }
      return filtered;
    }

    const intelFallback = [];
    if (!isSparkHardware && hybridCaps?.canHetero) {
      intelFallback.push({ id: 'openvino-hybrid', label: labelById['openvino-hybrid'], available: true });
    }
    if (!isSparkHardware) {
      intelFallback.push(
        { id: 'llamacpp-vulkan', label: labelById['llamacpp-vulkan'], available: true },
        { id: 'openvino-npu', label: labelById['openvino-npu'], available: true },
      );
    }
    return [
      { id: 'ollama-cuda', label: labelById['ollama-cuda'], available: true },
      ...(isSparkHardware ? [{ id: 'llamacpp-spark', label: labelById['llamacpp-spark'], available: true }] : []),
      ...intelFallback,
      { id: 'ollama-cpu', label: labelById['ollama-cpu'], available: true },
    ];
  }, [backend, backends, hybridCaps, sparkProbe, isSparkHardware]);

  const HardwareIcon = hardwareProfile.icon;

  return (
    <div className="space-y-6">
      <div className={`rounded-xl border p-4 ${hardwareProfile.shell}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className={`rounded-xl border p-2 ${hardwareProfile.pill}`}>
                <HardwareIcon size={18} />
              </div>
              <div>
                <h3 className={`text-sm font-semibold ${hardwareProfile.title}`}>
                  Hardware Profile: {hardwareProfile.label}
                </h3>
                <p className={`mt-0.5 text-[11px] ${hardwareProfile.muted}`}>
                  Accent: {hardwareProfile.accentName} · Auto-detected from local hardware and runtime probes
                </p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${hardwareProfile.pill}`}>
                {hardwareProfile.shortLabel}
              </span>
            </div>
            <p className={`mt-3 max-w-3xl text-xs leading-5 ${hardwareProfile.text}`}>
              {hardwareProfile.description}
            </p>
            {isSparkHardware && (
              <div className="mt-3 grid gap-2 text-[11px] text-[#d8ffb0]/70 sm:grid-cols-3">
                <div className="rounded-lg border border-[#76b900]/20 bg-black/20 px-3 py-2">
                  <div className="text-[#d8ffb0]/45">Unified Memory</div>
                  <div className="font-medium text-[#d8ffb0]">
                    {sparkProbe?.unifiedMemoryGiB ? `${Number(sparkProbe.unifiedMemoryGiB).toFixed(1)} GiB` : 'Detecting'}
                  </div>
                </div>
                <div className="rounded-lg border border-[#76b900]/20 bg-black/20 px-3 py-2">
                  <div className="text-[#d8ffb0]/45">Available Now</div>
                  <div className="font-medium text-[#d8ffb0]">
                    {sparkProbe?.memAvailableGiB ? `${Number(sparkProbe.memAvailableGiB).toFixed(1)} GiB` : 'Detecting'}
                  </div>
                </div>
                <div className="rounded-lg border border-[#76b900]/20 bg-black/20 px-3 py-2">
                  <div className="text-[#d8ffb0]/45">Runtime Policy</div>
                  <div className="font-medium text-[#d8ffb0]">MoE-safe Spark</div>
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRunSparkProbe}
              disabled={sparkProbeBusy}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${hardwareProfile.button} disabled:opacity-50`}
            >
              {sparkProbeBusy ? 'Detecting...' : 'Auto Detect'}
            </button>
            {isSparkHardware && profile !== 'spark' && (
              <button
                type="button"
                onClick={() => handleProfileChange('spark')}
                className="rounded-lg border border-[#76b900]/30 bg-[#76b900]/20 px-3 py-2 text-xs font-medium text-[#d8ffb0] transition hover:bg-[#76b900]/30"
              >
                Apply Spark Profile
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border border-forge-border rounded-lg bg-forge-bg/40">
        <h3 className="text-sm font-medium text-text-primary mb-2">System Health Overview</h3>
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Ollama</span>
            <span className={ollamaStatus?.running ? 'text-status-success' : 'text-status-error'}>
              {ollamaStatus?.running ? 'Running' : 'Not running'}
            </span>
          </div>
          {intelAcceleratorRelevant ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">NPU Server</span>
            <span className={npuStatus?.serverRunning ? 'text-status-success' : 'text-status-warning'}>
              {npuStatus?.serverRunning ? 'Online' : 'Offline'}
            </span>
          </div>
          ) : null}
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Routing</span>
            <span className={backendAligned ? 'text-status-success' : 'text-status-warning'}>
              {runtimeBackend}
              {!backendAligned ? ` (fallback from ${preferredBackend})` : ''}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Image Backend</span>
            <span className={imageStatus?.running ? 'text-status-success' : 'text-status-error'}>
              {imageStatus?.running ? 'Running' : 'Not running'}
            </span>
          </div>
        </div>
      </div>

            {/* GPU Preload Section */}
      <div className="p-4 bg-gradient-to-br from-purple-500/5 to-blue-500/5 border border-purple-500/20 rounded-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Zap size={16} className="text-purple-400" />
              Model Warmup
            </h3>
            <p className="text-xs text-text-muted mt-1">
              {currentModel
                ? `Warm up "${currentModel}" in the active runtime for a faster first response`
                : 'Select a model first to warm it up'}
            </p>
            {runningModels.length > 0 && (
              <div className="mt-2 text-[11px] text-status-success">
                {verifiedEvidenceCount > 0
                  ? `Verified offload records: ${verifiedEvidenceCount}`
                  : `${runningModels.length} model(s) currently resident in runtime`}
              </div>
            )}
            {warmupReport && (
              <div className={`mt-2 text-[11px] ${warmupReport.success ? 'text-status-success' : 'text-status-warning'}`}>
                {warmupReport.success
                  ? `Last warmup: ${warmupReport.model || warmupModel || 'model'} on ${warmupReport.backend || runtimeBackend}`
                  : `Last warmup reason: ${warmupReport.fallbackReason || warmupReport.error || 'not verified'}`}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleWarmupModel(currentModel)}
            disabled={warmingUp || !currentModel || (!/^npu:/i.test(String(currentModel || '')) && !ollamaStatus?.running)}
            className="btn btn-primary whitespace-nowrap text-xs flex items-center gap-2"
          >
            {warmingUp ? (
              <>
                <Loader size={14} className="animate-spin" />
                Loading to GPU...
              </>
            ) : (
              <>
                <Zap size={14} />
                Preload to GPU
              </>
            )}
          </button>
        </div>
        {warmupReport?.offloadEvidence && (
          <div className="mt-3 pt-3 border-t border-purple-500/20 text-[11px] text-text-muted">
            <div className="flex items-center justify-between">
              <span>Offload evidence method</span>
              <span className="text-text-primary">{warmupReport.offloadEvidence.method || 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span>VRAM committed</span>
              <span className={warmupReport.offloadEvidence.verified ? 'text-status-success' : 'text-status-warning'}>
                {formatBytes(warmupReport.offloadEvidence.sizeVram || 0)}
              </span>
            </div>
          </div>
        )}
        {availableModels.length > 0 && !currentModel && (
          <div className="mt-3 pt-3 border-t border-purple-500/20">
            <p className="text-xs text-text-muted mb-2">Quick preload:</p>
            <div className="flex flex-wrap gap-2">
              {availableModels.slice(0, 4).map(model => (
                <button
                  key={model.name || model}
                  onClick={() => handleWarmupModel(model.name || model)}
                  disabled={warmingUp}
                  className="text-[11px] px-2 py-1 bg-forge-bg border border-forge-border rounded hover:border-purple-500/50 transition-colors"
                >
                  {(model.name || model).split(':')[0]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Acceleration Evidence */}
      <div className="p-4 border border-forge-border rounded-lg bg-forge-bg/40 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-text-primary">Acceleration Evidence</h3>
            <p className="text-xs text-text-muted mt-1">
              Runtime truth for backend routing, lane activity, and verified offload.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await refreshRuntimeState();
              if (intelAcceleratorRelevant) {
                await refreshNpuStatus(true);
              }
            }}
            className="text-xs px-2 py-1 rounded border border-forge-border hover:border-workspace-code/50"
          >
            Refresh
          </button>
        </div>

        <div className="grid gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Preferred backend</span>
            <span className="text-text-primary">{preferredBackend}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Active backend</span>
            <span className={backendAligned ? 'text-status-success' : 'text-status-warning'}>{runtimeBackend}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Alignment</span>
            <span className={backendAligned ? 'text-status-success' : 'text-status-warning'}>
              {backendAligned ? 'aligned' : 'fallback active'}
            </span>
          </div>
          {lastBackendDecision && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Last selection source</span>
              <span className="text-text-primary">
                {lastBackendDecision.selectionSource || 'auto'}
              </span>
            </div>
          )}
          {lastBackendDecision?.fallbackReason && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Fallback reason</span>
              <span className="text-status-warning text-right max-w-[60%] truncate" title={lastBackendDecision.fallbackReason}>
                {lastBackendDecision.fallbackReason}
              </span>
            </div>
          )}
          {primaryRejectedCandidate && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Top rejected candidate</span>
              <span
                className="text-status-warning text-right max-w-[60%] truncate"
                title={`${primaryRejectedCandidate.backendId || 'backend'}: ${
                  primaryRejectedCandidate.reason || primaryRejectedCandidate.error || 'unavailable'
                }`}
              >
                {(primaryRejectedCandidate.backendId || 'backend')}: {primaryRejectedCandidate.reason || 'unavailable'}
              </span>
            </div>
          )}
          {lastBackendDecision?.lane && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Last lane</span>
              <span className="text-text-primary">{String(lastBackendDecision.lane).replace('lane_', '')}</span>
            </div>
          )}
          {lastBackendDecision?.model && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Last model request</span>
              <span className="text-text-primary text-right max-w-[60%] truncate" title={lastBackendDecision.model}>
                {lastBackendDecision.model}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Queue (active / queued)</span>
            <span className="text-text-primary">{queueState.active || 0} / {queueState.queued || 0}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Lanes in use</span>
            <span className="text-text-primary text-right max-w-[60%] truncate" title={activeLaneLabels.join(', ')}>
              {activeLaneLabels.length > 0 ? activeLaneLabels.join(', ') : 'idle'}
            </span>
          </div>
          {runtimeState?.deviceUtilization?.cpu && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">CPU load</span>
              <span className="text-text-primary">{Math.round(runtimeState.deviceUtilization.cpu.usage || 0)}%</span>
            </div>
          )}
          {runtimeState?.deviceUtilization?.memory && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">RAM usage</span>
              <span className="text-text-primary">{Math.round(runtimeState.deviceUtilization.memory.usagePercent || 0)}%</span>
            </div>
          )}
          {Array.isArray(runtimeState?.deviceUtilization?.gpus) && runtimeState.deviceUtilization.gpus.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">GPU load (top)</span>
              <span className="text-text-primary">
                {Math.round(Math.min(100, Number(runtimeState.deviceUtilization.gpus[0]?.utilizationGpu || 0)))}%
                {' '}
                / VRAM {Math.round(Math.min(100, Number(runtimeState.deviceUtilization.gpus[0]?.vramPercent || 0)))}%
              </span>
            </div>
          )}
          {intelAcceleratorRelevant && runtimeState?.deviceUtilization?.npu && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">NPU state</span>
              <span className={runtimeState.deviceUtilization.npu.serverRunning ? 'text-status-success' : 'text-status-warning'}>
                {runtimeState.deviceUtilization.npu.serverRunning
                  ? (runtimeState.deviceUtilization.npu.modelLoaded ? 'online (model loaded)' : 'online (idle)')
                  : 'offline'}
              </span>
            </div>
          )}
        </div>

        {recentEvidence.length > 0 && (
          <div className="space-y-2">
            {recentEvidence.map((row) => (
              <div key={row.key || `${row.model}-${row.checkedAt}`} className="p-2 rounded border border-forge-border/50 bg-forge-bg/50 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-primary truncate">{row.model || 'unknown model'} @ {row.backend || 'backend'}</span>
                  <span className={row.verified ? 'text-status-success' : 'text-status-warning'}>
                    {row.verified ? 'verified' : 'unverified'}
                  </span>
                </div>
                <div className="text-text-muted mt-1">
                  method: {row.method || 'n/a'}
                  {Number(row.sizeVram || 0) > 0 ? ` | VRAM: ${formatBytes(row.sizeVram)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-forge-border/50">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleRunBenchmark}
              disabled={!currentModel || benchmarkRunning || (!/^npu:/i.test(String(currentModel || '')) && !ollamaStatus?.running)}
              className="btn btn-secondary text-xs"
            >
              {benchmarkRunning ? 'Benchmarking...' : 'Run Benchmark'}
            </button>
            {benchmarkResult?.ok && (
              <span className="text-xs text-status-success">
                avg {benchmarkResult.avgLatencyMs || '?'} ms | {benchmarkResult.avgTokensPerSecond || '?'} tok/s
              </span>
            )}
            {benchmarkResult && !benchmarkResult.ok && (
              <span className="text-xs text-status-warning">
                {benchmarkResult.error || 'Benchmark failed'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Power Mode Toggle */}
      <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Zap size={16} className={powerMode ? 'text-workspace-casual' : 'text-text-muted'} />
              Power Mode
            </h3>
            <p className="text-xs text-text-muted mt-1">
              Optimize system for maximum AI performance
            </p>
          </div>
          <button
            onClick={handlePowerModeToggle}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              powerMode ? 'bg-workspace-casual' : 'bg-forge-elevated'
            }`}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                powerMode ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {powerMode && (
          <div className="mt-3 pt-3 border-t border-forge-border text-xs text-text-muted">
            <p>Active optimizations:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>Process priority set to HIGH</li>
              <li>Sleep prevention during inference</li>
              <li>GPU performance mode enabled</li>
            </ul>
          </div>
        )}
      </div>

      {/* Backend Selection */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Inference Backend</h3>
        <select
          value={backend}
          onChange={(e) => handleBackendChange(e.target.value)}
          className={`input w-full ${hardwareProfile.focus}`}
        >
          <option value="ollama-cuda">Standard (Ollama + GPU)</option>
          {isSparkHardware ? (
            <option value="llamacpp-spark">Unified Brain (Spark)</option>
          ) : null}
          {intelAcceleratorRelevant && hybridCaps?.canHetero ? (
          <option value="openvino-hybrid">Unified Brain (Intel GPU+NPU) — Experimental</option>
          ) : null}
          {intelAcceleratorRelevant ? (
            <>
              <option value="llamacpp-vulkan">Vulkan (Intel Arc)</option>
              <option value="openvino-npu">OpenVINO NPU Only</option>
            </>
          ) : null}
          <option value="ollama-cpu">CPU Only (Fallback)</option>
        </select>
        <p className="text-[11px] text-text-muted mt-1">
          Runtime detected {backendOptions.filter((option) => option.available).length} available backend(s).
        </p>
        <p className="text-xs text-text-muted mt-2">
          Standard mode loads models into GPU VRAM via Ollama — reliable and fast.
          {!isSparkHardware && hybridCaps?.canHetero
            ? ' Unified Brain (Intel) is experimental and splits one model across GPU + NPU as a single pipeline.'
            : isSparkHardware
              ? ' On Spark you get unified-memory telemetry with MoE-aware guardrails; Intel NPU and OpenVINO are hidden because they don’t apply.'
              : ''}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Performance Profile</h3>
        <select
          value={profile}
          onChange={(e) => handleProfileChange(e.target.value)}
          disabled={profileLoading}
          className={`input w-full ${hardwareProfile.focus}`}
        >
          {intelAcceleratorRelevant ? (
            <option value="laptop">Laptop Daily Driver (Hybrid GPU + NPU)</option>
          ) : null}
          <option value="spark">Spark Unified Brain (NVIDIA GB10)</option>
          <option value="speed">{intelAcceleratorRelevant ? 'Speed (Prefer GPU/NPU)' : 'Speed (CUDA / unified memory)'}</option>
          <option value="balanced">Balanced</option>
          {intelAcceleratorRelevant ? (
            <option value="efficiency">Efficiency (Prefer NPU/CPU)</option>
          ) : null}
        </select>
        <p className="text-xs text-text-muted mt-2">
          Profiles influence how DevForge schedules work across all backends and how the job queue
          prioritizes requests.
        </p>
        {intelAcceleratorRelevant ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={handleLaptopDailyTune}
            disabled={laptopBusy || profileLoading}
            className="btn btn-secondary text-xs"
          >
            {laptopBusy ? 'Applying laptop profile...' : 'Apply Laptop Daily Driver Tune-Up'}
          </button>
        </div>
        ) : null}
      </div>

      {(isSparkHardware || profile === 'spark') && (
        <div className="rounded-lg border border-[#76b900]/25 bg-[#76b900]/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-[#d8ffb0]">Spark Runtime Alignment</h3>
              <p className="mt-1 text-xs leading-5 text-[#d8ffb0]/70">
                DevForge detected NVIDIA Spark-style unified memory. MoE-safe guardrails are active:
                ctx 4096 for heavy MoE loads, q4_0 KV cache, one loaded model, and live unified-memory telemetry.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#d8ffb0]/65">
                <span>GPU: {sparkProbe?.gpuName || 'NVIDIA GB10'}</span>
                {sparkProbe?.memAvailableGiB ? <span>Available: {Number(sparkProbe.memAvailableGiB).toFixed(1)} GiB</span> : null}
                {sparkProbe?.unifiedMemoryGiB ? <span>Unified: {Number(sparkProbe.unifiedMemoryGiB).toFixed(1)} GiB</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={handleRunSparkProbe}
              disabled={sparkProbeBusy}
              className="shrink-0 rounded-lg border border-[#76b900]/30 bg-[#76b900]/15 px-3 py-2 text-xs font-medium text-[#d8ffb0] transition hover:bg-[#76b900]/25 disabled:opacity-50"
            >
              {sparkProbeBusy ? 'Probing...' : 'Run Spark Probe'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-forge-border bg-forge-bg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text-primary">Auto-warm last model on launch</h3>
            <p className="mt-1 text-xs text-text-muted">
              When enabled, DevForge will preload the last-used model into your runtime when the
              app starts. Default is OFF — most setups feel snappier when the model loads on the
              first chat instead of at launch. Use the top-bar Eject anytime to free the model.
            </p>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 select-none">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-cyan-500"
              checked={autoWarmupOnLaunch}
              onChange={(e) => handleToggleAutoWarmupOnLaunch(e.target.checked)}
            />
            <span className="text-xs text-text-secondary">{autoWarmupOnLaunch ? 'On' : 'Off'}</span>
          </label>
        </div>
      </div>

      {/* NPU One-Click Setup — Intel / OpenVINO only */}
      {intelAcceleratorRelevant ? (
      <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              Intel NPU Acceleration
              {backend === 'openvino-npu' && npuStatus?.serverRunning ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-success/20 text-status-success font-medium">ACTIVE</span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-warning/20 text-status-warning font-medium">STANDBY</span>
              )}
            </h3>
            <p className="text-xs text-text-muted mt-1">
              {backend === 'openvino-npu' && npuStatus?.serverRunning
                ? 'NPU is handling AI inference. Use the Backend dropdown above to switch back to Ollama+GPU.'
                : 'Click "Start NPU" to launch the NPU server and switch inference to the NPU chip. DevForge handles everything automatically.'}
            </p>
            {npuStatus && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${npuStatus.openvinoInstalled === true ? 'bg-status-success' : npuStatus.openvinoInstalled === false ? 'bg-status-error' : 'bg-status-warning'}`} />
                  <span className="text-text-muted">
                    OpenVINO:{' '}
                    {npuStatus.openvinoInstalled === true
                      ? `Installed (${npuStatus.openvinoVersion || 'env'})`
                      : npuStatus.openvinoInstalled === false
                        ? 'Not installed'
                        : 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${
                    npuStatus.openvinoInstalled === false
                      ? 'bg-status-warning'
                      : npuStatus.npuAvailable === true
                        ? 'bg-status-success'
                        : 'bg-status-warning'
                  }`} />
                  <span className="text-text-muted">
                    NPU Device: {npuDeviceLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${npuStatus.serverRunning === true ? 'bg-status-success' : 'bg-status-error'}`} />
                  <span className="text-text-muted">Server: {npuStatus.serverRunning === true ? 'Running on port 8081' : 'Not running'}</span>
                </div>
                {npuStatus.devices?.length > 0 && (
                  <div className="text-[11px] text-text-muted mt-1">
                    Available devices: {npuStatus.devices.map(d => d.id).join(', ')}
                  </div>
                )}
                {npuStatus.diagnostics?.pythonExecutable && (
                  <div
                    className="text-[10px] text-neutral-500 mt-1 font-mono truncate max-w-full"
                    title={npuStatus.diagnostics.pythonExecutable}
                  >
                    Python: {npuStatus.diagnostics.pythonExecutable}
                  </div>
                )}
                {npuStatus.error && (
                  <div className={`text-[11px] mt-1 ${npuStatus.openvinoInstalled === false ? 'text-status-warning' : 'text-status-error'}`}>
                    {npuStatus.openvinoInstalled === false ? 'Setup required' : 'Error'}: {npuStatus.error}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[11rem] sm:items-end">
            <button
              type="button"
              onClick={handleNpuOptimize}
              disabled={npuBusy}
              className="btn btn-primary w-full sm:w-auto whitespace-nowrap text-xs"
            >
              {npuActionLabel}
            </button>
            {npuStatus?.serverRunning && (
              <button
                type="button"
                onClick={async () => {
                  await window.electronAPI?.stopNpuServer();
                  await window.electronAPI?.clearNpuCache?.();
                  await window.electronAPI?.clearHardwareCache?.();
                  await refreshNpuStatus(true);
                }}
                className="btn btn-secondary w-full sm:w-auto whitespace-nowrap text-xs"
              >
                Stop Server
              </button>
            )}
          </div>
        </div>
      </div>
      ) : null}

      {/* Unified Brain Mode (Intel Hybrid GPU+NPU) */}
      {intelAcceleratorRelevant && hybridCaps?.available && (
        <div className="p-4 bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/25 rounded-lg space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Brain size={16} className={hybridStatus?.enabled ? 'text-violet-400' : 'text-text-muted'} />
                Unified Brain (Intel) Mode
              </h3>
              <p className="text-xs text-text-muted mt-1">
                {hybridCaps?.canHetero
                  ? 'One model split across GPU + NPU as a single inference pipeline. Two chips, one brain.'
                  : 'Auto-route inference to the best available device.'}
              </p>
              {hybridStatus?.enabled && (
                <div className="mt-2 text-[11px] text-violet-300">
                  Active: {hybridStatus.device || 'HETERO:GPU,NPU'}
                  {hybridStatus.mode ? ` (${hybridStatus.mode})` : ''}
                </div>
              )}
            </div>
            <button
              onClick={() => hybridStatus?.enabled ? handleHybridToggle(null) : handleHybridToggle('hetero-gpu-npu')}
              disabled={hybridLoading}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                hybridStatus?.enabled ? 'bg-violet-500' : 'bg-forge-elevated'
              } ${hybridLoading ? 'opacity-50' : ''}`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  hybridStatus?.enabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {hybridCaps?.devices?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {hybridCaps.devices.map((d) => (
                <span
                  key={d.id}
                  className="text-[10px] px-2 py-0.5 rounded border border-violet-500/20 bg-violet-500/10 text-violet-300"
                >
                  {d.id}{d.name ? ` — ${d.name}` : ''}
                </span>
              ))}
            </div>
          )}

          {/* Advanced modes accordion */}
          {hybridCaps?.modes?.length > 1 && (
            <div>
              <button
                type="button"
                onClick={() => setHybridAdvanced(!hybridAdvanced)}
                className="text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
              >
                <span className={`transform transition-transform ${hybridAdvanced ? 'rotate-90' : ''}`}>&#9654;</span>
                Advanced device modes
              </button>
              {hybridAdvanced && (
                <div className="mt-2 space-y-2">
                  {hybridCaps.modes.map((mode) => (
                    <div
                      key={mode.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        hybridStatus?.mode === mode.id
                          ? 'border-violet-500/40 bg-violet-500/10'
                          : 'border-forge-border bg-forge-bg/50 hover:border-violet-500/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-primary">{mode.label}</span>
                            {mode.recommended && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">recommended</span>
                            )}
                          </div>
                          <p className="text-[11px] text-text-muted mt-0.5">{mode.description}</p>
                          <p className="text-[10px] text-text-muted/60 mt-0.5 font-mono">{mode.device}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleHybridToggle(mode.id)}
                          disabled={hybridLoading || hybridStatus?.mode === mode.id}
                          className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                            hybridStatus?.mode === mode.id
                              ? 'bg-violet-500/20 text-violet-300 border-violet-500/30 cursor-default'
                              : 'bg-forge-bg text-text-muted border-forge-border hover:border-violet-500/30 hover:text-violet-300'
                          } ${hybridLoading ? 'opacity-50' : ''}`}
                        >
                          {hybridStatus?.mode === mode.id ? 'Active' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* NPU Model Converter — also available here for discoverability */}
      {intelAcceleratorRelevant ? <NPUModelConverter /> : null}

      {/* Image Generation Backend */}
      <ImageBackendControl imageStatus={imageStatus} setImageStatus={setImageStatus} />

      {/* Hardware Monitor */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Detected Hardware</h3>
        <Suspense fallback={<TabLoader />}>
          <HardwareMonitorFull />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Image Generation Backend Control Component
 * One-click setup with live progress feedback.
 */
function ImageBackendControl({ imageStatus, setImageStatus }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [progress, setProgress] = React.useState(null); // { step, message, percent }

  const refreshStatus = async () => {
    try {
      const status = await window.electronAPI?.imageAutoGetStatus?.();
      if (status) setImageStatus(status);
      return status;
    } catch (e) {
      console.error('[ImageBackend] Status check failed:', e);
      return null;
    }
  };

  // Listen for progress events from the backend during setup/download
  React.useEffect(() => {
    refreshStatus();

    const unsub = window.electronAPI?.onImageAutoEvent?.((data) => {
      if (!data) return;
      const { event, message, percent, error: eventError } = data;
      console.log('[ImageBackend] Event:', event, message || '', percent != null ? `${percent}%` : '');

      if (event === 'setup:complete' || event === 'backend:ready' || event === 'install:complete' || event === 'model:complete') {
        setProgress({ step: 'done', message: message || 'Ready!', percent: 100 });
        refreshStatus();
        setTimeout(() => setProgress(null), 4000);
      } else if (event === 'setup:error' || event === 'backend:error') {
        setError(eventError || message || 'Setup failed');
        setProgress(null);
        setBusy(false);
      } else if (event === 'install:download' || event === 'model:download') {
        // File download - show fine-grained progress
        const label = event === 'install:download' ? 'Downloading ComfyUI' : 'Downloading model';
        setProgress({ step: event, message: message || `${label}...`, percent: percent || 0 });
      } else if (event === 'install:extract') {
        setProgress({ step: event, message: message || 'Extracting files...', percent: percent || 0 });
      } else if (event === 'backend:starting') {
        setProgress({ step: event, message: message || 'Starting server...', percent: data.progress || 0 });
      } else if (message) {
        setProgress(prev => ({ step: event, message, percent: percent ?? prev?.percent ?? 0 }));
      }
    });

    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    setProgress({ step: 'start', message: 'Starting ComfyUI server...', percent: 0 });
    try {
      const result = await window.electronAPI?.imageAutoStart?.();
      if (result?.success) {
        setProgress({ step: 'done', message: 'Server running!', percent: 100 });
        await new Promise(r => setTimeout(r, 1500));
        await refreshStatus();
        setProgress(null);
      } else {
        setError(result?.error || 'Failed to start backend');
        setProgress(null);
      }
    } catch (e) {
      setError(e.message);
      setProgress(null);
    }
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await window.electronAPI?.imageAutoStop?.();
      await refreshStatus();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const handleSetup = async () => {
    setBusy(true);
    setError(null);
    setProgress({ step: 'init', message: 'Starting setup...', percent: 0 });
    try {
      const result = await window.electronAPI?.imageAutoSetup?.({});
      if (result?.success) {
        setProgress({ step: 'done', message: 'Image generation ready!', percent: 100 });
        await refreshStatus();
        setTimeout(() => setProgress(null), 3000);
      } else {
        setError(result?.error || 'Setup failed');
        setProgress(null);
      }
    } catch (e) {
      setError(e.message);
      setProgress(null);
    }
    setBusy(false);
  };

  const showSetupButton = !imageStatus?.installed && !imageStatus?.needsModel;
  const showModelNeeded = imageStatus?.installed && (imageStatus?.models?.length === 0 || imageStatus?.needsModel);

  return (
    <div className="p-4 bg-forge-bg border border-forge-border rounded-lg space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary">Image Generation (ComfyUI)</h3>
          <p className="text-xs text-text-muted mt-1">
            Local image generation with no content filters. Fully offline and private.
          </p>
          
          {imageStatus && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${imageStatus.installed ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-text-muted">
                  ComfyUI: {imageStatus.installed ? 'Installed' : 'Not installed'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${imageStatus.running ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-text-muted">
                  Server: {imageStatus.running ? `Running on port ${imageStatus.port || 8188}` : 'Not running'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${imageStatus.models?.length > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-text-muted">
                  Models: {imageStatus.models?.length || 0} installed
                  {showModelNeeded && !busy && ' - download a starter model below'}
                </span>
              </div>
              {imageStatus.comfyDir && (
                <div className="text-[10px] text-neutral-500 mt-1 font-mono truncate" title={imageStatus.comfyDir}>
                  {imageStatus.comfyDir}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[11rem] sm:items-end">
          {(!imageStatus?.installed || showModelNeeded) && (
            <button
              type="button"
              onClick={handleSetup}
              disabled={busy}
              className="btn btn-primary w-full sm:w-auto whitespace-nowrap text-xs"
            >
              {busy ? (
                <span className="flex items-center gap-1.5">
                  <Loader size={12} className="animate-spin" />
                  Working...
                </span>
              ) : showModelNeeded ? 'Download Model' : 'One-Click Setup'}
            </button>
          )}
          {imageStatus?.installed && !showModelNeeded && (
            <>
              <button
                type="button"
                onClick={imageStatus?.running ? handleStop : handleStart}
                disabled={busy}
                className={`btn w-full sm:w-auto whitespace-nowrap text-xs ${imageStatus?.running ? 'btn-secondary' : 'btn-primary'}`}
              >
                {busy ? (
                  <span className="flex items-center gap-1.5">
                    <Loader size={12} className="animate-spin" />
                    Please wait...
                  </span>
                ) : imageStatus?.running ? 'Stop Server' : 'Start Server'}
              </button>
              {!imageStatus?.running && (
                <button
                  type="button"
                  onClick={refreshStatus}
                  disabled={busy}
                  className="btn btn-secondary w-full sm:w-auto whitespace-nowrap text-xs"
                >
                  Refresh
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Live progress indicator */}
      {progress && (
        <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-indigo-300 font-medium">{progress.message}</span>
            {progress.percent > 0 && progress.percent < 100 && (
              <span className="text-[10px] text-indigo-400 font-mono tabular-nums">{progress.percent}%</span>
            )}
          </div>
          {progress.percent > 0 && (
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${Math.min(progress.percent, 100)}%`,
                  background: progress.step === 'done'
                    ? 'linear-gradient(90deg, #10b981, #34d399)'
                    : 'linear-gradient(90deg, #6366f1, #818cf8)',
                }}
              />
            </div>
          )}
          {progress.step !== 'done' && progress.percent === 0 && (
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-indigo-500/50 animate-pulse" />
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400 font-medium">Setup Error</p>
          <p className="text-[11px] text-red-300/80 mt-1 whitespace-pre-wrap">{error}</p>
          <button
            type="button"
            onClick={() => { setError(null); refreshStatus(); }}
            className="text-[10px] text-red-400 underline mt-2 hover:text-red-300"
          >
            Dismiss &amp; refresh status
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Memory Tab - View and manage AI memory for long conversations
 */
function MemoryTab() {
  const [memories, setMemories] = React.useState([]);
  const [stats, setStats] = React.useState({ memories: 0, summaries: 0, pinned: 0 });
  const [soulStats, setSoulStats] = React.useState(null);
  const [soulEnabled, setSoulEnabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mems, st, soulEngineEnabled] = await Promise.all([
        window.electronAPI?.memoryGetMemories?.({ workspace: 'casual' }),
        window.electronAPI?.memoryGetStats?.({ workspace: 'casual' }),
        window.electronAPI?.getSettings?.('soul_engine_enabled'),
      ]);
      const soul = soulEngineEnabled ? await window.electronAPI?.soulGetStats?.() : null;
      setMemories(mems || []);
      setStats(st || { memories: 0, summaries: 0, pinned: 0 });
      setSoulEnabled(Boolean(soulEngineEnabled));
      setSoulStats(soul);
    } catch (error) {
      console.error('Failed to load memory data:', error);
    }
    setLoading(false);
  };

  React.useEffect(() => {
    loadData();
  }, []);

  const handleDeleteMemory = async (memoryId) => {
    try {
      await window.electronAPI?.memoryDeleteMemory?.({ memoryId });
      setMemories(prev => prev.filter(m => m.id !== memoryId));
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-1">AI Memory</h2>
        <p className="text-sm text-text-secondary">
          DevForge remembers things about you to maintain coherent long conversations.
          Pin important messages so the AI never forgets them.
        </p>
      </div>

      {/* Soul Stats - Our Relationship */}
      {soulEnabled && soulStats && (
        <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-purple-300 mb-3 flex items-center gap-2">
            <span>*</span> Our Relationship
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center">
              <div className="text-xl font-bold text-text-primary">{soulStats.totalInteractions}</div>
              <div className="text-[10px] text-text-muted">Conversations</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-text-primary">{soulStats.daysTogether}</div>
              <div className="text-[10px] text-text-muted">Days Together</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-amber-400">{soulStats.currentStreak} streak</div>
              <div className="text-[10px] text-text-muted">Day Streak</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-400">{soulStats.trustLevel}%</div>
              <div className="text-[10px] text-text-muted">Trust Level</div>
            </div>
          </div>
          
          {/* What I know about you */}
          {(soulStats.knownName || soulStats.occupation || soulStats.techStack?.length > 0) && (
            <div className="mt-3 pt-3 border-t border-purple-500/20">
              <div className="text-xs text-text-muted mb-2">What I know about you:</div>
              <div className="flex flex-wrap gap-2">
                {soulStats.knownName && (
                  <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded">
                    Name: {soulStats.knownName}
                  </span>
                )}
                {soulStats.occupation && (
                  <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">
                    {soulStats.occupation}
                  </span>
                )}
                {soulStats.techStack?.slice(0, 5).map(tech => (
                  <span key={tech} className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Communication preferences learned */}
          {soulStats.preferences && (
            <div className="mt-3 pt-3 border-t border-purple-500/20">
              <div className="text-xs text-text-muted mb-2">How I've learned to communicate with you:</div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Verbosity</span>
                  <span className="text-text-secondary">
                    {soulStats.preferences.verbosity < 0.4 ? 'Concise' : 
                     soulStats.preferences.verbosity > 0.6 ? 'Detailed' : 'Balanced'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Tone</span>
                  <span className="text-text-secondary">
                    {soulStats.preferences.formality < 0.4 ? 'Casual' : 
                     soulStats.preferences.formality > 0.6 ? 'Formal' : 'Adaptive'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Technical</span>
                  <span className="text-text-secondary">
                    {soulStats.preferences.technicalDepth < 0.4 ? 'Simple' : 
                     soulStats.preferences.technicalDepth > 0.6 ? 'Deep' : 'Mixed'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Memory Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-forge-bg border border-forge-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-text-primary">{stats.memories}</div>
          <div className="text-xs text-text-muted">Memories</div>
        </div>
        <div className="bg-forge-bg border border-forge-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-text-primary">{stats.summaries}</div>
          <div className="text-xs text-text-muted">Summaries</div>
        </div>
        <div className="bg-forge-bg border border-forge-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-amber-500">{stats.pinned}</div>
          <div className="text-xs text-text-muted">Pinned</div>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-400 mb-2">How Memory Works</h3>
        <ul className="text-xs text-text-secondary space-y-1">
          <li>- <strong>Auto-Summary:</strong> Long conversations are summarized to preserve context</li>
          <li>- <strong>Fact Extraction:</strong> Important facts about you are remembered</li>
          <li>- <strong>Pinned Messages:</strong> Click pin on any message to ensure it's always included</li>
          <li>- <strong>Smart Context:</strong> Instead of just last 10 messages, AI sees relevant history</li>
        </ul>
      </div>

      {/* Memories List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">What I Remember</h3>
          <button 
            onClick={loadData}
            className="btn btn-secondary text-xs"
          >
            Refresh
          </button>
        </div>
        
        {loading ? (
          <div className="text-center text-text-muted py-8">Loading...</div>
        ) : memories.length === 0 ? (
          <div className="text-center text-text-muted py-8 bg-forge-bg border border-forge-border rounded-lg">
            <Brain className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>No memories yet</p>
            <p className="text-xs mt-1">Have longer conversations and I'll start remembering things about you!</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {memories.map(memory => (
              <div 
                key={memory.id}
                className="bg-forge-bg border border-forge-border rounded-lg p-3 flex items-start gap-3"
              >
                <div className="flex-1">
                  <p className="text-sm text-text-primary">{memory.content}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-text-muted">
                      {new Date(memory.created_at).toLocaleDateString()}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      memory.type === 'fact' ? 'bg-green-500/20 text-green-400' :
                      memory.type === 'pinned' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {memory.type}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteMemory(memory.id)}
                  className="p-1 text-text-muted hover:text-status-error transition-colors"
                  title="Forget this"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="text-xs text-text-muted border-t border-forge-border pt-4">
        <strong>Pro tip:</strong> Pin your most important messages (preferences, context, goals) 
        and they'll always be included in the AI's context, even in very long conversations.
      </div>
    </div>
  );
}

/**
 * VaultSafetySettings
 *
 * Lets the user customize safewords, aftercare persona, and inactivity
 * thresholds. All state is written via the preload bridge into electron-store
 * and consumed client-side by the chat engine.
 */
function VaultSafetySettings() {
  const [config, setConfig] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.vaultSafetyGetConfig?.();
        if (!cancelled && res?.success) setConfig(res.config);
      } catch (_) { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async (patch) => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await api.vaultSafetySetConfig?.(patch);
      if (res?.success) {
        setConfig(res.config);
        setStatus('Saved.');
        setTimeout(() => setStatus(null), 1500);
      } else {
        setStatus(res?.error || 'Save failed');
      }
    } catch (e) {
      setStatus(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <div className="p-4 rounded-lg bg-forge-bg border border-forge-border text-xs text-text-muted">Loading vault safety config...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">Safeword detection</p>
            <p className="text-xs text-text-muted mt-1">Intercepts the words below before they are sent to the model. Red stops and engages aftercare; yellow softens; green resumes.</p>
          </div>
          <button
            type="button"
            onClick={() => save({ enabled: !config.enabled })}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              config.enabled
                ? 'bg-status-success/20 border-status-success/40 text-status-success'
                : 'bg-forge-bg border-forge-border text-text-secondary'
            }`}
          >
            {config.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['red', 'yellow', 'green'].map((key) => (
            <label key={key} className="text-xs text-text-secondary">
              <span className="block mb-1 capitalize">{key}</span>
              <input
                type="text"
                value={config.safewords?.[key] || key}
                maxLength={32}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig({ ...config, safewords: { ...config.safewords, [key]: v } });
                }}
                onBlur={() => save({ safewords: config.safewords })}
                className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-sm text-text-primary"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">Aftercare autopilot</p>
            <p className="text-xs text-text-muted mt-1">If you go quiet after an intense scene, the app will gently offer aftercare. It never auto-engages without your confirmation.</p>
          </div>
          <button
            type="button"
            onClick={() => save({ aftercare: { enabled: !config.aftercare?.enabled } })}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              config.aftercare?.enabled
                ? 'bg-status-success/20 border-status-success/40 text-status-success'
                : 'bg-forge-bg border-forge-border text-text-secondary'
            }`}
          >
            {config.aftercare?.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Inactivity before suggesting aftercare (seconds)</span>
          <input
            type="number"
            min={30}
            max={600}
            step={5}
            value={Math.round((config.aftercare?.inactivityMs || 90000) / 1000)}
            onChange={(e) => {
              const secs = Math.max(30, Math.min(600, Number(e.target.value) || 90));
              setConfig({ ...config, aftercare: { ...config.aftercare, inactivityMs: secs * 1000 } });
            }}
            onBlur={() => save({ aftercare: config.aftercare })}
            className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-sm text-text-primary"
          />
        </label>
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Aftercare persona</span>
          <textarea
            value={config.aftercare?.persona || ''}
            maxLength={4000}
            rows={4}
            onChange={(e) => setConfig({ ...config, aftercare: { ...config.aftercare, persona: e.target.value } })}
            onBlur={() => save({ aftercare: config.aftercare })}
            className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
          />
        </label>
      </div>
      {status && <p className="text-[11px] text-text-muted">{saving ? 'Saving...' : status}</p>}
    </div>
  );
}

/**
 * AudioLayerSettings
 *
 * Local TTS + ambience toggle for the vault. Everything is optional — Web
 * Speech works out of the box, Piper and MusicGen require user-supplied
 * binaries to keep the app fully offline/privacy-first.
 */
function AudioLayerSettings() {
  const [config, setConfig] = React.useState(null);
  const [status, setStatus] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.audioGetConfig?.();
        if (!cancelled && res?.success) setConfig(res.config);
      } catch (_) { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async (patch) => {
    setStatus(null);
    try {
      const res = await api.audioSetConfig?.(patch);
      if (res?.success) {
        setConfig(res.config);
        setStatus('Saved.');
        setTimeout(() => setStatus(null), 1500);
      } else {
        setStatus(res?.error || 'Save failed');
      }
    } catch (e) {
      setStatus(e?.message || 'Save failed');
    }
  };

  if (!config) {
    return <div className="p-4 rounded-lg bg-forge-bg border border-forge-border text-xs text-text-muted">Loading audio config...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">Speak replies aloud</p>
            <p className="text-xs text-text-muted mt-1">
              Sentence-by-sentence narration of streaming responses. Everything stays
              on your machine. The red safeword stops audio instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ enabled: !config.enabled })}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              config.enabled
                ? 'bg-status-success/20 border-status-success/40 text-status-success'
                : 'bg-forge-bg border-forge-border text-text-secondary'
            }`}
          >
            {config.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Engine</span>
          <select
            value={config.engine}
            onChange={(e) => save({ engine: e.target.value })}
            className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-sm text-text-primary"
          >
            <option value="web-speech">Web Speech (built-in, no setup)</option>
            <option value="piper">Piper (local neural TTS)</option>
            <option value="off">Off</option>
          </select>
        </label>
        {config.engine === 'piper' && (
          <div className="grid grid-cols-1 gap-2">
            <label className="block text-xs text-text-secondary">
              <span className="block mb-1">Piper binary path</span>
              <input
                type="text"
                value={config.piperBinary || ''}
                onChange={(e) => setConfig({ ...config, piperBinary: e.target.value })}
                onBlur={() => save({ piperBinary: config.piperBinary })}
                placeholder="C:\\path\\to\\piper.exe"
                className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
              />
            </label>
            <label className="block text-xs text-text-secondary">
              <span className="block mb-1">Voice model (.onnx)</span>
              <input
                type="text"
                value={config.piperVoice || ''}
                onChange={(e) => setConfig({ ...config, piperVoice: e.target.value })}
                onBlur={() => save({ piperVoice: config.piperVoice })}
                placeholder="C:\\path\\to\\en_US-libritts-high.onnx"
                className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
              />
            </label>
          </div>
        )}
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Volume ({Math.round((config.volume || 0.8) * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.volume ?? 0.8}
            onChange={(e) => setConfig({ ...config, volume: Number(e.target.value) })}
            onMouseUp={() => save({ volume: config.volume })}
            onTouchEnd={() => save({ volume: config.volume })}
            className="w-full"
          />
        </label>
      </div>

      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">Ambient soundtrack</p>
            <p className="text-xs text-text-muted mt-1">
              Follows scene intensity. Pick a folder of ambient WAV/MP3 loops, or
              configure MusicGen to generate new ones. Disabled by default.
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ musicgenEnabled: !config.musicgenEnabled })}
            className={`px-3 py-1.5 text-xs rounded-full border ${
              config.musicgenEnabled
                ? 'bg-status-success/20 border-status-success/40 text-status-success'
                : 'bg-forge-bg border-forge-border text-text-secondary'
            }`}
          >
            {config.musicgenEnabled ? 'Generate new' : 'Library only'}
          </button>
        </div>
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Ambience library folder</span>
          <input
            type="text"
            value={config.ambienceDir || ''}
            onChange={(e) => setConfig({ ...config, ambienceDir: e.target.value })}
            onBlur={() => save({ ambienceDir: config.ambienceDir })}
            placeholder="C:\\path\\to\\ambience"
            className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
          />
        </label>
        {config.musicgenEnabled && (
          <div className="grid grid-cols-1 gap-2">
            <label className="block text-xs text-text-secondary">
              <span className="block mb-1">MusicGen binary</span>
              <input
                type="text"
                value={config.musicgenBinary || ''}
                onChange={(e) => setConfig({ ...config, musicgenBinary: e.target.value })}
                onBlur={() => save({ musicgenBinary: config.musicgenBinary })}
                placeholder="C:\\path\\to\\musicgen.exe"
                className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
              />
            </label>
            <label className="block text-xs text-text-secondary">
              <span className="block mb-1">MusicGen model</span>
              <input
                type="text"
                value={config.musicgenModel || ''}
                onChange={(e) => setConfig({ ...config, musicgenModel: e.target.value })}
                onBlur={() => save({ musicgenModel: config.musicgenModel })}
                placeholder="small | medium | path to weights"
                className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
              />
            </label>
          </div>
        )}
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Ambience starts at intensity ({Math.round((config.intensityThreshold ?? 0.4) * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.intensityThreshold ?? 0.4}
            onChange={(e) => setConfig({ ...config, intensityThreshold: Number(e.target.value) })}
            onMouseUp={() => save({ intensityThreshold: config.intensityThreshold })}
            onTouchEnd={() => save({ intensityThreshold: config.intensityThreshold })}
            className="w-full"
          />
        </label>
      </div>
      {status && <p className="text-[11px] text-text-muted">{status}</p>}
    </div>
  );
}

/**
 * HapticBridgeSettings
 *
 * Opt-in haptic integration via Intiface Central / Buttplug.io. Disabled
 * by default. The user must install the optional `buttplug` npm package
 * and run Intiface Central locally — nothing is downloaded automatically.
 */
function HapticBridgeSettings() {
  const [config, setConfig] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [deviceStatus, setDeviceStatus] = React.useState({ connected: false, devices: [], packageAvailable: false });
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const cfgRes = await api.hapticGetConfig?.();
      if (cfgRes?.success) setConfig(cfgRes.config);
      const statusRes = await api.hapticStatus?.();
      if (statusRes?.success !== false) setDeviceStatus(statusRes || {});
    } catch (_) { /* noop */ }
  }, []);

  React.useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const save = async (patch) => {
    setStatus(null);
    try {
      const res = await api.hapticSetConfig?.(patch);
      if (res?.success) {
        setConfig(res.config);
        setStatus('Saved.');
        setTimeout(() => setStatus(null), 1200);
      } else {
        setStatus(res?.error || 'Save failed');
      }
    } catch (e) {
      setStatus(e?.message || 'Save failed');
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const res = await api.hapticConnect?.();
      setStatus(res?.success ? 'Connected' : (res?.error || 'Connect failed'));
      await refresh();
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 2500);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.hapticDisconnect?.();
      await refresh();
    } finally { setBusy(false); }
  };

  const scan = async () => {
    setBusy(true);
    setStatus('Scanning for 4 seconds...');
    try {
      const res = await api.hapticScan?.({ durationMs: 4000 });
      setStatus(res?.success ? `Found ${res.devices?.length || 0} device(s)` : (res?.error || 'Scan failed'));
      await refresh();
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 2500);
    }
  };

  if (!config) {
    return <div className="p-4 rounded-lg bg-forge-bg border border-forge-border text-xs text-text-muted">Loading haptic config...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-text-primary">Enable haptic bridge</p>
            <p className="text-xs text-text-muted mt-1">
              Sends vibration intensity to your Intiface Central server. Requires
              the optional <code>buttplug</code> npm package and a running Intiface
              instance. Disabled by default. Red safeword stops all output instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => save({ enabled: !config.enabled })}
            className={`px-3 py-1.5 text-xs rounded-full border shrink-0 ${
              config.enabled
                ? 'bg-status-success/20 border-status-success/40 text-status-success'
                : 'bg-forge-bg border-forge-border text-text-secondary'
            }`}
          >
            {config.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
        {!deviceStatus.packageAvailable && (
          <div className="text-[11px] text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded-lg p-2">
            Optional <code>buttplug</code> package is not installed. Run <code>npm install buttplug</code> in the DevForge directory to enable this feature.
            {deviceStatus.packageError && <div className="mt-1 text-text-muted">{deviceStatus.packageError}</div>}
          </div>
        )}
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Intiface Central server URL</span>
          <input
            type="text"
            value={config.serverUrl || ''}
            onChange={(e) => setConfig({ ...config, serverUrl: e.target.value })}
            onBlur={() => save({ serverUrl: config.serverUrl })}
            placeholder="ws://127.0.0.1:12345"
            className="w-full px-2 py-1.5 rounded bg-forge-surface border border-forge-border text-xs text-text-primary font-mono"
          />
        </label>
        <label className="block text-xs text-text-secondary">
          <span className="block mb-1">Hard cap on intensity ({Math.round((config.maxIntensity ?? 0.5) * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.maxIntensity ?? 0.5}
            onChange={(e) => setConfig({ ...config, maxIntensity: Number(e.target.value) })}
            onMouseUp={() => save({ maxIntensity: config.maxIntensity })}
            onTouchEnd={() => save({ maxIntensity: config.maxIntensity })}
            className="w-full"
          />
          <span className="text-[10px] text-text-muted">Chat-driven output is clamped to this ceiling at all times.</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={Boolean(config.enableOnlyInNsfwWorkspace)}
            onChange={(e) => save({ enableOnlyInNsfwWorkspace: e.target.checked })}
          />
          Only active in the vault (nsfw) workspace
        </label>
      </div>

      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">Connection</p>
            <p className="text-xs text-text-muted mt-1">
              {deviceStatus.connected ? `Connected. ${deviceStatus.devices?.length || 0} device(s).` : 'Not connected.'}
            </p>
          </div>
          <div className="flex gap-2">
            {!deviceStatus.connected ? (
              <button
                type="button"
                disabled={busy || !config.enabled || !deviceStatus.packageAvailable}
                onClick={connect}
                className="px-3 py-1.5 text-xs rounded bg-forge-surface border border-forge-border text-text-primary hover:bg-forge-hover disabled:opacity-40"
              >
                Connect
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={scan}
                  className="px-3 py-1.5 text-xs rounded bg-forge-surface border border-forge-border text-text-primary hover:bg-forge-hover disabled:opacity-40"
                >
                  Scan
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={disconnect}
                  className="px-3 py-1.5 text-xs rounded bg-status-error/15 border border-status-error/40 text-status-error hover:bg-status-error/25 disabled:opacity-40"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
        {deviceStatus.devices?.length > 0 && (
          <ul className="text-xs text-text-secondary space-y-1">
            {deviceStatus.devices.map((d) => (
              <li key={d.index} className="px-2 py-1 rounded bg-forge-surface border border-forge-border font-mono">
                #{d.index} · {d.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status && <p className="text-[11px] text-text-muted">{status}</p>}
    </div>
  );
}
