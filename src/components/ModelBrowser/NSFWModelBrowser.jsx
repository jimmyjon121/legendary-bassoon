/**
 * Unified NSFW Model Browser
 *
 * The single model hub for the protected vault workspace.
 * Groups models by creator with bios, has source/category filters,
 * and uses a distinct rose/fuchsia palette that never overlaps safe workspaces.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, Download, Search, Loader2,
  MessageSquare, Eye, Image, Headphones, Layers,
  Zap, HardDrive, ChevronDown, ChevronRight, User, ExternalLink, Check,
  Flame, Shield, Filter, RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';

const CATEGORY_META = {
  text:       { label: 'Chat & Roleplay', icon: MessageSquare },
  vision:     { label: 'Vision',          icon: Eye },
  image:      { label: 'Image Gen',       icon: Image },
  audio:      { label: 'Audio',           icon: Headphones },
  multimodal: { label: 'Multimodal',      icon: Layers },
};

const SOURCE_FILTERS = [
  { id: 'all',         label: 'All Sources' },
  { id: 'ollama',      label: 'Ollama' },
  { id: 'huggingface', label: 'HuggingFace GGUF' },
  { id: 'civitai',     label: 'CivitAI' },
];

function CreatorSection({ creatorKey, creatorInfo, models, localModelNames, pulling, onPull }) {
  const [expanded, setExpanded] = useState(true);

  if (!models || models.length === 0) return null;

  return (
    <div className="mb-5">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-rose-950/40 to-fuchsia-950/30 border border-rose-500/15 hover:border-rose-500/30 transition-colors text-left group"
      >
        <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User size={16} className="text-rose-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-rose-100 text-sm">{creatorInfo?.name || creatorKey}</h3>
            <span className="text-[10px] text-rose-400/70 bg-rose-500/10 px-1.5 py-0.5 rounded">
              {models.length} model{models.length !== 1 ? 's' : ''}
            </span>
          </div>
          {creatorInfo?.bio && (
            <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{creatorInfo.bio}</p>
          )}
          {creatorInfo?.specialty && (
            <span className="inline-block mt-1 text-[9px] text-fuchsia-300/80 bg-fuchsia-500/10 px-1.5 py-0.5 rounded">
              {creatorInfo.specialty}
            </span>
          )}
        </div>
        <div className="flex-shrink-0 text-rose-500/50 group-hover:text-rose-400 transition-colors mt-1">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-2 pl-2">
              {models.map(model => (
                <ModelCard
                  key={model.id}
                  model={model}
                  isInstalled={localModelNames.has(model.id.toLowerCase()) || localModelNames.has(model.id.split('/').pop()?.toLowerCase())}
                  pullState={pulling[model.id]}
                  onPull={onPull}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelCard({ model, isInstalled, pullState, onPull }) {
  const [selectedVariant, setSelectedVariant] = useState(model.variants?.find(v => v.recommended) || model.variants?.[0]);
  const isPulling = pullState?.status === 'pulling';
  const isDone = pullState?.status === 'done';
  const isError = pullState?.status === 'error';
  const hasMultipleVariants = model.variants && model.variants.length > 1;

  const sourceColor = model.source === 'ollama'
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : model.source === 'huggingface'
    ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
    : 'text-sky-400 bg-sky-500/10 border-sky-500/20';

  return (
    <div className="p-3 bg-gray-950/60 border border-rose-500/10 rounded-lg hover:border-rose-500/25 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-100 text-sm">{model.name}</h4>
            {isInstalled && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/20 flex items-center gap-0.5">
                <Check size={8} />INSTALLED
              </span>
            )}
            {model.tags?.includes('abliterated') && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 font-semibold border border-rose-500/25 flex items-center gap-0.5">
                <Zap size={8} />ABLITERATED
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{model.description}</p>

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${sourceColor}`}>
              {model.source === 'ollama' ? 'Ollama' : model.source === 'huggingface' ? 'HuggingFace' : 'CivitAI'}
            </span>
            {(model.pulls || model.downloads) && (
              <span className="text-[9px] text-gray-600">
                {model.pulls ? `${(model.pulls / 1000).toFixed(0)}K pulls` : `${(model.downloads / 1000).toFixed(0)}K downloads`}
              </span>
            )}
            {model.family && (
              <span className="text-[9px] text-gray-600 bg-gray-900 px-1.5 py-0.5 rounded">{model.family}</span>
            )}
          </div>

          {/* Always show all variants/quantizations */}
          {model.variants && model.variants.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {model.variants.map(v => {
                const isSelected = selectedVariant?.tag === v.tag;
                return (
                  <button
                    key={v.tag}
                    onClick={() => setSelectedVariant(v)}
                    className={`text-[9px] px-2 py-1 rounded border transition-colors ${
                      isSelected
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-rose-500/20 hover:text-gray-300'
                    }`}
                  >
                    {v.params || v.tag} &middot; {v.size}GB {v.vram ? `(${v.vram}GB VRAM)` : ''} {v.recommended ? '★' : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-shrink-0">
          {isPulling ? (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/15 text-rose-400 rounded-lg text-[11px] border border-rose-500/20">
              <Loader2 size={12} className="animate-spin" />
              Pulling...
            </div>
          ) : isDone ? (
            <div className="px-3 py-2 bg-emerald-500/15 text-emerald-400 rounded-lg text-[11px] font-medium border border-emerald-500/20">
              Done
            </div>
          ) : isError ? (
            <button
              onClick={() => onPull(model)}
              className="px-3 py-2 bg-red-500/15 text-red-400 rounded-lg text-[11px] hover:bg-red-500/25 transition-colors border border-red-500/20"
              title={pullState?.error}
            >
              Retry
            </button>
          ) : isInstalled ? (
            <div className="px-3 py-2 bg-gray-900 text-gray-500 rounded-lg text-[11px] border border-gray-800">
              Installed
            </div>
          ) : model.source === 'civitai' ? (
            <a
              href={model.civitaiUrl || `https://civitai.com/models?query=${encodeURIComponent(model.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-2 bg-rose-500/20 text-rose-300 rounded-lg hover:bg-rose-500/30 transition-colors text-[11px] border border-rose-500/25"
            >
              <ExternalLink size={11} />
              CivitAI
            </a>
          ) : (
            <button
              onClick={() => onPull(model, selectedVariant)}
              className="flex items-center gap-1 px-3 py-2 bg-rose-500/20 text-rose-300 rounded-lg hover:bg-rose-500/30 transition-colors text-[11px] border border-rose-500/25"
            >
              <Download size={11} />
              {selectedVariant ? `Pull ${selectedVariant.tag}` : 'Pull'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NSFWModelBrowser({ onClose, embedded = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('text');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState({});
  const localModels = useAppStore((s) => s.models) || [];
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const isLocked = useAppStore((s) => s.isLocked);
  const nsfwPassword = useAppStore((s) => s.nsfwPassword);
  const canAccessPrivateCatalog = currentWorkspace === 'nsfw' && !isLocked && Boolean(nsfwPassword);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canAccessPrivateCatalog) {
        if (!cancelled) {
          setCatalog(null);
          setLoading(false);
        }
        return;
      }

      try {
        const data = await window.electronAPI?.providersGetPrivateVaultModels?.(nsfwPassword);
        if (!cancelled && data) setCatalog(data);
      } catch (e) {
        console.error('[NSFWModelBrowser] Failed to load catalog:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canAccessPrivateCatalog, nsfwPassword]);

  const localModelNames = useMemo(() => {
    return new Set((localModels || []).map(m => (m.name || m.id || '').split(':')[0].toLowerCase()));
  }, [localModels]);

  const creators = catalog?.creators || {};

  const filteredModels = useMemo(() => {
    const list = catalog?.[activeCategory] || [];
    let filtered = list;

    if (sourceFilter !== 'all') {
      filtered = filtered.filter(m => m.source === sourceFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        m.name?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.author?.toLowerCase().includes(q) ||
        m.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [catalog, activeCategory, sourceFilter, searchQuery]);

  const groupedByCreator = useMemo(() => {
    const groups = {};
    for (const model of filteredModels) {
      const key = model.creator || model.author || 'Community';
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
    }
    const creatorOrder = [
      'huihui_ai', 'Eric Hartford', 'Nous Research', 'Teknium',
      'Gryphe', 'Jon Durbin', 'TheBloke', 'PygmalionAI', 'KoboldAI', 'Community',
    ];
    const sorted = [];
    for (const key of creatorOrder) {
      if (groups[key]) {
        sorted.push({ key, models: groups[key] });
        delete groups[key];
      }
    }
    for (const [key, models] of Object.entries(groups)) {
      sorted.push({ key, models });
    }
    return sorted;
  }, [filteredModels]);

  const categoryCounts = useMemo(() => {
    if (!catalog) return {};
    const counts = {};
    for (const key of Object.keys(CATEGORY_META)) {
      counts[key] = catalog[key]?.length || 0;
    }
    return counts;
  }, [catalog]);

  const sourceCounts = useMemo(() => {
    const list = catalog?.[activeCategory] || [];
    const counts = { all: list.length };
    for (const m of list) {
      counts[m.source] = (counts[m.source] || 0) + 1;
    }
    return counts;
  }, [catalog, activeCategory]);

  const handlePull = useCallback(async (model, variant) => {
    const id = model.id;
    const tag = variant?.tag || model.variants?.find(v => v.recommended)?.tag || model.variants?.[0]?.tag || 'latest';
    const pullName = `${id}:${tag}`;
    setPulling(prev => ({ ...prev, [id]: { status: 'pulling', progress: 0, name: pullName } }));

    try {
      if (!canAccessPrivateCatalog || !nsfwPassword) {
        setPulling(prev => ({
          ...prev,
          [id]: { status: 'error', error: 'Vault is locked', name: pullName },
        }));
        return;
      }

      if (model.source === 'ollama') {
        const result = await window.electronAPI?.providersPullOllamaModel?.(pullName);
        setPulling(prev => ({
          ...prev,
          [id]: result?.success
            ? { status: 'done', progress: 100, name: pullName }
            : { status: 'error', error: result?.error || 'Pull failed', name: pullName },
        }));
      } else if (model.source === 'huggingface' || model.source === 'civitai') {
        const downloadUrl = variant?.downloadUrl || model.variants?.[0]?.downloadUrl;
        const result = await window.electronAPI?.providersDownloadNsfwModel?.({
          ...model,
          modelId: model.id,
          filename: model.name,
          downloadUrl,
        }, nsfwPassword);
        setPulling(prev => ({
          ...prev,
          [id]: result?.success
            ? { status: 'done', progress: 100, name: pullName }
            : { status: 'error', error: result?.error || 'Download failed', name: pullName },
        }));
      }
    } catch (err) {
      setPulling(prev => ({ ...prev, [id]: { status: 'error', error: err.message, name: pullName } }));
    }
  }, [canAccessPrivateCatalog, nsfwPassword]);

  const containerClass = embedded
    ? 'flex-1 flex flex-col bg-gradient-to-br from-gray-950 via-rose-950/10 to-gray-950 overflow-hidden'
    : 'fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm';

  const panelClass = embedded
    ? 'flex-1 flex flex-col overflow-hidden'
    : 'bg-gray-950 border border-rose-500/20 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl shadow-rose-500/10';

  return (
    <div className={containerClass}>
      <div className={panelClass}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-rose-500/15 bg-gradient-to-r from-rose-950/50 to-fuchsia-950/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
              <Flame size={18} className="text-rose-400" />
            </div>
            <div>
              <h2 className="font-bold text-rose-100 text-base">Vault Catalog</h2>
              <p className="text-[10px] text-gray-400">Protected model downloads available only while the vault is unlocked.</p>
            </div>
          </div>
          {!embedded && (
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-rose-500/10 text-gray-500 hover:text-rose-400 transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="px-4 pt-3 pb-2 border-b border-rose-500/10 space-y-2.5 bg-gray-950/80">
          <div className="flex gap-1.5 overflow-x-auto">
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const count = categoryCounts[key] || 0;
              if (count === 0) return null;
              const Icon = meta.icon;
              const active = key === activeCategory;
              return (
                <button
                  key={key}
                  onClick={() => { setActiveCategory(key); setSourceFilter('all'); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    active
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-sm shadow-rose-500/10'
                      : 'bg-gray-900/50 text-gray-500 hover:text-gray-300 border border-transparent hover:border-gray-800'
                  }`}
                >
                  <Icon size={13} />
                  {meta.label}
                  <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Source filter + Search */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {SOURCE_FILTERS.map(sf => {
                const count = sourceCounts[sf.id] || 0;
                if (sf.id !== 'all' && count === 0) return null;
                return (
                  <button
                    key={sf.id}
                    onClick={() => setSourceFilter(sf.id)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      sourceFilter === sf.id
                        ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30'
                        : 'text-gray-500 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    {sf.label} {sf.id !== 'all' ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models, creators, tags..."
                className="w-full pl-8 pr-3 py-1.5 bg-gray-900/60 border border-gray-800 rounded-lg text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-rose-500/40"
              />
            </div>
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-rose-400" />
              <span className="ml-3 text-gray-400 text-sm">Loading catalog...</span>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Search size={36} className="text-gray-700 mb-3" />
              <p className="text-gray-400 text-sm">No models match your filters</p>
              <p className="text-gray-600 text-xs mt-1">Try a different source, category, or search term</p>
            </div>
          ) : activeCategory === 'text' ? (
            groupedByCreator.map(({ key, models }) => (
              <CreatorSection
                key={key}
                creatorKey={key}
                creatorInfo={creators[key]}
                models={models}
                localModelNames={localModelNames}
                pulling={pulling}
                onPull={handlePull}
              />
            ))
          ) : (
            <div className="space-y-2">
              {filteredModels.map(model => (
                <ModelCard
                  key={model.id}
                  model={model}
                  isInstalled={localModelNames.has(model.id.toLowerCase())}
                  pullState={pulling[model.id]}
                  onPull={handlePull}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-rose-500/10 bg-gray-950/80">
          <p className="text-[10px] text-gray-600 text-center flex items-center justify-center gap-1.5">
            <Shield size={10} />
            All models run locally. Nothing leaves your machine. Your workspace is encrypted.
          </p>
        </div>
      </div>
    </div>
  );
}

export default NSFWModelBrowser;
