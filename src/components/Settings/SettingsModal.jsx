import React, { useState, useEffect, Suspense, lazy, memo } from 'react';
import { X, Settings, Server, Image, Shield, Keyboard, FolderOpen, Loader, Cpu, Zap, Bug } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { api } from '../../utils/electronAPI';
import { useShortcutsStore } from '../../stores/shortcutsStore';
import { useThemeStore } from '../../stores/themeStore';
import { DocumentUploader } from '../Documents/DocumentUploader';
import { DocumentList } from '../Documents/DocumentList';
import { ModelPresets } from './ModelPresets';
import { BackupSettings } from './BackupSettings';
import { motion } from 'framer-motion';

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
  { id: 'data', label: 'Data & Storage', icon: Database },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'debug', label: 'Debug', icon: Bug },
];

export function SettingsModal() {
  const { toggleSettings } = useAppStore();
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
    ollamaBinary: '',
    imageStartCommand: '',
    imageStopCommand: '',
    llamaQuantizePath: '',
    pythonPath: '',
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
          'tools.pythonPath'
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
          }));
        }
      } catch (error) {
        console.warn('Failed to load settings batch, settings will use defaults:', error);
      }
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
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
      });
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
        className="relative w-full max-w-3xl max-h-[85vh] bg-surface-1 border border-border-muted rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Simplified ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-24 bg-accent-primary/5 blur-3xl pointer-events-none" />

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
            className="p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-glass-3 transition-all duration-150"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative flex h-[550px]">
          {/* Sidebar */}
          <div className="w-52 border-r border-border-subtle p-3 bg-surface-0/50">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1
                  transition-all duration-150 text-sm
                  ${activeTab === tab.id 
                    ? 'bg-accent-primary/15 text-accent-primary shadow-sm' 
                    : 'text-text-secondary hover:bg-glass-3 hover:text-text-primary'
                  }
                `}
                style={activeTab === tab.id ? {
                  boxShadow: '0 0 20px rgba(139, 92, 246, 0.15)'
                } : {}}
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
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary rounded-xl hover:bg-glass-3 transition-all duration-150"
            >
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              className="px-5 py-2 text-sm font-medium text-white rounded-xl transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)'
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

function LLMSettings({ settings, setSettings, onSelectFolder }) {
  const [healthStatus, setHealthStatus] = React.useState({ status: 'checking', models: 0 });
  const [isChecking, setIsChecking] = React.useState(false);
  const [ollamaStatus, setOllamaStatus] = React.useState(null);
  const [ollamaBusy, setOllamaBusy] = React.useState(false);
  const currentWorkspace = useAppStore((state) => state.currentWorkspace);
  const ragInfluence = useAppStore((state) => state.ragInfluence || 0);
  const setRagInfluence = useAppStore((state) => state.setRagInfluence);
  const [knowledgeMessage, setKnowledgeMessage] = React.useState(null);
  const platform = window.electronAPI?.getPlatform?.();

  React.useEffect(() => {
    checkHealth();
  }, [settings.llmEndpoint]);

  const loadOllamaStatus = React.useCallback(async () => {
    try {
      const status = await window.electronAPI?.getOllamaStatus();
      setOllamaStatus(status);
    } catch (error) {
      console.error('Failed to load Ollama status:', error);
    }
  }, []);

  React.useEffect(() => {
    loadOllamaStatus();
  }, [loadOllamaStatus]);

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
      await loadOllamaStatus();
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

  const checkHealth = async () => {
    setIsChecking(true);
    try {
      const health = await window.electronAPI?.checkLLMHealth();
      setHealthStatus({
        status: health?.healthy ? 'online' : 'offline',
        models: health?.models || 0,
        error: health?.error
      });
    } catch (error) {
      setHealthStatus({ status: 'offline', models: 0, error: error.message });
    } finally {
      setIsChecking(false);
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

      <div className="p-4 rounded-lg border border-forge-border space-y-3">
        <h4 className="text-sm font-medium text-text-primary">Conversion Tools</h4>
        <p className="text-xs text-text-muted">
          Configure helper executables so DevForge can quantize GGUF models and build OpenVINO IR packages.
        </p>
        <div className="space-y-2">
          <label className="text-xs text-text-muted">llama-quantize executable</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.llamaQuantizePath || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, llamaQuantizePath: e.target.value }))
              }
              placeholder="C:\\tools\\llama.cpp\\llama-quantize.exe"
              className="input flex-1 text-xs font-mono"
            />
            <button
              type="button"
              onClick={async () => {
                const file = await window.electronAPI?.selectFile({ properties: ['openFile'] });
                if (file) {
                  setSettings((prev) => ({ ...prev, llamaQuantizePath: file }));
                }
              }}
              className="btn btn-secondary text-xs"
            >
              Browse
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-text-muted">Python executable (OpenVINO env)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.pythonPath || ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, pythonPath: e.target.value }))}
              placeholder={window.electronAPI?.getPlatform?.() === 'win32' ? 'py' : 'python3'}
              className="input flex-1 text-xs font-mono"
            />
            <button
              type="button"
              onClick={async () => {
                const file = await window.electronAPI?.selectFile({ properties: ['openFile'] });
                if (file) {
                  setSettings((prev) => ({ ...prev, pythonPath: file }));
                }
              }}
              className="btn btn-secondary text-xs"
            >
              Browse
            </button>
          </div>
          <p className="text-[11px] text-text-muted">
            Point this to the Python interpreter with OpenVINO installed (from the one-click setup).
          </p>
        </div>
      </div>

      <div className="p-4 rounded-lg border border-forge-border">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-medium text-text-primary">Ollama Service</h4>
            <p className="text-xs text-text-muted">
              Installed: {ollamaStatus?.installed ? 'Yes' : 'No'} • Running:{' '}
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
            <span className="text-lg">🗂️</span> LM Studio Models
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
                      <span className="opacity-50">•</span>
                      <span className="truncate">{model.parentFolder}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result?.success ? (
                      <span className="text-status-success text-xs flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full bg-status-success/20 flex items-center justify-center">✓</span>
                        Imported
                      </span>
                    ) : result ? (
                      <span className="text-status-error text-xs flex items-center gap-1" title={result.error}>
                        <span className="w-4 h-4 rounded-full bg-status-error/20 flex items-center justify-center">✗</span>
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
const NPU_RECOMMENDED_MODELS = [
  { id: 'microsoft/phi-2', name: 'Phi-2 (2.7B)', description: 'Fast, efficient general purpose' },
  { id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', name: 'TinyLlama 1.1B', description: 'Ultra lightweight chat' },
  { id: 'Qwen/Qwen2-1.5B-Instruct', name: 'Qwen2 1.5B', description: 'Strong multilingual' },
  { id: 'stabilityai/stablelm-2-1_6b-chat', name: 'StableLM 2 1.6B', description: 'Balanced performance' },
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

function NPUModelConverter() {
  const [modelInput, setModelInput] = React.useState('');
  const [converting, setConverting] = React.useState(false);
  const [conversionResult, setConversionResult] = React.useState(null);
  const [precision, setPrecision] = React.useState('int4');
  const [showRecommended, setShowRecommended] = React.useState(true);
  const [step, setStep] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const timerRef = React.useRef(null);

  React.useEffect(() => {
    if (converting) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - start) / 1000);
        setElapsed(secs);
        // Progress heuristic
        if (secs < 3) setStep(0);
        else if (secs < 15) setStep(1);
        else if (secs < 60) setStep(2);
        else if (secs < 90) setStep(3);
        else setStep(4);
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [converting]);

  const convertToNPU = async (modelId = modelInput) => {
    if (!modelId) return;
    setConverting(true);
    setConversionResult(null);
    setStep(0);
    setElapsed(0);
    
    try {
      const result = await window.electronAPI?.convertModelToNPU({ inputPath: modelId, precision });
      setStep(5);
      setConversionResult(result);
    } catch (error) {
      setConversionResult({ success: false, error: error.message });
    } finally {
      setConverting(false);
      clearInterval(timerRef.current);
    }
  };

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

      {/* Conversion Progress */}
      {converting && (
        <div className="bg-forge-bg border border-amber-500/20 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Loader size={14} className="animate-spin text-amber-400" />
              Converting: {modelInput}
            </span>
            <span className="text-xs text-text-muted font-mono">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
          </div>
          
          {/* Step Progress */}
          <div className="space-y-1">
            {CONVERSION_STEPS.map((s, i) => (
              <div key={s.id} className={`flex items-center gap-2 p-1.5 rounded text-xs transition-all ${
                i === step ? 'bg-amber-500/10 text-amber-400' : 
                i < step ? 'text-status-success' : 'text-text-muted opacity-50'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  i === step ? 'bg-amber-500 text-black animate-pulse' :
                  i < step ? 'bg-status-success text-white' : 'bg-forge-elevated'
                }`}>
                  {i < step ? '✓' : i + 1}
                </span>
                <span className="font-medium">{s.label}</span>
                <span className="text-[10px] text-text-muted">{s.desc}</span>
                {i === step && <Loader size={10} className="ml-auto animate-spin" />}
              </div>
            ))}
          </div>
          
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-forge-elevated rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
              style={{ width: `${((step + 1) / CONVERSION_STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Recommended models */}
      {showRecommended && !converting && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary font-medium">NPU-Optimized Models</span>
            <button 
              onClick={() => setShowRecommended(false)}
              className="text-[10px] text-text-muted hover:text-text-secondary"
            >
              Hide
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {NPU_RECOMMENDED_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  setModelInput(model.id);
                  convertToNPU(model.id);
                }}
                disabled={converting}
                className="p-2 rounded bg-forge-elevated hover:bg-forge-hover border border-forge-border text-left transition-colors"
              >
                <div className="text-xs font-medium text-text-primary">{model.name}</div>
                <div className="text-[10px] text-text-muted">{model.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!converting && (
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
              onClick={() => convertToNPU()}
              disabled={!modelInput}
              className="btn btn-primary flex items-center gap-2"
            >
              <Zap size={14} />
              Convert to NPU
            </button>
          </div>
        </div>
      )}

      {conversionResult && (
        <div className={`p-3 rounded text-xs ${
            conversionResult.success 
              ? 'bg-status-success/20 border border-status-success/30' 
              : conversionResult.needsSetup
              ? 'bg-amber-500/20 border border-amber-500/30'
              : 'bg-status-error/20 border border-status-error/30'
          }`}>
            {conversionResult.success ? (
              <div>
                <div className="font-medium text-status-success mb-1">✓ Conversion Successful!</div>
                <div className="text-text-muted">
                  Output saved to: <code className="bg-forge-bg px-1 rounded">{conversionResult.outputPath}</code>
                </div>
                <p className="text-[10px] mt-2 text-text-muted">
                  The model is now ready for NPU inference. Select it in the Model tab to use.
                </p>
              </div>
            ) : conversionResult.needsSetup ? (
              <div>
                <div className="font-medium text-amber-400 mb-1">⚠️ OpenVINO Setup Required</div>
                <div className="text-text-muted mb-2">
                  {conversionResult.error}
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
                <div className="font-medium text-status-error mb-1">✗ Conversion Failed</div>
                <div className="text-text-muted whitespace-pre-wrap">{conversionResult.error}</div>
                {conversionResult.stderr && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-text-muted hover:text-text-secondary">
                      Show details
                    </summary>
                    <pre className="mt-1 text-[9px] bg-forge-bg p-2 rounded overflow-x-auto max-h-32">
                      {conversionResult.stderr}
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
            <div className="text-[10px] text-text-muted">Port 8188 • Recommended</div>
          </div>
          <div className="p-2 rounded bg-forge-surface border border-forge-border">
            <div className="text-xs font-medium text-text-primary">A1111 WebUI</div>
            <div className="text-[10px] text-text-muted">Port 7860 • Use --api flag</div>
          </div>
          <div className="p-2 rounded bg-forge-surface border border-forge-border">
            <div className="text-xs font-medium text-text-primary">Fooocus</div>
            <div className="text-[10px] text-text-muted">Port 7865 • Simple UI</div>
          </div>
        </div>
      </div>

      {/* Model Types */}
      <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
        <h4 className="text-sm font-medium text-text-primary mb-3">Supported Model Types</h4>
        <div className="text-xs text-text-muted space-y-2">
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">SD 1.5</span>
            <span>512×512 • 20 steps • CFG 7</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">SDXL</span>
            <span>1024×1024 • 25 steps • CFG 7</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">Flux</span>
            <span>1024×1024 • 20 steps • CFG 1</span>
          </div>
          <div className="flex justify-between items-center p-2 bg-forge-surface rounded">
            <span className="font-medium text-text-secondary">SD 3</span>
            <span>1024×1024 • 28 steps • CFG 4.5</span>
          </div>
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          DevForge auto-detects model type from filename and applies optimal settings.
        </p>
      </div>
    </div>
  );
}

function PrivacySettings({ settings, setSettings, onClose }) {
  const { lockNsfw, isLocked, setWorkspace, unlockNsfw, checkNsfwPasswordExists, toggleSettings } = useAppStore();
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
                <p className="text-sm text-text-primary">Local‑only mode</p>
                <p className="text-xs text-text-muted mt-1">
                  When enabled, DevForge will block all non‑localhost network requests.
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
                {updatingLocalOnly ? 'Updating…' : localOnly ? 'Enabled' : 'Disabled'}
              </button>
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
                    {blockedExternal} blocked by local‑only mode.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Spacer to push vault access to bottom */}
      <div className="flex-1" />
      
      {/* Hidden Vault Access - at the very bottom, subtle */}
      <div className="pt-8 mt-8 border-t border-forge-border/30">
        {!showVaultAccess ? (
          <button
            onClick={() => setShowVaultAccess(true)}
            className="w-full text-center py-3 text-[11px] text-text-muted/50 hover:text-text-muted transition-colors"
          >
            ···
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500/50" />
              <span>Private Vault</span>
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
                  Enter Vault
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
        )}
      </div>
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
  }));

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
              Running diagnostics…
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

function HardwareSettings() {
  const [powerMode, setPowerMode] = React.useState(false);
  const [backend, setBackend] = React.useState('auto');
  const [backends, setBackends] = React.useState([]);
  const [npuStatus, setNpuStatus] = React.useState(null);
  const [npuBusy, setNpuBusy] = React.useState(false);
  const [profile, setProfile] = React.useState('balanced');
  const [profileLoading, setProfileLoading] = React.useState(true);
  const [imageStatus, setImageStatus] = React.useState(null);
  const [ollamaStatus, setOllamaStatus] = React.useState(null);
  const [runningModels, setRunningModels] = React.useState([]);
  const [warmingUp, setWarmingUp] = React.useState(false);
  const [warmupModel, setWarmupModel] = React.useState('');
  const currentModel = useAppStore((state) => state.currentModel);
  const availableModels = useAppStore((state) => state.availableModels);

  React.useEffect(() => {
    // Load current settings
    const loadSettings = async () => {
      try {
        const status = await window.electronAPI?.getPowerModeStatus?.();
        if (status) {
          setPowerMode(status.enabled);
        }
        
        const savedBackend = await window.electronAPI?.getSettings('preferredBackend');
        if (savedBackend) {
          setBackend(savedBackend);
        }

        const availableBackends = await window.electronAPI?.getBackends?.();
        if (availableBackends) {
          setBackends(availableBackends);
        }

        const currentProfile = await window.electronAPI?.getPerformanceProfile?.();
        if (currentProfile) {
          setProfile(currentProfile);
        }
        setProfileLoading(false);

        if (window.electronAPI?.getNpuStatus) {
          const status = await window.electronAPI.getNpuStatus();
          setNpuStatus(status);
        }
        if (window.electronAPI?.getImageBackendStatus) {
          const status = await window.electronAPI.getImageBackendStatus();
          setImageStatus(status);
        }
        if (window.electronAPI?.getOllamaStatus) {
          const status = await window.electronAPI.getOllamaStatus();
          setOllamaStatus(status);
        }
        
        // Get running models (loaded in GPU/memory)
        if (window.electronAPI?.getRunningModels) {
          const running = await window.electronAPI.getRunningModels();
          setRunningModels(running || []);
        }
      } catch (error) {
        console.error('Failed to load hardware settings:', error);
      }
    };
    loadSettings();
  }, []);
  
  // Warmup/preload model onto GPU
  const handleWarmupModel = async (modelName) => {
    if (!modelName || warmingUp) return;
    setWarmingUp(true);
    try {
      const result = await window.electronAPI?.warmupModel(modelName);
      if (result?.success) {
        // Refresh running models
        const running = await window.electronAPI?.getRunningModels();
        setRunningModels(running || []);
        // eslint-disable-next-line no-alert
        alert(`Model "${modelName}" loaded to GPU successfully!`);
      } else {
        // eslint-disable-next-line no-alert
        alert(`Failed to warmup model: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Warmup failed:', error);
      // eslint-disable-next-line no-alert
      alert(`Warmup failed: ${error.message}`);
    } finally {
      setWarmingUp(false);
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
      await window.electronAPI?.setSettings('preferredBackend', newBackend);
      await window.electronAPI?.setBackend?.(newBackend);
      setBackend(newBackend);
    } catch (error) {
      console.error('Failed to change backend:', error);
    }
  };

  const handleProfileChange = async (value) => {
    setProfile(value);
    try {
      await window.electronAPI?.setPerformanceProfile?.(value);
    } catch (error) {
      console.error('Failed to change performance profile:', error);
    }
  };

  const handleNpuOptimize = async () => {
    if (!window.electronAPI?.getNpuStatus) {
      console.error('NPU API not available');
      return;
    }
    
    console.log('[NPU Optimize] Starting full automatic NPU setup...');
    setNpuBusy(true);
    
    try {
      let status = await window.electronAPI.getNpuStatus();
      console.log('[NPU Optimize] Initial status:', status);

      // Step 1: Check/install OpenVINO if needed
      if (!status?.openvinoInstalled || status.setupRequired) {
        // eslint-disable-next-line no-alert
        const ok = window.confirm(
          'DevForge will now set up Intel NPU acceleration. This includes:\n\n' +
            '• Installing OpenVINO runtime\n' +
            '• Configuring the NPU inference server\n' +
            '• Auto-selecting an optimized model\n\n' +
            'This may take a few minutes. Continue?',
        );
        if (!ok) {
          setNpuBusy(false);
          return;
        }

        console.log('[NPU Optimize] Running OpenVINO setup...');
        const result = await window.electronAPI.setupNpu();
        console.log('[NPU Optimize] Setup result:', result);
        
        if (!result?.success) {
          // eslint-disable-next-line no-alert
          alert(
            `OpenVINO setup did not complete.\n\nYou can still use CPU / GPU backends.\n\nDetails: ${
              result?.error || 'Unknown error'
            }`,
          );
          setNpuBusy(false);
          return;
        }

        status = await window.electronAPI.getNpuStatus();
        console.log('[NPU Optimize] Status after setup:', status);
      }

      // Step 2: Auto-configure a model for NPU if not already configured
      if (window.electronAPI.autoConfigureNpuModel) {
        console.log('[NPU Optimize] Auto-configuring NPU model...');
        const configResult = await window.electronAPI.autoConfigureNpuModel();
        console.log('[NPU Optimize] Model config result:', configResult);
        
        if (configResult?.configured) {
          console.log('[NPU Optimize] Model configured:', configResult.model);
        }
      }

      // Step 3: Start the NPU server if not already running
      if (!status.serverRunning && window.electronAPI.startNpuServer) {
        console.log('[NPU Optimize] Starting NPU server...');
        const serverResult = await window.electronAPI.startNpuServer();
        console.log('[NPU Optimize] Server start result:', serverResult);
        
        if (!serverResult?.success) {
          // eslint-disable-next-line no-alert
          alert(
            `NPU server failed to start.\n\nDetails: ${serverResult?.error || 'Unknown error'}\n\nYou can still use CPU / GPU backends.`
          );
          setNpuBusy(false);
          return;
        }
        
        // Wait a moment for server to fully initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        status = await window.electronAPI.getNpuStatus();
        console.log('[NPU Optimize] Status after server start:', status);
      }

      setNpuStatus(status);

      // Step 4: Switch to NPU backend if everything is ready
      if (status.serverRunning) {
        console.log('[NPU Optimize] Switching to OpenVINO NPU backend...');
        await handleBackendChange('openvino-npu');
        // eslint-disable-next-line no-alert
        alert(
          'NPU optimization complete!\n\n' +
          '✓ OpenVINO installed\n' +
          '✓ NPU server running\n' +
          '✓ Backend switched to NPU\n\n' +
          'Your AI inference will now use the Intel NPU for efficient processing.'
        );
      } else if (status.npuAvailable) {
        // eslint-disable-next-line no-alert
        alert('NPU detected but server failed to start. Check Settings for details.');
      } else {
        // eslint-disable-next-line no-alert
        alert('NPU not detected on this system. Using GPU/CPU backends instead.');
      }
    } catch (error) {
      console.error('Failed to optimize NPU:', error);
      // eslint-disable-next-line no-alert
      alert(`NPU optimization failed: ${error.message || error}`);
    } finally {
      setNpuBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-4 border border-forge-border rounded-lg bg-forge-bg/40">
        <h3 className="text-sm font-medium text-text-primary mb-2">System Health Overview</h3>
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Ollama</span>
            <span className={ollamaStatus?.running ? 'text-status-success' : 'text-status-error'}>
              {ollamaStatus?.running ? 'Running' : 'Not running'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">NPU Server</span>
            <span className={npuStatus?.serverRunning ? 'text-status-success' : 'text-status-warning'}>
              {npuStatus?.serverRunning ? 'Online' : 'Offline'}
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
              GPU Model Preload
            </h3>
            <p className="text-xs text-text-muted mt-1">
              {currentModel 
                ? `Load "${currentModel}" into GPU memory for faster first response`
                : 'Select a model first to preload it to GPU'
              }
            </p>
            {runningModels.length > 0 && (
              <div className="mt-2 text-[11px] text-status-success">
                ✓ {runningModels.length} model(s) currently loaded in GPU
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleWarmupModel(currentModel)}
            disabled={warmingUp || !currentModel || !ollamaStatus?.running}
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
          className="input w-full"
        >
          <option value="auto">Auto (Recommended)</option>
          <option value="ollama-cuda">NVIDIA CUDA (RTX GPU)</option>
          <option value="llamacpp-vulkan">Vulkan (Intel Arc)</option>
          <option value="openvino-npu">OpenVINO NPU (Efficiency)</option>
          <option value="ollama-cpu">CPU Only</option>
        </select>
        <p className="text-xs text-text-muted mt-2">
          Auto mode selects the best backend based on your hardware and model size.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Performance Profile</h3>
        <select
          value={profile}
          onChange={(e) => handleProfileChange(e.target.value)}
          disabled={profileLoading}
          className="input w-full"
        >
          <option value="speed">Speed (Prefer GPU/NPU)</option>
          <option value="balanced">Balanced</option>
          <option value="efficiency">Efficiency (Prefer NPU/CPU)</option>
        </select>
        <p className="text-xs text-text-muted mt-2">
          Profiles influence how DevForge schedules work across all backends and how the job queue
          prioritizes requests.
        </p>
      </div>

      {/* NPU One‑Click Setup */}
      <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-medium text-text-primary">Intel NPU Acceleration</h3>
            <p className="text-xs text-text-muted mt-1">
              Let DevForge set up OpenVINO and start the NPU server for you. No terminal commands
              required.
            </p>
            {npuStatus && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${npuStatus.openvinoInstalled ? 'bg-status-success' : 'bg-status-error'}`} />
                  <span className="text-text-muted">OpenVINO: {npuStatus.openvinoInstalled ? `Installed (${npuStatus.openvinoVersion || 'env'})` : 'Not installed'}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${npuStatus.npuAvailable ? 'bg-status-success' : 'bg-status-warning'}`} />
                  <span className="text-text-muted">NPU Device: {npuStatus.npuAvailable ? 'Detected' : 'Not detected'}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${npuStatus.serverRunning ? 'bg-status-success' : 'bg-status-error'}`} />
                  <span className="text-text-muted">Server: {npuStatus.serverRunning ? 'Running on port 8081' : 'Not running'}</span>
                </div>
                {npuStatus.devices?.length > 0 && (
                  <div className="text-[11px] text-text-muted mt-1">
                    Available devices: {npuStatus.devices.map(d => d.id).join(', ')}
                  </div>
                )}
                {npuStatus.error && (
                  <div className="text-[11px] text-status-error mt-1">
                    Error: {npuStatus.error}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleNpuOptimize}
              disabled={npuBusy}
              className="btn btn-primary whitespace-nowrap text-xs"
            >
              {npuBusy ? 'Optimizing…' : npuStatus?.serverRunning ? 'Restart NPU' : 'Start NPU Server'}
            </button>
            {npuStatus?.serverRunning && (
              <button
                type="button"
                onClick={async () => {
                  await window.electronAPI?.stopNpuServer();
                  const status = await window.electronAPI?.getNpuStatus();
                  setNpuStatus(status);
                }}
                className="btn btn-secondary whitespace-nowrap text-xs"
              >
                Stop Server
              </button>
            )}
          </div>
        </div>
      </div>

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
        // File download — show fine-grained progress
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
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
                  {showModelNeeded && !busy && ' — download a starter model below'}
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
        
        <div className="flex flex-col gap-2">
          {(!imageStatus?.installed || showModelNeeded) && (
            <button
              type="button"
              onClick={handleSetup}
              disabled={busy}
              className="btn btn-primary whitespace-nowrap text-xs"
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
                className={`btn whitespace-nowrap text-xs ${imageStatus?.running ? 'btn-secondary' : 'btn-primary'}`}
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
                  className="btn btn-secondary whitespace-nowrap text-xs"
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
  const [loading, setLoading] = React.useState(true);
  const workspace = React.useMemo(() => 
    window.electronAPI?.getSettings?.('lastWorkspace') || 'casual', 
  []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mems, st, soul] = await Promise.all([
        window.electronAPI?.memoryGetMemories?.({ workspace: 'casual' }),
        window.electronAPI?.memoryGetStats?.({ workspace: 'casual' }),
        window.electronAPI?.soulGetStats?.(),
      ]);
      setMemories(mems || []);
      setStats(st || { memories: 0, summaries: 0, pinned: 0 });
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
      {soulStats && (
        <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-purple-300 mb-3 flex items-center gap-2">
            <span>✨</span> Our Relationship
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
              <div className="text-xl font-bold text-amber-400">{soulStats.currentStreak} 🔥</div>
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
        <h3 className="text-sm font-medium text-blue-400 mb-2">💡 How Memory Works</h3>
        <ul className="text-xs text-text-secondary space-y-1">
          <li>• <strong>Auto-Summary:</strong> Long conversations are summarized to preserve context</li>
          <li>• <strong>Fact Extraction:</strong> Important facts about you are remembered</li>
          <li>• <strong>Pinned Messages:</strong> Click 📌 on any message to ensure it's always included</li>
          <li>• <strong>Smart Context:</strong> Instead of just last 10 messages, AI sees relevant history</li>
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
