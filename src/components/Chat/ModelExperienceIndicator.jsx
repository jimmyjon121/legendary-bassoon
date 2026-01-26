/**
 * Model Experience Indicator
 * 
 * Shows the current model's capabilities and how the app is adapting to it.
 * Makes the "magic" visible so users understand what's happening.
 */

import React, { useState } from 'react';
import { 
  Brain, 
  Code, 
  MessageCircle, 
  Sparkles, 
  Lightbulb,
  Zap,
  ChevronDown,
  ChevronUp,
  Target,
  Settings2,
  Palette
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useModelExperience, useModelAwareness } from '../../services/modelExperience';

// Icon mapping for capabilities
const CAPABILITY_ICONS = {
  codeGeneration: Code,
  codeFix: Code,
  codeExplanation: Code,
  generalChat: MessageCircle,
  creative: Palette,
  reasoning: Lightbulb,
  roleplay: Sparkles,
};

// Labels for capabilities
const CAPABILITY_LABELS = {
  codeGeneration: 'Code Writing',
  codeFix: 'Bug Fixing',
  codeExplanation: 'Code Explanation',
  generalChat: 'Conversation',
  creative: 'Creative Writing',
  reasoning: 'Analytical',
  roleplay: 'Roleplay',
};

// Colors for capability levels
const LEVEL_COLORS = {
  excellent: 'bg-green-500',
  good: 'bg-emerald-500',
  moderate: 'bg-yellow-500',
  limited: 'bg-orange-500',
  minimal: 'bg-red-500',
};

const LEVEL_TEXT_COLORS = {
  excellent: 'text-green-400',
  good: 'text-emerald-400',
  moderate: 'text-yellow-400',
  limited: 'text-orange-400',
  minimal: 'text-red-400',
};

/**
 * Capability Bar - Visual representation of a single capability
 */
function CapabilityBar({ name, value, label }) {
  const percentage = Math.round(value * 100);
  const level = value >= 0.9 ? 'excellent' 
              : value >= 0.7 ? 'good' 
              : value >= 0.5 ? 'moderate' 
              : value >= 0.3 ? 'limited' 
              : 'minimal';
  
  const Icon = CAPABILITY_ICONS[name] || Target;
  
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="text-text-muted flex-shrink-0" />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] text-text-secondary">{label}</span>
          <span className={`text-[10px] ${LEVEL_TEXT_COLORS[level]}`}>{percentage}%</span>
        </div>
        <div className="h-1 bg-forge-border rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={`h-full rounded-full ${LEVEL_COLORS[level]}`}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Model Family Badge - Shows what kind of model this is
 */
