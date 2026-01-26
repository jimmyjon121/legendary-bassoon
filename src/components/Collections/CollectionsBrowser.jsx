/**
 * CollectionsBrowser - Browse and manage model collections
 * 
 * Features:
 * - Starter packs display
 * - User collections
 * - Collection details and models
 * - Install/download all models
 * - Import/export collections
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Package,
  Download,
  Plus,
  Trash2,
  Share2,
  Import,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Clock,
  Sparkles,
  Code,
  Palette,
  Brain,
  Zap,
  FileText,
  Eye,
  Settings,
  Copy,
  ExternalLink,
  Star,
  Filter,
} from 'lucide-react';
import {
  useStarterPacks,
  useUserCollections,
  useSelectedCollection,
  useCollectionsLoading,
  useCollectionInstallProgress,
  useCollectionsActions,
  useDownloadActions,
} from '../../stores/appStore';

// Category icons
const categoryIcons = {
  'starter-pack': Sparkles,
  'text-generation': FileText,
  'code-assistant': Code,
  'image-generation': Palette,
  'audio': Brain,
  'video': Eye,
  'multimodal': Eye,
  'embeddings': Brain,
  'roleplay': Star,
  'productivity': Zap,
  'custom': Package,
};

// Difficulty badges
const DifficultyBadge = memo(({ difficulty }) => {
  const config = {
    beginner: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Beginner' },
    intermediate: { color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Intermediate' },
    advanced: { color: 'text-red-400', bg: 'bg-red-500/10', label: 'Advanced' },
  };
  
  const { color, bg, label } = config[difficulty] || config.beginner;
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${color}`}>
      {label}
    </span>
  );
});

// Install status badge
const InstallStatusBadge = memo(({ status, modelsInstalled, modelsTotal }) => {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400">
        <CheckCircle className="w-3 h-3" />
        Installed
      </span>
    );
  }
  
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400">
        <Clock className="w-3 h-3" />
        {modelsInstalled}/{modelsTotal} installed
      </span>
    );
  }
  
  return null;
});

// Collection card
const CollectionCard = memo(({ collection, installStatus, onClick, onInstall }) => {
  const CategoryIcon = categoryIcons[collection.category] || Package;
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className="bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-xl p-4 cursor-pointer transition-all hover:border-[var(--accent-primary)]/30 group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="text-2xl">{collection.icon}</div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
              {collection.name}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <CategoryIcon className="w-3 h-3 text-[var(--text-muted)]" />
              <span className="text-xs text-[var(--text-muted)] capitalize">
                {collection.category?.replace('-', ' ')}
              </span>
            </div>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors" />
      </div>
      
      {/* Description */}
      <p className="text-sm text-[var(--text-muted)] mb-3 line-clamp-2">
        {collection.description}
      </p>
      
      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {collection.difficulty && <DifficultyBadge difficulty={collection.difficulty} />}
        {collection.estimatedSize && (
          <span className="text-xs text-[var(--text-muted)]">
            ~{collection.estimatedSize}
          </span>
        )}
        {collection.models && (
          <span className="text-xs text-[var(--text-muted)]">
            {collection.models.length} models
          </span>
        )}
        {installStatus && (
          <InstallStatusBadge 
            status={installStatus.status} 
            modelsInstalled={installStatus.modelsInstalled}
            modelsTotal={installStatus.modelsTotal}
          />
        )}
      </div>
      
      {/* Tags */}
      {collection.tags && collection.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {collection.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
});

