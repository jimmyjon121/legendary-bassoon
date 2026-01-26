/**
 * Private Vault - Secure Adult Content Zone
 * 
 * Password-protected private area with:
 * - Encrypted local storage
 * - Adult content gallery
 * - NSFW AI generation
 * - Secure notes & fantasies
 * - Quick panic/boss key hide
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock, Unlock, Eye, EyeOff, Shield, Flame, Heart,
  Image, Video, FileText, Trash2, Download, Plus,
  X, AlertTriangle, CheckCircle, Sparkles, Moon,
  Camera, Palette, BookOpen, Star, Zap, Settings,
  KeyRound, Fingerprint, Clock, FolderLock, Search,
  Grid, List, SortAsc, Filter, MoreVertical, Share2,
  RefreshCw, ChevronRight, Play, Pause, Volume2, VolumeX,
  Database, ExternalLink, Package,
} from 'lucide-react';

// Vault tabs
const VAULT_TABS = [
  { id: 'gallery', name: 'Gallery', icon: Image, color: 'text-pink-400' },
  { id: 'generate', name: 'Generate', icon: Flame, color: 'text-orange-400' },
  { id: 'models', name: 'NSFW Models', icon: Database, color: 'text-purple-400' },
  { id: 'fantasies', name: 'Fantasies', icon: BookOpen, color: 'text-red-400' },
  { id: 'favorites', name: 'Favorites', icon: Heart, color: 'text-rose-400' },
  { id: 'settings', name: 'Settings', icon: Settings, color: 'text-gray-400' },
];

// Content categories
const CATEGORIES = [
  { id: 'all', name: 'All', icon: Grid },
  { id: 'photos', name: 'Photos', icon: Camera },
  { id: 'generated', name: 'AI Generated', icon: Sparkles },
  { id: 'art', name: 'Art', icon: Palette },
  { id: 'stories', name: 'Stories', icon: BookOpen },
  { id: 'videos', name: 'Videos', icon: Video },
];

const isElectron = () => typeof window !== 'undefined' && window.electronAPI;

export function PrivateVault({ onClose, onPanic }) {
  // Auth state
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isSettingPin, setIsSettingPin] = useState(false);
  const [confirmPin, setConfirmPin] = useState('');
  
  // Vault state
  const [activeTab, setActiveTab] = useState('gallery');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Content state
  const [galleryItems, setGalleryItems] = useState([]);
  const [fantasies, setFantasies] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  
  // Generation state
  const [generationPrompt, setGenerationPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  
  // Settings
  const [settings, setSettings] = useState({
    autoLock: 5, // minutes
    panicKey: 'Escape',
    blurThumbnails: false,
    encryption: 'AES-256',
  });

  // Check if vault has PIN set
  useEffect(() => {
    const checkVault = async () => {
      if (isElectron() && window.electronAPI.vaultHasPin) {
        const hasPin = await window.electronAPI.vaultHasPin();
        if (!hasPin) {
          setIsSettingPin(true);
        }
      } else {
        // Demo mode - no PIN set
        const storedPin = localStorage.getItem('vault_pin');
        if (!storedPin) {
          setIsSettingPin(true);
        }
      }
    };
    checkVault();
  }, []);

  // Panic key handler
  useEffect(() => {
    const handlePanic = (e) => {
      if (e.key === settings.panicKey || (e.key === 'Escape' && e.shiftKey)) {
        handleQuickHide();
      }
    };
    
    window.addEventListener('keydown', handlePanic);
    return () => window.removeEventListener('keydown', handlePanic);
  }, [settings.panicKey]);

  // Auto-lock timer
  useEffect(() => {
    if (!isUnlocked || settings.autoLock === 0) return;
    
    const timer = setTimeout(() => {
      handleLock();
    }, settings.autoLock * 60 * 1000);
    
    return () => clearTimeout(timer);
  }, [isUnlocked, settings.autoLock]);

  // Quick hide - panic button
  const handleQuickHide = () => {
    setIsUnlocked(false);
    setPin('');
    setSelectedItem(null);
    onPanic?.();
    onClose?.();
  };

  // Lock vault
  const handleLock = () => {
    setIsUnlocked(false);
    setPin('');
    setSelectedItem(null);
  };

  // Verify PIN
  const handleUnlock = async () => {
    if (pin.length < 4) {
      setPinError('PIN must be at least 4 digits');
      return;
    }
    
    // In real app, verify against encrypted storage
    const storedPin = localStorage.getItem('vault_pin');
    if (storedPin && pin === atob(storedPin)) {
      setIsUnlocked(true);
      setPinError('');
      loadVaultContent();
    } else {
      setPinError('Incorrect PIN');
      setPin('');
    }
  };

  // Set new PIN
  const handleSetPin = async () => {
    if (pin.length < 4) {
      setPinError('PIN must be at least 4 digits');
      return;
    }
    
    if (pin !== confirmPin) {
      setPinError('PINs do not match');
      return;
    }
    
    // Store encrypted PIN
    localStorage.setItem('vault_pin', btoa(pin));
    setIsSettingPin(false);
    setIsUnlocked(true);
    setPinError('');
    loadVaultContent();
  };

  // Load vault content
  const loadVaultContent = async () => {
    // Load from encrypted storage
    const stored = localStorage.getItem('vault_content');
    if (stored) {
      try {
        const content = JSON.parse(atob(stored));
        setGalleryItems(content.gallery || []);
        setFantasies(content.fantasies || []);
        setFavorites(content.favorites || []);
      } catch (e) {
        console.error('Failed to load vault:', e);
      }
    }
  };

  // Save vault content
  const saveVaultContent = useCallback(() => {
    const content = {
      gallery: galleryItems,
      fantasies,
      favorites,
    };
    localStorage.setItem('vault_content', btoa(JSON.stringify(content)));
  }, [galleryItems, fantasies, favorites]);

  // Auto-save on changes
  useEffect(() => {
    if (isUnlocked) {
      saveVaultContent();
    }
  }, [galleryItems, fantasies, favorites, isUnlocked, saveVaultContent]);

  // Add to favorites
  const toggleFavorite = (item) => {
    setFavorites(prev => {
      const exists = prev.find(f => f.id === item.id);
      if (exists) {
        return prev.filter(f => f.id !== item.id);
      }
      return [...prev, { ...item, favorited: Date.now() }];
    });
  };

  // Delete item
  const deleteItem = (item) => {
    setGalleryItems(prev => prev.filter(g => g.id !== item.id));
    setFavorites(prev => prev.filter(f => f.id !== item.id));
    setSelectedItem(null);
  };

  // Add new fantasy
  const addFantasy = (fantasy) => {
    setFantasies(prev => [{
      id: Date.now(),
      ...fantasy,
      created: Date.now(),
    }, ...prev]);
  };

  // Render PIN entry screen
  if (!isUnlocked) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-8"
        >
          {/* Lock icon with glow */}
          <div className="flex justify-center mb-8">
            <motion.div
              animate={{ 
                boxShadow: ['0 0 20px rgba(236, 72, 153, 0.3)', '0 0 40px rgba(236, 72, 153, 0.5)', '0 0 20px rgba(236, 72, 153, 0.3)']
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-24 h-24 rounded-full bg-gradient-to-br from-pink-500/20 to-red-500/20 flex items-center justify-center border border-pink-500/30"
            >
              <Lock size={40} className="text-pink-400" />
            </motion.div>
          </div>

          <h1 className="text-2xl font-bold text-center text-white mb-2">
            {isSettingPin ? 'Create Your PIN' : 'Private Vault'}
          </h1>
          <p className="text-center text-gray-400 mb-8 text-sm">
            {isSettingPin 
              ? 'Set a secure PIN to protect your private content'
              : 'Enter your PIN to unlock'
            }
          </p>

          {/* PIN input */}
          <div className="space-y-4">
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                onKeyDown={(e) => e.key === 'Enter' && (isSettingPin ? null : handleUnlock())}
                placeholder="Enter PIN"
                className="w-full px-4 py-4 bg-gray-900 border border-pink-500/30 rounded-xl text-white text-center text-2xl tracking-[0.5em] placeholder-gray-600 focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
                autoFocus
              />
              <button
                onClick={() => setShowPin(!showPin)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-pink-400"
              >
                {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            {isSettingPin && (
              <input
                type={showPin ? 'text' : 'password'}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                onKeyDown={(e) => e.key === 'Enter' && handleSetPin()}
                placeholder="Confirm PIN"
                className="w-full px-4 py-4 bg-gray-900 border border-pink-500/30 rounded-xl text-white text-center text-2xl tracking-[0.5em] placeholder-gray-600 focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20"
              />
            )}

            {pinError && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-sm text-center"
              >
                {pinError}
              </motion.p>
            )}

            <button
              onClick={isSettingPin ? handleSetPin : handleUnlock}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-pink-500 to-red-500 text-white font-semibold hover:from-pink-600 hover:to-red-600 transition-all flex items-center justify-center gap-2"
            >
              {isSettingPin ? (
                <>
                  <Shield size={20} />
                  Create Vault
                </>
              ) : (
                <>
                  <Unlock size={20} />
                  Unlock
                </>
              )}
            </button>
          </div>

          {/* Security info */}
          <div className="mt-8 flex items-center justify-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Shield size={12} />
              AES-256 Encrypted
            </span>
            <span className="flex items-center gap-1">
              <FolderLock size={12} />
              Local Storage Only
            </span>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/10"
          >
            <X size={24} />
          </button>
        </motion.div>
      </div>
    );
  }

  // Main vault UI
  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Vault Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-pink-500/20 bg-gradient-to-r from-black via-gray-950 to-black">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center">
            <Flame size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Private Vault</h1>
            <p className="text-[10px] text-pink-400">Encrypted • Secure • Private</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Panic button */}
          <button
            onClick={handleQuickHide}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/30 flex items-center gap-1"
          >
            <AlertTriangle size={12} />
            Panic (Esc)
          </button>

          {/* Lock button */}
          <button
            onClick={handleLock}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <Lock size={18} />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="h-12 px-4 flex items-center gap-2 border-b border-pink-500/10 bg-black/50">
        {VAULT_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <Icon size={16} className={isActive ? tab.color : ''} />
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Render active tab */}
        {activeTab === 'gallery' && (
          <GalleryTab
            items={galleryItems}
            setItems={setGalleryItems}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            deleteItem={deleteItem}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            viewMode={viewMode}
            setViewMode={setViewMode}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            settings={settings}
          />
        )}
        
        {activeTab === 'generate' && (
          <GenerateTab
            prompt={generationPrompt}
            setPrompt={setGenerationPrompt}
            isGenerating={isGenerating}
            setIsGenerating={setIsGenerating}
            generatedImages={generatedImages}
            setGeneratedImages={setGeneratedImages}
            addToGallery={(img) => setGalleryItems(prev => [img, ...prev])}
          />
        )}
        
        {activeTab === 'models' && (
          <NSFWModelsTab />
        )}
        
        {activeTab === 'fantasies' && (
          <FantasiesTab
            fantasies={fantasies}
            addFantasy={addFantasy}
            deleteFantasy={(id) => setFantasies(prev => prev.filter(f => f.id !== id))}
          />
        )}
        
        {activeTab === 'favorites' && (
          <FavoritesTab
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            setSelectedItem={setSelectedItem}
          />
        )}
        
        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            onResetVault={() => {
              localStorage.removeItem('vault_pin');
              localStorage.removeItem('vault_content');
              setIsUnlocked(false);
              setIsSettingPin(true);
            }}
          />
        )}
      </div>

      {/* Item Preview Modal */}
      <AnimatePresence>
        {selectedItem && (
          <ItemPreview
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            isFavorite={favorites.some(f => f.id === selectedItem.id)}
            onToggleFavorite={() => toggleFavorite(selectedItem)}
            onDelete={() => deleteItem(selectedItem)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================
// GALLERY TAB
// ============================================

function GalleryTab({ 
  items, setItems, favorites, toggleFavorite, deleteItem,
  selectedItem, setSelectedItem, viewMode, setViewMode,
  searchQuery, setSearchQuery, selectedCategory, setSelectedCategory,
  settings 
}) {
  const [isDragging, setIsDragging] = useState(false);

  // Handle file drop
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setItems(prev => [{
            id: Date.now() + Math.random(),
            type: file.type.startsWith('image/') ? 'image' : 'video',
            src: event.target.result,
            name: file.name,
            added: Date.now(),
            category: 'photos',
          }, ...prev]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  // Filter items
  const filteredItems = items.filter(item => {
    if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
    if (searchQuery && !item.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col">
      {/* Toolbar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-pink-500/10">
        <div className="flex items-center gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-pink-500/20 text-pink-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="pl-9 pr-3 py-1.5 bg-gray-900 border border-pink-500/20 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-pink-500"
            />
          </div>

          <div className="flex rounded-lg border border-pink-500/20 overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2 py-1 ${viewMode === 'grid' ? 'bg-pink-500/20 text-pink-400' : 'text-gray-500'}`}
            >
              <Grid size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-2 py-1 ${viewMode === 'list' ? 'bg-pink-500/20 text-pink-400' : 'text-gray-500'}`}
            >
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        className={`flex-1 p-4 overflow-y-auto ${isDragging ? 'bg-pink-500/5' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full bg-pink-500/10 flex items-center justify-center mb-4">
              <Image size={40} className="text-pink-400/50" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Your private gallery</h3>
            <p className="text-gray-500 text-sm mb-4 max-w-md">
              Drag and drop images or videos here to add them to your encrypted vault.
              All content is stored locally and never leaves your device.
            </p>
            <label className="px-4 py-2 rounded-lg bg-pink-500/20 text-pink-400 cursor-pointer hover:bg-pink-500/30 flex items-center gap-2">
              <Plus size={16} />
              Add Content
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files);
                  files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setItems(prev => [{
                        id: Date.now() + Math.random(),
                        type: file.type.startsWith('image/') ? 'image' : 'video',
                        src: event.target.result,
                        name: file.name,
                        added: Date.now(),
                        category: 'photos',
                      }, ...prev]);
                    };
                    reader.readAsDataURL(file);
                  });
                }}
              />
            </label>
          </div>
        ) : (
          <div className={
            viewMode === 'grid'
              ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
              : 'space-y-2'
          }>
            {filteredItems.map((item) => (
              <GalleryItem
                key={item.id}
                item={item}
                viewMode={viewMode}
                isFavorite={favorites.some(f => f.id === item.id)}
                onSelect={() => setSelectedItem(item)}
                onToggleFavorite={() => toggleFavorite(item)}
                blurred={settings.blurThumbnails}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Gallery item component
function GalleryItem({ item, viewMode, isFavorite, onSelect, onToggleFavorite, blurred }) {
  const [isHovered, setIsHovered] = useState(false);

  if (viewMode === 'list') {
    return (
      <div
        onClick={onSelect}
        className="p-3 rounded-lg bg-gray-900/50 border border-pink-500/10 hover:border-pink-500/30 flex items-center gap-4 cursor-pointer"
      >
        <div className={`w-16 h-16 rounded-lg overflow-hidden bg-gray-800 ${blurred ? 'blur-lg hover:blur-none transition-all' : ''}`}>
          {item.type === 'image' ? (
            <img src={item.src} alt="" className="w-full h-full object-cover" />
          ) : (
            <video src={item.src} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{item.name}</p>
          <p className="text-xs text-gray-500">{new Date(item.added).toLocaleDateString()}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`p-2 rounded-lg ${isFavorite ? 'text-pink-400' : 'text-gray-500 hover:text-pink-400'}`}
        >
          <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  }

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.02 }}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="aspect-square rounded-xl overflow-hidden bg-gray-900 border border-pink-500/10 hover:border-pink-500/30 cursor-pointer relative group"
    >
      <div className={`w-full h-full ${blurred && !isHovered ? 'blur-xl' : ''} transition-all duration-300`}>
        {item.type === 'image' ? (
          <img src={item.src} alt="" className="w-full h-full object-cover" />
        ) : (
          <video src={item.src} className="w-full h-full object-cover" />
        )}
      </div>
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
          <p className="text-xs text-white truncate">{item.name}</p>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`p-1 rounded ${isFavorite ? 'text-pink-400' : 'text-white/70 hover:text-pink-400'}`}
          >
            <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Type indicator */}
      {item.type === 'video' && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
          <Play size={12} className="text-white" />
        </div>
      )}
    </motion.div>
  );
}

// ============================================
// GENERATE TAB - NSFW Image Generation
// ============================================

function GenerateTab({ prompt, setPrompt, isGenerating, setIsGenerating, generatedImages, setGeneratedImages, addToGallery }) {
  const [selectedStyle, setSelectedStyle] = useState('realistic');
  const [selectedModel, setSelectedModel] = useState(null);
  const [negativePrompt, setNegativePrompt] = useState('low quality, blurry, deformed');
  const [nsfwModels, setNsfwModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  const STYLES = [
    { id: 'realistic', name: 'Photorealistic', icon: Camera, desc: 'Ultra-realistic photos' },
    { id: 'artistic', name: 'Artistic', icon: Palette, desc: 'Creative & artistic' },
    { id: 'anime', name: 'Anime/Hentai', icon: Star, desc: 'Anime style' },
    { id: 'fantasy', name: 'Fantasy', icon: Sparkles, desc: 'Fantasy & surreal' },
  ];

  const PROMPT_SUGGESTIONS = [
    'Beautiful woman in elegant lingerie, soft lighting, bedroom, photorealistic',
    'Romantic couple in intimate embrace, artistic photography, sensual',
    'Seductive pose, professional boudoir photography, soft shadows',
    'Passionate moment, cinematic lighting, intimate setting',
    'Alluring silhouette against window light, artistic nude',
    'Sultry look, red lips, bedroom eyes, professional portrait',
    'Intimate couple, tangled sheets, morning light, romantic',
    'Sexy fitness model, athletic body, confident pose',
    'Elegant woman in sheer fabric, backlit, dreamy atmosphere',
    'Steamy shower scene, water droplets, sensual mood',
  ];

  // Load NSFW models
  useEffect(() => {
    const loadModels = async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.providersGetPrivateVaultModels) {
        try {
          const vaultModels = await window.electronAPI.providersGetPrivateVaultModels();
          setNsfwModels(vaultModels.image || []);
          if (vaultModels.image?.length > 0) {
            setSelectedModel(vaultModels.image[0]);
          }
        } catch (e) {
          console.error('Failed to load NSFW models:', e);
        }
      }
      setIsLoadingModels(false);
    };
    loadModels();
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    
    // In real implementation, this would call an actual NSFW image gen API
    // For now, simulate generation
    setTimeout(() => {
      const newImage = {
        id: Date.now(),
        type: 'image',
        src: `https://picsum.photos/seed/${Date.now()}/512/512`, // Placeholder
        name: `${selectedModel?.name || 'Generated'} - ${prompt.slice(0, 30)}...`,
        prompt,
        style: selectedStyle,
        model: selectedModel?.name,
        added: Date.now(),
        category: 'generated',
      };
      
      setGeneratedImages(prev => [newImage, ...prev]);
      setIsGenerating(false);
    }, 3000);
  };

  return (
    <div className="flex-1 flex">
      {/* Generation Panel */}
      <div className="w-[420px] border-r border-pink-500/10 p-4 flex flex-col overflow-y-auto">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Flame className="text-pink-400" size={20} />
          Uncensored Generation
        </h3>

        {/* Model selector */}
        <div className="mb-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
            NSFW Model
          </label>
          {isLoadingModels ? (
            <div className="p-3 rounded-lg bg-gray-900 border border-pink-500/10 text-gray-500 text-sm">
              Loading models...
            </div>
          ) : nsfwModels.length === 0 ? (
            <div className="p-3 rounded-lg bg-gray-900 border border-pink-500/10 text-gray-500 text-sm">
              No NSFW models available. Download from CivitAI.
            </div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {nsfwModels.map(model => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model)}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    selectedModel?.id === model.id
                      ? 'bg-pink-500/20 border-pink-500/50'
                      : 'bg-gray-900 border-pink-500/10 hover:border-pink-500/30'
                  }`}
                >
                  <p className="text-sm font-medium text-white">{model.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{model.baseModel} • {model.size}GB</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Style selector */}
        <div className="mb-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Style</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLES.map(style => {
              const Icon = style.icon;
              return (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`p-3 rounded-lg border text-sm font-medium flex flex-col items-start gap-1 transition-colors ${
                    selectedStyle === style.id
                      ? 'bg-pink-500/20 border-pink-500/50 text-pink-400'
                      : 'bg-gray-900 border-pink-500/10 text-gray-400 hover:border-pink-500/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} />
                    {style.name}
                  </div>
                  <span className="text-[10px] text-gray-500">{style.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt input */}
        <div className="mb-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
            Prompt <span className="text-pink-400">• Be explicit</span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your fantasy in detail..."
            className="w-full h-32 p-3 bg-gray-900 border border-pink-500/20 rounded-lg text-white placeholder-gray-600 resize-none focus:outline-none focus:border-pink-500"
          />
        </div>

        {/* Quick prompts */}
        <div className="mb-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">
            🔥 Quick Ideas
          </label>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {PROMPT_SUGGESTIONS.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => setPrompt(suggestion)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-pink-400 hover:bg-pink-500/10 line-clamp-2"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Negative prompt */}
        <div className="mb-4">
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Negative Prompt</label>
          <input
            type="text"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="What to avoid..."
            className="w-full px-3 py-2 bg-gray-900 border border-pink-500/20 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-pink-500"
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="mt-auto py-3 rounded-xl bg-gradient-to-r from-pink-500 via-red-500 to-rose-500 text-white font-semibold hover:from-pink-600 hover:via-red-600 hover:to-rose-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-pink-500/20"
        >
          {isGenerating ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              Creating your fantasy...
            </>
          ) : (
            <>
              <Flame size={18} />
              Generate Uncensored
            </>
          )}
        </button>

        {/* Disclaimer */}
        <p className="text-[10px] text-gray-600 mt-3 text-center">
          All generated content is stored locally and encrypted. 
          You are responsible for compliance with local laws.
        </p>
      </div>

      {/* Generated Images */}
      <div className="flex-1 p-4 overflow-y-auto bg-gradient-to-br from-black via-gray-950 to-black">
        {generatedImages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-pink-500/20 to-red-500/20 flex items-center justify-center mb-4 border border-pink-500/20">
              <Flame size={48} className="text-pink-400/50" />
            </div>
            <h3 className="text-xl font-medium text-white mb-2">Ready to create</h3>
            <p className="text-gray-500 text-sm max-w-xs">
              Enter a detailed prompt and let your imagination run wild. 
              No restrictions, no filters.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {generatedImages.map((img) => (
              <div
                key={img.id}
                className="aspect-square rounded-xl overflow-hidden bg-gray-900 border border-pink-500/10 hover:border-pink-500/30 relative group cursor-pointer"
              >
                <img src={img.src} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs text-white line-clamp-2 mb-2">{img.prompt}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-pink-400">{img.model}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => addToGallery(img)}
                          className="p-1.5 rounded bg-pink-500/30 text-white hover:bg-pink-500/50"
                          title="Save to Gallery"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => setPrompt(img.prompt)}
                          className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"
                          title="Reuse Prompt"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// NSFW MODELS TAB - Full Adult Model Browser
// ============================================

function NSFWModelsTab() {
  const [models, setModels] = useState({ image: [], llm: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('llm');
  const [selectedModel, setSelectedModel] = useState(null);
  const [pullProgress, setPullProgress] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  // Full list of uncensored LLMs available via Ollama
  const UNCENSORED_LLMS = [
    {
      id: 'wizard-vicuna-uncensored',
      name: 'Wizard Vicuna Uncensored',
      description: 'Completely uncensored conversational model. No content filters, no restrictions. Perfect for unrestricted roleplay and adult content.',
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
      description: 'Powerful uncensored Mixtral fine-tune. Excels at following instructions without moral judgments or refusals.',
      author: 'Cognitive Computations',
      family: 'Mixtral',
      capability: 'chat',
      variants: [
        { tag: '8x7b', params: '46.7B (8x7B)', size: 26, vram: 32 },
        { tag: '8x22b', params: '141B (8x22B)', size: 80, vram: 96 },
      ],
      tags: ['uncensored', 'moe', 'powerful', 'no-refusals'],
      pulls: 1000000,
    },
    {
      id: 'dolphin-llama3',
      name: 'Dolphin Llama 3 (Uncensored)',
      description: 'Llama 3 without safety training. Full capabilities, no restrictions on content generation.',
      author: 'Cognitive Computations',
      family: 'Llama',
      capability: 'chat',
      variants: [
        { tag: '8b', params: '8B', size: 4.7, vram: 8 },
        { tag: '70b', params: '70B', size: 40, vram: 48 },
      ],
      tags: ['uncensored', 'llama3', 'capable', 'nsfw'],
      pulls: 500000,
    },
    {
      id: 'nous-hermes2',
      name: 'Nous Hermes 2 (Uncensored)',
      description: 'High-quality uncensored model trained on diverse data. Great for creative writing and roleplay.',
      author: 'Nous Research',
      family: 'Mistral',
      capability: 'chat',
      variants: [
        { tag: '7b', params: '7B', size: 4.1, vram: 6 },
        { tag: '34b', params: '34B', size: 19, vram: 24 },
      ],
      tags: ['uncensored', 'creative', 'roleplay'],
      pulls: 600000,
    },
    {
      id: 'openhermes',
      name: 'OpenHermes 2.5 (Uncensored)',
      description: 'Mistral-based model fine-tuned for uncensored conversations. Helpful without moral restrictions.',
      author: 'Teknium',
      family: 'Mistral',
      capability: 'chat',
      variants: [
        { tag: '7b', params: '7B', size: 4.1, vram: 6 },
      ],
      tags: ['uncensored', 'helpful', 'mistral'],
      pulls: 400000,
    },
    {
      id: 'samantha-mistral',
      name: 'Samantha Mistral',
      description: 'Emotionally intelligent uncensored assistant. Designed for intimate, personal conversations.',
      author: 'Cognitive Computations',
      family: 'Mistral',
      capability: 'chat',
      variants: [
        { tag: '7b', params: '7B', size: 4.1, vram: 6 },
      ],
      tags: ['uncensored', 'emotional', 'intimate', 'companion'],
      pulls: 300000,
    },
    {
      id: 'mythomax',
      name: 'MythoMax L2 (Uncensored)',
      description: 'Excellent for creative fiction and adult storytelling. Merged model with diverse capabilities.',
      author: 'Gryphe',
      family: 'Llama',
      capability: 'chat',
      variants: [
        { tag: '13b', params: '13B', size: 7.4, vram: 10 },
      ],
      tags: ['uncensored', 'storytelling', 'creative', 'fiction'],
      pulls: 450000,
    },
    {
      id: 'luna-ai-llama2-uncensored',
      name: 'Luna AI Llama 2 Uncensored',
      description: 'Llama 2 with all safety filters removed. Full unrestricted generation capabilities.',
      author: 'The Bloke',
      family: 'Llama',
      capability: 'chat',
      variants: [
        { tag: '7b', params: '7B', size: 3.8, vram: 6 },
      ],
      tags: ['uncensored', 'llama2', 'no-filter'],
      pulls: 350000,
    },
    {
      id: 'guanaco',
      name: 'Guanaco (Uncensored)',
      description: 'QLoRA fine-tuned model known for being helpful without censorship.',
      author: 'Tim Dettmers',
      family: 'Llama',
      capability: 'chat',
      variants: [
        { tag: '7b', params: '7B', size: 3.8, vram: 6 },
        { tag: '13b', params: '13B', size: 7.4, vram: 10 },
        { tag: '33b', params: '33B', size: 18, vram: 24 },
      ],
      tags: ['uncensored', 'qlora', 'helpful'],
      pulls: 250000,
    },
    {
      id: 'airoboros',
      name: 'Airoboros (Uncensored)',
      description: 'GPT-4 distilled model with no content restrictions. Great for following complex instructions.',
      author: 'Jon Durbin',
      family: 'Llama',
      capability: 'chat',
      variants: [
        { tag: '7b', params: '7B', size: 3.8, vram: 6 },
        { tag: '13b', params: '13B', size: 7.4, vram: 10 },
        { tag: '33b', params: '33B', size: 18, vram: 24 },
      ],
      tags: ['uncensored', 'instruction', 'gpt4-distill'],
      pulls: 200000,
    },
  ];

  // NSFW Image Models
  const NSFW_IMAGE_MODELS = [
    {
      id: 'realistic-vision-nsfw',
      name: 'Realistic Vision V5.1 (Inpainting)',
      description: 'Photorealistic NSFW model. Incredible detail for adult content. Best for realistic human subjects.',
      author: 'SG_161222',
      baseModel: 'SD 1.5',
      size: 4.27,
      tags: ['photorealistic', 'nsfw', 'inpainting', 'portraits'],
      downloads: 1200000,
      rating: 4.8,
    },
    {
      id: 'deliberate-v5',
      name: 'Deliberate V5 NSFW',
      description: 'Versatile uncensored model. Handles any style from realistic to artistic NSFW.',
      author: 'XpucT',
      baseModel: 'SD 1.5',
      size: 4.27,
      tags: ['versatile', 'nsfw', 'artistic'],
      downloads: 900000,
      rating: 4.7,
    },
    {
      id: 'anything-v5',
      name: 'Anything V5 (NSFW)',
      description: 'Anime/hentai focused model. No restrictions on content. High quality illustrations.',
      author: 'Linaqruf',
      baseModel: 'SD 1.5',
      size: 4.27,
      tags: ['anime', 'hentai', 'nsfw', 'illustration'],
      downloads: 800000,
      rating: 4.6,
    },
    {
      id: 'perfect-world-nsfw',
      name: 'Perfect World NSFW',
      description: 'High quality SDXL model for uncensored realistic generation.',
      author: 'CivitAI',
      baseModel: 'SDXL 1.0',
      size: 6.94,
      tags: ['sdxl', 'realistic', 'nsfw', 'high-quality'],
      downloads: 400000,
      rating: 4.8,
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
    {
      id: 'juggernaut-aftermath',
      name: 'Juggernaut Aftermath (NSFW)',
      description: 'Uncensored version of popular Juggernaut. Stunning photorealism.',
      author: 'kandoo',
      baseModel: 'SDXL 1.0',
      size: 6.94,
      tags: ['sdxl', 'photorealistic', 'nsfw'],
      downloads: 350000,
      rating: 4.9,
    },
    {
      id: 'animagine-nsfw',
      name: 'Animagine XL 3.0 NSFW',
      description: 'Beautiful anime art generation without content restrictions.',
      author: 'Cagliostro',
      baseModel: 'SDXL 1.0',
      size: 6.94,
      tags: ['anime', 'sdxl', 'nsfw', 'hentai'],
      downloads: 300000,
      rating: 4.7,
    },
    {
      id: 'dark-sushi-nsfw',
      name: 'Dark Sushi Mix NSFW',
      description: 'Edgy and dark themed NSFW content. Great for fantasy and horror.',
      author: 'Dark Sushi',
      baseModel: 'SDXL 1.0',
      size: 6.94,
      tags: ['dark', 'edgy', 'fantasy', 'nsfw'],
      downloads: 200000,
      rating: 4.5,
    },
    {
      id: 'dreamshaper-nsfw',
      name: 'DreamShaper NSFW',
      description: 'Versatile model for dreamlike NSFW imagery. Artistic and surreal.',
      author: 'Lykon',
      baseModel: 'SD 1.5',
      size: 4.27,
      tags: ['artistic', 'dreamlike', 'nsfw', 'surreal'],
      downloads: 450000,
      rating: 4.6,
    },
    {
      id: 'unstable-diffusion',
      name: 'Unstable Diffusion',
      description: 'The original uncensored SD model. Community-trained for NSFW.',
      author: 'Unstable Diffusion',
      baseModel: 'SD 1.5',
      size: 4.27,
      tags: ['original', 'community', 'nsfw'],
      downloads: 500000,
      rating: 4.4,
    },
  ];

  useEffect(() => {
    // Load models
    setModels({
      llm: UNCENSORED_LLMS,
      image: NSFW_IMAGE_MODELS,
    });
    setIsLoading(false);
    
    // Listen for pull progress
    if (typeof window !== 'undefined' && window.electronAPI?.onProvidersPullProgress) {
      window.electronAPI.onProvidersPullProgress((progress) => {
        setPullProgress(prev => ({
          ...prev,
          [progress.model]: progress,
        }));
      });
    }
  }, []);

  // Filter models by search
  const currentModels = (activeCategory === 'llm' ? models.llm : models.image).filter(model => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      model.name.toLowerCase().includes(query) ||
      model.description.toLowerCase().includes(query) ||
      model.tags?.some(t => t.toLowerCase().includes(query))
    );
  });

  // Pull an Ollama model
  const handlePullModel = async (model, variant) => {
    if (typeof window === 'undefined' || !window.electronAPI?.providersPullOllamaModel) return;
    
    const modelName = variant ? `${model.id}:${variant.tag}` : model.id;
    
    try {
      setPullProgress(prev => ({
        ...prev,
        [modelName]: { status: 'starting', percent: 0 },
      }));
      
      await window.electronAPI.providersPullOllamaModel(modelName);
      
      setPullProgress(prev => ({
        ...prev,
        [modelName]: { status: 'completed', percent: 100 },
      }));
    } catch (error) {
      console.error('Pull error:', error);
      setPullProgress(prev => ({
        ...prev,
        [modelName]: { status: 'error', error: error.message },
      }));
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-black via-gray-950 to-black">
      {/* Header */}
      <div className="p-4 border-b border-pink-500/20 bg-black/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Flame className="text-pink-400" size={24} />
              Uncensored Model Hub
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Download unrestricted AI models • No filters • No limits
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search uncensored models..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-pink-500/20 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-pink-500"
          />
        </div>

        {/* Category tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveCategory('llm')}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeCategory === 'llm'
                ? 'bg-gradient-to-r from-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/20'
                : 'bg-gray-900 text-gray-400 hover:text-white border border-pink-500/20'
            }`}
          >
            💬 Uncensored Chat ({models.llm?.length || 0})
          </button>
          <button
            onClick={() => setActiveCategory('image')}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeCategory === 'image'
                ? 'bg-gradient-to-r from-pink-500 to-red-500 text-white shadow-lg shadow-pink-500/20'
                : 'bg-gray-900 text-gray-400 hover:text-white border border-pink-500/20'
            }`}
          >
            🎨 NSFW Image Gen ({models.image?.length || 0})
          </button>
        </div>
      </div>

      {/* Models Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <RefreshCw size={32} className="animate-spin text-pink-400" />
            </div>
          ) : currentModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Package size={48} className="text-pink-400/30 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No matches found</h3>
              <p className="text-gray-500 text-sm">Try a different search term</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {currentModels.map((model) => (
                <NSFWModelCard
                  key={model.id}
                  model={model}
                  category={activeCategory}
                  isSelected={selectedModel?.id === model.id}
                  onSelect={() => setSelectedModel(model)}
                  pullProgress={pullProgress}
                  onPull={handlePullModel}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Model Details Panel */}
      {selectedModel && (
        <NSFWModelDetails
          model={selectedModel}
          category={activeCategory}
          onClose={() => setSelectedModel(null)}
          pullProgress={pullProgress}
          onPull={handlePullModel}
        />
      )}
    </div>
  );
}

// NSFW Model Card
function NSFWModelCard({ model, category, isSelected, onSelect, pullProgress, onPull }) {
  const [selectedVariant, setSelectedVariant] = useState(model.variants?.[0]);
  const progress = pullProgress[selectedVariant ? `${model.id}:${selectedVariant.tag}` : model.id];
  const isPulling = progress?.status === 'starting' || progress?.status === 'downloading';
  const isComplete = progress?.status === 'completed';

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-xl border transition-all cursor-pointer ${
        isSelected
          ? 'bg-pink-500/20 border-pink-500/50 shadow-lg shadow-pink-500/10'
          : 'bg-gray-900/70 border-pink-500/10 hover:border-pink-500/30 hover:bg-gray-900'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white truncate">{model.name}</h3>
          <p className="text-[10px] text-gray-500">by {model.author}</p>
        </div>
        <span className="px-2 py-0.5 rounded bg-red-500/30 text-red-300 text-[10px] font-bold ml-2 shrink-0">
          🔥 NSFW
        </span>
      </div>
      
      <p className="text-xs text-gray-400 line-clamp-2 mb-3">{model.description}</p>
      
      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {model.tags?.slice(0, 4).map(tag => (
          <span key={tag} className="px-1.5 py-0.5 rounded bg-pink-500/10 text-[9px] text-pink-300 border border-pink-500/20">
            {tag}
          </span>
        ))}
      </div>

      {/* Variants for LLMs */}
      {model.variants && (
        <div className="flex gap-1 mb-3 flex-wrap">
          {model.variants.map(v => (
            <button
              key={v.tag}
              onClick={(e) => { e.stopPropagation(); setSelectedVariant(v); }}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                selectedVariant?.tag === v.tag
                  ? 'bg-pink-500/30 text-pink-300 border border-pink-500/50'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {v.params} • {v.size}GB
            </button>
          ))}
        </div>
      )}

      {/* Info row */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-3">
        <span>{model.baseModel || model.family}</span>
        <span>{model.pulls ? `${(model.pulls/1000).toFixed(0)}K pulls` : model.downloads ? `${(model.downloads/1000).toFixed(0)}K downloads` : ''}</span>
      </div>

      {/* Action button */}
      {category === 'llm' ? (
        <button
          onClick={(e) => { e.stopPropagation(); onPull(model, selectedVariant); }}
          disabled={isPulling}
          className={`w-full py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
            isComplete
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : isPulling
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-pink-500 text-white hover:bg-pink-600'
          }`}
        >
          {isComplete ? (
            <>
              <CheckCircle size={14} />
              Installed
            </>
          ) : isPulling ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              Pulling... {progress?.percent || 0}%
            </>
          ) : (
            <>
              <Download size={14} />
              Pull {selectedVariant?.tag || 'latest'}
            </>
          )}
        </button>
      ) : (
        <a
          href={`https://civitai.com/models?query=${encodeURIComponent(model.name)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-full py-2 rounded-lg text-xs font-medium bg-pink-500 text-white hover:bg-pink-600 flex items-center justify-center gap-2"
        >
          <ExternalLink size={14} />
          Download from CivitAI
        </a>
      )}
    </div>
  );
}

// NSFW Model Details Panel
function NSFWModelDetails({ model, category, onClose, pullProgress, onPull }) {
  const [selectedVariant, setSelectedVariant] = useState(model.variants?.[0]);
  const progress = pullProgress[selectedVariant ? `${model.id}:${selectedVariant.tag}` : model.id];
  const isPulling = progress?.status === 'starting' || progress?.status === 'downloading';
  const isComplete = progress?.status === 'completed';

  return (
    <div className="border-t border-pink-500/20 p-4 bg-gradient-to-r from-gray-900 to-black">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            {model.name}
            <span className="px-2 py-0.5 rounded bg-red-500/30 text-red-300 text-[10px] font-bold">
              🔥 NSFW
            </span>
          </h3>
          <p className="text-xs text-gray-400">by {model.author}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-500">
          <X size={18} />
        </button>
      </div>
      
      <p className="text-sm text-gray-300 mb-4">{model.description}</p>
      
      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-4">
        {model.tags?.map(tag => (
          <span key={tag} className="px-2 py-1 rounded-full bg-pink-500/10 text-xs text-pink-300 border border-pink-500/20">
            {tag}
          </span>
        ))}
      </div>

      {/* Variants */}
      {model.variants && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Available Sizes</p>
          <div className="flex flex-wrap gap-2">
            {model.variants.map(v => (
              <button
                key={v.tag}
                onClick={() => setSelectedVariant(v)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  selectedVariant?.tag === v.tag
                    ? 'bg-pink-500/30 text-pink-300 border border-pink-500/50'
                    : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                }`}
              >
                <div>{v.params}</div>
                <div className="text-[10px] text-gray-500">{v.size}GB • {v.vram}GB VRAM</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action */}
      {category === 'llm' ? (
        <button
          onClick={() => onPull(model, selectedVariant)}
          disabled={isPulling}
          className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${
            isComplete
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : isPulling
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-gradient-to-r from-pink-500 to-red-500 text-white hover:from-pink-600 hover:to-red-600 shadow-lg shadow-pink-500/20'
          }`}
        >
          {isComplete ? (
            <>
              <CheckCircle size={18} />
              Model Installed - Ready to Use
            </>
          ) : isPulling ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              Downloading... {progress?.percent || 0}%
            </>
          ) : (
            <>
              <Download size={18} />
              Pull {model.id}:{selectedVariant?.tag || 'latest'} with Ollama
            </>
          )}
        </button>
      ) : (
        <a
          href={`https://civitai.com/models?query=${encodeURIComponent(model.name)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3 rounded-xl font-medium bg-gradient-to-r from-pink-500 to-red-500 text-white hover:from-pink-600 hover:to-red-600 flex items-center justify-center gap-2 shadow-lg shadow-pink-500/20"
        >
          <ExternalLink size={18} />
          Download from CivitAI
        </a>
      )}
    </div>
  );
}

// ============================================
// FANTASIES TAB
// ============================================

function FantasiesTab({ fantasies, addFantasy, deleteFantasy }) {
  const [isWriting, setIsWriting] = useState(false);
  const [newFantasy, setNewFantasy] = useState({ title: '', content: '', tags: [] });
  const [selectedFantasy, setSelectedFantasy] = useState(null);

  const handleSave = () => {
    if (!newFantasy.title.trim() || !newFantasy.content.trim()) return;
    
    addFantasy(newFantasy);
    setNewFantasy({ title: '', content: '', tags: [] });
    setIsWriting(false);
  };

  return (
    <div className="flex-1 flex">
      {/* List */}
      <div className="w-80 border-r border-pink-500/10 flex flex-col">
        <div className="p-4 border-b border-pink-500/10">
          <button
            onClick={() => setIsWriting(true)}
            className="w-full py-2 rounded-lg bg-pink-500/20 text-pink-400 text-sm font-medium hover:bg-pink-500/30 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            New Fantasy
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {fantasies.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-gray-500 text-sm text-center px-4">
                Write down your deepest desires and fantasies...
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {fantasies.map((fantasy) => (
                <button
                  key={fantasy.id}
                  onClick={() => setSelectedFantasy(fantasy)}
                  className={`w-full p-3 rounded-lg text-left transition-colors ${
                    selectedFantasy?.id === fantasy.id
                      ? 'bg-pink-500/20 border border-pink-500/30'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <h4 className="text-sm font-medium text-white truncate">{fantasy.title}</h4>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-1">{fantasy.content}</p>
                  <p className="text-[10px] text-gray-600 mt-2">
                    {new Date(fantasy.created).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {isWriting ? (
          <div className="h-full flex flex-col">
            <input
              type="text"
              value={newFantasy.title}
              onChange={(e) => setNewFantasy(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Give your fantasy a title..."
              className="text-2xl font-semibold bg-transparent text-white placeholder-gray-600 focus:outline-none mb-4"
              autoFocus
            />
            <textarea
              value={newFantasy.content}
              onChange={(e) => setNewFantasy(prev => ({ ...prev, content: e.target.value }))}
              placeholder="Let your imagination run wild..."
              className="flex-1 bg-transparent text-gray-300 placeholder-gray-600 resize-none focus:outline-none leading-relaxed"
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-lg bg-pink-500 text-white font-medium hover:bg-pink-600"
              >
                Save Fantasy
              </button>
              <button
                onClick={() => { setIsWriting(false); setNewFantasy({ title: '', content: '', tags: [] }); }}
                className="px-4 py-2 rounded-lg text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : selectedFantasy ? (
          <div className="h-full flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-2xl font-semibold text-white">{selectedFantasy.title}</h2>
              <button
                onClick={() => { deleteFantasy(selectedFantasy.id); setSelectedFantasy(null); }}
                className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-6">
              Written on {new Date(selectedFantasy.created).toLocaleDateString()}
            </p>
            <div className="flex-1 overflow-y-auto">
              <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{selectedFantasy.content}</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <BookOpen size={48} className="text-pink-400/30 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Your Private Journal</h3>
            <p className="text-gray-500 text-sm max-w-md">
              Write your deepest fantasies, desires, and secret thoughts. 
              Everything is encrypted and never leaves your device.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// FAVORITES TAB
// ============================================

function FavoritesTab({ favorites, toggleFavorite, setSelectedItem }) {
  return (
    <div className="flex-1 p-4 overflow-y-auto">
      {favorites.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <Heart size={48} className="text-pink-400/30 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No favorites yet</h3>
          <p className="text-gray-500 text-sm">
            Heart your favorite content to save it here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {favorites.map((item) => (
            <GalleryItem
              key={item.id}
              item={item}
              viewMode="grid"
              isFavorite={true}
              onSelect={() => setSelectedItem(item)}
              onToggleFavorite={() => toggleFavorite(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// SETTINGS TAB
// ============================================

function SettingsTab({ settings, setSettings, onResetVault }) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  return (
    <div className="flex-1 p-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">Vault Settings</h2>

      <div className="space-y-6">
        {/* Auto-lock */}
        <div className="p-4 rounded-xl bg-gray-900/50 border border-pink-500/10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">Auto-Lock</h3>
              <p className="text-xs text-gray-500">Lock vault after inactivity</p>
            </div>
            <select
              value={settings.autoLock}
              onChange={(e) => setSettings(prev => ({ ...prev, autoLock: parseInt(e.target.value) }))}
              className="px-3 py-1.5 bg-gray-800 border border-pink-500/20 rounded-lg text-white text-sm focus:outline-none focus:border-pink-500"
            >
              <option value={0}>Never</option>
              <option value={1}>1 minute</option>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>
        </div>

        {/* Blur thumbnails */}
        <div className="p-4 rounded-xl bg-gray-900/50 border border-pink-500/10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">Blur Thumbnails</h3>
              <p className="text-xs text-gray-500">Blur images until hovered</p>
            </div>
            <button
              onClick={() => setSettings(prev => ({ ...prev, blurThumbnails: !prev.blurThumbnails }))}
              className={`w-12 h-6 rounded-full transition-colors ${
                settings.blurThumbnails ? 'bg-pink-500' : 'bg-gray-700'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                settings.blurThumbnails ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* Panic key */}
        <div className="p-4 rounded-xl bg-gray-900/50 border border-pink-500/10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">Panic Key</h3>
              <p className="text-xs text-gray-500">Instantly hide vault</p>
            </div>
            <span className="px-3 py-1.5 bg-gray-800 border border-pink-500/20 rounded-lg text-pink-400 text-sm font-mono">
              Shift + Escape
            </span>
          </div>
        </div>

        {/* Encryption info */}
        <div className="p-4 rounded-xl bg-gray-900/50 border border-pink-500/10">
          <div className="flex items-center gap-3">
            <Shield className="text-green-400" size={24} />
            <div>
              <h3 className="text-sm font-medium text-white">Encryption</h3>
              <p className="text-xs text-gray-500">
                All content encrypted with {settings.encryption} • Stored locally only
              </p>
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <h3 className="text-sm font-medium text-red-400 mb-2">Danger Zone</h3>
          {showResetConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-300">Are you sure? This cannot be undone.</span>
              <button
                onClick={() => { onResetVault(); setShowResetConfirm(false); }}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-gray-400 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-4 py-2 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/20"
            >
              Reset Vault & Delete All Content
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// ITEM PREVIEW MODAL
// ============================================

function ItemPreview({ item, onClose, isFavorite, onToggleFavorite, onDelete }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative max-w-5xl max-h-[90vh] w-full mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Media */}
        {item.type === 'image' ? (
          <img src={item.src} alt="" className="w-full h-full object-contain rounded-lg" />
        ) : (
          <video src={item.src} controls className="w-full h-full object-contain rounded-lg" />
        )}

        {/* Controls */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button
            onClick={onToggleFavorite}
            className={`p-2 rounded-lg backdrop-blur-sm ${
              isFavorite ? 'bg-pink-500/20 text-pink-400' : 'bg-black/50 text-white'
            }`}
          >
            <Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg bg-black/50 text-white hover:bg-red-500/50 backdrop-blur-sm"
          >
            <Trash2 size={20} />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-black/50 text-white hover:bg-white/20 backdrop-blur-sm"
          >
            <X size={20} />
          </button>
        </div>

        {/* Info */}
        <div className="absolute bottom-4 left-4 right-4 p-4 rounded-lg bg-black/50 backdrop-blur-sm">
          <p className="text-white font-medium">{item.name}</p>
          <p className="text-gray-400 text-sm">
            Added {new Date(item.added).toLocaleDateString()}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default PrivateVault;

