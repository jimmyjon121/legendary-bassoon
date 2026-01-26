import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, Image, Wand2, Settings2, Download, Trash2, Loader, RefreshCw, 
  AlertTriangle, CheckCircle, Sparkles, Zap, Shield, Play, Square,
  ChevronDown, ChevronUp, Copy, ExternalLink, HardDrive, FolderOpen
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { safeCall } from '../../utils/electronAPI';

export function ImageGenModal() {
  const { toggleImageGen, currentWorkspace } = useAppStore();
  
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

  // Check status on mount
  useEffect(() => {
    checkStatus();
    
    // Listen for setup events
    const unsubscribe = window.electronAPI?.onImageAutoEvent?.((data) => {
      setSetupProgress(data);
    });
    
    // Listen for download progress
    const unsubDownload = window.electronAPI?.onImageAutoDownloadProgress?.((data) => {
      setDownloadProgress(data);
    });
    
    return () => {
      unsubscribe?.();
      unsubDownload?.();
    };
  }, []);

  const checkStatus = async () => {
    setIsLoading(true);
    setError('');
    try {
      // Use the auto backend
      const result = await safeCall('imageAutoGetStatus', [], { installed: false, running: false });
      
      console.log('[ImageGen] Status:', result);
      setStatus(result);
      
      if (result?.models?.length > 0 && !selectedModel) {
        setSelectedModel(result.models[0]);
      }
      
      // If installed but not running, auto-start it
      if (result?.installed && !result?.running && result?.models?.length > 0) {
        console.log('[ImageGen] Backend installed but not running, auto-starting...');
        setIsLoading(true);
        const startResult = await safeCall('imageAutoStart', [], { success: false });
        if (startResult.success) {
          // Re-check status after start
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
        // Give it a moment then check status
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

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  // Render setup screen if not ready
  const renderSetupScreen = () => (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="w-20 h-20 bg-gradient-to-br from-pink-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mb-6">
        <Image size={40} className="text-pink-400" />
      </div>
      
      <h2 className="text-2xl font-bold text-text-primary mb-2">Image Generation</h2>
      <p className="text-text-muted text-center mb-6 max-w-md">
        Generate images locally on your machine. Fully offline, private, and unrestricted.
      </p>
      
      {/* Features */}
      <div className="grid grid-cols-3 gap-4 mb-8 w-full max-w-md">
        {[
          { icon: Shield, label: 'No Filters', color: 'text-pink-400' },
          { icon: Zap, label: 'Offline', color: 'text-amber-400' },
          { icon: Sparkles, label: 'NSFW OK', color: 'text-purple-400' },
        ].map(({ icon: Icon, label, color }) => (
          <div key={label} className="flex flex-col items-center p-3 bg-neutral-900 rounded-lg">
            <Icon size={20} className={color} />
            <span className="text-xs text-text-muted mt-1">{label}</span>
          </div>
        ))}
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
              />
            </div>
          )}
        </div>
      )}
      
      {/* Error */}
      {error && (
        <div className="w-full max-w-md mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      
      {/* Note about 7-Zip */}
      <div className="w-full max-w-md mb-6 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-xs text-amber-300">
          <strong>Note:</strong> First-time setup requires{' '}
          <a 
            href="https://7-zip.org/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="underline hover:text-amber-200"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI?.openExternal?.('https://7-zip.org/');
            }}
          >
            7-Zip
          </a>
          {' '}to be installed for extracting files.
        </p>
      </div>
      
      {/* Setup Button */}
      <button
        onClick={handleAutoSetup}
        disabled={isSettingUp}
        className="btn bg-gradient-to-r from-pink-500 to-purple-500 text-white px-8 py-3 text-lg hover:opacity-90 disabled:opacity-50"
      >
        {isSettingUp ? (
          <>
            <Loader className="animate-spin mr-2" size={20} />
            Setting Up...
          </>
        ) : (
          <>
            <Download className="mr-2" size={20} />
            One-Click Setup
          </>
        )}
      </button>
      
      <p className="text-xs text-text-muted mt-4">
        Downloads ~1.7GB backend + ~2GB starter model
      </p>
    </div>
  );

  // Render "needs model" screen - when ComfyUI is installed but no models
  const renderNeedsModel = () => (
    <div className="flex flex-col items-center py-8 px-6 overflow-y-auto">
      <div className="w-16 h-16 bg-purple-500/20 rounded-2xl flex items-center justify-center mb-4">
        <HardDrive size={32} className="text-purple-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-text-primary mb-2">Download a Model</h3>
      <p className="text-sm text-text-muted mb-4 text-center max-w-md">
        ComfyUI is installed! Now download a model to start generating images.
      </p>
      
      {/* Download Progress */}
      {isDownloadingModel && downloadProgress && (
        <div className="w-full max-w-md mb-6 p-4 bg-neutral-900 rounded-lg border border-neutral-800">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="animate-spin text-purple-400" size={16} />
            <span className="text-sm text-text-secondary">{downloadProgress.message || 'Downloading...'}</span>
          </div>
          {downloadProgress.percent !== undefined && (
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-pink-500 to-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
          )}
          <p className="text-xs text-neutral-500 mt-2">
            {downloadProgress.percent}% complete
          </p>
        </div>
      )}
      
      {error && (
        <div className="w-full max-w-md mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      
      {/* Available Models */}
      <div className="w-full max-w-md space-y-3 mb-6">
        <p className="text-xs text-text-muted font-medium uppercase tracking-wide">Recommended Models</p>
        
        {status?.availableModels?.map((model, idx) => (
          <div 
            key={model.filename}
            className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 hover:border-purple-500/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium text-text-primary flex items-center gap-2">
                  {model.name}
                  {idx === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-pink-500/20 text-pink-400 rounded">Recommended</span>
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
                className="btn bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                <Download size={14} className="mr-1" />
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
          className="mt-3 text-xs text-purple-400 hover:text-purple-300"
        >
          <RefreshCw size={12} className="inline mr-1" />
          Refresh after adding models
        </button>
      </div>
    </div>
  );

  // Render not running screen
  const renderNotRunning = () => (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mb-4">
        <AlertTriangle size={32} className="text-amber-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-text-primary mb-2">Backend Not Running</h3>
      <p className="text-sm text-text-muted mb-2">The image generation backend needs to start</p>
      
      {status?.comfyDir && (
        <p className="text-xs text-neutral-500 mb-4 font-mono truncate max-w-md">{status.comfyDir}</p>
      )}
      
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg max-w-md">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      
      <button
        onClick={handleStartBackend}
        disabled={isLoading}
        className="btn bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-3"
      >
        {isLoading ? (
          <>
            <Loader className="animate-spin mr-2" size={16} />
            Starting... (may take 30-60s)
          </>
        ) : (
          <>
            <Play className="mr-2" size={16} />
            Start Image Backend
          </>
        )}
      </button>
      
      <p className="text-xs text-neutral-600 mt-3">
        The backend runs in the background with no visible window
      </p>
    </div>
  );

  // Render main generation interface
  const renderGenerationUI = () => (
    <div className="flex flex-col h-full">
      {/* Prompt Input */}
      <div className="p-4 border-b border-neutral-800">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          className="w-full h-24 bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-text-primary placeholder-text-muted resize-none focus:border-pink-500 focus:outline-none"
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
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary"
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
            <option value="512x512">512×512</option>
            <option value="512x768">512×768</option>
            <option value="768x512">768×512</option>
            <option value="768x768">768×768</option>
            <option value="1024x1024">1024×1024</option>
          </select>
          
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-neutral-800"
          >
            {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
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
                    className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-text-primary"
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
          className="w-full mt-4 btn bg-gradient-to-r from-pink-500 to-purple-500 text-white py-3 disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <Loader className="animate-spin mr-2" size={18} />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="mr-2" size={18} />
              Generate Image
            </>
          )}
        </button>
        
        {error && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-xs text-red-400">{error}</p>
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
              {currentWorkspace === 'nsfw' ? '🔒 Private Mode - No restrictions' : 'Type a prompt and click Generate'}
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
                  className="w-full aspect-square object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs text-white line-clamp-2 mb-2">{img.prompt}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(img.prompt)}
                        className="p-1.5 bg-white/20 rounded hover:bg-white/30"
                        title="Copy prompt"
                      >
                        <Copy size={14} className="text-white" />
                      </button>
                      <button
                        onClick={() => window.electronAPI?.openExternal?.(img.url)}
                        className="p-1.5 bg-white/20 rounded hover:bg-white/30"
                        title="Open full size"
                      >
                        <ExternalLink size={14} className="text-white" />
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

  // Main render
  return (
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
        className="w-full max-w-2xl h-[80vh] bg-neutral-950 rounded-2xl shadow-2xl border border-neutral-800 overflow-hidden flex flex-col"
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
                  <span className="text-green-400">● Backend running</span>
                ) : status?.installed ? (
                  <span className="text-amber-400">● Backend stopped</span>
                ) : (
                  <span className="text-neutral-500">● Not set up</span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={checkStatus}
              className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-neutral-800"
              title="Refresh status"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={toggleImageGen}
              className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-neutral-800"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading && !status ? (
            <div className="flex items-center justify-center h-full">
              <Loader className="animate-spin text-pink-400" size={32} />
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
  );
}