// Collection detail view
const CollectionDetail = memo(({ collection, installStatus, onClose, onInstallAll }) => {
  const [installing, setInstalling] = useState(false);
  
  const handleInstallAll = async () => {
    setInstalling(true);
    await onInstallAll(collection);
    setInstalling(false);
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-dim)]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{collection.icon}</div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">
                {collection.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {collection.difficulty && <DifficultyBadge difficulty={collection.difficulty} />}
                {collection.estimatedSize && (
                  <span className="text-xs text-[var(--text-muted)]">
                    ~{collection.estimatedSize}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
        </div>
        
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {collection.description}
        </p>
        
        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleInstallAll}
            disabled={installing || installStatus?.status === 'complete'}
            className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {installing ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                Installing...
              </>
            ) : installStatus?.status === 'complete' ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Installed
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Install All Models
              </>
            )}
          </button>
          
          {collection.type !== 'curated' && (
            <button className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors">
              <Share2 className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          )}
        </div>
      </div>
      
      {/* Models list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
          Models in this collection ({collection.models?.length || 0})
        </h3>
        
        <div className="space-y-2">
          {collection.models?.map((model, index) => (
            <div
              key={`${model.provider}-${model.modelId}`}
              className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] border border-[var(--border-dim)] rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-xs font-medium text-[var(--text-muted)]">
                  {index + 1}
                </div>
                <div>
                  <div className="font-medium text-sm text-[var(--text-primary)]">
                    {model.modelId}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {model.provider} • {model.role}
                  </div>
                </div>
              </div>
              
              <button className="px-3 py-1.5 text-xs bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)]/10 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] rounded-lg transition-colors">
                Download
              </button>
            </div>
          ))}
        </div>
      </div>
      
      {/* Tags */}
      {collection.tags && collection.tags.length > 0 && (
        <div className="p-4 border-t border-[var(--border-dim)]">
          <div className="flex flex-wrap gap-1">
            {collection.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
});

// Create collection form
const CreateCollectionForm = memo(({ onSubmit, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📦');
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name, description, icon });
  };
  
  const icons = ['📦', '🚀', '💻', '✍️', '🎨', '📋', '🔥', '⚡', '🎯', '🧠'];
  
  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">
        Create New Collection
      </h3>
      
      {/* Icon selector */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          Icon
        </label>
        <div className="flex flex-wrap gap-2">
          {icons.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIcon(i)}
              className={`w-10 h-10 text-xl rounded-lg border transition-colors ${
                icon === i
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                  : 'border-[var(--border-dim)] bg-[var(--bg-tertiary)] hover:border-[var(--border)]'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Collection"
          className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-dim)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          required
        />
      </div>
      
      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your collection..."
          rows={3}
          className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-dim)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none"
        />
      </div>
      
      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          Create Collection
        </button>
      </div>
    </form>
  );
});

// Main component
export const CollectionsBrowser = memo(({ isOpen, onClose }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState('starter');
  const [categoryFilter, setCategoryFilter] = useState(null);
  
  const starterPacks = useStarterPacks();
  const userCollections = useUserCollections();
  const selectedCollection = useSelectedCollection();
  const loading = useCollectionsLoading();
  const installProgress = useCollectionInstallProgress();
  
  const {
    fetchAllCollections,
    getCollection,
    createCollection,
    selectCollection,
    clearSelectedCollection,
    setupCollectionListeners,
  } = useCollectionsActions();
  
  const { createDownload } = useDownloadActions();
  
  // Initialize on mount
  useEffect(() => {
    if (isOpen) {
      fetchAllCollections();
    }
  }, [isOpen, fetchAllCollections]);
  
  // Setup event listeners
  useEffect(() => {
    const cleanup = setupCollectionListeners();
    return cleanup;
  }, [setupCollectionListeners]);
  
  // Handle collection click
  const handleCollectionClick = useCallback(async (collection) => {
    await getCollection(collection.id);
  }, [getCollection]);
  
  // Handle create collection
  const handleCreateCollection = useCallback(async (data) => {
    await createCollection(data);
    setShowCreateForm(false);
  }, [createCollection]);
  
  // Handle install all models
  const handleInstallAll = useCallback(async (collection) => {
    // Queue downloads for all models in collection
    for (const model of collection.models || []) {
      // This would integrate with DownloadManagerV2
      console.log('Would download:', model);
    }
  }, []);
  
  // Filter collections
  const filteredStarterPacks = useMemo(() => {
    if (!categoryFilter) return starterPacks;
    return starterPacks.filter((c) => c.category === categoryFilter);
  }, [starterPacks, categoryFilter]);
  
  const filteredUserCollections = useMemo(() => {
    if (!categoryFilter) return userCollections;
    return userCollections.filter((c) => c.category === categoryFilter);
  }, [userCollections, categoryFilter]);
  
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
        className="w-full max-w-5xl h-[80vh] bg-[var(--bg-primary)] border border-[var(--border-dim)] rounded-xl shadow-2xl overflow-hidden flex"
      >
        {/* Main content */}
        <div className={`flex-1 flex flex-col ${selectedCollection ? 'w-1/2' : 'w-full'}`}>
          {/* Header */}
          <div className="p-4 border-b border-[var(--border-dim)] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[var(--accent-primary)]/10 rounded-lg">
                <Package className="w-5 h-5 text-[var(--accent-primary)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  Model Collections
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Curated starter packs and custom bundles
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--bg-secondary)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--text-muted)]" />
            </button>
          </div>
          
          {/* Tabs */}
          <div className="px-4 py-2 border-b border-[var(--border-dim)] flex items-center justify-between">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab('starter')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'starter'
                    ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Sparkles className="w-4 h-4 inline-block mr-1" />
                Starter Packs
              </button>
              <button
                onClick={() => setActiveTab('user')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === 'user'
                    ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Package className="w-4 h-4 inline-block mr-1" />
                My Collections
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              {activeTab === 'user' && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="px-3 py-1.5 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  New
                </button>
              )}
            </div>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {showCreateForm ? (
              <CreateCollectionForm
                onSubmit={handleCreateCollection}
                onCancel={() => setShowCreateForm(false)}
              />
            ) : loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-sm text-[var(--text-muted)]">Loading...</div>
              </div>
            ) : activeTab === 'starter' ? (
              <div className="grid grid-cols-2 gap-4">
                {filteredStarterPacks.map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    installStatus={installProgress[collection.id]}
                    onClick={() => handleCollectionClick(collection)}
                  />
                ))}
              </div>
            ) : (
              <>
                {filteredUserCollections.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
                    <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">
                      No collections yet
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mb-4">
                      Create your own collection of favorite models.
                    </p>
                    <button
                      onClick={() => setShowCreateForm(true)}
                      className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Create Collection
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {filteredUserCollections.map((collection) => (
                      <CollectionCard
                        key={collection.id}
                        collection={collection}
                        installStatus={installProgress[collection.id]}
                        onClick={() => handleCollectionClick(collection)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* Detail panel */}
        <AnimatePresence>
          {selectedCollection && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '50%', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-l border-[var(--border-dim)] bg-[var(--bg-secondary)]"
            >
              <CollectionDetail
                collection={selectedCollection}
                installStatus={installProgress[selectedCollection.id]}
                onClose={clearSelectedCollection}
                onInstallAll={handleInstallAll}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
});

export default CollectionsBrowser;