function ModelFamilyBadge({ family, primaryStrength }) {
  const familyConfig = {
    code: { icon: Code, label: 'Code Expert', color: 'text-blue-400 bg-blue-500/20 border-blue-500/30' },
    chat: { icon: MessageCircle, label: 'Conversational', color: 'text-green-400 bg-green-500/20 border-green-500/30' },
    creative: { icon: Palette, label: 'Creative', color: 'text-purple-400 bg-purple-500/20 border-purple-500/30' },
    reasoning: { icon: Lightbulb, label: 'Analytical', color: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' },
    compact: { icon: Zap, label: 'Fast & Light', color: 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30' },
    flagship: { icon: Brain, label: 'Full Power', color: 'text-rose-400 bg-rose-500/20 border-rose-500/30' },
  };

  const config = familyConfig[family] || familyConfig.chat;
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border ${config.color}`}>
      <Icon size={12} />
      <span className="text-[10px] font-medium">{config.label}</span>
    </div>
  );
}

/**
 * Optimization Status - Shows what's been optimized
 */
function OptimizationStatus({ suggestions, uiConfig }) {
  const optimizations = [];

  if (uiConfig.showCodeActions) {
    optimizations.push({ icon: Code, label: 'Code tools enabled' });
  }
  if (uiConfig.syntaxHighlightChat) {
    optimizations.push({ icon: Palette, label: 'Syntax highlighting' });
  }
  if (uiConfig.enableCharacterMode) {
    optimizations.push({ icon: Sparkles, label: 'Character mode ready' });
  }
  if (uiConfig.compactMode) {
    optimizations.push({ icon: Zap, label: 'Fast mode' });
  }
  if (uiConfig.showThinkingProcess) {
    optimizations.push({ icon: Lightbulb, label: 'Thinking visible' });
  }

  if (optimizations.length === 0) {
    optimizations.push({ icon: Settings2, label: 'Balanced configuration' });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {optimizations.slice(0, 3).map((opt, i) => {
        const Icon = opt.icon;
        return (
          <div 
            key={i}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-forge-bg/60 rounded text-[9px] text-text-muted"
          >
            <Icon size={10} />
            <span>{opt.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Main Model Experience Indicator Component
 */
export function ModelExperienceIndicator({ compact = false }) {
  const [expanded, setExpanded] = useState(false);
  const {
    profile,
    modelFamily,
    primaryStrength,
    capabilities,
    uiConfig,
    suggestions,
    isLoading,
    getStatusText,
  } = useModelExperience();

  const { isModelLoaded } = useModelAwareness();

  if (!isModelLoaded && !isLoading) {
    return null;
  }

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-2"
      >
        <ModelFamilyBadge family={modelFamily} primaryStrength={primaryStrength} />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-forge-surface/80 border border-forge-border/50 rounded-lg backdrop-blur-sm overflow-hidden"
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-forge-hover/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-workspace-casual" />
          <span className="text-xs font-medium text-text-primary">
            {isLoading ? 'Analyzing model...' : getStatusText()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ModelFamilyBadge family={modelFamily} primaryStrength={primaryStrength} />
          {expanded ? (
            <ChevronUp size={14} className="text-text-muted" />
          ) : (
            <ChevronDown size={14} className="text-text-muted" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-forge-border/30 space-y-3">
              {/* Capabilities */}
              <div>
                <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-2">
                  Capabilities
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(capabilities).map(([name, value]) => (
                    <CapabilityBar
                      key={name}
                      name={name}
                      value={value}
                      label={CAPABILITY_LABELS[name] || name}
                    />
                  ))}
                </div>
              </div>

              {/* Active Optimizations */}
              <div>
                <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-2">
                  Active Optimizations
                </h4>
                <OptimizationStatus suggestions={suggestions} uiConfig={uiConfig} />
              </div>

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wide mb-2">
                    Suggestions
                  </h4>
                  <div className="space-y-1.5">
                    {suggestions.slice(0, 2).map((suggestion, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 p-2 bg-workspace-casual/10 border border-workspace-casual/20 rounded text-[10px]"
                      >
                        <Target size={12} className="text-workspace-casual flex-shrink-0 mt-0.5" />
                        <span className="text-text-secondary">{suggestion.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Info Footer */}
              {profile?.model && (
                <div className="pt-2 border-t border-forge-border/20 flex items-center justify-between text-[9px] text-text-muted">
                  <span>{profile.model.filename}</span>
                  {profile.model.parametersB && (
                    <span>{profile.model.parametersB}B parameters</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Inline Model Status - Minimal version for chat header
 */
export function ModelStatusInline() {
  const { isModelLoaded, modelFamily, primaryStrength } = useModelAwareness();

  if (!isModelLoaded) return null;

  return (
    <ModelFamilyBadge family={modelFamily} primaryStrength={primaryStrength} />
  );
}

/**
 * Model Capability Quick Check - For conditional UI rendering
 */
export function ModelCapabilityGate({ 
  capability, 
  threshold = 'good', 
  children, 
  fallback = null 
}) {
  const { getCapabilityLevel } = useModelAwareness();
  const level = getCapabilityLevel(capability);
  
  const thresholdOrder = ['minimal', 'limited', 'moderate', 'good', 'excellent'];
  const currentIndex = thresholdOrder.indexOf(level);
  const thresholdIndex = thresholdOrder.indexOf(threshold);
  
  if (currentIndex >= thresholdIndex) {
    return children;
  }
  
  return fallback;
}

export default ModelExperienceIndicator;












