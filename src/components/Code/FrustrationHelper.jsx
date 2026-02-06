/**
 * FrustrationHelper Component
 * 
 * Non-intrusive slide-in panel that appears when frustration is detected,
 * offering contextual help options.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getFrustrationDetector } from '../../services/frustrationDetector';

const FrustrationHelper = ({ onSuggestionSelect, onDismiss }) => {
  const [frustration, setFrustration] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);

  useEffect(() => {
    const detector = getFrustrationDetector();
    
    // Start monitoring
    detector.start();

    // Listen for frustration state changes
    const unsubscribe = detector.addListener((state) => {
      setFrustration(state);
      
      if (detector.shouldShowHelp()) {
        setIsVisible(true);
        setIsMinimized(false);
      } else if (state.dismissed) {
        setIsVisible(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSuggestionClick = useCallback((suggestion) => {
    setSelectedSuggestion(suggestion.id);
    
    if (suggestion.id === 'leave-alone') {
      // Dismiss and don't bother for a while
      const detector = getFrustrationDetector();
      detector.dismiss(true);
      setIsVisible(false);
      onDismiss?.();
    } else {
      // Notify parent of selected suggestion
      onSuggestionSelect?.(suggestion);
    }
  }, [onSuggestionSelect, onDismiss]);

  const handleDismiss = useCallback(() => {
    const detector = getFrustrationDetector();
    detector.dismiss(false);
    setIsVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  const handleMinimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const handleExpand = useCallback(() => {
    setIsMinimized(false);
  }, []);

  if (!isVisible || !frustration) {
    return null;
  }

  const summary = getFrustrationDetector().getSummary();
  if (!summary) return null;

  // Minimized view - just a small indicator
  if (isMinimized) {
    return (
      <div 
        className="fixed bottom-4 right-4 z-50 cursor-pointer"
        onClick={handleExpand}
      >
        <div className="bg-amber-500/90 backdrop-blur-sm rounded-full p-3 shadow-lg hover:bg-amber-500 transition-colors">
          <div className="flex items-center gap-2">
            <span className="text-xl">😤</span>
            <span className="text-white text-sm font-medium pr-2">
              Need help?
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Full panel view
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slide-in-right">
      <div className="bg-gray-900/95 backdrop-blur-sm rounded-lg shadow-2xl border border-gray-700 w-80 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">
              {summary.level === 'high' ? '😰' : summary.level === 'moderate' ? '😤' : '🤔'}
            </span>
            <span className="text-white font-medium">
              Looks like you might be stuck
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleMinimize}
              className="p-1 hover:bg-white/20 rounded transition-colors"
              title="Minimize"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
              </svg>
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-white/20 rounded transition-colors"
              title="Dismiss"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Detection info */}
        <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700">
          <p className="text-gray-400 text-sm">
            {summary.mainReason}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  summary.level === 'high' ? 'bg-red-500' :
                  summary.level === 'moderate' ? 'bg-amber-500' : 'bg-yellow-500'
                }`}
                style={{ width: `${summary.score}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">
              {summary.score}%
            </span>
          </div>
        </div>

        {/* Suggestions */}
        <div className="p-3 space-y-2">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">
            Would you like me to...
          </p>
          {frustration.suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => handleSuggestionClick(suggestion)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
                selectedSuggestion === suggestion.id
                  ? 'bg-blue-600 text-white'
                  : suggestion.id === 'leave-alone'
                  ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
              }`}
            >
              <span className="text-lg">{suggestion.icon}</span>
              <span className="text-sm">{suggestion.label}</span>
            </button>
          ))}
        </div>

        {/* Footer note */}
        <div className="px-4 py-2 bg-gray-800/30 border-t border-gray-700">
          <p className="text-gray-500 text-xs text-center">
            I noticed some patterns that suggest you might need help. 
            <br />No judgment - coding is hard! 💪
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

/**
 * Hook to use frustration detection in any component
 */
export function useFrustrationDetector() {
  const [state, setState] = useState(() => getFrustrationDetector().getFrustrationState());

  useEffect(() => {
    const detector = getFrustrationDetector();
    detector.start();
    
    const unsubscribe = detector.addListener(setState);
    return unsubscribe;
  }, []);

  return {
    ...state,
    detector: getFrustrationDetector(),
    shouldShowHelp: getFrustrationDetector().shouldShowHelp(),
    summary: getFrustrationDetector().getSummary()
  };
}

/**
 * Helper to record editor events for frustration detection
 */
export function recordEditorEvent(eventType, data) {
  const detector = getFrustrationDetector();
  
  switch (eventType) {
    case 'undo':
    case 'redo':
      detector.recordUndoRedo(eventType, data.filePath);
      break;
    case 'cursor':
      detector.recordCursorPosition(data.filePath, data.line, data.column);
      break;
    case 'delete':
      detector.recordDeletion(data.filePath, data.text, data.line);
      break;
    case 'error':
      detector.recordError(data.filePath, data.message, data.line);
      break;
    case 'fileOpen':
      detector.recordFileOpen(data.filePath);
      break;
    case 'edit':
      detector.recordFileActivity(data.filePath);
      break;
    default:
      break;
  }
}

export default FrustrationHelper;
