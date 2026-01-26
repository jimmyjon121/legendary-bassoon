/**
 * Soul Indicator
 * 
 * Compact indicator showing current cognitive state and circadian mode.
 * Appears in the top bar, click to open Soul Dashboard.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sun, Moon, Sunrise, Sunset, Coffee, Sparkles, Zap, Target, Palette, Compass, Battery } from 'lucide-react';
import { useSoulStore, CIRCADIAN_PERIODS, getCircadianPeriod } from '../../stores/soulStore';

// State icons and colors
const STATE_CONFIG = {
  focused: {
    icon: Target,
    color: 'from-sky-400 to-blue-500',
    glow: 'rgba(56, 189, 248, 0.4)',
    label: 'Focused',
  },
  stressed: {
    icon: Zap,
    color: 'from-rose-400 to-red-500',
    glow: 'rgba(244, 63, 94, 0.4)',
    label: 'Stressed',
  },
  creative: {
    icon: Palette,
    color: 'from-violet-400 to-purple-500',
    glow: 'rgba(167, 139, 250, 0.4)',
    label: 'Creative',
  },
  exploratory: {
    icon: Compass,
    color: 'from-cyan-400 to-teal-500',
    glow: 'rgba(34, 211, 238, 0.4)',
    label: 'Exploring',
  },
  tired: {
    icon: Battery,
    color: 'from-slate-400 to-gray-500',
    glow: 'rgba(100, 116, 139, 0.3)',
    label: 'Tired',
  },
  flow: {
    icon: Sparkles,
    color: 'from-emerald-400 to-green-500',
    glow: 'rgba(52, 211, 153, 0.4)',
    label: 'In Flow',
  },
};

// Circadian icons
const CIRCADIAN_ICONS = {
  morning: Sunrise,
  workday: Sun,
  evening: Sunset,
  nightowl: Moon,
  latenight: Coffee,
};

export function SoulIndicator({ onClick, compact = false }) {
  const {
    currentState,
    stateConfidence,
    circadianPeriod,
    circadianInfo,
    enabled,
    suggestions,
    unacknowledgedInsights,
  } = useSoulStore();
  
  const [isHovered, setIsHovered] = useState(false);
  
  // Get state config
  const stateConfig = currentState ? STATE_CONFIG[currentState] : null;
  const StateIcon = stateConfig?.icon || Brain;
  const CircadianIcon = CIRCADIAN_ICONS[circadianPeriod] || Sun;
  
  // Don't show if disabled
  if (!enabled) {
    return null;
  }
  
  // Notification dot for suggestions/insights
  const hasNotifications = suggestions.length > 0 || unacknowledgedInsights > 0;
  
  return (
    <motion.button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 group"
      style={{
        background: isHovered 
          ? 'rgba(129, 140, 248, 0.1)' 
          : 'rgba(26, 26, 46, 0.5)',
        border: '1px solid',
        borderColor: isHovered 
          ? 'rgba(129, 140, 248, 0.3)' 
          : 'rgba(255, 255, 255, 0.05)',
      }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* State indicator dot */}
      <div 
        className={`soul-indicator ${currentState ? `soul-indicator-${currentState}` : ''}`}
        style={{
          boxShadow: stateConfig 
            ? `0 0 10px ${stateConfig.glow}, 0 0 20px ${stateConfig.glow}` 
            : '0 0 8px rgba(129, 140, 248, 0.3)',
        }}
      />
      
      {/* Main icon */}
      {!compact && (
        <div className="relative">
          <StateIcon 
            size={14} 
            className={`transition-colors ${
              currentState 
                ? `text-${currentState === 'focused' ? 'sky' : currentState === 'stressed' ? 'rose' : currentState === 'creative' ? 'violet' : currentState === 'exploratory' ? 'cyan' : currentState === 'flow' ? 'emerald' : 'slate'}-400`
                : 'text-text-muted'
            }`}
          />
        </div>
      )}
      
      {/* State label (on hover) */}
      <AnimatePresence>
        {isHovered && !compact && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="overflow-hidden whitespace-nowrap"
          >
            <span className="text-[11px] text-text-secondary">
              {stateConfig?.label || 'Ready'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Circadian indicator */}
      {!compact && (
        <div 
          className="flex items-center gap-1 pl-2 border-l border-forge-border/50"
          title={`${circadianInfo?.label || 'Unknown'}: ${circadianInfo?.tone || ''}`}
        >
          <CircadianIcon size={12} className="text-text-muted" />
        </div>
      )}
      
      {/* Notification dot */}
      {hasNotifications && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-workspace-nsfw"
          style={{
            boxShadow: '0 0 8px rgba(244, 114, 182, 0.6)',
          }}
        />
      )}
      
      {/* Hover tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 rounded-lg bg-forge-surface border border-forge-border shadow-depth z-50 whitespace-nowrap"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <StateIcon size={12} className="text-neural-pulse" />
                <span className="text-xs text-text-primary font-medium">
                  {stateConfig?.label || 'Analyzing...'}
                </span>
                {stateConfidence > 0 && (
                  <span className="text-[10px] text-text-muted">
                    {Math.round(stateConfidence * 100)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <CircadianIcon size={12} className="text-text-muted" />
                <span className="text-[11px] text-text-secondary">
                  {circadianInfo?.label}: {circadianInfo?.tone}
                </span>
              </div>
              {hasNotifications && (
                <div className="text-[10px] text-workspace-nsfw mt-1 pt-1 border-t border-forge-border/50">
                  {suggestions.length > 0 && `${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''}`}
                  {suggestions.length > 0 && unacknowledgedInsights > 0 && ' • '}
                  {unacknowledgedInsights > 0 && `${unacknowledgedInsights} new insight${unacknowledgedInsights > 1 ? 's' : ''}`}
                </div>
              )}
            </div>
            {/* Tooltip arrow */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-forge-surface border-l border-t border-forge-border rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * Proactive Suggestion Bubble
 */
export function ProactiveSuggestion({ suggestion, onAccept, onDismiss }) {
  if (!suggestion) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      className="proactive-bubble rounded-xl px-4 py-3 max-w-sm"
    >
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-[rgba(57,255,20,0.1)]">
          <Sparkles size={14} className="text-[#39ff14]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary leading-relaxed">
            {suggestion.message}
          </p>
          {suggestion.action && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => onAccept?.(suggestion)}
                className="px-2.5 py-1 rounded text-[11px] font-medium text-[#39ff14] bg-[rgba(57,255,20,0.15)] hover:bg-[rgba(57,255,20,0.25)] transition-colors"
              >
                {suggestion.actionLabel || 'Show me'}
              </button>
              <button
                onClick={() => onDismiss?.(suggestion.id)}
                className="px-2.5 py-1 rounded text-[11px] text-text-muted hover:text-text-secondary transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => onDismiss?.(suggestion.id)}
          className="text-text-muted hover:text-text-secondary transition-colors"
        >
          <span className="sr-only">Close</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Suggestion Container (positioned at bottom-right)
 */
export function SuggestionContainer() {
  const { suggestions, dismissSuggestion } = useSoulStore();
  const [activeSuggestion, setActiveSuggestion] = useState(null);
  
  // Show the most recent suggestion
  useEffect(() => {
    if (suggestions.length > 0) {
      setActiveSuggestion(suggestions[suggestions.length - 1]);
    } else {
      setActiveSuggestion(null);
    }
  }, [suggestions]);
  
  const handleAccept = (suggestion) => {
    // Execute the suggestion action
    if (suggestion.onAction) {
      suggestion.onAction();
    }
    dismissSuggestion(suggestion.id);
  };
  
  const handleDismiss = (id) => {
    dismissSuggestion(id);
    setActiveSuggestion(null);
  };
  
  return (
    <div className="fixed bottom-6 right-6 z-40">
      <AnimatePresence mode="wait">
        {activeSuggestion && (
          <ProactiveSuggestion
            key={activeSuggestion.id}
            suggestion={activeSuggestion}
            onAccept={handleAccept}
            onDismiss={handleDismiss}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default SoulIndicator;




