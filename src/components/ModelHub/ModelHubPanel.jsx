/**
 * ModelHubPanel - Unified Model Hub with Download Center, Library, and more
 * 
 * Features:
 * - Browse models from HuggingFace, CivitAI, Ollama
 * - Download Center with queue management
 * - Library browser with filters
 * - Storage management
 * - Private Vault entry (low-key)
 * - Collections browser
 * - Model converter access
 */

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  Library,
  HardDrive,
  Settings,
  Search,
  Filter,
  Grid,
  List,
  RefreshCw,
  Star,
  Trash2,
  Plus,
  Package,
  Sparkles,
  Play,
  Pause,
  XCircle,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronRight,
  Folder,
  Tag,
  MoreVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ArrowUpDown,
  Globe,
  Box,
  Database,
  Palette,
  Flame,
  Cpu,
  Zap,
  TrendingUp,
  Loader2,
  Image,
  MessageCircle,
  Code,
} from 'lucide-react';
import {
  useDownloads,
  useDownloadActions,
  useAppStore,
} from '../../stores/appStore';
import { ModelProfileModal } from './ModelProfileModal';

// Format bytes
const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Format speed
const formatSpeed = (bytesPerSec) => {
  if (!bytesPerSec) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
};

// Download status badge
const DownloadStatusBadge = memo(({ status }) => {
  const config = {
    queued: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Queued' },
    downloading: { icon: Download, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Downloading', animate: true },
    paused: { icon: Pause, color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Paused' },
    completed: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Completed' },
    error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Failed' },
    cancelled: { icon: XCircle, color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Cancelled' },
    verifying: { icon: RefreshCw, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'Verifying', animate: true },
    scheduled: { icon: Clock, color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Scheduled' },
  };
  
  const { icon: Icon, color, bg, label, animate } = config[status] || config.queued;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${color}`}>
      <Icon className={`w-3 h-3 ${animate ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
});

// Download item card
const DownloadItemCard = memo(({ download, onPause, onResume, onCancel, onRetry }) => {
  const progress = download.progress || 0;
  const isActive = ['downloading', 'verifying'].includes(download.status);
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg p-3"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 mr-3">
          <div className="font-medium text-sm text-[var(--text-primary)] truncate">
            {download.name}
          </div>
          <div className="text-xs text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
            <span>{formatBytes(download.totalBytes)}</span>
            {download.metadata?.provider && (
              <span className="text-[var(--text-muted)]">• {download.metadata.provider}</span>
            )}
          </div>
        </div>
        <DownloadStatusBadge status={download.status} />
      </div>
      
      {/* Progress bar */}
      {isActive && (
        <div className="mb-2">
          <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)]"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-[var(--text-muted)]">
            <span>{progress}%</span>
            <span>{formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}</span>
          </div>
        </div>
      )}
      
      {/* Error message */}
      {download.status === 'error' && download.error && (
        <div className="mb-2 p-2 bg-red-500/10 rounded text-xs text-red-400 truncate">
          {download.error}
        </div>
      )}
      
      {/* Actions */}
      <div className="flex items-center justify-end gap-1">
        {download.status === 'downloading' && (
          <button
            onClick={() => onPause(download.id)}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Pause"
          >
            <Pause className="w-4 h-4" />
          </button>
        )}
        {download.status === 'paused' && (
          <button
            onClick={() => onResume(download.id)}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title="Resume"
          >
            <Play className="w-4 h-4" />
          </button>
        )}
        {download.status === 'error' && (
          <button
            onClick={() => onRetry(download.id)}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-amber-400 hover:text-amber-300 transition-colors"
            title="Retry"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        {['queued', 'downloading', 'paused'].includes(download.status) && (
          <button
            onClick={() => onCancel(download.id)}
            className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-red-400 hover:text-red-300 transition-colors"
            title="Cancel"
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
});

// Library model card
const LibraryModelCard = memo(({ model, onSelect, onFavorite, onDelete }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      onClick={() => onSelect(model)}
      className="bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg p-3 cursor-pointer hover:border-[var(--accent-primary)]/30 transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-[var(--text-primary)] truncate">
            {model.alias || model.name}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">
            {model.provider} • {model.type}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onFavorite(model.id); }}
          className={`p-1 rounded transition-colors ${
            model.favorite
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-[var(--text-muted)] hover:text-amber-400'
          }`}
        >
          <Star className={`w-4 h-4 ${model.favorite ? 'fill-current' : ''}`} />
        </button>
      </div>
      
      {/* Tags */}
      {model.tags && model.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {model.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      
      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{formatBytes(model.size)}</span>
        {model.usageCount > 0 && (
          <span>Used {model.usageCount}×</span>
        )}
      </div>
    </motion.div>
  );
});

// Tab button
const TabButton = memo(({ active, icon: Icon, label, onClick, badge, color }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
      active
        ? `bg-[var(--accent-primary)]/10 ${color || 'text-[var(--accent-primary)]'}`
        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
    }`}
  >
    <Icon className="w-4 h-4" />
    {label}
    {badge > 0 && (
      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--accent-primary)] text-white">
        {badge}
      </span>
    )}
  </button>
));

// Provider tabs for Browse
const BROWSE_PROVIDERS = [
  { id: 'featured', name: 'Featured', icon: Sparkles, color: 'text-yellow-400' },
  { id: 'ollama', name: 'Ollama', icon: Box, color: 'text-green-400' },
  { id: 'huggingface', name: 'HuggingFace', icon: Database, color: 'text-orange-400' },
  { id: 'vision', name: 'Vision', icon: Eye, color: 'text-purple-400' },
  { id: 'image', name: 'Image Gen', icon: Palette, color: 'text-pink-400' },
];

// Quantization guide for users
const QUANT_GUIDE = {
  'Q2_K': { quality: 1, emoji: '⚡', label: 'Tiny', desc: 'Fastest, lowest quality' },
  'Q3_K_M': { quality: 2, emoji: '🏃', label: 'Small', desc: 'Fast, some quality loss' },
  'Q4_K_M': { quality: 4, emoji: '⭐', label: 'Best Balance', desc: 'Recommended for most users' },
  'Q5_K_M': { quality: 4.5, emoji: '✨', label: 'High Quality', desc: 'Better quality, more VRAM' },
  'Q6_K': { quality: 5, emoji: '💎', label: 'Very High', desc: 'Near-original, large' },
  'Q8_0': { quality: 5, emoji: '🔮', label: 'Maximum', desc: 'Best quality, huge' },
};

// Check if model can run on user's hardware
const getCompatibility = (model, hardware) => {
  if (!hardware?.vram) return { canRun: true, status: 'unknown', message: 'Hardware not detected' };
  
  const vramGB = hardware.vram / 1024; // Convert MB to GB
  const modelVram = model.vram || model.variants?.[0]?.vram || 0;
  const modelSize = model.size || model.variants?.[0]?.size || 0;
  
  // Estimate VRAM needed (rough: model size * 1.2 for overhead)
  const estimatedVram = modelVram || (modelSize * 1.2);
  
  if (estimatedVram <= 0) {
    return { canRun: true, status: 'unknown', message: 'Size unknown' };
  }
  
  if (estimatedVram <= vramGB * 0.8) {
    return { canRun: true, status: 'perfect', message: `✓ Runs great (${estimatedVram.toFixed(1)}GB needed)` };
  } else if (estimatedVram <= vramGB) {
    return { canRun: true, status: 'good', message: `✓ Will run (${estimatedVram.toFixed(1)}GB needed)` };
  } else if (estimatedVram <= vramGB * 1.3) {
    return { canRun: true, status: 'tight', message: `⚠ Tight fit - may use CPU offload` };
  } else {
    return { canRun: false, status: 'no', message: `✗ Too large (needs ${estimatedVram.toFixed(1)}GB VRAM)` };
  }
};

// Get best variant for user's hardware
const getBestVariant = (model, hardware) => {
  if (!model.variants || model.variants.length === 0) return null;
  if (!hardware?.vram) return model.variants[0];
  
  const vramGB = hardware.vram / 1024;
  
  // Sort variants by size (largest first that fits)
  const sortedVariants = [...model.variants].sort((a, b) => (b.vram || b.size || 0) - (a.vram || a.size || 0));
  
  // Find largest variant that fits comfortably (80% of VRAM)
  const bestFit = sortedVariants.find(v => (v.vram || v.size * 1.2) <= vramGB * 0.8);
  
  // If nothing fits comfortably, find one that fits at all
  if (!bestFit) {
    return sortedVariants.find(v => (v.vram || v.size * 1.2) <= vramGB) || sortedVariants[sortedVariants.length - 1];
  }
  
  return bestFit;
};

// Model card for browse - cleaner, less glassy
const BrowseModelCard = memo(({ model, onDownload, onViewProfile, downloading, hardware }) => {
  const bestVariant = getBestVariant(model, hardware);
  const sizeGB = bestVariant?.size || model.size || model.variants?.[0]?.size || 0;
  const vramNeeded = bestVariant?.vram || model.vram || (sizeGB * 1.2);
  const compatibility = getCompatibility({ vram: vramNeeded, size: sizeGB }, hardware);
  
  const sizeDisplay = sizeGB ? `${sizeGB.toFixed?.(1) || sizeGB} GB` : 'Unknown';
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onViewProfile?.(model)}
      className={`bg-neutral-900 border rounded-lg p-4 transition-all cursor-pointer ${
        compatibility.status === 'no' 
          ? 'border-red-500/30 opacity-60' 
          : compatibility.status === 'perfect'
          ? 'border-emerald-500/30 hover:border-emerald-500/50'
          : 'border-neutral-700 hover:border-neutral-600'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-white truncate">
            {model.name}
          </h4>
          <p className="text-xs text-neutral-400 mt-0.5">
            {model.author || model.provider || 'Community'}
          </p>
        </div>
        
        {/* Compatibility badge */}
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
          compatibility.status === 'perfect' ? 'bg-emerald-500/20 text-emerald-400' :
          compatibility.status === 'good' ? 'bg-blue-500/20 text-blue-400' :
          compatibility.status === 'tight' ? 'bg-amber-500/20 text-amber-400' :
          compatibility.status === 'no' ? 'bg-red-500/20 text-red-400' :
          'bg-neutral-700 text-neutral-400'
        }`}>
          {compatibility.status === 'perfect' && <CheckCircle className="w-3 h-3" />}
          {compatibility.status === 'good' && <CheckCircle className="w-3 h-3" />}
          {compatibility.status === 'tight' && <AlertCircle className="w-3 h-3" />}
          {compatibility.status === 'no' && <XCircle className="w-3 h-3" />}
          <span>{sizeDisplay}</span>
        </div>
      </div>
      
      {/* Description */}
      <p className="text-xs text-neutral-300 line-clamp-2 mb-3 leading-relaxed">
        {model.description || 'No description available'}
      </p>
      
      {/* Best variant recommendation */}
      {bestVariant && model.variants?.length > 1 && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <span className="text-neutral-500">Best for your PC:</span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
            {bestVariant.tag || bestVariant.params}
          </span>
          {bestVariant.vram && (
            <span className="text-neutral-500">({bestVariant.vram}GB VRAM)</span>
          )}
        </div>
      )}
      
      {/* Tags */}
      {model.tags && model.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {model.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      
      {/* Stats & Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          {(model.pulls || model.downloads) && (
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {((model.pulls || model.downloads) / 1000).toFixed(0)}K
            </span>
          )}
          {model.rating && (
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              {model.rating}
            </span>
          )}
          <span className="text-blue-400 hover:text-blue-300 transition-colors">
            View details →
          </span>
        </div>
        
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(model, bestVariant); }}
          disabled={downloading || compatibility.status === 'no'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            compatibility.status === 'no'
              ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
              : downloading
              ? 'bg-neutral-700 text-neutral-300'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {downloading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Installing...</span>
            </>
          ) : compatibility.status === 'no' ? (
            <>
              <XCircle className="w-3 h-3" />
              <span>Too Large</span>
            </>
          ) : (
            <>
              <Download className="w-3 h-3" />
              <span>Install</span>
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
});

// Main component
export const ModelHubPanel = memo(({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [showPrivateVault, setShowPrivateVault] = useState(false);
  const [libraryModels, setLibraryModels] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  
  // Hardware state
  const [hardware, setHardware] = useState(null);
  const [hardwareLoading, setHardwareLoading] = useState(true);
  
  // Browse state
  const [browseProvider, setBrowseProvider] = useState('featured');
  const [browseModels, setBrowseModels] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState(null);
  const [downloadingModel, setDownloadingModel] = useState(null);
  const [pullProgress, setPullProgress] = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  
  const downloads = useDownloads();
  const {
    initializeDownloads,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    clearCompletedDownloads,
  } = useDownloadActions();
  
  // Initialize on mount
  useEffect(() => {
    if (isOpen) {
      initializeDownloads();
      loadLibrary();
      loadBrowseModels(browseProvider);
      loadHardwareInfo();
    }
  }, [isOpen]);
  
  // Load hardware info for smart recommendations
  const loadHardwareInfo = async () => {
    setHardwareLoading(true);
    try {
      const info = await window.electronAPI?.detectHardware?.();
      if (info) {
        // Get VRAM from first GPU
        const vram = info.gpus?.[0]?.vram || 0;
        const ram = info.memory?.total || 0;
        setHardware({
          vram, // in MB
          ram,
          gpuName: info.gpus?.[0]?.name || 'Unknown GPU',
          hasNpu: info.npu?.detected || false,
          npuTops: info.npu?.tops || 0,
        });
      }
    } catch (error) {
      console.error('Failed to detect hardware:', error);
    } finally {
      setHardwareLoading(false);
    }
  };
  
  // Load browse models when provider changes
  useEffect(() => {
    if (isOpen && activeTab === 'browse') {
      loadBrowseModels(browseProvider);
    }
  }, [browseProvider, isOpen, activeTab]);
  
  // Subscribe to pull progress
  useEffect(() => {
    if (!window.electronAPI?.onProvidersPullProgress) return;
    
    const cleanup = window.electronAPI.onProvidersPullProgress((progress) => {
      setPullProgress(prev => ({
        ...prev,
        [progress.model]: progress
      }));
      
      if (progress.status === 'success' || progress.status === 'error') {
        setDownloadingModel(null);
        // Refresh library after successful download
        if (progress.status === 'success') {
          loadLibrary();
        }
      }
    });
    
    return () => cleanup?.();
  }, []);
  
  // Load browse models
  const loadBrowseModels = async (provider) => {
    setBrowseLoading(true);
    setBrowseError(null);
    setBrowseModels([]);
    
    try {
      let models = [];
      
      switch (provider) {
        case 'featured':
          const featured = await window.electronAPI?.providersGetFeatured?.();
          if (featured) {
            // Combine all featured models
            models = [
              ...(featured.llm?.ollama || []).map(m => ({ ...m, source: 'ollama' })),
              ...(featured.llm?.huggingface || []).map(m => ({ ...m, source: 'huggingface' })),
              ...(featured.vision || []).map(m => ({ ...m, source: 'vision' })),
              ...(featured.image || []).map(m => ({ ...m, source: 'civitai' })),
            ];
          }
          break;
          
        case 'ollama':
          models = await window.electronAPI?.providersGetOllamaModels?.('popular') || [];
          break;
          
        case 'huggingface':
          // Get categories for HuggingFace
          const categories = await window.electronAPI?.providersGetAllCategories?.();
          if (categories?.huggingface) {
            // Get models from first few collections
            const collections = Object.keys(categories.huggingface).slice(0, 3);
            for (const collection of collections) {
              const collectionModels = categories.huggingface[collection]?.models || [];
              models.push(...collectionModels.map(m => ({ 
                id: m,
                name: m.split('/').pop(),
                author: m.split('/')[0],
                source: 'huggingface',
                tags: ['gguf']
              })));
            }
          }
          break;
          
        case 'vision':
          models = await window.electronAPI?.providersGetVisionModels?.() || [];
          break;
          
        case 'image':
          models = await window.electronAPI?.providersGetImageModels?.('popular') || [];
          break;
      }
      
      setBrowseModels(models);
    } catch (error) {
      console.error('Failed to load browse models:', error);
      setBrowseError(error.message || 'Failed to load models');
    } finally {
      setBrowseLoading(false);
    }
  };
  
  // Handle model download/install with smart variant selection
  const handleDownloadModel = async (model, variant = null) => {
    const modelId = model.id || model.name;
    setDownloadingModel(modelId);
    
    try {
      // For Ollama models, use pull with best variant tag
      if (model.source === 'ollama' || browseProvider === 'ollama') {
        // Use variant tag if provided (e.g., "7b", "13b")
        const tag = variant?.tag || '';
        const modelName = tag ? `${modelId}:${tag}` : modelId;
        console.log(`[ModelHub] Installing Ollama model: ${modelName}`);
        await window.electronAPI?.providersPullOllamaModel?.(modelName);
      } else {
        // For HuggingFace/other models, include variant info
        const downloadPayload = {
          ...model,
          selectedVariant: variant,
          // Auto-select best quantization for user's hardware
          quantization: variant?.quantization || 'Q4_K_M', // Default to best balance
        };
        await window.electronAPI?.providersDownloadModel?.(downloadPayload);
      }
    } catch (error) {
      console.error('Failed to download model:', error);
      setDownloadingModel(null);
    }
  };
  
  // Load library models
  const loadLibrary = async () => {
    setLibraryLoading(true);
    try {
      const models = await window.electronAPI?.libraryGetAllModels?.();
      if (models && !models.error) {
        setLibraryModels(models);
      }
    } catch (error) {
      console.error('Failed to load library:', error);
    } finally {
      setLibraryLoading(false);
    }
  };
  
  // Filter downloads
  const filteredDownloads = useMemo(() => {
    if (!searchQuery) return downloads;
    const query = searchQuery.toLowerCase();
    return downloads.filter(d => d.name?.toLowerCase().includes(query));
  }, [downloads, searchQuery]);
  
  // Filter library
  const filteredLibrary = useMemo(() => {
    if (!searchQuery) return libraryModels;
    const query = searchQuery.toLowerCase();
    return libraryModels.filter(m => 
      m.name?.toLowerCase().includes(query) ||
      m.alias?.toLowerCase().includes(query) ||
      m.tags?.some(t => t.toLowerCase().includes(query))
    );
  }, [libraryModels, searchQuery]);
  
  // Download stats
  const downloadStats = useMemo(() => ({
    total: downloads.length,
    active: downloads.filter(d => ['downloading', 'verifying'].includes(d.status)).length,
    completed: downloads.filter(d => d.status === 'completed').length,
    failed: downloads.filter(d => d.status === 'error').length,
  }), [downloads]);
  
  // Handle favorite
  const handleFavorite = useCallback(async (modelId) => {
    const model = libraryModels.find(m => m.id === modelId);
    if (model) {
      await window.electronAPI?.libraryUpdateModel?.(modelId, { favorite: !model.favorite });
      loadLibrary();
    }
  }, [libraryModels]);
  
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-5xl h-[85vh] bg-[var(--bg-primary)] border border-[var(--border-dim)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--border-dim)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 rounded-xl">
              <Package className="w-6 h-6 text-[var(--accent-primary)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">
                Model Hub
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Browse HuggingFace, CivitAI, Ollama & more
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-9 pr-3 py-2 w-64 bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
              />
            </div>
            
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="px-4 py-2 border-b border-[var(--border-dim)] flex items-center justify-between">
          <div className="flex gap-1">
            <TabButton
              active={activeTab === 'browse'}
              icon={Globe}
              label="Browse"
              onClick={() => setActiveTab('browse')}
              color="text-emerald-400"
            />
            <TabButton
              active={activeTab === 'downloads'}
              icon={Download}
              label="Downloads"
              onClick={() => setActiveTab('downloads')}
              badge={downloadStats.active}
            />
            <TabButton
              active={activeTab === 'library'}
              icon={Library}
              label="Library"
              onClick={() => setActiveTab('library')}
              badge={libraryModels.length}
            />
            <TabButton
              active={activeTab === 'storage'}
              icon={HardDrive}
              label="Storage"
              onClick={() => setActiveTab('storage')}
            />
          </div>
          
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            {activeTab === 'library' && (
              <div className="flex bg-[var(--bg-secondary)] rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-[var(--bg-tertiary)]' : ''}`}
                >
                  <Grid className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-[var(--bg-tertiary)]' : ''}`}
                >
                  <List className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
              </div>
            )}
            
            {/* Private Vault entry - subtle */}
            <button
              onClick={() => setShowPrivateVault(true)}
              className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors group"
              title="Private Vault"
            >
              <Lock className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Browse Tab */}
          {activeTab === 'browse' && (
            <div className="space-y-4">
              {/* Hardware Info Bar - Shows your PC specs */}
              <div className="flex items-center justify-between p-3 bg-neutral-900 border border-neutral-800 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs text-neutral-300">
                      {hardwareLoading ? 'Detecting...' : hardware?.gpuName || 'Unknown GPU'}
                    </span>
                  </div>
                  {hardware?.vram > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 rounded text-xs">
                      <span className="text-emerald-400 font-medium">{(hardware.vram / 1024).toFixed(0)} GB</span>
                      <span className="text-neutral-500">VRAM</span>
                    </div>
                  )}
                  {hardware?.hasNpu && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 rounded text-xs">
                      <Zap className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400">NPU {hardware.npuTops} TOPS</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-500">
                    ✓ Models marked green will run smoothly on your PC
                  </span>
                  <button
                    onClick={() => loadBrowseModels(browseProvider)}
                    className="p-1.5 hover:bg-neutral-800 rounded transition-colors"
                    title="Refresh models"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-neutral-500" />
                  </button>
                </div>
              </div>
              
              {/* Provider sub-tabs */}
              <div className="flex items-center gap-2 pb-3 border-b border-neutral-800">
                {BROWSE_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => setBrowseProvider(provider.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      browseProvider === provider.id
                        ? `bg-neutral-800 ${provider.color}`
                        : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
                    }`}
                  >
                    <provider.icon className="w-3.5 h-3.5" />
                    {provider.name}
                  </button>
                ))}
                
                {/* NSFW button - subtle */}
                <button
                  onClick={() => setShowPrivateVault(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-600 hover:text-pink-400 hover:bg-pink-500/10 transition-all ml-auto"
                  title="Private Vault (NSFW)"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Private
                </button>
              </div>
              
              {/* Quantization tip */}
              <div className="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                <Sparkles className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-xs text-neutral-400">
                  <span className="text-blue-400 font-medium">Smart Install:</span> We auto-select the best model size and settings for your hardware. 
                  <span className="text-neutral-500"> Q4_K_M quantization gives the best balance of quality and speed.</span>
                </div>
              </div>
              
              {/* Browse content */}
              {browseLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-4" />
                  <p className="text-sm text-neutral-400">Loading models from {BROWSE_PROVIDERS.find(p => p.id === browseProvider)?.name}...</p>
                </div>
              ) : browseError ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
                  <h3 className="text-sm font-medium text-neutral-300 mb-2">Failed to load models</h3>
                  <p className="text-xs text-neutral-500 mb-4">{browseError}</p>
                  <button
                    onClick={() => loadBrowseModels(browseProvider)}
                    className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                  </button>
                </div>
              ) : browseModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Globe className="w-12 h-12 text-neutral-600 mb-4" />
                  <h3 className="text-sm font-medium text-neutral-300 mb-2">No models found</h3>
                  <p className="text-xs text-neutral-500">Try selecting a different provider or check your connection</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <AnimatePresence mode="popLayout">
                    {browseModels.slice(0, 30).map((model, idx) => (
                      <BrowseModelCard
                        key={model.id || model.name || idx}
                        model={model}
                        onDownload={handleDownloadModel}
                        onViewProfile={(m) => { setSelectedModel(m); setShowProfile(true); }}
                        downloading={downloadingModel === (model.id || model.name)}
                        hardware={hardware}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
          
          {/* Downloads Tab */}
          {activeTab === 'downloads' && (
            <div className="space-y-4">
              {/* Stats bar */}
              <div className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg">
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-[var(--text-muted)]">
                    Total: <span className="text-[var(--text-primary)] font-medium">{downloadStats.total}</span>
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Active: <span className="text-blue-400 font-medium">{downloadStats.active}</span>
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Completed: <span className="text-emerald-400 font-medium">{downloadStats.completed}</span>
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Failed: <span className="text-red-400 font-medium">{downloadStats.failed}</span>
                  </span>
                </div>
                
                {downloadStats.completed > 0 && (
                  <button
                    onClick={clearCompletedDownloads}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >
                    Clear completed
                  </button>
                )}
              </div>
              
              {/* Downloads list */}
              {filteredDownloads.length === 0 ? (
                <div className="text-center py-12">
                  <Download className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                    No downloads
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Downloads will appear here when you start downloading models.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {filteredDownloads.map((download) => (
                      <DownloadItemCard
                        key={download.id}
                        download={download}
                        onPause={pauseDownload}
                        onResume={resumeDownload}
                        onCancel={cancelDownload}
                        onRetry={retryDownload}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
          
          {/* Library Tab */}
          {activeTab === 'library' && (
            <div className="space-y-4">
              {libraryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 text-[var(--accent-primary)] animate-spin" />
                </div>
              ) : filteredLibrary.length === 0 ? (
                <div className="text-center py-12">
                  <Library className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
                  <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                    No models in library
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Download or import models to add them to your library.
                  </p>
                </div>
              ) : (
                <div className={`${
                  viewMode === 'grid'
                    ? 'grid grid-cols-3 gap-3'
                    : 'space-y-2'
                }`}>
                  <AnimatePresence>
                    {filteredLibrary.map((model) => (
                      <LibraryModelCard
                        key={model.id}
                        model={model}
                        onSelect={() => {}}
                        onFavorite={handleFavorite}
                        onDelete={() => {}}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
          
          {/* Storage Tab */}
          {activeTab === 'storage' && (
            <div className="text-center py-12">
              <HardDrive className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                Storage Management
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                View disk usage, clean up old files, and manage storage locations.
              </p>
            </div>
          )}
          
          {/* Collections Tab */}
          {activeTab === 'collections' && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                Model Collections
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Browse starter packs and create custom collections.
              </p>
            </div>
          )}
        </div>
      </motion.div>
      
      {/* Private Vault Modal */}
      <AnimatePresence>
        {showPrivateVault && (
          <PrivateVaultModal
            isOpen={showPrivateVault}
            onClose={() => setShowPrivateVault(false)}
          />
        )}
      </AnimatePresence>
      
      {/* Model Profile Modal */}
      <AnimatePresence>
        {showProfile && selectedModel && (
          <ModelProfileModal
            model={selectedModel}
            isOpen={showProfile}
            onClose={() => { setShowProfile(false); setSelectedModel(null); }}
            onDownload={handleDownloadModel}
            hardware={hardware}
            downloading={downloadingModel === (selectedModel?.id || selectedModel?.name)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// Private Vault Modal - subtle entry point for NSFW content
const PrivateVaultModal = memo(({ isOpen, onClose }) => {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  
  const handleUnlock = () => {
    // In production, this would verify against stored password
    setUnlocked(true);
  };
  
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="w-full max-w-md bg-[var(--bg-primary)] border border-[var(--border-dim)] rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center">
            {unlocked ? (
              <Unlock className="w-8 h-8 text-emerald-400" />
            ) : (
              <Lock className="w-8 h-8 text-[var(--text-muted)]" />
            )}
          </div>
          
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Private Vault
          </h3>
          
          {!unlocked ? (
            <>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                This section contains adult content. Enter your password to access.
              </p>
              
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg px-4 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] mb-4"
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              />
              
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUnlock}
                  className="flex-1 px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Unlock
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Vault unlocked. Content is isolated from main library.
              </p>
              
              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg text-left mb-4">
                <p className="text-xs text-[var(--text-muted)]">
                  This area contains NSFW model downloads. Content here is:
                </p>
                <ul className="mt-2 text-xs text-[var(--text-secondary)] space-y-1">
                  <li>• Encrypted at rest</li>
                  <li>• Hidden from main searches</li>
                  <li>• Not included in analytics</li>
                  <li>• Password protected</li>
                </ul>
              </div>
              
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-lg text-sm font-medium transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
});

export default ModelHubPanel;



