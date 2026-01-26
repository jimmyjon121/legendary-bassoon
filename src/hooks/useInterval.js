/**
 * Safe Timer Hooks
 * 
 * These hooks properly clean up timers to prevent memory leaks.
 * Use these instead of raw setTimeout/setInterval in React components.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * useInterval - Safe setInterval that cleans up automatically
 * 
 * @param {Function} callback - Function to call on each interval
 * @param {number|null} delay - Interval in ms, or null to pause
 * 
 * @example
 * // Poll every 5 seconds
 * useInterval(() => fetchData(), 5000);
 * 
 * // Pause polling when not visible
 * useInterval(() => fetchData(), isVisible ? 5000 : null);
 */
export function useInterval(callback, delay) {
  const savedCallback = useRef(callback);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval
  useEffect(() => {
    if (delay === null || delay === undefined) return;

    const tick = () => savedCallback.current();
    const id = setInterval(tick, delay);

    return () => clearInterval(id);
  }, [delay]);
}

/**
 * useTimeout - Safe setTimeout that cleans up automatically
 * 
 * @param {Function} callback - Function to call after delay
 * @param {number|null} delay - Delay in ms, or null to cancel
 * 
 * @example
 * // Show toast for 3 seconds
 * useTimeout(() => setShowToast(false), showToast ? 3000 : null);
 */
export function useTimeout(callback, delay) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null || delay === undefined) return;

    const id = setTimeout(() => savedCallback.current(), delay);

    return () => clearTimeout(id);
  }, [delay]);
}

/**
 * useDebounce - Debounce a value
 * 
 * @param {any} value - Value to debounce
 * @param {number} delay - Debounce delay in ms
 * @returns {any} Debounced value
 * 
 * @example
 * const debouncedSearch = useDebounce(searchTerm, 300);
 */
export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useThrottle - Throttle a callback
 * 
 * @param {Function} callback - Function to throttle
 * @param {number} delay - Throttle delay in ms
 * @returns {Function} Throttled function
 * 
 * @example
 * const throttledScroll = useThrottle(handleScroll, 100);
 */
export function useThrottle(callback, delay) {
  const lastRan = useRef(Date.now());
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  return useCallback((...args) => {
    const now = Date.now();
    if (now - lastRan.current >= delay) {
      lastRan.current = now;
      savedCallback.current(...args);
    }
  }, [delay]);
}

/**
 * useAnimationFrame - Safe requestAnimationFrame hook
 * 
 * @param {Function} callback - Called on each animation frame
 * @param {boolean} active - Whether animation is active
 * 
 * @example
 * useAnimationFrame((deltaTime) => {
 *   // Animate something
 * }, isAnimating);
 */
export function useAnimationFrame(callback, active = true) {
  const requestRef = useRef();
  const previousTimeRef = useRef();
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;

    const animate = (time) => {
      if (previousTimeRef.current !== undefined) {
        const deltaTime = time - previousTimeRef.current;
        savedCallback.current(deltaTime);
      }
      previousTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [active]);
}

export default {
  useInterval,
  useTimeout,
  useDebounce,
  useThrottle,
  useAnimationFrame,
};

