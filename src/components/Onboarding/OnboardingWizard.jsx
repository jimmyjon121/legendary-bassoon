import React, { useState, useEffect } from 'react';
import { Check, X, Loader, Download, ArrowRight, ArrowLeft, Sparkles, ExternalLink, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';

const RECOMMENDED_MODEL = 'llama3.2:3b'; // Small, fast, good quality
const STARTUP_READY_PROBE_DELAY_MS = 1200;
const STARTUP_SIGNAL_FALLBACK_MS = 8000;
const OPTIONAL_HEALTH_TIMEOUT_MS = 2500;

async function optionalHealthProbe(label, promise, fallback = null) {
  if (!promise) return fallback;
  let timeoutId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`[Onboarding] Optional ${label} health probe timed out; continuing`);
          resolve(fallback);
        }, OPTIONAL_HEALTH_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn(`[Onboarding] Optional ${label} health probe failed:`, error?.message || error);
    return fallback;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function OnboardingWizard({ onComplete }) {
  const initializeApp = useAppStore((s) => s.initializeApp);
  const setModel = useAppStore((s) => s.setModel);
  const setPreferredBackend = useAppStore((s) => s.setPreferredBackend);
  const refreshModels = useAppStore((s) => s.refreshModels);
  const refreshLlmRuntime = useAppStore((s) => s.refreshLlmRuntime);
  const [currentStep, setCurrentStep] = useState(0);
  const [setupStatus, setSetupStatus] = useState('auto-setup'); // auto-setup, checking, ready, no-ollama, no-models, ollama-not-running, npu-available, downloading, error
  const [downloadProgress, setDownloadProgress] = useState('');
  const [error, setError] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(true);
  const [systemHealth, setSystemHealth] = useState(null);
  const [setupLog, setSetupLog] = useState([]);

  const getConfiguredNpuModelId = React.useCallback((status) => {
    const modelId = String(status?.model || status?.modelPath || '').trim();
    return modelId || null;
  }, []);

  const loadSystemHealth = React.useCallback(async () => {
    const [ollama, npu, image] = await Promise.all([
      window.electronAPI?.getOllamaStatus?.(),
      optionalHealthProbe('NPU', window.electronAPI?.getNpuStatus?.({ force: false })),
      optionalHealthProbe('image backend', window.electronAPI?.getImageBackendStatus?.()),
    ]);
    const summary = {
      ollama,
      npu: npu || null,
      image: image || null,
    };
    setSystemHealth(summary);
    return summary;
  }, []);

  const activateNpuRuntime = React.useCallback(async (options = {}) => {
    setIsSettingUp(true);
    setError('');
    setSetupStatus('npu-available');

    try {
      let npuStatus = await window.electronAPI?.getNpuStatus?.({ force: true });
      let modelId = getConfiguredNpuModelId(npuStatus);

      if (!modelId && options.autoConfigure !== false) {
        const configResult = await window.electronAPI?.autoConfigureNpuModel?.({
          enableAutoStart: true,
          workload: 'chat',
          profile: 'balanced',
          forceStatusRefresh: true,
        });
        modelId = String(configResult?.model || '').trim() || modelId;
        npuStatus = await window.electronAPI?.getNpuStatus?.({ force: true }) || npuStatus;
        modelId = modelId || getConfiguredNpuModelId(npuStatus);
      }

      if (!modelId) {
        throw new Error('No OpenVINO model is configured for the NPU yet.');
      }

      if (!npuStatus?.serverRunning) {
        const startResult = await window.electronAPI?.startNpuServer?.({ device: 'NPU' });
        if (!startResult?.success) {
          throw new Error(startResult?.error || 'Failed to start the OpenVINO server');
        }
      }

      await setPreferredBackend?.('openvino-npu');
      const selection = `npu:${modelId}`;
      const setResult = await setModel(selection);
      if (setResult?.success === false) {
        throw new Error(setResult?.error || 'Failed to select the NPU model');
      }

      await loadSystemHealth();
      setSetupStatus('ready');
    } catch (err) {
      console.error('NPU activation failed:', err);
      setError(err?.message || 'Failed to enable the NPU runtime');
      setSetupStatus('npu-available');
    } finally {
      setIsSettingUp(false);
    }
  }, [getConfiguredNpuModelId, loadSystemHealth, setModel, setPreferredBackend]);

  const checkSetup = React.useCallback(async (options = {}) => {
    const readyOnly = options.readyOnly === true;
    console.log('Checking setup...', readyOnly ? '(ready-only probe)' : '');
    setIsSettingUp(true);
    setError('');
    
    try {
      console.log('Checking Ollama health...');
      const runtime = await refreshLlmRuntime?.({
        refreshModels: true,
        hydrateSelection: false,
        persistResolvedSelection: false,
        updateError: false,
        skipStatus: true,
      });
      const summary = await loadSystemHealth();
      const npuStatus = summary?.npu || null;
      const configuredNpuModelId = getConfiguredNpuModelId(npuStatus);
      const npuAvailable = Boolean(npuStatus?.openvinoInstalled && npuStatus?.npuAvailable);
      const npuConfigured = Boolean(npuAvailable && configuredNpuModelId);
      const health = runtime?.llmHealth || useAppStore.getState().llmHealth;
      console.log('Health result:', health);

      if (npuConfigured && npuStatus?.serverRunning) {
        try {
          await setPreferredBackend?.('openvino-npu');
          const selection = `npu:${configuredNpuModelId}`;
          const setResult = await setModel(selection);
          if (setResult?.success === false) {
            throw new Error(setResult?.error || 'Failed to select the NPU model');
          }
          console.log('NPU runtime already ready, using it for onboarding');
          setSetupStatus('ready');
          setIsSettingUp(false);
          return true;
        } catch (npuError) {
          console.warn('Failed to auto-select configured NPU model:', npuError);
          if (readyOnly) {
            return false;
          }
          setError(npuError?.message || 'Failed to activate the configured NPU model');
          setSetupStatus('npu-available');
          setIsSettingUp(false);
          return false;
        }
      }
      
      if (!health?.healthy) {
        console.log('Ollama not healthy');

        if (readyOnly) {
          return false;
        }

        if (npuAvailable) {
          console.log('NPU acceleration is available, offering NPU onboarding path');
          setSetupStatus('npu-available');
          setIsSettingUp(false);
          return false;
        }
        
        // Check if Ollama is installed but just not running
        const ollamaStatus = runtime?.ollamaStatus || summary?.ollama || await window.electronAPI?.getOllamaStatus?.();
        console.log('Ollama status:', ollamaStatus);
        
        if (ollamaStatus?.installed && !ollamaStatus?.running) {
          console.log('Ollama installed but not running');
          setSetupStatus('ollama-not-running');
          setIsSettingUp(false);
          return false;
        }
        
        console.log('Ollama not installed, setting no-ollama');
        setSetupStatus('no-ollama');
        setIsSettingUp(false);
        return false;
      }
      
      // Check if we have models
      console.log('Getting models...');
      const models = Array.isArray(runtime?.availableModels)
        ? runtime.availableModels
        : (useAppStore.getState().availableModels || []);
      console.log('Models:', models);
      
      if (!models || models.length === 0) {
        if (readyOnly) {
          return false;
        }
        if (npuAvailable) {
          console.log('No Ollama models found, but NPU acceleration is available');
          setSetupStatus('npu-available');
          setIsSettingUp(false);
          return false;
        }
        console.log('No models found, setting no-models');
        setSetupStatus('no-models');
        setIsSettingUp(false);
        return false;
      }
      
      // All good!
      console.log('All good! Setting ready');
      setSetupStatus('ready');
      setIsSettingUp(false);
      
      // Auto-select first model
      const startupModel = runtime?.model || models[0]?.name || null;
      if (startupModel) {
        await setModel(startupModel);
      }
      return true;
      
    } catch (err) {
      console.error('Setup check error:', err);
      if (readyOnly) {
        return false;
      }
      setSetupStatus('no-ollama');
      setError(err.message);
      setIsSettingUp(false);
      return false;
    }
  }, [getConfiguredNpuModelId, loadSystemHealth, refreshLlmRuntime, setModel, setPreferredBackend]);

  useEffect(() => {
    let unsubscribe = null;
    let readyProbeTimer = null;
    let fallbackTimer = null;
    let checkTimer = null;
    let completed = false;
    let cancelled = false;

    const clearStartupTimers = () => {
      if (readyProbeTimer) clearTimeout(readyProbeTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (checkTimer) clearTimeout(checkTimer);
    };

    const appendSetupLog = (message) => {
      setSetupLog((prev) => (Array.isArray(prev) ? prev : []).concat([
        `[${new Date().toISOString()}] ${message}`,
      ]));
    };

    const markCompletedAndCheck = (source = 'ipc') => {
      if (completed || cancelled) return;
      completed = true;
      clearStartupTimers();
      if (source === 'fallback') {
        console.warn(`[Onboarding] auto-setup-complete did not arrive within ${STARTUP_SIGNAL_FALLBACK_MS}ms; proceeding with local health check`);
        appendSetupLog(`[WARN] Startup signal timed out after ${Math.round(STARTUP_SIGNAL_FALLBACK_MS / 1000)}s; continuing with local checks`);
      }
      setSetupStatus('checking');
      checkTimer = setTimeout(() => {
        if (cancelled) return;
        checkSetup({ source });
      }, 300);
    };

    const runReadyProbe = async () => {
      if (completed || cancelled) return;
      const ready = await checkSetup({ readyOnly: true, source: 'local-ready-probe' });
      if (cancelled) return;
      if (ready) {
        if (!completed) {
          completed = true;
          clearStartupTimers();
          appendSetupLog('[INFO] Local runtime was ready before startup signal completed');
        }
        return;
      }
      if (!completed) {
        appendSetupLog('[INFO] Local runtime is not ready yet; waiting briefly for startup services');
      }
    };

    if (window.electronAPI?.onAutoSetupComplete) {
      unsubscribe = window.electronAPI.onAutoSetupComplete((result) => {
        console.log('Auto-setup completed:', result);
        setSetupLog(result?.log || []);
        markCompletedAndCheck('ipc');
      });
      readyProbeTimer = setTimeout(runReadyProbe, STARTUP_READY_PROBE_DELAY_MS);
      fallbackTimer = setTimeout(() => markCompletedAndCheck('fallback'), STARTUP_SIGNAL_FALLBACK_MS);
    } else {
      markCompletedAndCheck('no-ipc');
    }

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      clearStartupTimers();
    };
  }, [checkSetup]);

  const handleOneClickSetup = async () => {
    setIsSettingUp(true);
    setSetupStatus('downloading');
    setDownloadProgress('Starting download...');
    setError('');
    
    try {
      // Pull the recommended model via Ollama API
      const endpoint = await window.electronAPI?.getSettings('llmEndpoint') || 'http://localhost:11434';
      
      // Start the pull - this streams progress
      const response = await fetch(`${endpoint}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: RECOMMENDED_MODEL, stream: true })
      });
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.status) {
              if (data.completed && data.total) {
                const percent = Math.round((data.completed / data.total) * 100);
                const mb = Math.round(data.completed / 1024 / 1024);
                const totalMb = Math.round(data.total / 1024 / 1024);
                setDownloadProgress(`${data.status}: ${mb}MB / ${totalMb}MB (${percent}%)`);
              } else {
                setDownloadProgress(data.status);
              }
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) {
              throw e;
            }
          }
        }
      }
      
      setDownloadProgress('Model downloaded! Setting up...');
      
      // Refresh models and select the new one
      await refreshModels();
      await setModel(RECOMMENDED_MODEL);
      
      setSetupStatus('ready');
      setDownloadProgress('');
      
    } catch (err) {
      setError(err.message || 'Download failed');
      setSetupStatus('no-models');
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleComplete = async () => {
    console.log('Complete clicked');
    try {
      await window.electronAPI?.setSettings('hasOnboarded', true);
    } catch (e) {
      console.log('setSettings failed (expected in browser):', e);
    }
    if (onComplete) {
      onComplete();
    } else {
      await initializeApp();
    }
  };

  const handleSkipSetup = async () => {
    console.log('Skip clicked');
    try {
      await window.electronAPI?.setSettings('hasOnboarded', true);
    } catch (e) {
      console.log('setSettings failed (expected in browser):', e);
    }
    if (onComplete) {
      onComplete();
    } else {
      await initializeApp();
    }
  };

  const openOllamaDownload = () => {
    window.electronAPI?.openExternal?.('https://ollama.ai/download');
    // Fallback for if openExternal isn't available
    window.open('https://ollama.ai/download', '_blank');
  };

  const renderHealthSummary = () => {
    if (!systemHealth) return null;
    const items = [
      {
        label: 'Ollama',
        ok: systemHealth.ollama?.running,
        detail: systemHealth.ollama?.installed ? 'Installed' : 'Install required',
      },
      {
        label: 'NPU Server',
        ok: systemHealth.npu?.serverRunning,
        detail: getConfiguredNpuModelId(systemHealth.npu)
          ? `Configured: ${getConfiguredNpuModelId(systemHealth.npu).split('/').pop()}`
          : (systemHealth.npu?.npuAvailable ? 'NPU detected' : 'NPU not detected'),
      },
      {
        label: 'Image Backend',
        ok: systemHealth.image?.running,
        detail: systemHealth.image?.installed ? 'Configured' : 'Not configured',
      },
    ];

    return (
      <div className="mt-6 border border-forge-border rounded-lg p-3">
        <h4 className="text-sm font-medium text-text-primary mb-2">System Health</h4>
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.label} className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">{item.label}</span>
              <span className={item.ok ? 'text-status-success' : 'text-status-error'}>
                {item.ok ? 'Ready' : 'Action needed'} • {item.detail}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-screen bg-forge-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl bg-forge-surface border border-forge-border rounded-xl shadow-[0_24px_70px_-42px_rgba(0,0,0,0.92)] overflow-hidden"
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-forge-border text-center">
          <div className="w-14 h-14 rounded-xl bg-workspace-casual/20 border border-workspace-casual/30 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={32} className="text-workspace-casual" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Welcome to DevForge</h1>
          <p className="text-text-secondary mt-2">Your private AI assistant - 100% local</p>
        </div>

        {/* Content */}
        <div className="p-8">
          <AnimatePresence mode="wait">
            {setupStatus === 'auto-setup' && (
              <motion.div
                key="auto-setup"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-8"
              >
                <Loader size={48} className="animate-spin text-workspace-casual mx-auto mb-4" />
                <p className="text-lg text-text-primary font-medium mb-2">Setting up DevForge...</p>
                <p className="text-sm text-text-secondary mb-4">Configuring backends and checking system</p>
                
                {setupLog.length > 0 && (
                  <div className="mt-6 max-h-40 overflow-y-auto bg-forge-bg rounded-lg p-3 text-left">
                    {setupLog.map((log, idx) => (
                      <div key={idx} className="text-xs text-text-muted font-mono mb-1">
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {setupStatus === 'checking' && (
              <motion.div
                key="checking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-12"
              >
                <Loader size={48} className="animate-spin text-workspace-casual mx-auto mb-4" />
                <p className="text-text-secondary">Checking your setup...</p>
              </motion.div>
            )}

            {setupStatus === 'ollama-not-running' && (
              <motion.div
                key="ollama-not-running"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center"
              >
                <div className="w-20 h-20 rounded-full bg-workspace-casual/20 flex items-center justify-center mx-auto mb-6">
                  <Sparkles size={40} className="text-workspace-casual" />
                </div>
                
                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  Start Ollama
                </h2>
                <p className="text-text-secondary mb-6">
                  Ollama is installed but not running. Click below to start it.
                </p>

                <button
                  onClick={async () => {
                    setIsSettingUp(true);
                    try {
                      const result = await window.electronAPI?.startOllama();
                      if (result?.success) {
                        // Wait a moment for Ollama to fully start
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await checkSetup();
                      } else {
                        setError(result?.error || 'Failed to start Ollama');
                        setIsSettingUp(false);
                      }
                    } catch (err) {
                      setError(err.message);
                      setIsSettingUp(false);
                    }
                  }}
                  disabled={isSettingUp}
                  className="btn btn-primary w-full text-base py-2.5 mb-4"
                >
                  {isSettingUp ? (
                    <>
                      <Loader size={20} className="animate-spin" />
                      Starting Ollama...
                    </>
                  ) : (
                    <>
                      <Sparkles size={20} />
                      Start Ollama Now
                    </>
                  )}
                </button>

                {error && (
                  <div className="mt-4 p-3 bg-status-error/10 border border-status-error/30 rounded-lg text-sm text-status-error">
                    {error}
                  </div>
                )}
              </motion.div>
            )}

            {setupStatus === 'no-ollama' && (
              <motion.div
                key="no-ollama"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center"
              >
                <div className="w-20 h-20 rounded-full bg-status-warning/20 flex items-center justify-center mx-auto mb-6">
                  <Download size={40} className="text-status-warning" />
                </div>
                
                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  Install Ollama First
                </h2>
                <p className="text-text-secondary mb-6">
                  DevForge needs Ollama to run AI models locally. It's free and takes 2 minutes.
                </p>

                <div className="space-y-4">
                  <button
                    onClick={openOllamaDownload}
                    className="btn btn-primary w-full text-base py-2.5"
                  >
                    <ExternalLink size={20} />
                    Download Ollama (Free)
                  </button>
                  
                  <div className="p-4 bg-forge-bg rounded-lg text-left text-sm text-text-muted">
                    <p className="font-medium text-text-secondary mb-2">After installing:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Open Ollama (it runs in the background)</li>
                      <li>Come back here and click the button below</li>
                    </ol>
                  </div>

                  <button
                    onClick={() => {
                      console.log('Check button clicked');
                      checkSetup();
                    }}
                    disabled={isSettingUp}
                    className="btn btn-secondary w-full disabled:opacity-50 cursor-pointer hover:bg-forge-hover active:scale-[0.98] transition-all"
                    type="button"
                  >
                    {isSettingUp ? (
                      <>
                        <Loader size={16} className="animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} />
                        I've Installed Ollama - Check Again
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {setupStatus === 'npu-available' && (
              <motion.div
                key="npu-available"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center"
              >
                <div className="w-20 h-20 rounded-full bg-workspace-casual/20 flex items-center justify-center mx-auto mb-6">
                  <Sparkles size={40} className="text-workspace-casual" />
                </div>

                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  NPU Acceleration Is Available
                </h2>
                <p className="text-text-secondary mb-6">
                  DevForge can start with your local OpenVINO/NPU runtime even if Ollama is not ready.
                </p>

                <div className="p-4 mb-4 bg-forge-bg rounded-lg text-left text-sm text-text-muted">
                  <p className="font-medium text-text-secondary mb-2">What this will do:</p>
                  <ul className="space-y-1">
                    <li>Start the OpenVINO inference server</li>
                    <li>{getConfiguredNpuModelId(systemHealth?.npu) ? 'Use your configured NPU model' : 'Auto-select an NPU-friendly model'}</li>
                    <li>Make the NPU runtime the active backend</li>
                  </ul>
                </div>

                {error && (
                  <div className="p-4 mb-4 bg-status-error/20 border border-status-error/30 rounded-lg text-status-error text-sm">
                    {error}
                  </div>
                )}

                <button
                  onClick={() => activateNpuRuntime({ autoConfigure: true })}
                  disabled={isSettingUp}
                  className="btn btn-primary w-full text-base py-2.5 disabled:opacity-50"
                >
                  {isSettingUp ? (
                    <>
                      <Loader size={20} className="animate-spin" />
                      Starting NPU Runtime...
                    </>
                  ) : (
                    <>
                      <Sparkles size={20} />
                      Use NPU Acceleration
                    </>
                  )}
                </button>

                <button
                  onClick={checkSetup}
                  disabled={isSettingUp}
                  className="btn btn-secondary w-full mt-3"
                  type="button"
                >
                  <RefreshCw size={16} />
                  Check Again
                </button>
              </motion.div>
            )}

            {setupStatus === 'no-models' && (
              <motion.div
                key="no-models"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center"
              >
                <div className="w-20 h-20 rounded-full bg-workspace-casual/20 flex items-center justify-center mx-auto mb-6">
                  <Check size={40} className="text-workspace-casual" />
                </div>
                
                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  Ollama is Running! 🎉
                </h2>
                <p className="text-text-secondary mb-6">
                  Now let's download an AI model. This is a one-time ~2GB download.
                </p>

                {error && (
                  <div className="p-4 mb-4 bg-status-error/20 border border-status-error/30 rounded-lg text-status-error text-sm">
                    {error}
                  </div>
                )}

                <button
                  onClick={handleOneClickSetup}
                  disabled={isSettingUp}
                  className="btn btn-primary w-full text-base py-2.5 disabled:opacity-50"
                >
                  {isSettingUp ? (
                    <>
                      <Loader size={20} className="animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download size={20} />
                      Download AI Model (2GB)
                    </>
                  )}
                </button>

                <p className="text-xs text-text-muted mt-3">
                  Downloads Llama 3.2 (3B) - fast and capable
                </p>
              </motion.div>
            )}

            {setupStatus === 'downloading' && (
              <motion.div
                key="downloading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-8"
              >
                <Loader size={48} className="animate-spin text-workspace-casual mx-auto mb-6" />
                
                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  Downloading AI Model
                </h2>
                <p className="text-text-secondary mb-4">
                  This may take a few minutes depending on your internet speed.
                </p>
                
                <div className="p-4 bg-forge-bg rounded-lg">
                  <p className="text-sm text-text-primary font-mono">
                    {downloadProgress || 'Starting...'}
                  </p>
                </div>

                <p className="text-xs text-text-muted mt-4">
                  Don't close this window
                </p>
              </motion.div>
            )}

            {setupStatus === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center"
              >
                <div className="w-20 h-20 rounded-full bg-status-success/20 flex items-center justify-center mx-auto mb-6">
                  <Check size={40} className="text-status-success" />
                </div>
                
                <h2 className="text-xl font-semibold text-text-primary mb-2">
                  You're All Set! 🚀
                </h2>
                <p className="text-text-secondary mb-6">
                  DevForge is ready. Start chatting with your private AI.
                </p>

                <div className="space-y-3 text-left p-4 bg-forge-bg rounded-lg mb-6">
                  <div className="flex items-center gap-3 text-sm">
                    <Check size={16} className="text-status-success flex-shrink-0" />
                    <span className="text-text-secondary">
                      {systemHealth?.npu?.serverRunning
                        ? 'OpenVINO runtime connected'
                        : systemHealth?.ollama?.running
                          ? 'Ollama connected'
                          : 'Local runtime connected'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Check size={16} className="text-status-success flex-shrink-0" />
                    <span className="text-text-secondary">AI model ready</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Check size={16} className="text-status-success flex-shrink-0" />
                    <span className="text-text-secondary">100% private - nothing leaves your computer</span>
                  </div>
                </div>

                <button
                  onClick={handleComplete}
                  className="btn btn-primary w-full text-base py-2.5"
                >
                  Start Using DevForge
                  <ArrowRight size={20} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {renderHealthSummary()}
        </div>

        {/* Footer */}
        {(setupStatus === 'no-ollama' || setupStatus === 'no-models' || setupStatus === 'npu-available') && (
          <div className="px-8 py-4 border-t border-forge-border">
            <button
              onClick={handleSkipSetup}
              type="button"
              className="text-sm text-text-muted hover:text-text-secondary w-full text-center cursor-pointer py-2"
            >
              Skip setup and configure later →
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
