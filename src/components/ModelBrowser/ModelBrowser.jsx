/**
 * Model Browser - Multi-Provider Interface
 * 
 * Comprehensive model discovery across:
 * - Ollama Library (official models)
 * - HuggingFace (GGUF models)
 * - Vision Models (LLaVA, etc.)
 * - Image Generation (Stable Diffusion, FLUX)
 */

import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, Grid, List, Download, GitCompare, X,
  Sparkles, TrendingUp, Clock, Code, MessageCircle, Lightbulb,
  Cpu, HardDrive, Zap, ChevronRight, ExternalLink, RefreshCw,
  Package, Info, CheckCircle, AlertCircle, Loader2, Eye, Image,
  Globe, Layers, Star, Play, Box, Database, MonitorPlay, Palette,
  Server, Settings, Flame, AlertTriangle,
} from 'lucide-react';
import { useHuggingFaceStore } from '../../stores/huggingfaceStore';
import { HardwarePanel } from './HardwarePanel';

// Provider tabs
const PROVIDERS = [
  { id: 'featured', name: 'Featured', icon: Sparkles, color: 'text-yellow-400' },
  { id: 'ollama', name: 'Ollama Library', icon: Box, color: 'text-green-400' },
  { id: 'huggingface', name: 'HuggingFace', icon: Database, color: 'text-orange-400' },
  { id: 'vision', name: 'Vision Models', icon: Eye, color: 'text-purple-400' },
  { id: 'image', name: 'Image Gen', icon: Palette, color: 'text-pink-400' },
  { id: 'nsfw', name: 'NSFW Models', icon: Flame, color: 'text-red-400', nsfw: true },
];

// Category icons
const CATEGORY_ICONS = {
  popular: TrendingUp,
  chat: MessageCircle,
  code: Code,
  vision: Eye,
  small: Zap,
  uncensored: Package,
  sdxl: Layers,
  flux: Sparkles,
  sd15: Image,
  anime: Palette,
  photorealistic: MonitorPlay,
};

const isElectron = () => typeof window !== 'undefined' && window.electronAPI;

// Fallback NSFW model data
const UNCENSORED_LLMS = [
  {
    id: 'wizard-vicuna-uncensored',
    name: 'Wizard Vicuna Uncensored',
    description: 'Completely uncensored conversational model. No content filters, no restrictions.',
    author: 'Cognitive Computations',
    family: 'Vicuna',
    capability: 'chat',
    variants: [
      { tag: '13b', params: '13B', size: 7.4, vram: 10 },
      { tag: '30b', params: '30B', size: 17, vram: 22 },
    ],
    tags: ['uncensored', 'roleplay', 'nsfw', 'no-filter'],
    pulls: 800000,
  },
  {
    id: 'dolphin-mixtral',
    name: 'Dolphin Mixtral (Uncensored)',
    description: 'Powerful uncensored Mixtral fine-tune. Follows instructions without moral judgments.',
    author: 'Cognitive Computations',
    family: 'Mixtral',
    capability: 'chat',
    variants: [
      { tag: '8x7b', params: '46.7B (8x7B)', size: 26, vram: 32 },
    ],
    tags: ['uncensored', 'moe', 'powerful', 'no-refusals'],
    pulls: 1000000,
  },
  {
    id: 'mythomax',
    name: 'MythoMax L2 (Uncensored)',
    description: 'Excellent for creative fiction and adult storytelling.',
    author: 'Gryphe',
    family: 'Llama',
    capability: 'chat',
    variants: [
      { tag: '13b', params: '13B', size: 7.4, vram: 10 },
    ],
    tags: ['uncensored', 'storytelling', 'creative', 'fiction'],
    pulls: 450000,
  },
];

const NSFW_IMAGE_MODELS = [
  {
    id: 'realistic-vision-nsfw',
    name: 'Realistic Vision V5.1 (NSFW)',
    description: 'Photorealistic NSFW model. Incredible detail for adult content.',
    author: 'SG_161222',
    baseModel: 'SD 1.5',
    size: 4.27,
    tags: ['photorealistic', 'nsfw', 'inpainting', 'portraits'],
    downloads: 1200000,
    rating: 4.8,
  },
  {
    id: 'anything-v5',
    name: 'Anything V5 (NSFW)',
    description: 'Anime/hentai focused model. No restrictions on content.',
    author: 'Linaqruf',
    baseModel: 'SD 1.5',
    size: 4.27,
    tags: ['anime', 'hentai', 'nsfw', 'illustration'],
    downloads: 800000,
    rating: 4.6,
  },
  {
    id: 'pony-diffusion-v6',
    name: 'Pony Diffusion V6 XL',
    description: 'Specialized for anime/furry NSFW. Huge community and LoRA ecosystem.',
    author: 'AstraliteHeart',
    baseModel: 'SDXL 1.0',
    size: 6.94,
    tags: ['anime', 'furry', 'nsfw', 'lora-compatible'],
    downloads: 600000,
    rating: 4.6,
  },
];

