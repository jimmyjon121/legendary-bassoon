/**
 * FlowStateIndicator Component
 * 
 * Status bar indicator showing current flow state and queued notifications.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getFlowStateMonitor } from '../../services/flowStateMonitor';

const FlowStateIndicator = ({ onNotificationClick, position = 'bottom-left' }) => {
  const [flowState, setFlowState] = useState(null);
  const [showQueue, setShowQueue] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const monitor = getFlowStateMonitor();
    monitor.start();

    // Initial state
    setFlowState(monitor.getFlowState());
    setNotifications(monitor.getPendingNotifications());

    // Listen for changes
    const unsubscribe = monitor.addListener((state) => {
      setFlowState(state);
      setNotifications(monitor.getPendingNotifications());
    });

    return () => unsubscribe();
  }, []);

  const handleDismissNotification = useCallback((notificationId) => {
    const monitor = getFlowStateMonitor();
    monitor.clearNotification(notificationId);
    setNotifications(monitor.getPendingNotifications());
  }, []);

  const handleNotificationAction = useCallback((notification) => {
    handleDismissNotification(notification.id);
    onNotificationClick?.(notification);
  }, [onNotificationClick, handleDismissNotification]);

  if (!flowState) return null;

  const stats = getFlowStateMonitor().getStatistics();
  const { isInFlow, flowDepth, currentLevel, duration } = flowState;

  // Position classes
  const positionClasses = {
    'bottom-left': 'fixed bottom-4 left-4',
    'bottom-right': 'fixed bottom-4 right-4',
    'top-left': 'fixed top-4 left-4',
    'top-right': 'fixed top-4 right-4',
    'inline': 'relative'
  };

  // Format duration
  const formatDuration = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  // Get flow level styling
  const getLevelStyle = () => {
    if (!isInFlow) return { bg: 'bg-gray-700', text: 'text-gray-400', glow: '' };
    
    switch (currentLevel) {
      case 'deep':
        return { 
          bg: 'bg-purple-600', 
          text: 'text-purple-200', 
          glow: 'shadow-purple-500/50 shadow-lg',
          icon: '🔮'
        };
      case 'moderate':
        return { 
          bg: 'bg-blue-600', 
          text: 'text-blue-200', 
          glow: 'shadow-blue-500/30 shadow-md',
          icon: '⚡'
        };
      case 'shallow':
        return { 
          bg: 'bg-green-600', 
          text: 'text-green-200', 
          glow: 'shadow-green-500/20',
          icon: '🌊'
        };
      default:
        return { 
          bg: 'bg-teal-600', 
          text: 'text-teal-200', 
          glow: '',
          icon: '💧'
        };
    }
  };

  const style = getLevelStyle();

  return (
    <div className={`${positionClasses[position]} z-40`}>
      {/* Main indicator */}
      <div 
        className={`${style.bg} ${style.glow} rounded-lg backdrop-blur-sm transition-all duration-500`}
        onClick={() => isInFlow && setShowQueue(!showQueue)}
      >
        <div className="px-3 py-2 flex items-center gap-3 cursor-pointer">
          {/* Flow icon */}
          <div className="relative">
            {isInFlow ? (
              <span className="text-lg">{style.icon}</span>
            ) : (
              <span className="text-lg opacity-50">💤</span>
            )}
            {/* Pulsing indicator when in deep flow */}
            {currentLevel === 'deep' && (
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-purple-300 rounded-full animate-pulse" />
            )}
          </div>

          {/* Flow info */}
          <div className="flex flex-col">
            <span className={`text-sm font-medium ${style.text}`}>
              {isInFlow ? (
                <>
                  {currentLevel ? currentLevel.charAt(0).toUpperCase() + currentLevel.slice(1) : 'Building'} Flow
                </>
              ) : (
                'Ready'
              )}
            </span>
            {isInFlow && (
              <span className="text-xs text-white/60">
                {formatDuration(duration)} • {Math.round(flowDepth * 100)}% depth
              </span>
            )}
          </div>

          {/* Queued notifications badge */}
          {notifications.length > 0 && (
            <div className="relative ml-2">
              <div className="bg-amber-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {notifications.length}
              </div>
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-amber-400 rounded-full animate-ping" />
            </div>
          )}

          {/* Flow depth bar */}
          {isInFlow && (
            <div className="w-16 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-white/70 rounded-full transition-all duration-1000"
                style={{ width: `${flowDepth * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Notification queue dropdown */}
      {showQueue && notifications.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-gray-900 rounded-lg shadow-xl border border-gray-700 overflow-hidden">
          <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
            <span className="text-sm font-medium text-gray-300">
              Queued for after flow ({notifications.length})
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.map((notification) => (
              <div 
                key={notification.id}
                className="px-3 py-2 border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm text-gray-200">{notification.title}</p>
                    {notification.message && (
                      <p className="text-xs text-gray-400 mt-0.5">{notification.message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {notification.action && (
                      <button
                        onClick={() => handleNotificationAction(notification)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        View
                      </button>
                    )}
                    <button
                      onClick={() => handleDismissNotification(notification.id)}
                      className="p-1 text-gray-500 hover:text-gray-300"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's stats (shown on hover when not in queue view) */}
      {!showQueue && isInFlow && (
        <div className="absolute bottom-full left-0 mb-2 opacity-0 hover:opacity-100 transition-opacity">
          <div className="bg-gray-900/95 rounded-lg px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
            Today: {stats.todaySessions} sessions • {stats.totalFlowTimeFormatted} total flow time
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
        .animate-ping {
          animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
};

/**
 * Hook to use flow state monitoring in components
 */
export function useFlowState() {
  const [state, setState] = useState(() => getFlowStateMonitor().getFlowState());

  useEffect(() => {
    const monitor = getFlowStateMonitor();
    monitor.start();
    
    const unsubscribe = monitor.addListener(setState);
    return unsubscribe;
  }, []);

  return {
    ...state,
    monitor: getFlowStateMonitor(),
    statistics: getFlowStateMonitor().getStatistics(),
    queueNotification: (notification) => getFlowStateMonitor().queueNotification(notification),
    shouldDelay: (actionType) => getFlowStateMonitor().shouldDelayAction(actionType)
  };
}

/**
 * Hook for AI components to adjust behavior based on flow state
 */
export function useAIFlowAwareness() {
  const { isInFlow, aiIntensity, shouldDelay } = useFlowState();

  return {
    isInFlow,
    intensity: aiIntensity,
    shouldShowSuggestions: aiIntensity === 'normal',
    shouldShowTips: aiIntensity === 'normal',
    shouldDelay,
    
    // Helper to wrap actions that respect flow state
    withFlowAwareness: (callback, actionType = 'suggestion') => {
      if (shouldDelay(actionType)) {
        return () => {
          getFlowStateMonitor().queueNotification({
            type: actionType,
            title: 'AI Suggestion',
            message: 'Available after your flow session',
            action: callback
          });
        };
      }
      return callback;
    }
  };
}

export default FlowStateIndicator;
