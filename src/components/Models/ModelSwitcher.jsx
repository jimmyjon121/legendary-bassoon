import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import { 
  ChevronDown, 
  Check, 
  Cpu, 
  Zap, 
  Search,
  Star,
  Clock,
  Settings
} from 'lucide-react';
import { ModelBadge } from './ModelPerformanceBadges';

/**
 * ModelSwitcher - Animated model selection dropdown with transition effects
 */
export const ModelSwitcher = ({ 
  models = [], 
  selectedModel, 
  onSelectModel,
  recentModels = [],
  favoriteModels = [],
  onToggleFavorite,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [transitioning, setTransitioning] = useState(false);
  const dropdownRef = useRef(null);
  const transitionRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter models
  const filteredModels = models.filter(model =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Animated model switch
  const handleModelSelect = async (model) => {
    if (model.id === selectedModel?.id) {
      setIsOpen(false);
      return;
    }

    setTransitioning(true);
    setIsOpen(false);

    // Animate the transition indicator
    if (transitionRef.current) {
      const tl = gsap.timeline();
      
      tl.to(transitionRef.current, {
        scaleX: 1,
        duration: 0.3,
        ease: 'power2.in',
      })
      .to(transitionRef.current, {
        scaleX: 0,
        transformOrigin: 'right',
        duration: 0.3,
        ease: 'power2.out',
        delay: 0.1,
      });
    }

    // Delay the actual model switch for visual effect
    await new Promise(resolve => setTimeout(resolve, 200));
    onSelectModel?.(model);
    
    await new Promise(resolve => setTimeout(resolve, 400));
    setTransitioning(false);
  };

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Selected Model Button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-3 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors w-full ${
          transitioning ? 'pointer-events-none' : ''
        }`}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--ws-primary)] to-[var(--ws-secondary)] flex items-center justify-center">
          <Cpu size={16} className="text-white" />
        </div>
        
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-medium text-white truncate">
            {selectedModel?.name || 'Select Model'}
          </div>
          <div className="text-xs text-white/50 truncate">
            {selectedModel?.size || 'No model selected'}
          </div>
        </div>
        
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={18} className="text-white/50" />
        </motion.div>
      </motion.button>

      {/* Transition Indicator */}
      <div 
        ref={transitionRef}
        className="absolute inset-0 bg-[var(--ws-primary)] rounded-xl pointer-events-none opacity-20"
        style={{ scaleX: 0, transformOrigin: 'left' }}
      />

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute z-50 top-full left-0 right-0 mt-2 bg-[#0a0a14] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Search */}
            <div className="p-3 border-b border-white/10">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models..."
                  className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/40 outline-none focus:border-[var(--ws-primary)]/50"
                  autoFocus
                />
              </div>
            </div>

            {/* Recent Models */}
            {recentModels.length > 0 && !searchQuery && (
              <ModelSection
                title="Recent"
                icon={<Clock size={12} />}
                models={recentModels}
                selectedModel={selectedModel}
                favoriteModels={favoriteModels}
                onSelect={handleModelSelect}
                onToggleFavorite={onToggleFavorite}
              />
            )}

            {/* Favorite Models */}
            {favoriteModels.length > 0 && !searchQuery && (
              <ModelSection
                title="Favorites"
                icon={<Star size={12} className="text-yellow-400" />}
                models={models.filter(m => favoriteModels.includes(m.id))}
                selectedModel={selectedModel}
                favoriteModels={favoriteModels}
                onSelect={handleModelSelect}
                onToggleFavorite={onToggleFavorite}
              />
            )}

            {/* All Models */}
            <ModelSection
              title={searchQuery ? 'Results' : 'All Models'}
              models={filteredModels}
              selectedModel={selectedModel}
              favoriteModels={favoriteModels}
              onSelect={handleModelSelect}
              onToggleFavorite={onToggleFavorite}
              maxHeight={240}
            />

            {/* No Results */}
            {filteredModels.length === 0 && (
              <div className="p-8 text-center text-white/40">
                <Cpu size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No models found</p>
              </div>
            )}

            {/* Footer */}
            <div className="p-2 border-t border-white/10 bg-white/5">
              <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                <Settings size={14} />
                <span>Model Settings</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transition Overlay */}
      <AnimatePresence>
        {transitioning && (
          <motion.div
            className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--ws-primary)] to-[var(--ws-secondary)] flex items-center justify-center shadow-2xl"
              initial={{ scale: 0.5, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0.5, rotate: 180 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Zap size={24} className="text-white" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * ModelSection - Section within dropdown
 */
const ModelSection = ({ 
  title, 
  icon, 
  models, 
  selectedModel, 
  favoriteModels = [],
  onSelect, 
  onToggleFavorite,
  maxHeight
}) => {
  if (models.length === 0) return null;

  return (
    <div>
      {title && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-white/40">
          {icon}
          <span className="uppercase tracking-wider">{title}</span>
        </div>
      )}
      <div 
        className="overflow-y-auto"
        style={{ maxHeight: maxHeight || 'none' }}
      >
        {models.map((model, index) => (
          <ModelOption
            key={model.id}
            model={model}
            isSelected={model.id === selectedModel?.id}
            isFavorite={favoriteModels.includes(model.id)}
            index={index}
            onSelect={() => onSelect(model)}
            onToggleFavorite={() => onToggleFavorite?.(model.id)}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * ModelOption - Individual model in dropdown
 */
const ModelOption = ({ 
  model, 
  isSelected, 
  isFavorite, 
  index, 
  onSelect, 
  onToggleFavorite 
}) => {
  return (
    <motion.button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
        isSelected 
          ? 'bg-[var(--ws-primary)]/20' 
          : 'hover:bg-white/5'
      }`}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      whileHover={{ x: 4 }}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        isSelected 
          ? 'bg-[var(--ws-primary)]' 
          : 'bg-white/10'
      }`}>
        <Cpu size={14} className="text-white" />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium truncate ${
            isSelected ? 'text-[var(--ws-primary)]' : 'text-white'
          }`}>
            {model.name}
          </span>
          {model.badges?.slice(0, 2).map(badge => (
            <ModelBadge key={badge} type={badge} size="xs" showLabel={false} />
          ))}
        </div>
        <div className="text-xs text-white/50 truncate">
          {model.size || model.parameters || 'Unknown size'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <motion.button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={`p-1 rounded transition-colors ${
            isFavorite ? 'text-yellow-400' : 'text-white/20 hover:text-white/50'
          }`}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
        >
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
        </motion.button>
        
        {isSelected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-[var(--ws-primary)]"
          >
            <Check size={16} />
          </motion.div>
        )}
      </div>
    </motion.button>
  );
};

export default ModelSwitcher;






