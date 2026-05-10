import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Image, Download, CheckCircle, ExternalLink, Loader, AlertTriangle, 
  Folder, Play, Shield, Zap, Eye, HardDrive, RefreshCw, Sparkles
} from 'lucide-react';
import { api, safeCall } from '../../utils/electronAPI';

// NSFW-friendly models - NO safety filters or content restrictions
const AVAILABLE_MODELS = {
  sdxl: [
    {
      id: 'ponyDiffusionV6',
      name: 'Pony Diffusion V6 XL',
      description: 'Artistic SDXL model - fully unrestricted, excellent for creative content',
      size: '6.5 GB',
      resolution: '1024×1024',
      nsfw: true,
      recommended: true,
      tags: ['artistic', 'versatile', 'nsfw-capable'],
    },
    {
      id: 'realvisxl_v5',
      name: 'RealVisXL V5.0',
      description: 'Photorealistic SDXL - no content restrictions',
      size: '6.5 GB',
      resolution: '1024×1024',
      nsfw: true,
      tags: ['photorealistic', 'portraits', 'nsfw-capable'],
    },
  ],
  sd15: [
    {
      id: 'realisticVisionV60',
      name: 'Realistic Vision V6.0',
      description: 'Best photorealistic SD 1.5 model - unrestricted',
      size: '2.1 GB',
      resolution: '512×512',
      nsfw: true,
      tags: ['photorealistic', 'fast', 'nsfw-capable'],
    },
    {
      id: 'deliberate_v6',
      name: 'Deliberate V6',
      description: 'Versatile artistic model - no content filters',
      size: '2.0 GB',
      resolution: '512×512',
      nsfw: true,
      tags: ['artistic', 'versatile', 'nsfw-capable'],
    },
  ],
  flux: [
    {
      id: 'flux1_dev',
      name: 'Flux.1 Dev',
      description: 'Latest technology - unrestricted, best prompt following',
      size: '24 GB',
      resolution: '1024×1024',
      nsfw: true,
      vramRequired: '16+ GB',
      tags: ['cutting-edge', 'best-quality', 'nsfw-capable'],
    },
  ],
};

