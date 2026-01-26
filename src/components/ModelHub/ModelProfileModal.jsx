/**
 * ModelProfileModal - Detailed model information view
 * 
 * Shows comprehensive info about a model:
 * - Overview & description
 * - Strengths & weaknesses
 * - Benchmarks & performance
 * - Use cases & examples
 * - Technical specs
 * - Community ratings
 */

import { useState, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  Star,
  Zap,
  Brain,
  Code,
  MessageCircle,
  Image,
  Eye,
  Globe,
  Clock,
  HardDrive,
  Cpu,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Target,
  Shield,
  Gauge,
  BookOpen,
  Users,
  Calendar,
  Tag,
  Loader2,
} from 'lucide-react';

// Capability icons
const CAPABILITY_ICONS = {
  chat: MessageCircle,
  code: Code,
  vision: Eye,
  image: Image,
  reasoning: Brain,
  math: Target,
  multilingual: Globe,
  creative: Sparkles,
};

// Format numbers with K/M suffix
const formatNumber = (num) => {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
};

// Format bytes
const formatBytes = (bytes) => {
  if (!bytes) return 'Unknown';
  if (typeof bytes === 'number' && bytes < 100) {
    // Assume it's already in GB
    return `${bytes.toFixed(1)} GB`;
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Strength/weakness badge
const TraitBadge = memo(({ trait, type }) => {
  const isStrength = type === 'strength';
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
      isStrength 
        ? 'bg-emerald-500/10 border border-emerald-500/20' 
        : 'bg-amber-500/10 border border-amber-500/20'
    }`}>
      {isStrength ? (
        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
      ) : (
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
      )}
      <span className={`text-sm ${isStrength ? 'text-emerald-300' : 'text-amber-300'}`}>
        {trait}
      </span>
    </div>
  );
});

// Benchmark bar
const BenchmarkBar = memo(({ name, score, maxScore = 100, description }) => {
  const percentage = Math.min((score / maxScore) * 100, 100);
  const getColor = () => {
    if (percentage >= 80) return 'bg-emerald-500';
    if (percentage >= 60) return 'bg-blue-500';
    if (percentage >= 40) return 'bg-amber-500';
    return 'bg-red-500';
  };
  
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-300">{name}</span>
        <span className="text-sm font-medium text-white">{score.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${getColor()} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, delay: 0.1 }}
        />
      </div>
      {description && (
        <p className="text-xs text-neutral-500">{description}</p>
      )}
    </div>
  );
});

// Use case card
const UseCaseCard = memo(({ useCase }) => {
  const Icon = CAPABILITY_ICONS[useCase.icon] || MessageCircle;
  
  return (
    <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl hover:border-neutral-600 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${useCase.color || 'bg-blue-500/20'}`}>
          <Icon className={`w-5 h-5 ${useCase.iconColor || 'text-blue-400'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-white mb-1">{useCase.title}</h4>
          <p className="text-sm text-neutral-400 leading-relaxed">{useCase.description}</p>
          {useCase.example && (
            <div className="mt-2 p-2 bg-neutral-900 rounded-lg">
              <p className="text-xs text-neutral-500 font-mono">{useCase.example}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Variant selector
const VariantSelector = memo(({ variants, selected, onSelect, hardware }) => {
  if (!variants || variants.length === 0) return null;
  
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-neutral-300">Available Sizes</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {variants.map((variant) => {
          const isSelected = selected?.tag === variant.tag;
          const canRun = !hardware?.vram || (variant.vram || variant.size * 1.2) <= (hardware.vram / 1024);
          
          return (
            <button
              key={variant.tag}
              onClick={() => onSelect(variant)}
              className={`p-3 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'bg-emerald-500/20 border-emerald-500/50'
                  : canRun
                  ? 'bg-neutral-800/50 border-neutral-700 hover:border-neutral-600'
                  : 'bg-neutral-900/50 border-neutral-800 opacity-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`font-medium ${isSelected ? 'text-emerald-400' : 'text-white'}`}>
                  {variant.params || variant.tag}
                </span>
                {canRun && (
                  <CheckCircle className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-neutral-600'}`} />
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span>{variant.size ? `${variant.size} GB` : 'Size unknown'}</span>
                {variant.vram && <span>• {variant.vram} GB VRAM</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

// Main component
export const ModelProfileModal = memo(({ 
  model, 
  isOpen, 
  onClose, 
  onDownload,
  hardware,
  downloading = false 
}) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [copied, setCopied] = useState(false);
  const [detailedInfo, setDetailedInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Load detailed info when modal opens
  useEffect(() => {
    if (isOpen && model) {
      loadDetailedInfo();
      // Select best variant for hardware
      if (model.variants?.length > 0) {
        const best = getBestVariant(model.variants, hardware);
        setSelectedVariant(best);
      }
    }
  }, [isOpen, model?.id]);
  
  const loadDetailedInfo = async () => {
    if (!model) return;
    setLoading(true);
    try {
      const details = await window.electronAPI?.catalogGetModelDetails?.('ollama', model.id);
      if (details) {
        setDetailedInfo(details);
      }
    } catch (err) {
      console.error('Failed to load model details:', err);
    } finally {
      setLoading(false);
    }
  };
  
  // Get best variant for user's hardware
  const getBestVariant = (variants, hw) => {
    if (!variants || variants.length === 0) return null;
    if (!hw?.vram) return variants[0];
    
    const vramGB = hw.vram / 1024;
    const sorted = [...variants].sort((a, b) => (b.size || 0) - (a.size || 0));
    return sorted.find(v => (v.vram || v.size * 1.2) <= vramGB * 0.8) || sorted[sorted.length - 1];
  };
  
  const handleCopyCommand = () => {
    const command = `ollama pull ${model.id}${selectedVariant?.tag ? `:${selectedVariant.tag}` : ''}`;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleDownload = () => {
    if (onDownload) {
      onDownload(model, selectedVariant);
    }
  };
  
  if (!isOpen || !model) return null;
  
  // Merge model data with detailed info
  const displayModel = { ...model, ...detailedInfo };
  const CapabilityIcon = CAPABILITY_ICONS[displayModel.capability] || MessageCircle;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="w-full max-w-4xl max-h-[90vh] bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="relative p-6 border-b border-neutral-800 bg-gradient-to-b from-neutral-800/50 to-transparent">
          {/* Background accent */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 pointer-events-none" />
          
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {/* Model icon */}
              <div className="p-3 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-xl border border-emerald-500/20">
                <CapabilityIcon className="w-8 h-8 text-emerald-400" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-bold text-white truncate">
                    {displayModel.name}
                  </h2>
                  {displayModel.official && (
                    <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-medium rounded-full">
                      Official
                    </span>
                  )}
                </div>
                
                <p className="text-neutral-400 text-sm mb-3">
                  by <span className="text-neutral-300">{displayModel.author || 'Community'}</span>
                  {displayModel.family && (
                    <> • <span className="text-neutral-500">{displayModel.family} family</span></>
                  )}
                </p>
                
                {/* Quick stats */}
                <div className="flex flex-wrap items-center gap-3">
                  {displayModel.pulls && (
                    <div className="flex items-center gap-1.5 text-sm text-neutral-400">
                      <TrendingUp className="w-4 h-4" />
                      <span>{formatNumber(displayModel.pulls)} pulls</span>
                    </div>
                  )}
                  {displayModel.rating && (
                    <div className="flex items-center gap-1.5 text-sm text-amber-400">
                      <Star className="w-4 h-4 fill-current" />
                      <span>{displayModel.rating}</span>
                    </div>
                  )}
                  {displayModel.updated && (
                    <div className="flex items-center gap-1.5 text-sm text-neutral-500">
                      <Calendar className="w-4 h-4" />
                      <span>Updated {displayModel.updated}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="px-6 pt-4 border-b border-neutral-800">
          <div className="flex gap-1">
            {[
              { id: 'overview', label: 'Overview', icon: BookOpen },
              { id: 'benchmarks', label: 'Benchmarks', icon: Gauge },
              { id: 'usecases', label: 'Use Cases', icon: Target },
              { id: 'technical', label: 'Technical', icon: Cpu },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-neutral-800 text-white border-b-2 border-emerald-500'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  {/* Description */}
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">About</h3>
                    <p className="text-neutral-300 leading-relaxed">
                      {displayModel.longDescription || displayModel.description || 'No description available.'}
                    </p>
                  </div>
                  
                  {/* Strengths & Considerations */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Strengths */}
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                        Strengths
                      </h3>
                      <div className="space-y-2">
                        {(displayModel.strengths || [
                          'Fast inference speed',
                          'Good general knowledge',
                          'Follows instructions well',
                        ]).map((strength, i) => (
                          <TraitBadge key={i} trait={strength} type="strength" />
                        ))}
                      </div>
                    </div>
                    
                    {/* Considerations */}
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                        Considerations
                      </h3>
                      <div className="space-y-2">
                        {(displayModel.considerations || displayModel.weaknesses || [
                          'May need more context for complex tasks',
                          'Knowledge cutoff applies',
                        ]).map((consideration, i) => (
                          <TraitBadge key={i} trait={consideration} type="consideration" />
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Tags */}
                  {displayModel.tags && displayModel.tags.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-neutral-400 mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-2">
                        {displayModel.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-3 py-1 bg-neutral-800 text-neutral-300 text-sm rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
              
              {/* Benchmarks Tab */}
              {activeTab === 'benchmarks' && (
                <motion.div
                  key="benchmarks"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Performance Benchmarks</h3>
                    <div className="space-y-4">
                      {(displayModel.benchmarks || [
                        { name: 'MMLU (Knowledge)', score: 72.5, description: 'Measures broad knowledge across 57 subjects' },
                        { name: 'HumanEval (Coding)', score: 65.2, description: 'Python code generation accuracy' },
                        { name: 'HellaSwag (Reasoning)', score: 81.3, description: 'Common sense reasoning ability' },
                        { name: 'TruthfulQA', score: 58.7, description: 'Factual accuracy and avoiding hallucinations' },
                      ]).map((benchmark, i) => (
                        <BenchmarkBar
                          key={i}
                          name={benchmark.name}
                          score={benchmark.score}
                          maxScore={benchmark.maxScore || 100}
                          description={benchmark.description}
                        />
                      ))}
                    </div>
                  </div>
                  
                  <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl">
                    <p className="text-sm text-neutral-400">
                      <span className="text-neutral-300 font-medium">Note:</span> Benchmarks are approximate and may vary based on quantization and hardware. Real-world performance depends on your specific use case.
                    </p>
                  </div>
                </motion.div>
              )}
              
              {/* Use Cases Tab */}
              {activeTab === 'usecases' && (
                <motion.div
                  key="usecases"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <h3 className="text-lg font-semibold text-white mb-4">Best Use Cases</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(displayModel.useCases || [
                      {
                        icon: 'chat',
                        title: 'Conversational AI',
                        description: 'Natural dialogue, question answering, and general assistance.',
                        color: 'bg-blue-500/20',
                        iconColor: 'text-blue-400',
                      },
                      {
                        icon: 'code',
                        title: 'Code Assistance',
                        description: 'Code completion, explanation, debugging, and generation.',
                        color: 'bg-emerald-500/20',
                        iconColor: 'text-emerald-400',
                      },
                      {
                        icon: 'creative',
                        title: 'Creative Writing',
                        description: 'Stories, articles, marketing copy, and creative content.',
                        color: 'bg-purple-500/20',
                        iconColor: 'text-purple-400',
                      },
                      {
                        icon: 'reasoning',
                        title: 'Analysis & Reasoning',
                        description: 'Problem solving, data analysis, and logical reasoning.',
                        color: 'bg-amber-500/20',
                        iconColor: 'text-amber-400',
                      },
                    ]).map((useCase, i) => (
                      <UseCaseCard key={i} useCase={useCase} />
                    ))}
                  </div>
                </motion.div>
              )}
              
              {/* Technical Tab */}
              {activeTab === 'technical' && (
                <motion.div
                  key="technical"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  {/* Variant selector */}
                  <VariantSelector
                    variants={displayModel.variants}
                    selected={selectedVariant}
                    onSelect={setSelectedVariant}
                    hardware={hardware}
                  />
                  
                  {/* Technical specs */}
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Technical Specifications</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl">
                        <div className="text-sm text-neutral-500 mb-1">Architecture</div>
                        <div className="font-medium text-white">{displayModel.architecture || displayModel.family || 'Transformer'}</div>
                      </div>
                      <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl">
                        <div className="text-sm text-neutral-500 mb-1">Context Length</div>
                        <div className="font-medium text-white">{displayModel.contextLength || '4096'} tokens</div>
                      </div>
                      <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl">
                        <div className="text-sm text-neutral-500 mb-1">Training Data Cutoff</div>
                        <div className="font-medium text-white">{displayModel.dataCutoff || 'Unknown'}</div>
                      </div>
                      <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl">
                        <div className="text-sm text-neutral-500 mb-1">License</div>
                        <div className="font-medium text-white">{displayModel.license || 'See model page'}</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Command to install */}
                  <div>
                    <h3 className="text-sm font-medium text-neutral-400 mb-2">Install Command</h3>
                    <div className="flex items-center gap-2 p-3 bg-neutral-950 border border-neutral-800 rounded-lg font-mono text-sm">
                      <span className="text-neutral-500">$</span>
                      <span className="text-emerald-400 flex-1">
                        ollama pull {displayModel.id}{selectedVariant?.tag ? `:${selectedVariant.tag}` : ''}
                      </span>
                      <button
                        onClick={handleCopyCommand}
                        className="p-1.5 hover:bg-neutral-800 rounded transition-colors"
                        title="Copy command"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-neutral-500" />
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-neutral-500">
              {selectedVariant && (
                <>
                  <span>Selected: <span className="text-neutral-300">{selectedVariant.params || selectedVariant.tag}</span></span>
                  <span>•</span>
                  <span>Size: <span className="text-neutral-300">{selectedVariant.size ? `${selectedVariant.size} GB` : 'Unknown'}</span></span>
                  {selectedVariant.vram && (
                    <>
                      <span>•</span>
                      <span>VRAM: <span className="text-neutral-300">{selectedVariant.vram} GB</span></span>
                    </>
                  )}
                </>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              {displayModel.url && (
                <a
                  href={displayModel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Ollama
                </a>
              )}
              
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Install Model
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default ModelProfileModal;
