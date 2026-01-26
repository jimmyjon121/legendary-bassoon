import { useEffect, useRef, useCallback } from 'react';
import { gsap } from 'gsap';
import { 
  createMagneticEffect, 
  create3DTilt, 
  scrambleText,
  glitchText,
  neonFlicker 
} from '../utils/gsapAnimations';

/**
 * Hook for magnetic button effect
 */
export const useMagnetic = (strength = 0.3) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const cleanup = createMagneticEffect(ref.current, strength);
    return cleanup;
  }, [strength]);
  
  return ref;
};

/**
 * Hook for 3D tilt effect on cards
 */
export const use3DTilt = (options = {}) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const cleanup = create3DTilt(ref.current, options);
    return cleanup;
  }, []);
  
  return ref;
};

/**
 * Hook for text scramble reveal
 */
export const useScrambleText = (text, trigger = true) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current || !trigger) return;
    
    scrambleText(ref.current, text, { duration: 1.2 });
  }, [text, trigger]);
  
  return ref;
};

/**
 * Hook for glitch effect
 */
export const useGlitch = (trigger = false) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current || !trigger) return;
    
    glitchText(ref.current);
  }, [trigger]);
  
  const triggerGlitch = useCallback(() => {
    if (ref.current) {
      glitchText(ref.current);
    }
  }, []);
  
  return [ref, triggerGlitch];
};

/**
 * Hook for stagger animation on mount
 */
export const useStaggerIn = (options = {}) => {
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const children = containerRef.current.children;
    
    gsap.from(children, {
      opacity: 0,
      y: options.y || 30,
      duration: options.duration || 0.6,
      stagger: options.stagger || 0.08,
      ease: options.ease || 'power3.out',
      delay: options.delay || 0,
    });
  }, []);
  
  return containerRef;
};

/**
 * Hook for fade in animation
 */
export const useFadeIn = (options = {}) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current) return;
    
    gsap.from(ref.current, {
      opacity: 0,
      y: options.y || 20,
      duration: options.duration || 0.5,
      delay: options.delay || 0,
      ease: options.ease || 'power2.out',
    });
  }, []);
  
  return ref;
};

/**
 * Hook for hover animation
 */
export const useHoverAnimation = (hoverProps, normalProps = {}) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const element = ref.current;
    
    const handleMouseEnter = () => {
      gsap.to(element, {
        duration: 0.3,
        ease: 'power2.out',
        ...hoverProps,
      });
    };
    
    const handleMouseLeave = () => {
      gsap.to(element, {
        duration: 0.3,
        ease: 'power2.out',
        scale: 1,
        x: 0,
        y: 0,
        rotation: 0,
        ...normalProps,
      });
    };
    
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);
  
  return ref;
};

/**
 * Hook for neon flicker effect
 */
export const useNeonFlicker = (active = true, options = {}) => {
  const ref = useRef(null);
  const timelineRef = useRef(null);
  
  useEffect(() => {
    if (!ref.current || !active) return;
    
    timelineRef.current = neonFlicker(ref.current, options);
    
    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
      }
    };
  }, [active]);
  
  return ref;
};

/**
 * Hook for scroll-triggered animation
 */
export const useScrollAnimation = (animation, options = {}) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animation(entry.target);
            if (!options.repeat) {
              observer.unobserve(entry.target);
            }
          }
        });
      },
      { threshold: options.threshold || 0.1 }
    );
    
    observer.observe(ref.current);
    
    return () => observer.disconnect();
  }, []);
  
  return ref;
};

/**
 * Hook for continuous rotation
 */
export const useRotate = (duration = 2, active = true) => {
  const ref = useRef(null);
  const tweenRef = useRef(null);
  
  useEffect(() => {
    if (!ref.current || !active) return;
    
    tweenRef.current = gsap.to(ref.current, {
      rotation: 360,
      duration,
      repeat: -1,
      ease: 'none',
    });
    
    return () => {
      if (tweenRef.current) {
        tweenRef.current.kill();
      }
    };
  }, [duration, active]);
  
  return ref;
};

/**
 * Hook for pulse animation
 */
export const usePulse = (scale = 1.1, duration = 1, active = true) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!ref.current || !active) return;
    
    const tween = gsap.to(ref.current, {
      scale,
      duration: duration / 2,
      repeat: -1,
      yoyo: true,
      ease: 'power1.inOut',
    });
    
    return () => tween.kill();
  }, [scale, duration, active]);
  
  return ref;
};

/**
 * Hook for typewriter effect
 */
export const useTypewriter = (text, options = {}) => {
  const ref = useRef(null);
  const { speed = 50, startDelay = 0, cursor = true, onComplete } = options;
  
  useEffect(() => {
    if (!ref.current) return;
    
    const element = ref.current;
    element.textContent = '';
    
    if (cursor) {
      element.style.borderRight = '2px solid #818cf8';
      element.style.paddingRight = '2px';
    }
    
    let timeout;
    let i = 0;
    
    const type = () => {
      if (i < text.length) {
        element.textContent += text.charAt(i);
        i++;
        timeout = setTimeout(type, speed);
      } else {
        if (cursor) {
          element.style.animation = 'cursorBlink 0.7s infinite';
        }
        onComplete?.();
      }
    };
    
    const startTimeout = setTimeout(type, startDelay);
    
    return () => {
      clearTimeout(timeout);
      clearTimeout(startTimeout);
    };
  }, [text, speed, startDelay, cursor]);
  
  return ref;
};

// Add cursor blink animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes cursorBlink {
      0%, 100% { border-right-color: #818cf8; }
      50% { border-right-color: transparent; }
    }
  `;
  document.head.appendChild(style);
}

export default {
  useMagnetic,
  use3DTilt,
  useScrambleText,
  useGlitch,
  useStaggerIn,
  useFadeIn,
  useHoverAnimation,
  useNeonFlicker,
  useScrollAnimation,
  useRotate,
  usePulse,
  useTypewriter,
};






