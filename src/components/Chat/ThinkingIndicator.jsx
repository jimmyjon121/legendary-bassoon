import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Zap, Clock, Sparkles, Loader2 } from 'lucide-react';
import { useInterval } from '../../hooks/useInterval';

export function ThinkingIndicator() {
  const { isGenerating, generationMetadata, currentModel, streamingContent } = useAppStore((state) => ({
    isGenerating: state.isGenerating,
    generationMetadata: state.generationMetadata,
    currentModel: state.currentModel,
    streamingContent: state.streamingContent,
  }));

  const [elapsedTime, setElapsedTime] = useState(0);
  const [thinkingPhrase, setThinkingPhrase] = useState(0);

  // Thinking phrases that cycle through
  const thinkingPhrases = useMemo(() => [
    'Analyzing your request...',
    'Processing context...',
    'Formulating response...',
    'Generating ideas...',
    'Crafting reply...',
    'Almost there...',
  ], []);

  // Reset elapsed time when generation stops
  useEffect(() => {
    if (!isGenerating) {
      setElapsedTime(0);
    }
  }, [isGenerating]);

  // Update elapsed time - using safe interval hook (500ms instead of 100ms for less CPU)
  const startTime = generationMetadata?.startedAt || Date.now();
  useInterval(
    useCallback(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, [startTime]),
    isGenerating ? 500 : null // null disables the interval
  );

  // Cycle through thinking phrases - using safe interval hook
  useInterval(
    useCallback(() => {
      setThinkingPhrase((prev) => (prev + 1) % thinkingPhrases.length);
    }, [thinkingPhrases.length]),
    isGenerating ? 3000 : null // null disables the interval
  );

  if (!isGenerating) return null;

  const stage = generationMetadata?.stage || 'preparing';
  const tokens = generationMetadata?.tokensEstimated || 0;
  const tps = generationMetadata?.tokensPerSecond || 0;
  const chars = generationMetadata?.chars || 0;

  // Calculate progress - indeterminate at first, then based on tokens
  const hasStartedGenerating = tokens > 0 || chars > 0;
  
  // Format elapsed time
  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Determine the current status
  const getStatusInfo = () => {
    if (stage === 'preparing' && !hasStartedGenerating) {
      return {
        icon: Brain,
        label: thinkingPhrases[thinkingPhrase],
        color: 'text-workspace-code',
        pulse: true,
      };
    }
    if (stage === 'generating' || hasStartedGenerating) {
      return {
        icon: Sparkles,
        label: 'Generating response...',
        color: 'text-emerald-400',
        pulse: false,
      };
    }
    return {
      icon: Loader2,
      label: 'Processing...',
      color: 'text-text-muted',
      pulse: true,
    };
  };

  const status = getStatusInfo();
  const StatusIcon = status.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        className="max-w-3xl mx-auto mb-3"
      >
        <div className="px-4 py-3 rounded-xl bg-forge-surface/90 border border-forge-border/60 backdrop-blur-sm shadow-lg">
          {/* Main status row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-forge-bg/80 ${status.pulse ? 'animate-pulse' : ''}`}>
                <StatusIcon size={18} className={`${status.color} ${status.icon === Loader2 ? 'animate-spin' : ''}`} />
              </div>
              <div>
                <motion.p 
                  key={status.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm font-medium text-text-primary"
                >
                  {status.label}
                </motion.p>
                <p className="text-[11px] text-text-muted">
                  Using {currentModel || 'model'}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-[11px]">
              {/* Elapsed time */}
              <div className="flex items-center gap-1.5 text-text-muted">
                <Clock size={12} />
                <span>{formatTime(elapsedTime)}</span>
              </div>

              {/* Tokens */}
              {tokens > 0 && (
                <div className="flex items-center gap-1.5 text-text-muted">
                  <span className="text-text-primary font-medium">~{tokens}</span>
                  <span>tokens</span>
                </div>
              )}

              {/* Speed */}
              {tps > 0 && (
                <div className="flex items-center gap-1.5">
                  <Zap size={12} className="text-workspace-code" />
                  <span className="text-workspace-code font-medium">{tps}</span>
                  <span className="text-text-muted">tok/s</span>
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 w-full rounded-full bg-forge-bg overflow-hidden">
            {hasStartedGenerating ? (
              <motion.div
                className="h-full bg-gradient-to-r from-workspace-code to-emerald-400 rounded-full"
                initial={{ width: '5%' }}
                animate={{ 
                  width: `${Math.min(95, Math.max(5, (tokens / 500) * 100))}%`,
                }}
                transition={{ type: 'spring', stiffness: 100, damping: 20 }}
              />
            ) : (
              <motion.div
                className="h-full bg-workspace-code/60 rounded-full"
                initial={{ x: '-100%', width: '30%' }}
                animate={{ x: '400%' }}
                transition={{ 
                  repeat: 9999, 
                  duration: 1.5, 
                  ease: 'easeInOut',
                }}
              />
            )}
          </div>

          {/* Character count when generating */}
          {hasStartedGenerating && chars > 0 && (
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-2 text-[10px] text-text-muted text-right"
            >
              {chars.toLocaleString()} characters generated
            </motion.p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default ThinkingIndicator;
