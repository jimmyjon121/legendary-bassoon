import React, { useState, useEffect } from 'react';
import { Check, X, Loader, Download, ArrowRight, ArrowLeft, Sparkles, ExternalLink, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';

const RECOMMENDED_MODEL = 'llama3.2:3b'; // Small, fast, good quality

export function OnboardingWizard({ onComplete }) {
  const { initializeApp, setModel, refreshModels, setNsfwPassword } = useAppStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [setupStatus, setSetupStatus] = useState('auto-setup'); // auto-setup, checking, ready, no-ollama, no-models, downloading, error
  const [downloadProgress, setDownloadProgress] = useState('');
  const [error, setError] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(true);
  const [systemHealth, setSystemHealth] = useState(null);
  const [setupLog, setSetupLog] = useState([]);

  useEffect(() => {
    // Listen for auto-setup completion from main process
    if (window.electronAPI?.onAutoSetupComplete) {
      window.electronAPI.onAutoSetupComplete((result) => {
        console.log('Auto-setup completed:', result);
        setSetupLog(result.log || []);
        setSetupStatus('checking');
        // After auto-setup, check the actual status
        setTimeout(() => {
          setIsSettingUp(false);
          checkSetup();
        }, 500);
      });
    } else {
      // If in browser mode, skip auto-setup and go straight to checking
      setSetupStatus('checking');
      checkSetup();
    }
  }, []);

  const checkSetup = async () => {
    console.log('Checking setup...');
    setIsSettingUp(true);
    setError('');
    
    try {
      // Check if Ollama is running
      console.log('Checking Ollama health...');
      const health = await window.electronAPI?.checkLLMHealth();
      console.log('Health result:', health);
      
      if (!health?.healthy) {
        console.log('Ollama not healthy');
        
        // Check if Ollama is installed but just not running
        const ollamaStatus = await window.electronAPI?.getOllamaStatus?.();
        console.log('Ollama status:', ollamaStatus);
        
        if (ollamaStatus?.installed && !ollamaStatus?.running) {
          console.log('Ollama installed but not running');
          setSetupStatus('ollama-not-running');
          setIsSettingUp(false);
          return;
        }
        
        console.log('Ollama not installed, setting no-ollama');
        setSetupStatus('no-ollama');
        setIsSettingUp(false);
        return;
      }
      
      // Check if we have models
      console.log('Getting models...');
      const models = await window.electronAPI?.getModels();
      console.log('Models:', models);
      
      if (!models || models.length === 0) {
        console.log('No models found, setting no-models');
        setSetupStatus('no-models');
        setIsSettingUp(false);
        return;
      }

      const summary = {
        ollama: await window.electronAPI?.getOllamaStatus?.(),
        npu: (await window.electronAPI?.getNpuStatus?.()) || null,
        image: (await window.electronAPI?.getImageBackendStatus?.()) || null,
      };
      setSystemHealth(summary);
      
      // All good!
      console.log('All good! Setting ready');
      setSetupStatus('ready');
      setIsSettingUp(false);
      
      // Auto-select first model
      await setModel(models[0].name);
      
    } catch (err) {
      console.error('Setup check error:', err);
      setSetupStatus('no-ollama');
      setError(err.message);
      setIsSettingUp(false);
    }
  };

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
        detail: systemHealth.npu?.npuAvailable ? 'NPU detected' : 'NPU not detected',
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
        className="w-full max-w-xl bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-forge-border text-center">
          <div className="w-16 h-16 rounded-2xl bg-workspace-casual/20 border border-workspace-casual/30 flex items-center justify-center mx-auto mb-4">
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
                  className="btn btn-primary w-full text-lg py-3 mb-4"
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
                    className="btn btn-primary w-full text-lg py-3"
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
                  className="btn btn-primary w-full text-lg py-3 disabled:opacity-50"
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
                    <span className="text-text-secondary">Ollama connected</span>
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
                  className="btn btn-primary w-full text-lg py-3"
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
        {(setupStatus === 'no-ollama' || setupStatus === 'no-models') && (
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
