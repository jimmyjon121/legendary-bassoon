import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Cpu, Sliders, Sparkles, CheckCircle, Loader2, FileCode, Zap, X } from 'lucide-react';
import { useModelExperience, OPTIMIZATION_STAGES } from '../../services/modelExperience';

// Map stage IDs to display info
const STAGE_CONFIG = {
  idle: { label: 'Idle', icon: Brain, order: -1 },
  detecting: { label: 'Detecting model family', icon: Brain, order: 0 },
  template: { label: 'Configuring chat template', icon: FileCode, order: 1 },
  analyzing: { label: 'Analyzing capabilities', icon: Cpu, order: 2 },
  optimizing: { label: 'Optimizing parameters', icon: Sliders, order: 3 },
  ready: { label: 'Model optimized!', icon: Sparkles, order: 4 },
};

const ORDERED_STAGES = ['detecting', 'template', 'analyzing', 'optimizing', 'ready'];

export function ModelOptimizingToast() {
  const { 
    isLoading, 
    profile, 
    modelFamily, 
    primaryStrength,
    currentStage,
    stageHistory,
    lastOptimizationDuration,
  } = useModelExperience();
  
  // DISABLED: Toast was too annoying - always showing up
  // The MAEE still works in the background, just no popup
  const [show, setShow] = useState(false);
  const [displayStage, setDisplayStage] = useState('idle');
  const hideTimerRef = useRef(null);
  
  // Track if we've ever shown the toast this entire session
  const hasShownOnce = useRef(false);

  // Only show ONCE per app session, on first model load
  useEffect(() => {
    // Never show if we've already shown once
    if (hasShownOnce.current) {
      return;
    }
    
    // Never show for cached profiles
    if (profile?.fromCache) {
      return;
    }
    
    // Only show when stage moves to 'ready' for the first time
    if (currentStage === 'ready' && !hasShownOnce.current) {
      hasShownOnce.current = true;
      setShow(true);
      setDisplayStage('ready');
      
      // Auto-hide after 2 seconds
      hideTimerRef.current = setTimeout(() => {
        setShow(false);
      }, 2000);
    }
    
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [currentStage, profile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const isComplete = displayStage === 'ready' || (!isLoading && profile);
  const currentOrder = STAGE_CONFIG[displayStage]?.order ?? -1;

  const handleClose = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    setShow(false);
    useModelExperience.getState().setOptimizationStage?.('idle');
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden min-w-[340px]">
            {/* Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-accent-primary/20 to-purple-500/20 border-b border-forge-border">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: isComplete ? 0 : 360 }}
                  transition={{ duration: 2, repeat: isComplete ? 0 : Infinity, ease: 'linear' }}
                >
                  <Brain size={18} className="text-accent-primary" />
                </motion.div>
                <span className="text-sm font-medium text-text-primary">
                  Model Experience Engine
                </span>
                {isComplete && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="ml-auto flex items-center gap-1"
                  >
                    <CheckCircle size={16} className="text-green-400" />
                    {lastOptimizationDuration && (
                      <span className="text-[10px] text-text-muted">
                        {(lastOptimizationDuration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </motion.span>
                )}
                {isComplete && (
                  <button
                    onClick={handleClose}
                    className="ml-2 p-1 rounded hover:bg-forge-hover text-text-muted hover:text-text-primary transition-colors"
                    title="Close"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Steps */}
            <div className="p-4 space-y-2">
              {ORDERED_STAGES.map((stageId, index) => {
                const config = STAGE_CONFIG[stageId];
                const isActive = displayStage === stageId && !isComplete;
                const isStageComplete = currentOrder > config.order || isComplete;
                const Icon = config.icon;

                return (
                  <motion.div
                    key={stageId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ 
                      opacity: isStageComplete || isActive ? 1 : 0.4,
                      x: 0 
                    }}
                    transition={{ delay: index * 0.05 }}
                    className={`flex items-center gap-3 py-1 ${
                      isActive ? 'text-accent-primary' : isStageComplete ? 'text-green-400' : 'text-text-muted'
                    }`}
                  >
                    <div className="w-5 h-5 flex items-center justify-center">
                      {isActive ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : isStageComplete ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', damping: 10 }}
                        >
                          <CheckCircle size={16} />
                        </motion.div>
                      ) : (
                        <Icon size={16} />
                      )}
                    </div>
                    <span className="text-xs">{config.label}</span>
                  </motion.div>
                );
              })}
            </div>

            {/* Optimization Summary */}
            <AnimatePresence>
              {isComplete && profile && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-forge-border overflow-hidden"
                >
                  <div className="px-4 py-3 bg-forge-bg/50 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-muted">Family</span>
                      <span className="text-text-primary font-medium capitalize">{modelFamily}</span>
                    </div>
                    {profile.template?.detected && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Template</span>
                        <span className="text-purple-400 font-medium capitalize">{profile.template.detected}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-muted">Strength</span>
                      <span className="text-text-primary font-medium capitalize">
                        {primaryStrength?.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-muted">Temperature</span>
                      <span className="text-accent-primary font-mono">
                        {profile.inference?.temperature?.toFixed(2) || '0.40'}
                      </span>
                    </div>
                    {profile.template?.needsManualFormat && (
                      <div className="flex items-center gap-1 text-[10px] text-yellow-400/80 mt-1">
                        <Zap size={10} />
                        <span>Manual template formatting applied</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ModelOptimizingToast;
