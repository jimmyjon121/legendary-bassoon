/**
 * Throttle function - limits how often a function can be called
 * @param {Function} fn - Function to throttle
 * @param {number} wait - Minimum time between calls in ms
 * @returns {Function} Throttled function
 */
export function throttle(fn, wait = 50) {
  let lastTime = 0;
  let timeoutId = null;
  let lastArgs = null;
  
  const throttled = (...args) => {
    const now = Date.now();
    lastArgs = args;
    
    if (now - lastTime >= wait) {
      lastTime = now;
      fn(...args);
    } else if (!timeoutId) {
      // Schedule a final call
      timeoutId = setTimeout(() => {
        lastTime = Date.now();
        timeoutId = null;
        if (lastArgs) {
          fn(...lastArgs);
        }
      }, wait - (now - lastTime));
    }
  };
  
  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  
  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      if (lastArgs) {
        fn(...lastArgs);
      }
    }
  };
  
  return throttled;
}

/**
 * Debounce function - delays execution until after wait period of inactivity
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Delay in ms
 * @returns {Function} Debounced function
 */
export function debounce(fn, wait = 100) {
  let timeoutId = null;
  
  const debounced = (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, wait);
  };
  
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  
  debounced.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      fn();
    }
  };
  
  return debounced;
}