export function ImageSetupWizard({ onComplete, onSkip }) {
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [selectedModelType, setSelectedModelType] = useState('sdxl');
  const [selectedModel, setSelectedModel] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [error, setError] = useState('');

  // Check ComfyUI status on mount
  useEffect(() => {
    checkStatus();
    
    // Listen for download progress
    const unsubscribe = window.electronAPI?.onComfyuiDownloadProgress?.((data) => {
      setDownloadProgress(data);
    });
    
    return () => unsubscribe?.();
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const result = await safeCall('comfyuiGetStatus', [], { installed: false, running: false });
      setStatus(result);
      
      // If already installed and has models, we might skip some steps
      if (result.installed && result.models?.length > 0) {
        setStep(4); // Go to ready step
      } else if (result.installed) {
        setStep(3); // Go to model selection
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleInstallComfyUI = async () => {
    setInstalling(true);
    setError('');
    
    try {
      const result = await safeCall('comfyuiInstall', [{}], { success: false });
      
      if (result.success) {
        setStatus(prev => ({ ...prev, installed: true }));
        setStep(result.requiresManualDownload ? 2 : 3);
      } else {
        setError(result.error || 'Installation failed');
      }
    } catch (err) {
      setError(err.message);
    }
    
    setInstalling(false);
  };

  const handleStartComfyUI = async () => {
    setLoading(true);
    try {
      const result = await safeCall('comfyuiStart', [], { success: false });
      if (result.success) {
        setStatus(prev => ({ ...prev, running: true }));
        // Refresh to get model list
        setTimeout(checkStatus, 2000);
      } else {
        setError(result.error || 'Failed to start ComfyUI');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleDownloadModel = async (model) => {
    setSelectedModel(model);
    setDownloadProgress({ modelId: model.id, percent: 0 });
    setError('');
    
    try {
      const result = await safeCall('comfyuiDownloadModel', [model], { success: false });
      
      if (result.success) {
        setDownloadProgress(null);
        if (result.alreadyExists) {
          setStep(4);
        } else {
          // Refresh model list
          await checkStatus();
          setStep(4);
        }
      } else {
        setError(result.error || 'Download failed');
        setDownloadProgress(null);
      }
    } catch (err) {
      setError(err.message);
      setDownloadProgress(null);
    }
  };

  const openExternalLink = (url) => {
    api.openExternal(url);
  };

  const openDetectedPath = async () => {
    if (!status?.path) return;
    const result = await api.openPath(status.path);
    if (result?.success === false) {
      setError(result.error || 'Failed to open detected path');
    }
  };

  // Step 1: Introduction & Check
  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mb-4">
          <Image className="text-pink-400" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-text-primary">Local Image Generation</h2>
        <p className="text-sm text-text-muted mt-2">
          Completely offline, unrestricted, private image generation
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: Shield, label: 'No Content Filters', desc: 'Full creative freedom' },
          { icon: Zap, label: 'Fully Offline', desc: 'Works without internet' },
          { icon: Eye, label: 'NSFW Capable', desc: 'Adult content supported' },
          { icon: HardDrive, label: 'Local Storage', desc: 'Your data stays private' },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="p-3 bg-neutral-900 rounded-lg border border-neutral-800">
            <Icon size={18} className="text-pink-400 mb-2" />
            <p className="text-sm font-medium text-text-primary">{label}</p>
            <p className="text-xs text-text-muted">{desc}</p>
          </div>
        ))}
      </div>

      {/* Status Check */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader className="animate-spin text-pink-400" size={20} />
          <span className="text-sm text-text-muted">Checking installation...</span>
        </div>
      ) : status?.installed ? (
        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle className="text-green-400" size={20} />
            <span className="text-sm font-medium text-green-400">ComfyUI Detected!</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-text-muted truncate" title={status.path}>
              Found at: {status.path}
            </p>
            <button
              type="button"
              onClick={openDetectedPath}
              className="text-xs text-green-300 hover:text-green-200 whitespace-nowrap"
            >
              Open
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-amber-400" size={20} />
            <span className="text-sm font-medium text-amber-400">ComfyUI Not Installed</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            We'll help you set it up in the next step
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onSkip} className="btn btn-secondary flex-1">
          Skip for Now
        </button>
        <button 
          onClick={() => status?.installed ? setStep(3) : setStep(2)} 
          className="btn bg-gradient-to-r from-pink-500 to-purple-500 text-white flex-1 hover:opacity-90"
          disabled={loading}
        >
          {status?.installed ? 'Choose Models' : 'Set Up Now'}
        </button>
      </div>
    </div>
  );

  // Step 2: Install ComfyUI
  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <Download className="mx-auto text-pink-400 mb-3" size={48} />
        <h2 className="text-xl font-semibold text-text-primary">Install ComfyUI</h2>
        <p className="text-sm text-text-muted mt-2">
          The most powerful local image generation backend
        </p>
      </div>

      <div className="space-y-4 bg-neutral-900 rounded-lg p-4 border border-neutral-800">
        {[
          { num: 1, title: 'Download ComfyUI Portable', action: 'download' },
          { num: 2, title: 'Extract to folder', desc: 'C:\\Anvil\\ComfyUI recommended' },
          { num: 3, title: 'Download a model', action: 'next' },
          { num: 4, title: 'Run & Generate!', desc: 'Anvil auto-detects ComfyUI' },
        ].map(({ num, title, desc, action }) => (
          <div key={num} className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-sm font-bold flex-shrink-0">
              {num}
            </div>
            <div className="flex-1">
              <p className="text-sm text-text-primary font-medium">{title}</p>
              {desc && <p className="text-xs text-text-muted mt-0.5">{desc}</p>}
              {action === 'download' && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => openExternalLink('https://github.com/comfyanonymous/ComfyUI/releases')}
                    className="btn btn-sm bg-pink-500/20 text-pink-300 hover:bg-pink-500/30"
                  >
                    <ExternalLink size={12} />
                    NVIDIA GPU
                  </button>
                  <button
                    onClick={() => openExternalLink('https://github.com/comfyanonymous/ComfyUI/releases')}
                    className="btn btn-sm bg-neutral-800 text-text-secondary hover:bg-neutral-700"
                  >
                    CPU Only
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 bg-neutral-800/50 rounded-lg border border-neutral-700">
        <p className="text-xs text-text-muted">
          <strong className="text-text-secondary">Note:</strong> ComfyUI is a separate application. 
          Anvil communicates with it to generate images while keeping everything local and private.
        </p>
      </div>

      <div className="flex gap-3">
        <button onClick={() => setStep(1)} className="btn btn-secondary flex-1">
          Back
        </button>
        <button onClick={() => setStep(3)} className="btn bg-gradient-to-r from-pink-500 to-purple-500 text-white flex-1">
          I've Installed It
        </button>
      </div>
    </div>
  );

  // Step 3: Model Selection
  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <Sparkles className="mx-auto text-pink-400 mb-3" size={48} />
        <h2 className="text-xl font-semibold text-text-primary">Choose Your Model</h2>
        <p className="text-sm text-text-muted mt-2">
          All models are unrestricted - no content filters
        </p>
      </div>

      {/* Model Type Tabs */}
      <div className="flex gap-2 p-1 bg-neutral-900 rounded-lg">
        {[
          { id: 'sdxl', label: 'SDXL (Best)', desc: '6-7 GB' },
          { id: 'sd15', label: 'SD 1.5 (Fast)', desc: '2 GB' },
          { id: 'flux', label: 'Flux (Premium)', desc: '24 GB' },
        ].map(({ id, label, desc }) => (
          <button
            key={id}
            onClick={() => setSelectedModelType(id)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              selectedModelType === id 
                ? 'bg-pink-500/20 text-pink-300' 
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <span>{label}</span>
            <span className="block text-[10px] opacity-70">{desc}</span>
          </button>
        ))}
      </div>

      {/* Model List */}
      <div className="space-y-3 max-h-[280px] overflow-y-auto">
        {AVAILABLE_MODELS[selectedModelType]?.map((model) => (
          <motion.div
            key={model.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-lg border transition-colors ${
              downloadProgress?.modelId === model.id
                ? 'border-pink-500 bg-pink-500/10'
                : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{model.name}</span>
                  {model.recommended && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-pink-500/20 text-pink-300 rounded">
                      Recommended
                    </span>
                  )}
                  {model.nsfw && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded">
                      NSFW OK
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-1">{model.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                  <span>{model.size}</span>
                  <span>{model.resolution}</span>
                  {model.vramRequired && (
                    <span className="text-amber-400">⚠ {model.vramRequired} VRAM</span>
                  )}
                </div>
              </div>
              
              {downloadProgress?.modelId === model.id ? (
                <div className="text-right">
                  <Loader className="animate-spin text-pink-400 ml-auto" size={20} />
                  <p className="text-xs text-pink-400 mt-1">{downloadProgress.percent}%</p>
                </div>
              ) : (
                <button
                  onClick={() => handleDownloadModel(model)}
                  className="btn btn-sm bg-pink-500/20 text-pink-300 hover:bg-pink-500/30"
                  disabled={!!downloadProgress}
                >
                  <Download size={14} />
                  Get Model
                </button>
              )}
            </div>
            
            {downloadProgress?.modelId === model.id && (
              <div className="mt-3">
                <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => setStep(2)} className="btn btn-secondary flex-1">
          Back
        </button>
        <button 
          onClick={() => setStep(4)} 
          className="btn btn-secondary flex-1"
          disabled={!!downloadProgress}
        >
          Skip Model Download
        </button>
      </div>
    </div>
  );

  // Step 4: Ready
  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-2xl flex items-center justify-center mb-4">
          <CheckCircle className="text-green-400" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-text-primary">You're All Set!</h2>
        <p className="text-sm text-text-muted mt-2">
          Local image generation is ready to use
        </p>
      </div>

      {/* Status Summary */}
      <div className="space-y-3 bg-neutral-900 rounded-lg p-4 border border-neutral-800">
        <div className="flex items-center gap-3">
          <CheckCircle className="text-green-400" size={18} />
          <span className="text-sm text-text-primary">ComfyUI Backend</span>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
            status?.running ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            {status?.running ? 'Running' : 'Not Started'}
          </span>
        </div>
        
        {status?.models?.length > 0 && (
          <div className="flex items-center gap-3">
            <CheckCircle className="text-green-400" size={18} />
            <span className="text-sm text-text-primary">Models Installed</span>
            <span className="ml-auto text-xs text-text-muted">{status.models.length} model(s)</span>
          </div>
        )}
        
        <div className="flex items-center gap-3">
          <Shield className="text-pink-400" size={18} />
          <span className="text-sm text-text-primary">Content Restrictions</span>
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-pink-500/20 text-pink-300">
            None
          </span>
        </div>
      </div>

      {!status?.running && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-sm text-amber-400 mb-2">Start ComfyUI to begin generating images</p>
          <button
            onClick={handleStartComfyUI}
            disabled={loading}
            className="btn btn-sm bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
          >
            {loading ? <Loader className="animate-spin" size={14} /> : <Play size={14} />}
            Start ComfyUI
          </button>
        </div>
      )}

      <div className="p-3 bg-neutral-800/50 rounded-lg border border-neutral-700">
        <p className="text-xs text-text-muted">
          <strong className="text-text-secondary">How to use:</strong> Open the Image Generation panel 
          from the sidebar or chat. Your images are generated locally and stored privately.
        </p>
      </div>

      <button 
        onClick={onComplete} 
        className="btn bg-gradient-to-r from-pink-500 to-purple-500 text-white w-full hover:opacity-90"
      >
        Start Generating Images
      </button>
    </div>
  );

  if (loading && !status) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader className="animate-spin text-pink-400 mb-4" size={32} />
        <p className="text-sm text-text-muted">Checking image generation setup...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md mx-auto"
    >
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`w-2 h-2 rounded-full transition-colors ${
              s === step ? 'bg-pink-500' : s < step ? 'bg-pink-500/50' : 'bg-neutral-700'
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
