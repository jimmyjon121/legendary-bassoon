import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { gsap } from 'gsap';

/**
 * Animation settings store
 * Controls performance and animation preferences
 */
export const useAnimationStore = create(
  persist(
    (set, get) => ({
      // Performance settings
      animationsEnabled: true,
      reducedMotion: false, // Follows system preference by default
      particlesEnabled: true,
      matrixRainEnabled: false, // Heavy - off by default
      magneticEnabled: true,
      glowEffectsEnabled: true,
      
      // Performance level: 'high' | 'medium' | 'low' | 'off'
      performanceLevel: 'high',
      
      // Detected system preference
      systemPrefersReducedMotion: false,
      
      // Initialize - detect system preferences
      initialize: () => {
        // Check for reduced motion preference
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const prefersReduced = mediaQuery.matches;
        
        set({ 
          systemPrefersReducedMotion: prefersReduced,
          reducedMotion: prefersReduced,
        });
        
        // Listen for changes
        mediaQuery.addEventListener('change', (e) => {
          set({ 
            systemPrefersReducedMotion: e.matches,
            reducedMotion: e.matches,
          });
        });
        
        // Configure GSAP for performance
        gsap.config({
          force3D: true, // Force GPU acceleration
          nullTargetWarn: false,
        });
        
        // Set GSAP defaults
        gsap.defaults({
          ease: 'power2.out',
          duration: 0.3,
        });
      },
      
      // Toggle all animations
      toggleAnimations: () => {
        const enabled = !get().animationsEnabled;
        set({ animationsEnabled: enabled });
        
        if (!enabled) {
          // Kill all running animations
          gsap.globalTimeline.pause();
        } else {
          gsap.globalTimeline.resume();
        }
      },
      
      // Set performance level
      setPerformanceLevel: (level) => {
        set({ performanceLevel: level });
        
        switch (level) {
          case 'high':
            set({
              animationsEnabled: true,
              particlesEnabled: true,
              magneticEnabled: true,
              glowEffectsEnabled: true,
              matrixRainEnabled: true,
            });
            break;
          case 'medium':
            set({
              animationsEnabled: true,
              particlesEnabled: true,
              magneticEnabled: true,
              glowEffectsEnabled: true,
              matrixRainEnabled: false,
            });
            break;
          case 'low':
            set({
              animationsEnabled: true,
              particlesEnabled: false,
              magneticEnabled: false,
              glowEffectsEnabled: true,
              matrixRainEnabled: false,
            });
            break;
          case 'off':
            set({
              animationsEnabled: false,
              particlesEnabled: false,
              magneticEnabled: false,
              glowEffectsEnabled: false,
              matrixRainEnabled: false,
            });
            gsap.globalTimeline.pause();
            break;
        }
      },
      
      // Individual toggles
      toggleParticles: () => set(s => ({ particlesEnabled: !s.particlesEnabled })),
      toggleMatrixRain: () => set(s => ({ matrixRainEnabled: !s.matrixRainEnabled })),
      toggleMagnetic: () => set(s => ({ magneticEnabled: !s.magneticEnabled })),
      toggleGlowEffects: () => set(s => ({ glowEffectsEnabled: !s.glowEffectsEnabled })),
      toggleReducedMotion: () => set(s => ({ reducedMotion: !s.reducedMotion })),
    }),
    {
      name: 'devforge-animations',
      partialize: (state) => ({
        performanceLevel: state.performanceLevel,
        animationsEnabled: state.animationsEnabled,
        particlesEnabled: state.particlesEnabled,
        matrixRainEnabled: state.matrixRainEnabled,
        magneticEnabled: state.magneticEnabled,
        glowEffectsEnabled: state.glowEffectsEnabled,
      }),
    }
  )
);

// Helper hook for checking if animations should run
export const useCanAnimate = () => {
  const { animationsEnabled, reducedMotion } = useAnimationStore();
  return animationsEnabled && !reducedMotion;
};

// Helper hook for specific features
export const useAnimationFeatures = () => {
  const store = useAnimationStore();
  const canAnimate = store.animationsEnabled && !store.reducedMotion;
  
  return {
    canAnimate,
    particles: canAnimate && store.particlesEnabled,
    matrixRain: canAnimate && store.matrixRainEnabled,
    magnetic: canAnimate && store.magneticEnabled,
    glow: canAnimate && store.glowEffectsEnabled,
  };
};






