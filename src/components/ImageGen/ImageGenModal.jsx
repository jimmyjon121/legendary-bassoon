import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  X, Image, Wand2, Settings2, Download, Trash2, Loader, RefreshCw, 
  AlertTriangle, CheckCircle, Sparkles, Zap, Shield, Play, Square,
  ChevronDown, ChevronUp, Copy, ExternalLink, HardDrive, FolderOpen,
  Wifi, WifiOff, StopCircle, Save
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { safeCall } from '../../utils/electronAPI';

export function ImageGenModal() {
  const toggleImageGen = useAppStore((s) => s.toggleImageGen);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  
  // Status
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupProgress, setSetupProgress] = useState(null);
  
  // Generation
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('bad quality, blurry, distorted, deformed');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [error, setError] = useState('');
  
  // Model download
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  
  // Settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [settings, setSettings] = useState({
    width: 512,
    height: 512,
    steps: 20,
    cfg: 7,
    seed: -1,
  });
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  
  const promptRef = useRef(null);

  // Check status on mount
  useEffect(() => {
    checkStatus();
    
    // Listen for setup events
    const unsubscribe = window.electronAPI?.onImageAutoEvent?.((data) => {
      setSetupProgress(data);
    });
    
    // Listen for download progress
    const unsubDownload = window.electronAPI?.onImageAutoDownloadProgress?.((data) => {
      setDownloadProgress(prev => ({ ...prev, ...data }));
    });
    
    // Escape to close
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') toggleImageGen();
    };
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      unsubscribe?.();
      unsubDownload?.();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const checkStatus = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await safeCall('imageAutoGetStatus', [], { installed: false, running: false });
      setStatus(result);
      
      if (result?.models?.length > 0 && !selectedModel) {
        setSelectedModel(result.models[0]);
      }
      
      // If installed but not running, auto-start it
      if (result?.installed && !result?.running && result?.models?.length > 0) {
        const startResult = await safeCall('imageAutoStart', [], { success: false });
        if (startResult.success) {
          const newStatus = await safeCall('imageAutoGetStatus', [], { installed: false, running: false });
          setStatus(newStatus);
        }
      }
    } catch (err) {
      console.error('[ImageGen] Status check error:', err);
      setError(err.message);
    }
    setIsLoading(false);
  };

  const handleAutoSetup = async () => {
    setIsSettingUp(true);
    setError('');
    setSetupProgress({ message: 'Starting setup...', percent: 0 });
    
    try {
      const result = await safeCall('imageAutoSetup', [{}], { success: false });
      if (result.success) {
        await checkStatus();
      } else {
        setError(result.error || 'Setup failed');
      }
    } catch (err) {
      setError(err.message);
    }
    
    setIsSettingUp(false);
    setSetupProgress(null);
  };

  const handleStartBackend = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await safeCall('imageAutoStart', [], { success: false });
      if (result.success) {
        await new Promise(r => setTimeout(r, 1000));
        await checkStatus();
      } else {
        setError(result.error || 'Failed to start backend');
        setIsLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  const handleStopBackend = async () => {
    try {
      await safeCall('imageAutoStop', [], { success: false });
      await checkStatus();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadModel = async (model) => {
    setIsDownloadingModel(true);
    setDownloadProgress({ percent: 0, message: `Downloading ${model.name}...` });
    setError('');
    
    try {
      const result = await safeCall('imageAutoDownloadModel', [{ url: model.url, filename: model.filename }], { success: false });
      if (result.success) {
        setDownloadProgress(null);
        await checkStatus();
      } else {
        setError(result.error || 'Download failed');
      }
    } catch (err) {
      setError(err.message);
    }
    
    setIsDownloadingModel(false);
    setDownloadProgress(null);
  };

  const openModelsFolder = () => {
    if (status?.modelsDir) {
      window.electronAPI?.openPath?.(status.modelsDir);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError('');
    
    try {
      const result = await safeCall('imageAutoGenerate', [{
        prompt: prompt.trim(),
        negativePrompt,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        cfg: settings.cfg,
        seed: settings.seed,
        model: selectedModel?.filename || null,
      }], { success: false });
      
      if (result.success && result.images?.length > 0) {
        const newImages = result.images.map((img, idx) => ({
          id: `img_${Date.now()}_${idx}`,
          url: img.url,
          filename: img.filename,
          prompt,
          timestamp: Date.now(),
        }));
        setGeneratedImages(prev => [...newImages, ...prev]);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
    
    setIsGenerating(false);
  };

  const handlePromptKeyDown = (e) => {
    // Ctrl+Enter or Cmd+Enter to generate
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const deleteImage = (imageId) => {
    setGeneratedImages(prev => prev.filter(img => img.id !== imageId));
    if (selectedImage?.id === imageId) setSelectedImage(null);
  };

  // ─────────────────────────────────────────────────────────────────────
  // RENDER SECTIONS
  // ─────────────────────────────────────────────────────────────────────

  const renderSetupScreen = () => (
    <div className="flex flex-col items-center justify-center py-10 px-6 overflow-y-auto">
      <div className="w-[72px] h-[72px] bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-xl flex items-center justify-center mb-5">
        <Image size={40} className="text-pink-400" />
      </div>
      
      <h2 className="text-2xl font-bold text-text-primary mb-2">Image Generation</h2>
      <p className="text-text-muted text-center mb-6 max-w-md">
        Generate images locally on your machine. 100% free, open source, offline after setup.
      </p>
      
      {/* Features */}
      <div className="grid grid-cols-3 gap-4 mb-6 w-full max-w-md">
        {[
          { icon: Shield, label: 'No Filters', desc: 'Unrestricted', color: 'text-pink-400' },
          { icon: WifiOff, label: 'Offline', desc: 'After setup', color: 'text-amber-400' },
          { icon: Sparkles, label: 'Free Forever', desc: 'No API keys', color: 'text-purple-400' },
        ].map(({ icon: Icon, label, desc, color }) => (
          <div key={label} className="flex flex-col items-center p-3 bg-neutral-900 rounded-lg">
            <Icon size={20} className={color} />
            <span className="text-xs text-text-primary mt-1 font-medium">{label}</span>
            <span className="text-[10px] text-text-muted">{desc}</span>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div className="w-full max-w-md mb-6 space-y-2">
        <p className="text-xs text-text-muted font-medium uppercase tracking-wide">How it works</p>
        <div className="space-y-1.5 text-xs text-text-secondary">
          {[
            'Downloads open-source ComfyUI backend (~1.7 GB, one time)',
            'Downloads a free AI model from HuggingFace (~2 GB, one time)',
            'Everything runs locally on your GPU - no internet needed after setup',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-pink-400 font-bold mt-0.5">{i + 1}.</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Setup Progress */}
      {isSettingUp && setupProgress && (
        <div className="w-full max-w-md mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="animate-spin text-pink-400" size={16} />
            <span className="text-sm text-text-secondary">{setupProgress.message}</span>
          </div>
          {setupProgress.percent !== undefined && (
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${setupProgress.percent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>
      )}
      
      {/* Error */}
      {error && (
        <div className="w-full max-w-md mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400 whitespace-pre-wrap">{error}</p>
        </div>
      )}
      
      {/* 7-Zip note */}
      <div className="w-full max-w-md mb-6 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-xs text-amber-300">
          <strong>Requirement:</strong> 7-Zip must be installed to extract the backend.{' '}
          <a 
            href="#"
            className="underline hover:text-amber-200"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI?.openExternal?.('https://7-zip.org/');
            }}
          >
            Download 7-Zip (free)
          </a>
        </p>
      </div>
      
      {/* Setup Button */}
      <button
        onClick={handleAutoSetup}
        disabled={isSettingUp}
        className="flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-2.5 rounded-lg hover:opacity-95 disabled:opacity-50 transition-opacity font-medium"
      >
        {isSettingUp ? (
          <>
            <Loader className="animate-spin" size={20} />
            Setting Up...
          </>
        ) : (
          <>
            <Download size={20} />
            One-Click Setup
          </>
        )}
      </button>
      
      <p className="text-xs text-neutral-600 mt-3">
        Total download: ~3.7 GB (internet required once)
      </p>
    </div>
  );

  const renderNeedsModel = () => (
    <div className="flex flex-col items-center py-8 px-6 overflow-y-auto">
      <div className="w-14 h-14 bg-purple-500/20 rounded-xl flex items-center justify-center mb-4">
        <HardDrive size={32} className="text-purple-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-text-primary mb-2">Download a Model</h3>
      <p className="text-sm text-text-muted mb-1 text-center max-w-md">
        Backend is installed. Now pick a free model to download from HuggingFace.
      </p>
      <p className="text-xs text-neutral-600 mb-4 text-center max-w-md">
        No account or API key needed - all models are open source.
      </p>
      
      {/* Download Progress */}
      {isDownloadingModel && downloadProgress && (
        <div className="w-full max-w-md mb-6 p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="animate-spin text-purple-400" size={16} />
            <span className="text-sm text-text-secondary">{downloadProgress.message || 'Downloading...'}</span>
          </div>
          {downloadProgress.percent !== undefined && (
            <>
              <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${downloadProgress.percent}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                {downloadProgress.percent}% complete
              </p>
            </>
          )}
        </div>
      )}
      
      {error && (
        <div className="w-full max-w-md mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>
        </div>
      )}
      
      {/* Available Models */}
      <div className="w-full max-w-md space-y-3 mb-6">
        <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Free Models (HuggingFace)</p>
        
        {status?.availableModels?.map((model, idx) => (
          <div 
            key={model.filename}
            className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 hover:border-purple-500/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-text-primary flex items-center gap-2">
                  {model.name}
                  {idx === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-pink-500/20 text-pink-400 rounded flex-shrink-0">Recommended</span>
                  )}
                </h4>
                <p className="text-xs text-text-muted mt-1">
                  {model.description || 'High quality image generation model'}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Size: {model.size}</p>
              </div>
              <button
                onClick={() => handleDownloadModel(model)}
                disabled={isDownloadingModel}
                className="flex items-center gap-1 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 transition-colors flex-shrink-0"
              >
                <Download size={14} />
                Download
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {/* Manual model option */}
      <div className="w-full max-w-md p-4 bg-neutral-900/50 rounded-lg border border-neutral-800">
        <p className="text-xs text-text-muted mb-2">
          <strong>Have your own model?</strong> Place .safetensors or .ckpt files in:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs text-neutral-400 bg-neutral-950 px-2 py-1 rounded truncate">
            {status?.modelsDir || 'models/checkpoints'}
          </code>
          <button
            onClick={openModelsFolder}
            className="p-1.5 text-text-muted hover:text-text-secondary rounded hover:bg-neutral-800"
            title="Open folder"
          >
            <FolderOpen size={16} />
          </button>
        </div>
        <button
          onClick={checkStatus}
          className="mt-3 text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
        >
          <RefreshCw size={12} />
          Refresh after adding models
        </button>
      </div>
    </div>
  );

  const renderNotRunning = () => (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="w-14 h-14 bg-amber-500/20 rounded-xl flex items-center justify-center mb-4">
        <AlertTriangle size={32} className="text-amber-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-text-primary mb-2">Backend Not Running</h3>
      <p className="text-sm text-text-muted mb-2">The image generation backend needs to start</p>
      
      {status?.comfyDir && (
        <p className="text-xs text-neutral-500 mb-4 font-mono truncate max-w-md">{status.comfyDir}</p>
      )}
      
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg max-w-md">
          <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>
        </div>
      )}
      
      <button
        onClick={handleStartBackend}
        disabled={isLoading}
        className="flex items-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-5 py-2.5 rounded-lg transition-opacity hover:opacity-95 disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <Loader className="animate-spin" size={16} />
            Starting... (may take 30-60s)
          </>
        ) : (
          <>
            <Play size={16} />
            Start Image Backend
          </>
        )}
      </button>
      
      <p className="text-xs text-neutral-600 mt-3">
        Runs in the background with no visible window
      </p>
    </div>
  );

  const renderGenerationUI = () => (
    <div className="flex flex-col h-full">
      {/* Prompt Input */}
      <div className="p-4 border-b border-neutral-800">
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Describe the image you want to generate..."
          className="w-full h-24 bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-text-primary placeholder-text-muted resize-none focus:border-pink-500 focus:outline-none transition-colors"
          disabled={isGenerating}
        />
        
        {/* Quick Settings Row */}
        <div className="flex items-center gap-3 mt-3">
          <select
            value={selectedModel?.filename || ''}
            onChange={(e) => {
              const model = status?.models?.find(m => m.filename === e.target.value);
              setSelectedModel(model);
            }}
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary min-w-0"
          >
            {status?.models?.map(model => (
              <option key={model.filename} value={model.filename}>{model.name}</option>
            ))}
          </select>
          
          <select
            value={`${settings.width}x${settings.height}`}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number);
              setSettings(prev => ({ ...prev, width: w, height: h }));
            }}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary"
          >
            <option value="512x512">512x512</option>
            <option value="512x768">512x768</option>
            <option value="768x512">768x512</option>
            <option value="768x768">768x768</option>
            <option value="1024x1024">1024x1024</option>
          </select>
          
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-neutral-800 transition-colors"
            title="Advanced settings"
          >
            {showAdvanced ? <ChevronUp size={18} /> : <Settings2 size={18} />}
          </button>
        </div>
        
        {/* Advanced Settings */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-3 space-y-3">
                <div>
                  <label className="text-xs text-text-muted block mb-1">Negative Prompt</label>
                  <input
                    type="text"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary focus:border-pink-500 focus:outline-none"
                  />
                </div>
                
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-text-muted block mb-1">Steps</label>
                    <input
                      type="number"
                      value={settings.steps}
                      onChange={(e) => setSettings(prev => ({ ...prev, steps: parseInt(e.target.value) || 20 }))}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary"
                      min="1"
                      max="100"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted block mb-1">CFG Scale</label>
                    <input
                      type="number"
                      value={settings.cfg}
                      onChange={(e) => setSettings(prev => ({ ...prev, cfg: parseFloat(e.target.value) || 7 }))}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary"
                      min="1"
                      max="30"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted block mb-1">Seed (-1 = random)</label>
                    <input
                      type="number"
                      value={settings.seed}
                      onChange={(e) => setSettings(prev => ({ ...prev, seed: parseInt(e.target.value) || -1 }))}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating}
          className="w-full mt-4 flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white py-2.5 rounded-lg disabled:opacity-50 hover:opacity-95 transition-opacity font-medium"
        >
          {isGenerating ? (
            <>
              <Loader className="animate-spin" size={18} />
              Generating...
            </>
          ) : (
            <>
              <Wand2 size={18} />
              Generate
              <span className="text-white/60 text-xs ml-1">(Ctrl+Enter)</span>
            </>
          )}
        </button>
        
        {error && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>
          </div>
        )}
      </div>
      
      {/* Generated Images Gallery */}
      <div className="flex-1 overflow-y-auto p-4">
        {generatedImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Image size={48} className="text-neutral-700 mb-4" />
            <p className="text-text-muted">Your generated images will appear here</p>
            <p className="text-xs text-neutral-600 mt-1">
              Type a prompt and press Ctrl+Enter or click Generate
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {generatedImages.map((img) => (
              <motion.div
                key={img.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative group rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800"
              >
                <img
                  src={img.url}
                  alt={img.prompt}
                  className="w-full aspect-square object-cover cursor-pointer"
                  onClick={() => setSelectedImage(img)}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling && (e.target.nextSibling.style.display = 'flex');
                  }}
                />
                {/* Fallback for broken images */}
                <div className="hidden items-center justify-center aspect-square bg-neutral-900 text-neutral-600">
                  <AlertTriangle size={24} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs text-white line-clamp-2 mb-2">{img.prompt}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(img.prompt)}
                        className="p-1.5 bg-white/20 rounded hover:bg-white/30 transition-colors"
                        title="Copy prompt"
                      >
                        <Copy size={14} className="text-white" />
                      </button>
                      <button
                        onClick={() => window.electronAPI?.openExternal?.(img.url)}
                        className="p-1.5 bg-white/20 rounded hover:bg-white/30 transition-colors"
                        title="Open full size"
                      >
                        <ExternalLink size={14} className="text-white" />
                      </button>
                      <button
                        onClick={() => deleteImage(img.id)}
                        className="p-1.5 bg-white/20 rounded hover:bg-red-500/50 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={14} className="text-white" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────
  // IMAGE LIGHTBOX
  // ─────────────────────────────────────────────────────────────────────
  const renderLightbox = () => {
    if (!selectedImage) return null;
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
        onClick={() => setSelectedImage(null)}
      >
        <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
          <img
            src={selectedImage.url}
            alt={selectedImage.prompt}
            className="max-w-full max-h-[85vh] object-contain rounded-lg"
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <button
              onClick={() => copyToClipboard(selectedImage.prompt)}
              className="p-2 bg-black/60 rounded-lg hover:bg-black/80 transition-colors"
              title="Copy prompt"
            >
              <Copy size={16} className="text-white" />
            </button>
            <button
              onClick={() => setSelectedImage(null)}
              className="p-2 bg-black/60 rounded-lg hover:bg-black/80 transition-colors"
            >
              <X size={16} className="text-white" />
            </button>
          </div>
          <div className="mt-3 p-3 bg-neutral-900/80 rounded-lg max-w-xl">
            <p className="text-sm text-text-secondary">{selectedImage.prompt}</p>
          </div>
        </div>
      </motion.div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={toggleImageGen}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-2xl h-[80vh] bg-neutral-950 rounded-xl shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] border border-neutral-800 overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-500 rounded-lg flex items-center justify-center">
                <Image size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-text-primary">Image Generation</h2>
                <p className="text-xs text-text-muted">
                  {status?.running ? (
                    <span className="text-green-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Running locally
                      {status?.models?.length > 0 && ` - ${status.models.length} model${status.models.length > 1 ? 's' : ''}`}
                    </span>
                  ) : status?.installed ? (
                    <span className="text-amber-400">Backend stopped</span>
                  ) : (
                    <span className="text-neutral-500">Not set up</span>
                  )}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              {status?.running && (
                <button
                  onClick={handleStopBackend}
                  className="p-2 text-text-muted hover:text-red-400 rounded-lg hover:bg-neutral-800 transition-colors"
                  title="Stop backend"
                >
                  <StopCircle size={16} />
                </button>
              )}
              <button
                onClick={checkStatus}
                className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-neutral-800 transition-colors"
                title="Refresh status"
              >
                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={toggleImageGen}
                className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-neutral-800 transition-colors"
                title="Close (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {isLoading && !status ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Loader className="animate-spin text-pink-400" size={32} />
                <p className="text-sm text-text-muted">Checking backend status...</p>
              </div>
            ) : !status?.installed ? (
              renderSetupScreen()
            ) : status?.needsModel ? (
              renderNeedsModel()
            ) : !status?.running ? (
              renderNotRunning()
            ) : (
              renderGenerationUI()
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* Image lightbox */}
      <AnimatePresence>
        {selectedImage && renderLightbox()}
      </AnimatePresence>
    </>
  );
}
