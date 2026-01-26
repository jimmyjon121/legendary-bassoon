import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Custom hook for gesture controls in the casual chat interface
 * Provides swipe, pinch, long press, and other touch/mouse gestures
 */
export function useGestures({ 
  onSwipeLeft, 
  onSwipeRight, 
  onSwipeUp, 
  onSwipeDown,
  onPinch,
  onLongPress,
  onDoubleClick,
  enabled = true 
}) {
  const elementRef = useRef(null);
  const [gestureState, setGestureState] = useState({
    isPressed: false,
    startPos: null,
    currentPos: null,
    startTime: null,
    lastTap: null,
  });

  const handleStart = useCallback((clientX, clientY) => {
    if (!enabled) return;
    
    setGestureState({
      isPressed: true,
      startPos: { x: clientX, y: clientY },
      currentPos: { x: clientX, y: clientY },
      startTime: Date.now(),
      lastTap: Date.now(),
    });
  }, [enabled]);

  const handleMove = useCallback((clientX, clientY) => {
    if (!enabled || !gestureState.isPressed) return;
    
    setGestureState(prev => ({
      ...prev,
      currentPos: { x: clientX, y: clientY },
    }));
  }, [enabled, gestureState.isPressed]);

  const handleEnd = useCallback(() => {
    if (!enabled || !gestureState.isPressed || !gestureState.startPos || !gestureState.currentPos) return;

    const deltaX = gestureState.currentPos.x - gestureState.startPos.x;
    const deltaY = gestureState.currentPos.y - gestureState.startPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const duration = Date.now() - gestureState.startTime;

    // Long press detection
    if (duration > 500 && distance < 10) {
      onLongPress?.({ x: gestureState.startPos.x, y: gestureState.startPos.y });
    }
    // Swipe detection
    else if (distance > 50 && duration < 500) {
      const angle = Math.atan2(deltaY, deltaX);
      const absAngle = Math.abs(angle);
      
      if (absAngle < Math.PI / 4) {
        // Right swipe
        onSwipeRight?.({ distance, duration, angle });
      } else if (absAngle > 3 * Math.PI / 4) {
        // Left swipe
        onSwipeLeft?.({ distance, duration, angle });
      } else if (angle > 0) {
        // Down swipe
        onSwipeDown?.({ distance, duration, angle });
      } else {
        // Up swipe
        onSwipeUp?.({ distance, duration, angle });
      }
    }
    // Double click detection
    else if (duration < 200 && distance < 10) {
      const timeSinceLastTap = Date.now() - (gestureState.lastTap || 0);
      if (timeSinceLastTap < 300) {
        onDoubleClick?.({ x: gestureState.startPos.x, y: gestureState.startPos.y });
      }
    }

    setGestureState({
      isPressed: false,
      startPos: null,
      currentPos: null,
      startTime: null,
      lastTap: Date.now(),
    });
  }, [enabled, gestureState, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onLongPress, onDoubleClick]);

  // Mouse events
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    const handleMouseDown = (e) => {
      handleStart(e.clientX, e.clientY);
    };

    const handleMouseMove = (e) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      handleEnd();
    };

    // Touch events
    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
      } else if (e.touches.length === 2 && onPinch) {
        // Pinch gesture start
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) + 
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );
        setGestureState(prev => ({ ...prev, initialPinchDistance: distance }));
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
      } else if (e.touches.length === 2 && onPinch && gestureState.initialPinchDistance) {
        // Pinch gesture
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.sqrt(
          Math.pow(touch2.clientX - touch1.clientX, 2) + 
          Math.pow(touch2.clientY - touch1.clientY, 2)
        );
        const scale = distance / gestureState.initialPinchDistance;
        onPinch({ scale, distance, initialDistance: gestureState.initialPinchDistance });
      }
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    // Add event listeners
    element.addEventListener('mousedown', handleMouseDown);
    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    
    // Global listeners for move and end events
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
      element.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleStart, handleMove, handleEnd, onPinch, gestureState.initialPinchDistance]);

  return {
    ref: elementRef,
    gestureState,
    isGesturing: gestureState.isPressed,
  };
}

/**
 * Hook for keyboard shortcuts and hotkeys
 */
export function useKeyboardShortcuts(shortcuts, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();
      const combo = [
        e.ctrlKey && 'ctrl',
        e.metaKey && 'cmd',
        e.altKey && 'alt',
        e.shiftKey && 'shift',
        key
      ].filter(Boolean).join('+');

      if (shortcuts[combo]) {
        e.preventDefault();
        shortcuts[combo](e);
      } else if (shortcuts[key]) {
        shortcuts[key](e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}

/**
 * Hook for smooth animations and micro-interactions
 */
export function useMicroInteractions() {
  const [interactions, setInteractions] = useState({
    hover: {},
    focus: {},
    active: {},
  });

  const registerHover = useCallback((id, element) => {
    setInteractions(prev => ({
      ...prev,
      hover: { ...prev.hover, [id]: element }
    }));
  }, []);

  const triggerHover = useCallback((id) => {
    const element = interactions.hover[id];
    if (element) {
      element.style.transform = 'scale(1.02)';
      element.style.transition = 'transform 0.2s ease';
      setTimeout(() => {
        element.style.transform = 'scale(1)';
      }, 200);
    }
  }, [interactions.hover]);

  const triggerSuccess = useCallback((id) => {
    const element = interactions.hover[id];
    if (element) {
      element.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.5)';
      element.style.transition = 'box-shadow 0.3s ease';
      setTimeout(() => {
        element.style.boxShadow = 'none';
      }, 600);
    }
  }, [interactions.hover]);

  const triggerError = useCallback((id) => {
    const element = interactions.hover[id];
    if (element) {
      element.style.animation = 'shake 0.3s ease-in-out';
      setTimeout(() => {
        element.style.animation = 'none';
      }, 300);
    }
  }, [interactions.hover]);

  return {
    registerHover,
    triggerHover,
    triggerSuccess,
    triggerError,
  };
}

export default useGestures;