export function ModelBrowser({ onClose }) {
  // Provider state
  const [activeProvider, setActiveProvider] = useState('featured');
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('popular');
  const [categories, setCategories] = useState({});
  
  // Detail panel
  const [selectedModel, setSelectedModel] = useState(null);
  
  // Pull/Download state
  const [pullProgress, setPullProgress] = useState({});
  
  // Hardware state
  const [hardwareInfo, setHardwareInfo] = useState({
    vramGB: 8,
    ramGB: 16,
    cpuCores: 8,
    hasNpu: false,
    hasCuda: false,
    gpuName: 'Unknown',
  });
  const [recommendations, setRecommendations] = useState(null);
  const [showHardware, setShowHardware] = useState(true);
  
  // View state
  const [viewMode, setViewMode] = useState('grid');

  // Error state
  const [initError, setInitError] = useState(null);

  // NSFW age verification
  const [showAgeVerification, setShowAgeVerification] = useState(false);
  const [ageVerified, setAgeVerified] = useState(false);

  // Load initial data
  useEffect(() => {
    if (!isElectron()) {
      setInitError('Not running in Electron');
      setIsLoading(false);
      return;
    }
    
    const init = async () => {
      setIsLoading(true);
      setInitError(null);
      
      try {
        console.log('[ModelBrowser] Starting init...');
        
        // Check if provider methods exist
        if (!window.electronAPI.providersGetAllCategories) {
          throw new Error('Provider API not available - app may need restart');
        }
        
        // Get categories
        console.log('[ModelBrowser] Getting categories...');
        const allCategories = await window.electronAPI.providersGetAllCategories();
        console.log('[ModelBrowser] Got categories:', allCategories);
        setCategories(allCategories || {});
        
        // Load featured models by default
        console.log('[ModelBrowser] Loading featured models...');
        await loadFeaturedModels();
        console.log('[ModelBrowser] Init complete');
      } catch (error) {
        console.error('[ModelBrowser] Init error:', error);
        setInitError(error.message || 'Failed to initialize');
        
        // Load fallback data
        loadFallbackData();
      }
      setIsLoading(false);
    };
    
    init();
    
    // Listen for pull progress
    const cleanup = window.electronAPI.onProvidersPullProgress?.((progress) => {
      setPullProgress(prev => ({
        ...prev,
        [progress.model]: progress,
      }));
    });
    
    return () => cleanup?.();
  }, []);
  
  // Fallback data when backend fails
  const loadFallbackData = () => {
    const fallbackModels = [
      {
        id: 'llama3.2',
        name: 'Llama 3.2',
        description: 'Meta\'s latest model - fast and capable',
        author: 'Meta',
        family: 'Llama',
        capability: 'chat',
        variants: [
          { tag: '1b', params: '1B', size: 1.3, vram: 2 },
          { tag: '3b', params: '3B', size: 2.0, vram: 4 },
        ],
        tags: ['chat', 'popular'],
        pulls: 5000000,
        source: 'ollama',
      },
      {
        id: 'mistral',
        name: 'Mistral 7B',
        description: 'Fast and efficient from Mistral AI',
        author: 'Mistral AI',
        family: 'Mistral',
        capability: 'chat',
        variants: [{ tag: 'latest', params: '7B', size: 4.1, vram: 6 }],
        tags: ['chat', 'fast'],
        pulls: 3000000,
        source: 'ollama',
      },
      {
        id: 'codellama',
        name: 'Code Llama',
        description: 'Specialized for code generation',
        author: 'Meta',
        family: 'CodeLlama',
        capability: 'code',
        variants: [
          { tag: '7b', params: '7B', size: 3.8, vram: 6 },
          { tag: '13b', params: '13B', size: 7.4, vram: 10 },
        ],
        tags: ['code', 'programming'],
        pulls: 4000000,
        source: 'ollama',
      },
      {
        id: 'qwen2.5',
        name: 'Qwen 2.5',
        description: 'Alibaba multilingual model',
        author: 'Alibaba',
        family: 'Qwen',
        capability: 'chat',
        variants: [
          { tag: '7b', params: '7B', size: 4.4, vram: 6 },
          { tag: '14b', params: '14B', size: 8.9, vram: 12 },
        ],
        tags: ['chat', 'multilingual'],
        pulls: 2500000,
        source: 'ollama',
      },
      {
        id: 'llava',
        name: 'LLaVA',
        description: 'Vision model - understands images',
        author: 'Microsoft',
        family: 'LLaVA',
        capability: 'vision',
        variants: [{ tag: '7b', params: '7B', size: 4.5, vram: 8 }],
        tags: ['vision', 'multimodal'],
        pulls: 1500000,
        source: 'ollama',
        isVision: true,
      },
    ];
    
    setModels(fallbackModels);
    setCategories({
      ollama: {
        popular: { name: 'Popular' },
        chat: { name: 'Chat' },
        code: { name: 'Code' },
        vision: { name: 'Vision' },
      },
    });
  };

  // Load featured models
  const loadFeaturedModels = async () => {
    setIsLoading(true);
    try {
      const featured = await window.electronAPI.providersGetFeatured();
      // Combine featured into a flat list with source tags (SFW only)
      const combined = [
        ...(featured.llm?.ollama || []).map(m => ({ ...m, source: 'ollama' })),
        ...(featured.llm?.huggingface || []).map(m => ({ ...m, source: 'huggingface' })),
        ...(featured.vision || []).map(m => ({ ...m, source: 'ollama', isVision: true })),
        ...(featured.image || []).map(m => ({ ...m, source: 'civitai' })),
      ];
      setModels(combined);
    } catch (error) {
      console.error('Featured load error:', error);
      // Load fallback data
      loadFallbackData();
    }
    setIsLoading(false);
  };

  // Load Ollama models
  const loadOllamaModels = async (category = 'popular') => {
    setIsLoading(true);
    setSelectedCategory(category);
    try {
      const result = await window.electronAPI.providersGetOllamaModels(category);
      setModels((result || []).map(m => ({ ...m, source: 'ollama' })));
    } catch (error) {
      console.error('Ollama load error:', error);
    }
    setIsLoading(false);
  };

  // Load Vision models
  const loadVisionModels = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.providersGetVisionModels();
      setModels((result || []).map(m => ({ ...m, source: 'ollama', isVision: true })));
    } catch (error) {
      console.error('Vision load error:', error);
    }
    setIsLoading(false);
  };

  // Load Image Gen models (SFW only - NSFW in Private Vault)
  const loadImageModels = async (category = 'popular') => {
    setIsLoading(true);
    setSelectedCategory(category);

    try {
      const result = await window.electronAPI.providersGetImageModels(category);
      setModels((result || []).map(m => ({ ...m, source: 'civitai' })));
    } catch (error) {
      console.error('Image load error:', error);
    }
    setIsLoading(false);
  };

  // Load NSFW models from all providers
  const loadNSFWModels = async (category = 'all') => {
    setIsLoading(true);
    setSelectedCategory(category);

    try {
      const [nsfwLLM, nsfwImage, hfNSFW] = await Promise.all([
        window.electronAPI.providersGetNSFWModels?.('llm') || Promise.resolve([]),
        window.electronAPI.providersGetNSFWModels?.('image') || Promise.resolve([]),
        window.electronAPI.providersGetNSFWModels?.('huggingface') || Promise.resolve([]),
      ]);

      const combined = [
        ...(nsfwLLM || []).map(m => ({ ...m, source: 'ollama', type: 'llm', nsfw: true })),
        ...(nsfwImage || []).map(m => ({ ...m, source: 'civitai', type: 'image', nsfw: true })),
        ...(hfNSFW || []).map(m => ({ ...m, source: 'huggingface', type: 'llm', nsfw: true })),
      ];

      setModels(combined);
    } catch (error) {
      console.error('NSFW models load error:', error);
      // Fallback to hardcoded NSFW models
      setModels(getFallbackNSFWModels());
    }
    setIsLoading(false);
  };

  // Fallback NSFW models for when backend fails
  const getFallbackNSFWModels = () => {
    return [
      // NSFW LLMs from various sources
      ...UNCENSORED_LLMS.map(m => ({ ...m, source: 'ollama', type: 'llm', nsfw: true })),
      // NSFW Image models
      ...NSFW_IMAGE_MODELS.map(m => ({ ...m, source: 'civitai', type: 'image', nsfw: true })),
    ];
  };

  // Handle provider change
  const handleProviderChange = (providerId) => {
    setActiveProvider(providerId);
    setSelectedModel(null);
    setSelectedCategory('popular');

    // Check age verification for NSFW content
    if (providerId === 'nsfw' && !ageVerified) {
      setShowAgeVerification(true);
      return;
    }

    switch (providerId) {
      case 'featured':
        loadFeaturedModels();
        break;
      case 'ollama':
        loadOllamaModels('popular');
        break;
      case 'vision':
        loadVisionModels();
        break;
      case 'image':
        loadImageModels('popular');
        break;
      case 'nsfw':
        loadNSFWModels('all');
        break;
      case 'huggingface':
        // Use HuggingFace store
        break;
    }
  };

  // Search across providers
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    try {
      const results = await window.electronAPI.providersSearchAll(searchQuery, {
        providers: ['ollama', 'civitai'],
      });
      
      const combined = [
        ...(results.ollama || []).map(m => ({ ...m, source: 'ollama' })),
        ...(results.civitai || []).map(m => ({ ...m, source: 'civitai' })),
      ];
      setModels(combined);
    } catch (error) {
      console.error('Search error:', error);
    }
    setIsLoading(false);
  };

  // Pull/Install an Ollama model
  const handlePullModel = async (model, variant) => {
    if (!isElectron()) return;
    
    const modelName = variant ? `${model.id}:${variant.tag}` : model.id;
    
    try {
      setPullProgress(prev => ({
        ...prev,
        [modelName]: { status: 'starting', progress: 0 },
      }));
      
      await window.electronAPI.providersPullOllamaModel(modelName);
      
      setPullProgress(prev => ({
        ...prev,
        [modelName]: { status: 'completed', progress: 100 },
      }));
    } catch (error) {
      console.error('Pull error:', error);
      setPullProgress(prev => ({
        ...prev,
        [modelName]: { status: 'error', error: error.message },
      }));
    }
  };

  // Filter models by search
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;

    const query = searchQuery.toLowerCase();
    return models.filter(m =>
      m.name?.toLowerCase().includes(query) ||
      m.description?.toLowerCase().includes(query) ||
      m.family?.toLowerCase().includes(query) ||
      m.tags?.some(t => t.toLowerCase().includes(query))
    );
  }, [models, searchQuery]);

  // Get categories for current provider
  const currentCategories = useMemo(() => {
    switch (activeProvider) {
      case 'ollama':
        return categories.ollama || {};
      case 'image':
        return categories.civitai || {};
      case 'nsfw':
        return {
          all: { name: 'All NSFW', description: 'All uncensored models' },
          llm: { name: 'NSFW Chat', description: 'Uncensored language models' },
          image: { name: 'NSFW Image', description: 'Adult image generation' },
          huggingface: { name: 'NSFW HF', description: 'NSFW models from HuggingFace' },
        };
      default:
        return {};
    }
  }, [activeProvider, categories]);

  return (
    <div className="fixed inset-0 z-50 bg-forge-bg flex flex-col">
      {/* Header */}
      <header className="h-16 px-4 flex items-center justify-between border-b border-forge-border bg-forge-surface/80 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
            <Globe size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-text-primary">Model Hub</h1>
            <p className="text-[10px] text-text-muted">
              Discover & download AI models from multiple sources
            </p>
          </div>
        </div>

        {/* Global Search */}
        <div className="flex-1 max-w-xl mx-8">
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search all models..."
              className="w-full pl-11 pr-4 py-2.5 bg-forge-bg border border-forge-border rounded-xl text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Hardware Badge */}
          <button
            onClick={() => setShowHardware(!showHardware)}
            className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${
              showHardware 
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-forge-bg border-forge-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <Server size={14} />
            <span className="text-xs">{hardwareInfo.gpuName?.split(' ').slice(0, 3).join(' ')}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20">
              {hardwareInfo.vramGB}GB
            </span>
          </button>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-forge-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {initError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center gap-3">
          <AlertCircle size={16} className="text-red-400" />
          <span className="text-sm text-red-400 flex-1">
            {initError} — Showing cached model list. Try restarting the app.
          </span>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30"
          >
            Reload
          </button>
        </div>
      )}

      {/* Provider Tabs */}
      <div className="h-14 px-4 flex items-center gap-2 border-b border-forge-border bg-forge-surface/50">
        {PROVIDERS.map((provider) => {
          const Icon = provider.icon;
          const isActive = activeProvider === provider.id;
          
          return (
            <button
              key={provider.id}
              onClick={() => handleProviderChange(provider.id)}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-forge-hover text-text-primary border border-forge-border'
                  : 'text-text-muted hover:text-text-secondary hover:bg-forge-hover/50'
              }`}
            >
              <Icon size={16} className={isActive ? provider.color : ''} />
              {provider.name}
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Categories */}
        {(activeProvider === 'ollama' || activeProvider === 'image' || activeProvider === 'nsfw') && (
          <aside className="w-52 border-r border-forge-border bg-forge-surface/30 flex flex-col overflow-y-auto">
            <div className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Categories</p>
              <div className="space-y-1">
                {Object.entries(currentCategories).map(([id, cat]) => {
                  const Icon = CATEGORY_ICONS[id] || Package;
                  const isActive = selectedCategory === id;
                  
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setSelectedCategory(id);
                        if (activeProvider === 'ollama') {
                          loadOllamaModels(id);
                        } else if (activeProvider === 'image') {
                          loadImageModels(id);
                        } else if (activeProvider === 'nsfw') {
                          loadNSFWModels(id);
                        }
                      }}
                      className={`w-full px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'hover:bg-forge-hover text-text-secondary'
                      }`}
                    >
                      <Icon size={14} />
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="h-11 px-4 flex items-center justify-between border-b border-forge-border bg-forge-surface/20">
            <span className="text-sm text-text-secondary">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Loading...
                </span>
              ) : (
                `${filteredModels.length} models`
              )}
            </span>

            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-forge-border overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2 py-1 ${viewMode === 'grid' ? 'bg-forge-hover text-text-primary' : 'text-text-muted'}`}
                >
                  <Grid size={14} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2 py-1 ${viewMode === 'list' ? 'bg-forge-hover text-text-primary' : 'text-text-muted'}`}
                >
                  <List size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Models Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 size={32} className="animate-spin text-accent-primary mx-auto mb-3" />
                  <p className="text-text-secondary">Loading models...</p>
                </div>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Package size={48} className="text-text-muted mx-auto mb-3 opacity-50" />
                  <p className="text-text-secondary mb-2">No models found</p>
                  <p className="text-xs text-text-muted">Try a different search or category</p>
                </div>
              </div>
            ) : (
              <div className={
                viewMode === 'grid'
                  ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                  : 'space-y-2'
              }>
                {filteredModels.map((model, idx) => (
                  <ModelCard
                    key={`${model.source}-${model.id}-${idx}`}
                    model={model}
                    viewMode={viewMode}
                    isSelected={selectedModel?.id === model.id}
                    onSelect={() => setSelectedModel(model)}
                    onPull={(variant) => handlePullModel(model, variant)}
                    pullProgress={pullProgress[model.id] || pullProgress[`${model.id}:${model.variants?.[0]?.tag}`]}
                    vramGB={hardwareInfo.vramGB}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* Detail Panel */}
        <AnimatePresence>
          {selectedModel && (
            <ModelDetailPanel
              model={selectedModel}
              onClose={() => setSelectedModel(null)}
              onPull={(variant) => handlePullModel(selectedModel, variant)}
              pullProgress={pullProgress}
              vramGB={hardwareInfo.vramGB}
            />
          )}
        </AnimatePresence>

        {/* Age Verification Modal */}
        <AnimatePresence>
          {showAgeVerification && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-forge-surface border border-red-500/30 rounded-xl p-6 max-w-md w-full"
              >
                <div className="text-center mb-6">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle size={32} className="text-red-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Age Verification Required</h2>
                  <p className="text-text-secondary text-sm">
                    The NSFW Models section contains uncensored AI models that may generate adult content.
                    You must be 18+ to access this section.
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setAgeVerified(true);
                      setShowAgeVerification(false);
                      handleProviderChange('nsfw');
                    }}
                    className="w-full py-3 rounded-lg bg-gradient-to-r from-red-500 to-pink-500 text-white font-semibold hover:from-red-600 hover:to-pink-600 transition-all"
                  >
                    I am 18+ and consent to viewing adult content
                  </button>
                  <button
                    onClick={() => {
                      setShowAgeVerification(false);
                      setActiveProvider('featured');
                      loadFeaturedModels();
                    }}
                    className="w-full py-2 rounded-lg border border-forge-border text-text-secondary hover:bg-forge-hover transition-colors"
                  >
                    Cancel - Return to safe content
                  </button>
                </div>

                <p className="text-xs text-text-muted text-center mt-4">
                  By accessing NSFW content, you acknowledge that you are responsible for compliance with local laws and regulations.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================
// MODEL CARD COMPONENT
// ============================================

function ModelCard({ model, viewMode, isSelected, onSelect, onPull, pullProgress, vramGB }) {
  const isPulling = pullProgress?.status === 'starting' || pullProgress?.status === 'downloading';
  const isCompleted = pullProgress?.status === 'completed';
  
  // Determine if model fits in VRAM
  const fitsInVram = model.variants 
    ? model.variants.some(v => v.vram <= vramGB)
    : (model.size || 0) <= vramGB;

  // Source badge
  const sourceBadge = {
    ollama: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Ollama' },
    huggingface: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'HF' },
    civitai: { bg: 'bg-pink-500/20', text: 'text-pink-400', label: 'CivitAI' },
  }[model.source] || { bg: 'bg-gray-500/20', text: 'text-gray-400', label: model.source };

  if (viewMode === 'list') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-3 rounded-lg border transition-all cursor-pointer ${
          isSelected
            ? 'border-accent-primary bg-accent-primary/10'
            : 'border-forge-border bg-forge-surface/50 hover:border-accent-primary/50'
        }`}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${sourceBadge.bg} ${sourceBadge.text}`}>
              {sourceBadge.label}
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-text-primary truncate">{model.name}</h3>
              <p className="text-[10px] text-text-muted truncate">{model.description}</p>
            </div>
            {model.variants && (
              <span className="px-2 py-0.5 rounded bg-forge-bg text-[10px] text-text-secondary">
                {model.variants.length} variants
              </span>
            )}
            {!fitsInVram && (
              <span className="text-[10px] text-yellow-400">⚠️ Large</span>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Grid view
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl border overflow-hidden transition-all cursor-pointer group ${
        isSelected
          ? 'border-accent-primary bg-accent-primary/10 ring-2 ring-accent-primary/30'
          : 'border-forge-border bg-forge-surface/50 hover:border-accent-primary/50 hover:bg-forge-hover'
      }`}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${sourceBadge.bg} ${sourceBadge.text}`}>
              {sourceBadge.label}
            </span>
            {model.nsfw && (
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-bold">
                🔥 NSFW
              </span>
            )}
          </div>
          {model.isVision && (
            <Eye size={14} className="text-purple-400" />
          )}
        </div>
        <h3 className="text-sm font-semibold text-text-primary truncate mb-1">{model.name}</h3>
        <p className="text-[10px] text-text-muted line-clamp-2">{model.description}</p>
      </div>

      {/* Tags */}
      {model.tags && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {model.tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-forge-bg text-[9px] text-text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-forge-border bg-forge-bg/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          {model.variants ? (
            <span>{model.variants.length} sizes</span>
          ) : model.size ? (
            <span>{model.size} GB</span>
          ) : null}
          {model.pulls && (
            <span className="flex items-center gap-1">
              <Download size={10} />
              {(model.pulls / 1000000).toFixed(1)}M
            </span>
          )}
          {model.downloads && (
            <span className="flex items-center gap-1">
              <Download size={10} />
              {(model.downloads / 1000).toFixed(0)}K
            </span>
          )}
        </div>
        
        {!fitsInVram && (
          <span className="text-[10px] text-yellow-400">⚠️</span>
        )}
        
        {isCompleted && (
          <CheckCircle size={14} className="text-green-400" />
        )}
      </div>
    </motion.div>
  );
}

// ============================================
// MODEL DETAIL PANEL
// ============================================

function ModelDetailPanel({ model, onClose, onPull, pullProgress, vramGB }) {
  const [selectedVariant, setSelectedVariant] = useState(null);

  // For Ollama models with variants, select the best one for user's VRAM
  useEffect(() => {
    if (model.variants) {
      const suitable = model.variants.filter(v => v.vram <= vramGB);
      if (suitable.length > 0) {
        setSelectedVariant(suitable[suitable.length - 1]); // Largest that fits
      } else {
        setSelectedVariant(model.variants[0]); // Smallest if none fit
      }
    }
  }, [model, vramGB]);

  const progress = selectedVariant 
    ? pullProgress[`${model.id}:${selectedVariant.tag}`]
    : pullProgress[model.id];
  
  const isPulling = progress?.status === 'starting' || progress?.status === 'downloading';
  const isCompleted = progress?.status === 'completed';

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="w-96 border-l border-forge-border bg-forge-surface flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b border-forge-border">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-text-primary">{model.name}</h2>
            <p className="text-xs text-text-muted">by {model.author}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-forge-hover text-text-muted">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-text-secondary">{model.description}</p>
      </div>

      {/* Variants (for Ollama models) */}
      {model.variants && (
        <div className="p-4 border-b border-forge-border">
          <h3 className="text-xs font-medium text-text-muted uppercase mb-2">Available Sizes</h3>
          <div className="space-y-2">
            {model.variants.map(variant => {
              const fitsVram = variant.vram <= vramGB;
              const isSelected = selectedVariant?.tag === variant.tag;
              
              return (
                <button
                  key={variant.tag}
                  onClick={() => setSelectedVariant(variant)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-accent-primary bg-accent-primary/10'
                      : 'border-forge-border hover:border-accent-primary/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-text-primary">
                        {model.id}:{variant.tag}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-text-muted">{variant.params}</span>
                        <span className="text-[10px] text-text-muted">•</span>
                        <span className="text-[10px] text-text-muted">{variant.size} GB</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] ${fitsVram ? 'text-green-400' : 'text-yellow-400'}`}>
                        {variant.vram} GB VRAM
                      </span>
                      {fitsVram && (
                        <div className="text-[9px] text-green-400">✓ Fits your GPU</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Info for image models */}
      {model.baseModel && (
        <div className="p-4 border-b border-forge-border">
          <h3 className="text-xs font-medium text-text-muted uppercase mb-2">Model Info</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 rounded bg-forge-bg">
              <p className="text-[10px] text-text-muted">Base Model</p>
              <p className="text-sm text-text-primary">{model.baseModel}</p>
            </div>
            <div className="p-2 rounded bg-forge-bg">
              <p className="text-[10px] text-text-muted">Size</p>
              <p className="text-sm text-text-primary">{model.size} GB</p>
            </div>
            {model.rating && (
              <div className="p-2 rounded bg-forge-bg">
                <p className="text-[10px] text-text-muted">Rating</p>
                <p className="text-sm text-text-primary flex items-center gap-1">
                  <Star size={12} className="text-yellow-400" />
                  {model.rating}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tags */}
      {model.tags && (
        <div className="p-4 border-b border-forge-border">
          <h3 className="text-xs font-medium text-text-muted uppercase mb-2">Tags</h3>
          <div className="flex flex-wrap gap-1">
            {model.tags.map(tag => (
              <span key={tag} className="px-2 py-1 rounded-full bg-forge-bg text-xs text-text-secondary">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 mt-auto">
        {model.source === 'ollama' ? (
          <button
            onClick={() => onPull(selectedVariant)}
            disabled={isPulling || isCompleted}
            className={`w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors ${
              isCompleted
                ? 'bg-green-500/20 text-green-400'
                : isPulling
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-accent-primary text-white hover:bg-accent-primary/90'
            }`}
          >
            {isCompleted ? (
              <>
                <CheckCircle size={18} />
                Installed
              </>
            ) : isPulling ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Pulling... {progress?.percent || 0}%
              </>
            ) : (
              <>
                <Download size={18} />
                Pull with Ollama
              </>
            )}
          </button>
        ) : model.source === 'civitai' ? (
          <a
            href={`https://civitai.com/models/${model.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 rounded-lg font-medium bg-pink-500/20 text-pink-400 flex items-center justify-center gap-2 hover:bg-pink-500/30 transition-colors"
          >
            <ExternalLink size={18} />
            View on CivitAI
          </a>
        ) : null}
      </div>
    </motion.aside>
  );
}

export default ModelBrowser;
