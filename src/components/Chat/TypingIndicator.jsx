import React, { useState, useCallback, useMemo } from 'react';
import { Bot, Clock, Zap, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { useInterval } from '../../hooks/useInterval';

export function TypingIndicator() {
  const { generationMetadata, currentModel, streamingContent } = useAppStore((state) => ({
    generationMetadata: state.generationMetadata,
    currentModel: state.currentModel,
    streamingContent: state.streamingContent,
  }));

  const [elapsedTime, setElapsedTime] = useState(0);
  const [thinkingPhrase, setThinkingPhrase] = useState(0);

  const thinkingPhrases = useMemo(() => [
    'Analyzing...',
    'Processing...',
    'Thinking...',
    'Formulating...',
  ], []);

  // Update elapsed time - using safe interval hook (updates every 500ms instead of 100ms for less CPU)
  const startTime = generationMetadata?.startedAt || Date.now();
  useInterval(
    useCallback(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, [startTime]),
    500
  );

  // Cycle thinking phrases - using safe interval hook
  useInterval(
    useCallback(() => {
      setThinkingPhrase((prev) => (prev + 1) % thinkingPhrases.length);
    }, [thinkingPhrases.length]),
    2000
  );

  const stage = generationMetadata?.stage || 'preparing';
  const tokens = generationMetadata?.tokensEstimated || 0;
  const tps = generationMetadata?.tokensPerSecond || 0;
  const chars = generationMetadata?.chars || 0;
  const hasStartedGenerating = tokens > 0 || chars > 0;

  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3"
    >
      {/* Bot Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-forge-elevated border border-forge-border flex items-center justify-center">
        <Bot size={16} className="text-text-secondary" />
      </div>

      {/* Message bubble with progress info */}
      <div className="message-assistant rounded-2xl rounded-tl-sm px-4 py-3 min-w-[280px] max-w-md">
        {/* Status row */}
        <div className="flex items-center gap-2 mb-2">
          {hasStartedGenerating ? (
            <Sparkles size={14} className="text-emerald-400" />
          ) : (
            <div className="flex items-center gap-1">
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-workspace-code" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-workspace-code" />
              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-workspace-code" />
            </div>
          )}
          <motion.span 
            key={hasStartedGenerating ? 'generating' : thinkingPhrase}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-text-primary"
          >
            {hasStartedGenerating ? 'Generating response...' : thinkingPhrases[thinkingPhrase]}
          </motion.span>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full rounded-full bg-forge-bg/60 overflow-hidden mb-2">
          {hasStartedGenerating ? (
            <motion.div
              className="h-full bg-gradient-to-r from-workspace-code to-emerald-400 rounded-full"
              initial={{ width: '5%' }}
              animate={{ width: `${Math.min(95, Math.max(5, (tokens / 400) * 100))}%` }}
              transition={{ type: 'spring', stiffness: 100, damping: 20 }}
            />
          ) : (
            <motion.div
              className="h-full bg-workspace-code/70 rounded-full"
              style={{ width: '25%' }}
              animate={{ x: ['0%', '300%', '0%'] }}
              transition={{ repeat: 9999, duration: 1.8, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          {/* Model */}
          <span className="truncate max-w-[100px]" title={currentModel}>
            {currentModel || 'model'}
          </span>
          
          <span className="text-forge-border">•</span>
          
          {/* Time */}
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {formatTime(elapsedTime)}
          </span>

          {/* Tokens - only show when generating */}
          {tokens > 0 && (
            <>
              <span className="text-forge-border">•</span>
              <span>~{tokens} tok</span>
            </>
          )}

          {/* Speed - only show when generating */}
          {tps > 0 && (
            <>
              <span className="text-forge-border">•</span>
              <span className="flex items-center gap-1 text-workspace-code">
                <Zap size={10} />
                {tps} tok/s
              </span>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
