import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, 
  Zap, 
  Rocket, 
  Brain, 
  Code2, 
  Cpu,
  X,
  Play,
  Settings,
  Gauge
} from 'lucide-react';

// Import our custom components
import { MagneticButton } from '../ui/MagneticButton';
import { AnimatedCard, FeatureCard } from '../ui/AnimatedCard';
import { 
  TypewriterText, 
  ScrambleText, 
  WaveText, 
  GradientText, 
  NeonText,
  SplitRevealText,
  AnimatedCounter 
} from '../ui/AnimatedText';
import { 
  MatrixRain, 
  ParticleField, 
  GradientMesh, 
  Aurora,
  Scanlines 
} from '../ui/AnimatedBackgrounds';
import { useAnimationStore, useAnimationFeatures } from '../../stores/animationStore';

// Register ScrollTrigger
gsap.registerPlugin(ScrollTrigger);

const Section = ({ title, children, className = '' }) => (
  <div className={`mb-16 ${className}`}>
    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
      <div className="w-1 h-8 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full" />
      {title}
    </h2>
    {children}
  </div>
);

export const AnimationShowcase = ({ onClose }) => {
  const containerRef = useRef(null);
  const heroRef = useRef(null);
  const features = useAnimationFeatures();
  const { performanceLevel, setPerformanceLevel } = useAnimationStore();
  const [activeBackground, setActiveBackground] = useState('particles');
  const [scrambleKey, setScrambleKey] = useState(0);
  
  // ScrollTrigger animations
  useEffect(() => {
    if (!containerRef.current) return;
    
    const sections = containerRef.current.querySelectorAll('.scroll-section');
    
    sections.forEach((section) => {
      gsap.from(section, {
        scrollTrigger: {
          trigger: section,
          start: 'top 80%',
          end: 'top 20%',
          toggleActions: 'play none none reverse',
        },
        opacity: 0,
        y: 60,
        duration: 0.8,
        ease: 'power3.out',
      });
    });
    
    // Parallax hero
    if (heroRef.current) {
      gsap.to(heroRef.current, {
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
        y: 100,
        opacity: 0.5,
      });
    }
    
    return () => {
      ScrollTrigger.getAll().forEach(t => t.kill());
    };
  }, []);
  
  const backgrounds = {
    particles: <ParticleField count={60} color="#818cf8" opacity={0.4} />,
    matrix: <MatrixRain color="#00ff41" opacity={0.2} />,
    gradient: <GradientMesh colors={['#818cf8', '#c084fc', '#f472b6', '#22d3ee']} />,
    aurora: <Aurora colors={['#818cf8', '#22d3ee', '#c084fc']} opacity={0.4} />,
  };
  
  return (
    <div className="fixed inset-0 z-50 bg-[#030308] overflow-hidden">
      {/* Close button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={onClose}
        className="fixed top-6 right-6 z-50 p-3 rounded-xl bg-white/10 
                   border border-white/20 backdrop-blur-sm
                   hover:bg-white/20 transition-colors"
      >
        <X className="w-5 h-5 text-white" />
      </motion.button>
      
      {/* Performance controls */}
      <div className="fixed top-6 left-6 z-50 flex items-center gap-3">
        <div className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 
                       backdrop-blur-sm flex items-center gap-3">
          <Gauge className="w-4 h-4 text-indigo-400" />
          <select
            value={performanceLevel}
            onChange={(e) => setPerformanceLevel(e.target.value)}
            className="bg-transparent text-white text-sm outline-none cursor-pointer"
          >
            <option value="high" className="bg-zinc-900">High Performance</option>
            <option value="medium" className="bg-zinc-900">Medium</option>
            <option value="low" className="bg-zinc-900">Low</option>
            <option value="off" className="bg-zinc-900">Animations Off</option>
          </select>
        </div>
      </div>
      
      {/* Background selector */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 
                     flex items-center gap-2 px-4 py-2 rounded-xl 
                     bg-white/10 border border-white/20 backdrop-blur-sm">
        <span className="text-xs text-white/50 mr-2">Background:</span>
        {Object.keys(backgrounds).map((bg) => (
          <button
            key={bg}
            onClick={() => setActiveBackground(bg)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${activeBackground === bg 
                ? 'bg-indigo-500 text-white' 
                : 'text-white/50 hover:text-white hover:bg-white/10'
              }`}
          >
            {bg.charAt(0).toUpperCase() + bg.slice(1)}
          </button>
        ))}
      </div>
      
      {/* Dynamic background */}
      <div className="fixed inset-0 z-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeBackground}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0"
          >
            {features.canAnimate && backgrounds[activeBackground]}
          </motion.div>
        </AnimatePresence>
        <Scanlines opacity={0.03} />
      </div>
      
      {/* Content */}
      <div 
        ref={containerRef}
        className="relative z-10 h-full overflow-y-auto px-8 py-20"
      >
        {/* Hero Section */}
        <div ref={heroRef} className="min-h-screen flex items-center justify-center">
          <div className="text-center max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h1 className="text-6xl font-bold mb-6">
                <GradientText 
                  text="GSAP Animation Engine" 
                  colors={['#818cf8', '#c084fc', '#f472b6', '#22d3ee', '#818cf8']}
                  duration={4}
                />
              </h1>
              
              <div className="text-xl text-white/60 mb-8 h-8">
                <ScrambleText 
                  key={scrambleKey}
                  text="Professional-grade animations for DevForge" 
                  duration={1.5}
                />
              </div>
              
              <div className="flex items-center justify-center gap-4">
                <MagneticButton 
                  variant="primary" 
                  icon={Play}
                  onClick={() => setScrambleKey(k => k + 1)}
                >
                  Replay Scramble
                </MagneticButton>
                <MagneticButton variant="cyber" icon={Sparkles}>
                  Cyber Mode
                </MagneticButton>
                <MagneticButton variant="ghost" icon={Settings}>
                  Settings
                </MagneticButton>
              </div>
            </motion.div>
          </div>
        </div>
        
        {/* Text Animations Section */}
        <Section title="Text Animations" className="scroll-section max-w-4xl mx-auto">
          <div className="grid gap-8">
            {/* Typewriter */}
            <AnimatedCard className="p-6">
              <h3 className="text-sm text-indigo-400 mb-3">Typewriter Effect</h3>
              <div className="text-2xl text-white font-mono">
                <TypewriterText 
                  text="Hello, I am typing this character by character..." 
                  speed={40}
                />
              </div>
            </AnimatedCard>
            
            {/* Wave Text */}
            <AnimatedCard className="p-6">
              <h3 className="text-sm text-indigo-400 mb-3">Wave Text</h3>
              <div className="text-3xl font-bold">
                <WaveText text="Bouncing Wave Effect" waveHeight={10} />
              </div>
            </AnimatedCard>
            
            {/* Neon Text */}
            <AnimatedCard className="p-6" glowColor="#22d3ee">
              <h3 className="text-sm text-cyan-400 mb-3">Neon Flicker</h3>
              <div className="text-4xl font-bold">
                <NeonText text="NEON LIGHTS" color="#22d3ee" />
              </div>
            </AnimatedCard>
            
            {/* Split Reveal */}
            <AnimatedCard className="p-6" glowColor="#10b981">
              <h3 className="text-sm text-emerald-400 mb-3">Split Reveal</h3>
              <div className="text-3xl font-bold text-white">
                <SplitRevealText text="Characters Reveal One By One" stagger={0.05} />
              </div>
            </AnimatedCard>
            
            {/* Counter */}
            <AnimatedCard className="p-6" glowColor="#f59e0b">
              <h3 className="text-sm text-amber-400 mb-3">Animated Counter</h3>
              <div className="text-5xl font-bold text-white">
                <AnimatedCounter from={0} to={99.99} duration={3} decimals={2} suffix="%" />
              </div>
            </AnimatedCard>
          </div>
        </Section>
        
        {/* Buttons Section */}
        <Section title="Magnetic Buttons" className="scroll-section max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="flex flex-col items-center gap-3">
              <MagneticButton variant="primary" icon={Rocket}>
                Primary
              </MagneticButton>
              <span className="text-xs text-white/40">With particles</span>
            </div>
            
            <div className="flex flex-col items-center gap-3">
              <MagneticButton variant="success" icon={Zap}>
                Success
              </MagneticButton>
              <span className="text-xs text-white/40">Green variant</span>
            </div>
            
            <div className="flex flex-col items-center gap-3">
              <MagneticButton variant="danger" icon={X}>
                Danger
              </MagneticButton>
              <span className="text-xs text-white/40">Red variant</span>
            </div>
            
            <div className="flex flex-col items-center gap-3">
              <MagneticButton variant="cyber" icon={Cpu}>
                Cyber
              </MagneticButton>
              <span className="text-xs text-white/40">Cyberpunk style</span>
            </div>
          </div>
          
          <div className="mt-8 flex justify-center gap-4">
            <MagneticButton variant="primary" size="sm">Small</MagneticButton>
            <MagneticButton variant="primary" size="md">Medium</MagneticButton>
            <MagneticButton variant="primary" size="lg">Large</MagneticButton>
            <MagneticButton variant="primary" size="xl">Extra Large</MagneticButton>
          </div>
        </Section>
        
        {/* Cards Section */}
        <Section title="3D Tilt Cards" className="scroll-section max-w-4xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={Brain}
              title="AI Powered"
              description="Intelligent features that adapt to your workflow and preferences."
              color="#818cf8"
              delay={0}
            />
            <FeatureCard
              icon={Code2}
              title="Code First"
              description="Built for developers who love clean, efficient code."
              color="#f59e0b"
              delay={0.1}
            />
            <FeatureCard
              icon={Sparkles}
              title="Beautiful UI"
              description="Stunning visuals with GSAP-powered animations."
              color="#ec4899"
              delay={0.2}
            />
          </div>
        </Section>
        
        {/* Stats Section with ScrollTrigger */}
        <Section title="Scroll-Triggered Stats" className="scroll-section max-w-4xl mx-auto">
          <div className="grid grid-cols-4 gap-6">
            {[
              { label: 'Animations', value: 50, suffix: '+' },
              { label: 'FPS', value: 60, suffix: '' },
              { label: 'Bundle Size', value: 45, suffix: 'KB' },
              { label: 'Performance', value: 100, suffix: '%' },
            ].map((stat, i) => (
              <AnimatedCard key={stat.label} className="p-6 text-center">
                <div className="text-3xl font-bold text-white mb-2">
                  <AnimatedCounter 
                    from={0} 
                    to={stat.value} 
                    duration={2} 
                    suffix={stat.suffix}
                    delay={i * 0.2}
                  />
                </div>
                <div className="text-sm text-white/50">{stat.label}</div>
              </AnimatedCard>
            ))}
          </div>
        </Section>
        
        {/* Footer */}
        <div className="text-center py-20 scroll-section">
          <p className="text-white/40 text-sm">
            All animations powered by{' '}
            <span className="text-indigo-400">GSAP</span> +{' '}
            <span className="text-purple-400">Framer Motion</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AnimationShowcase;






