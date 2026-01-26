import React from 'react';
import { motion } from 'framer-motion';
import { 
  Sparkles, 
  Zap, 
  Gauge, 
  Eye, 
  EyeOff,
  Cpu,
  Wand2,
  Grid3X3,
  Waves
} from 'lucide-react';
import { useAnimationStore, useAnimationFeatures } from '../../stores/animationStore';

const ToggleSwitch = ({ enabled, onChange, label, description, icon: Icon }) => (
  <div className="flex items-center justify-between p-4 rounded-xl bg-white/3 hover:bg-white/5 transition-colors">
    <div className="flex items-center gap-3">
      {Icon && (
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center
          ${enabled ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/5 text-white/30'}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div>
        <div className="font-medium text-white/90">{label}</div>
        {description && (
          <div className="text-sm text-white/40">{description}</div>
        )}
      </div>
    </div>
    <motion.button
      onClick={onChange}
      className={`relative w-12 h-7 rounded-full transition-colors
        ${enabled ? 'bg-indigo-500' : 'bg-white/10'}`}
      whileTap={{ scale: 0.95 }}
    >
      <motion.div
        className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-lg"
        animate={{ x: enabled ? 24 : 4 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </motion.button>
  </div>
);

const PerformanceLevel = ({ level, currentLevel, onClick, label, description }) => (
  <motion.button
    onClick={onClick}
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    className={`flex-1 p-4 rounded-xl border transition-all text-left
      ${currentLevel === level 
        ? 'bg-indigo-500/20 border-indigo-500/40' 
        : 'bg-white/3 border-white/10 hover:border-white/20'
      }`}
  >
    <div className={`font-medium ${currentLevel === level ? 'text-indigo-400' : 'text-white/70'}`}>
      {label}
    </div>
    <div className="text-xs text-white/40 mt-1">{description}</div>
  </motion.button>
);

export const AnimationSettings = () => {
  const {
    animationsEnabled,
    particlesEnabled,
    matrixRainEnabled,
    magneticEnabled,
    glowEffectsEnabled,
    reducedMotion,
    performanceLevel,
    toggleAnimations,
    toggleParticles,
    toggleMatrixRain,
    toggleMagnetic,
    toggleGlowEffects,
    toggleReducedMotion,
    setPerformanceLevel,
  } = useAnimationStore();
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 
                      flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white">Animation Settings</h3>
          <p className="text-sm text-white/40">
            GSAP-powered animations and visual effects
          </p>
        </div>
      </div>
      
      {/* Performance Level Presets */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="w-4 h-4 text-white/50" />
          <span className="text-sm font-medium text-white/70">Performance Level</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <PerformanceLevel
            level="high"
            currentLevel={performanceLevel}
            onClick={() => setPerformanceLevel('high')}
            label="High"
            description="All effects enabled"
          />
          <PerformanceLevel
            level="medium"
            currentLevel={performanceLevel}
            onClick={() => setPerformanceLevel('medium')}
            label="Medium"
            description="Core effects only"
          />
          <PerformanceLevel
            level="low"
            currentLevel={performanceLevel}
            onClick={() => setPerformanceLevel('low')}
            label="Low"
            description="Minimal animations"
          />
          <PerformanceLevel
            level="off"
            currentLevel={performanceLevel}
            onClick={() => setPerformanceLevel('off')}
            label="Off"
            description="Disable all"
          />
        </div>
      </div>
      
      {/* Individual Toggles */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-white/70 mb-3">Individual Controls</div>
        
        <ToggleSwitch
          enabled={animationsEnabled}
          onChange={toggleAnimations}
          icon={Zap}
          label="Master Animations"
          description="Enable/disable all animations"
        />
        
        <ToggleSwitch
          enabled={!reducedMotion}
          onChange={toggleReducedMotion}
          icon={reducedMotion ? EyeOff : Eye}
          label="Motion Effects"
          description={reducedMotion ? "Reduced motion mode (accessibility)" : "Full motion effects"}
        />
        
        <ToggleSwitch
          enabled={particlesEnabled}
          onChange={toggleParticles}
          icon={Sparkles}
          label="Particle Effects"
          description="Button click particles and floating elements"
        />
        
        <ToggleSwitch
          enabled={magneticEnabled}
          onChange={toggleMagnetic}
          icon={Wand2}
          label="Magnetic Effects"
          description="Buttons and cards react to cursor"
        />
        
        <ToggleSwitch
          enabled={glowEffectsEnabled}
          onChange={toggleGlowEffects}
          icon={Cpu}
          label="Glow Effects"
          description="Neon glows and light effects"
        />
        
        <ToggleSwitch
          enabled={matrixRainEnabled}
          onChange={toggleMatrixRain}
          icon={Grid3X3}
          label="Matrix Rain"
          description="Canvas-based matrix rain background (GPU intensive)"
        />
      </div>
      
      {/* Performance Note */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <div className="flex items-start gap-3">
          <Gauge className="w-5 h-5 text-amber-400 mt-0.5" />
          <div>
            <div className="font-medium text-amber-400">Performance Tip</div>
            <div className="text-sm text-white/60 mt-1">
              GSAP uses GPU acceleration for smooth 60fps animations. 
              If you notice performance issues, try lowering the performance level 
              or disabling specific effects like Matrix Rain.
            </div>
          </div>
        </div>
      </div>
      
      {/* Demo Link */}
      <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Waves className="w-5 h-5 text-indigo-400" />
            <div>
              <div className="font-medium text-white/90">Animation Showcase</div>
              <div className="text-sm text-white/40">
                Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs">Ctrl+Shift+A</kbd> to view demo
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnimationSettings;






