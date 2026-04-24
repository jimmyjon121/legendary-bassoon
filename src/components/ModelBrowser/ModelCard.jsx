/**
 * ModelCard Component
 * 
 * Displays a model in either grid or list view with key information.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  Download, Star, GitCompare, Check, ExternalLink,
  Code, MessageCircle, Lightbulb, Zap, Package, Brain, Eye,
} from 'lucide-react';

const FAMILY_COLORS = {
  'Llama 3': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Llama 2': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Llama': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Mistral': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Mixtral': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Qwen': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Gemma': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Phi': 'bg-green-500/20 text-green-400 border-green-500/30',
  'CodeLlama': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'DeepSeek': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  'Vicuna': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  'WizardLM': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'Other': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const CAPABILITY_ICONS = {
  code: Code,
  chat: MessageCircle,
  creative: Lightbulb,
  instruction: Brain,
  vision: Eye,
  uncensored: Package,
  general: Zap,
  reasoning: Brain,
};

function normalizeCapability(model = {}) {
  const capability = String(model?.capability || '').toLowerCase();
  const tags = Array.isArray(model?.tags) ? model.tags.map((tag) => String(tag).toLowerCase()) : [];
  if (capability === 'coding') return 'code';
  if (capability === 'multimodal') return 'vision';
  if (capability === 'roleplay' || capability === 'erotica' || capability === 'storytelling') return 'creative';
  if ((!capability || capability === 'general') && (tags.includes('vision') || tags.includes('multimodal'))) return 'vision';
  if ((!capability || capability === 'general') && (tags.includes('code') || tags.includes('coding') || tags.includes('programming'))) return 'code';
  return capability || 'general';
}

function getFeatureLabels(model = {}) {
  const tags = Array.isArray(model?.tags) ? model.tags.map((tag) => String(tag).toLowerCase()) : [];
  const labels = [];
  if (tags.includes('vision') || tags.includes('multimodal')) labels.push('Vision');
  if (tags.includes('tools') || tags.includes('function-calling')) labels.push('Tools');
  if (tags.includes('thinking') || tags.includes('reasoning')) labels.push('Thinking');
  const seen = new Set();
  return labels.filter((label) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 2);
}

function formatNumber(num) {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function ModelCard({
  model,
  viewMode,
  isSelected,
  isInCompare,
  onSelect,
  onAddToCompare,
  onRemoveFromCompare,
}) {
  const enriched = model.enriched || model;
  const modelId = model.id || model.modelId;
  const displayName = enriched.displayName || modelId.split('/').pop();
  const author = enriched.author || modelId.split('/')[0];
  const family = enriched.family || 'Other';
  const params = enriched.params;
  const capability = normalizeCapability(enriched);
  const featureLabels = getFeatureLabels(enriched);
  const downloads = enriched.downloadCount || model.downloads || 0;
  const likes = enriched.likes || model.likes || 0;

  const familyColor = FAMILY_COLORS[family] || FAMILY_COLORS['Other'];
  const CapabilityIcon = CAPABILITY_ICONS[capability] || Zap;

  // Get file size summary
  const ggufFiles = model.ggufFiles || [];
  const sizeRange = ggufFiles.length > 0
    ? `${Math.min(...ggufFiles.map(f => f.sizeGB)).toFixed(1)} - ${Math.max(...ggufFiles.map(f => f.sizeGB)).toFixed(1)} GB`
    : null;

  if (viewMode === 'list') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-3 rounded-lg border transition-all cursor-pointer ${
          isSelected
            ? 'border-accent-primary bg-accent-primary/10'
            : 'border-forge-border bg-forge-surface/50 hover:border-accent-primary/50 hover:bg-forge-hover'
        }`}
        onClick={onSelect}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Family Badge */}
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${familyColor}`}>
              {family}
            </span>

            {/* Name */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-text-primary truncate">{displayName}</h3>
              <p className="text-[10px] text-text-muted truncate">by {author}</p>
            </div>

            {/* Params */}
            {params && (
              <span className="px-2 py-0.5 rounded bg-forge-bg text-[10px] text-text-secondary">
                {params}
              </span>
            )}

            {/* Size */}
            {sizeRange && (
              <span className="text-[10px] text-text-muted">{sizeRange}</span>
            )}

            {/* Stats */}
            <div className="flex items-center gap-3 text-[10px] text-text-muted">
              <span className="flex items-center gap-1">
                <Download size={10} />
                {formatNumber(downloads)}
              </span>
              <span className="flex items-center gap-1">
                <Star size={10} />
                {formatNumber(likes)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 ml-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                isInCompare ? onRemoveFromCompare() : onAddToCompare();
              }}
              className={`p-1.5 rounded transition-colors ${
                isInCompare
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'hover:bg-forge-hover text-text-muted hover:text-text-primary'
              }`}
              title={isInCompare ? 'Remove from compare' : 'Add to compare'}
            >
              {isInCompare ? <Check size={14} /> : <GitCompare size={14} />}
            </button>
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
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${familyColor}`}>
            {family}
          </span>
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              isInCompare ? onRemoveFromCompare() : onAddToCompare();
            }}
            className={`p-1 rounded transition-all ${
              isInCompare
                ? 'bg-purple-500/20 text-purple-400'
                : 'opacity-0 group-hover:opacity-100 hover:bg-forge-hover text-text-muted hover:text-text-primary'
            }`}
            title={isInCompare ? 'Remove from compare' : 'Add to compare'}
          >
            {isInCompare ? <Check size={14} /> : <GitCompare size={14} />}
          </button>
        </div>

        <h3 className="text-sm font-medium text-text-primary truncate mb-0.5" title={displayName}>
          {displayName}
        </h3>
        <p className="text-[10px] text-text-muted truncate">by {author}</p>
      </div>

      {/* Info */}
      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        {params && (
          <span className="px-2 py-0.5 rounded bg-forge-bg text-[10px] text-text-secondary font-medium">
            {params}
          </span>
        )}
        
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          <CapabilityIcon size={10} />
          <span className="capitalize">{capability}</span>
        </span>
        {featureLabels.map((label) => (
          <span key={label} className="px-2 py-0.5 rounded bg-forge-bg text-[10px] text-text-muted">
            {label}
          </span>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-forge-border bg-forge-bg/50 flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <Download size={10} />
            {formatNumber(downloads)}
          </span>
          <span className="flex items-center gap-1">
            <Star size={10} />
            {formatNumber(likes)}
          </span>
        </div>

        {sizeRange && (
          <span className="text-[10px] text-text-muted">{sizeRange}</span>
        )}
      </div>
    </motion.div>
  );
}

export default ModelCard;












