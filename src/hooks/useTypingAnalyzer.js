/**
 * Typing Analyzer Hook
 * 
 * Tracks typing patterns to infer cognitive state:
 * - WPM (words per minute)
 * - Backspace ratio (corrections)
 * - Pause patterns (thinking gaps)
 * - Burst patterns (flow vs. stop-start)
 * 
 * Records typing_burst events to the Unified Ledger.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useSoulStore } from '../stores/soulStore';
import { isElectron, safeCall } from '../utils/electronAPI';

// Configuration
const CONFIG = {
  // Minimum characters before recording a burst
  MIN_BURST_CHARS: 20,
  // Time without typing to consider burst complete (ms)
  BURST_TIMEOUT: 3000,
  // Pause threshold (ms) - gaps longer than this count as pauses
  PAUSE_THRESHOLD: 1500,
  // Debounce for recording to ledger (ms)
  RECORD_DEBOUNCE: 5000,
};

/**
 * Calculate WPM from character count and duration
 */
function calculateWPM(charCount, durationMs) {
  if (durationMs < 1000) return 0;
  // Average word length ~5 chars
  const words = charCount / 5;
  const minutes = durationMs / 60000;
  return Math.round(words / minutes);
}

/**
 * Analyze typing patterns and infer signals
 */
function analyzePatterns(stats) {
  const signals = [];
  
  // High backspace ratio suggests uncertainty or stress
  if (stats.backspaceRatio > 0.3) {
    signals.push({ type: 'high_corrections', weight: 0.6, suggests: 'stressed' });
  }
  
  // Very low backspace ratio with high WPM suggests flow
  if (stats.backspaceRatio < 0.1 && stats.wpm > 50) {
    signals.push({ type: 'smooth_flow', weight: 0.7, suggests: 'flow' });
  }
  
  // Many pauses suggest thinking/exploration
  if (stats.pauseRatio > 0.4) {
    signals.push({ type: 'thoughtful_pauses', weight: 0.5, suggests: 'exploratory' });
  }
  
  // High WPM with few pauses suggests focused/flow state
  if (stats.wpm > 60 && stats.pauseRatio < 0.2) {
    signals.push({ type: 'rapid_focused', weight: 0.8, suggests: 'focused' });
  }
  
  // Low WPM with many corrections suggests fatigue
  if (stats.wpm < 20 && stats.backspaceRatio > 0.2) {
    signals.push({ type: 'slow_uncertain', weight: 0.4, suggests: 'tired' });
  }
  
  // Burst of creative typing (moderate speed, long bursts)
  if (stats.wpm > 35 && stats.wpm < 55 && stats.burstLength > 100) {
    signals.push({ type: 'creative_burst', weight: 0.5, suggests: 'creative' });
  }
  
  return signals;
}

/**
 * Main typing analyzer hook
 */
export function useTypingAnalyzer(workspace) {
  const statsRef = useRef({
    charCount: 0,
    backspaceCount: 0,
    pauseCount: 0,
    burstStart: null,
    lastKeyTime: null,
    keyTimes: [],
  });
  
  const recordTimeoutRef = useRef(null);
  const burstTimeoutRef = useRef(null);
  
  const { setState, enabled: soulEnabled } = useSoulStore();
  
  // Reset stats for a new burst
  const resetBurst = useCallback(() => {
    statsRef.current = {
      charCount: 0,
      backspaceCount: 0,
      pauseCount: 0,
      burstStart: null,
      lastKeyTime: null,
      keyTimes: [],
    };
  }, []);
  
  // Record burst to ledger and update soul state
  const recordBurst = useCallback(async () => {
    const stats = statsRef.current;
    
    if (stats.charCount < CONFIG.MIN_BURST_CHARS || !stats.burstStart) {
      resetBurst();
      return;
    }
    
    const duration = Date.now() - stats.burstStart;
    const wpm = calculateWPM(stats.charCount, duration);
    const backspaceRatio = stats.charCount > 0 
      ? stats.backspaceCount / stats.charCount 
      : 0;
    const pauseRatio = stats.keyTimes.length > 0 
      ? stats.pauseCount / stats.keyTimes.length 
      : 0;
    
    const burstStats = {
      wpm,
      backspaceRatio,
      pauseRatio,
      burstLength: stats.charCount,
      duration,
      pauseCount: stats.pauseCount,
    };
    
    // Analyze patterns
    const signals = analyzePatterns(burstStats);
    
    // Update soul state based on strongest signal
    if (signals.length > 0 && soulEnabled) {
      const strongest = signals.reduce((a, b) => a.weight > b.weight ? a : b);
      const confidence = Math.min(0.9, strongest.weight + (signals.length - 1) * 0.05);
      setState(strongest.suggests, confidence, signals);
    }
    
    // Record to ledger
    if (isElectron() && soulEnabled) {
      await safeCall('ledger:recordTypingBurst', [{
        workspace,
        wpm,
        backspaces: stats.backspaceCount,
        pauseCount: stats.pauseCount,
        duration,
        characterCount: stats.charCount,
      }], null);
    }
    
    resetBurst();
  }, [workspace, setState, soulEnabled, resetBurst]);
  
  // Handle keydown event
  const handleKeyDown = useCallback((e) => {
    if (!soulEnabled) return;
    
    const now = Date.now();
    const stats = statsRef.current;
    
    // Start new burst if needed
    if (!stats.burstStart) {
      stats.burstStart = now;
    }
    
    // Check for pause
    if (stats.lastKeyTime && (now - stats.lastKeyTime) > CONFIG.PAUSE_THRESHOLD) {
      stats.pauseCount++;
    }
    
    stats.lastKeyTime = now;
    stats.keyTimes.push(now);
    
    // Track backspaces
    if (e.key === 'Backspace') {
      stats.backspaceCount++;
    } else if (e.key.length === 1) {
      // Regular character
      stats.charCount++;
    }
    
    // Clear existing burst timeout
    if (burstTimeoutRef.current) {
      clearTimeout(burstTimeoutRef.current);
    }
    
    // Set new burst timeout
    burstTimeoutRef.current = setTimeout(() => {
      recordBurst();
    }, CONFIG.BURST_TIMEOUT);
    
    // Debounced ledger recording
    if (!recordTimeoutRef.current) {
      recordTimeoutRef.current = setTimeout(() => {
        recordTimeoutRef.current = null;
      }, CONFIG.RECORD_DEBOUNCE);
    }
  }, [soulEnabled, recordBurst]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (burstTimeoutRef.current) {
        clearTimeout(burstTimeoutRef.current);
      }
      if (recordTimeoutRef.current) {
        clearTimeout(recordTimeoutRef.current);
      }
    };
  }, []);
  
  // Get current stats (for debugging)
  const getCurrentStats = useCallback(() => {
    const stats = statsRef.current;
    if (!stats.burstStart) return null;
    
    const duration = Date.now() - stats.burstStart;
    return {
      charCount: stats.charCount,
      wpm: calculateWPM(stats.charCount, duration),
      backspaceRatio: stats.charCount > 0 
        ? stats.backspaceCount / stats.charCount 
        : 0,
      pauseCount: stats.pauseCount,
      duration,
    };
  }, []);
  
  return {
    handleKeyDown,
    resetBurst,
    recordBurst,
    getCurrentStats,
  };
}

/**
 * Simplified hook for input elements
 * Returns props to spread on an input/textarea
 */
export function useTypingAnalyzerProps(workspace) {
  const { handleKeyDown } = useTypingAnalyzer(workspace);
  
  return {
    onKeyDown: handleKeyDown,
  };
}

export default useTypingAnalyzer;




