import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';

/**
 * Text that reveals character by character with GSAP
 */
export const TypewriterText = ({
  text,
  speed = 50,
  delay = 0,
  cursor = true,
  cursorColor = '#818cf8',
  className = '',
  onComplete,
}) => {
  const textRef = useRef(null);
  const [displayText, setDisplayText] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  
  useEffect(() => {
    if (!text) return;
    
    let i = 0;
    let timeout;
    
    const startTimeout = setTimeout(() => {
      const type = () => {
        if (i < text.length) {
          setDisplayText(text.substring(0, i + 1));
          i++;
          timeout = setTimeout(type, speed);
        } else {
          onComplete?.();
        }
      };
      type();
    }, delay);
    
    return () => {
      clearTimeout(startTimeout);
      clearTimeout(timeout);
    };
  }, [text, speed, delay]);
  
  // Cursor blink
  useEffect(() => {
    if (!cursor) return;
    const interval = setInterval(() => setShowCursor(v => !v), 530);
    return () => clearInterval(interval);
  }, [cursor]);
  
  return (
    <span className={`inline-block ${className}`}>
      {displayText}
      {cursor && (
        <span 
          className="inline-block w-[2px] h-[1em] ml-0.5 align-middle"
          style={{ 
            backgroundColor: showCursor ? cursorColor : 'transparent',
            transition: 'background-color 0.1s',
          }}
        />
      )}
    </span>
  );
};

/**
 * Text that scrambles then reveals
 */
export const ScrambleText = ({
  text,
  duration = 1.5,
  delay = 0,
  chars = '!<>-_\\/[]{}—=+*^?#________',
  className = '',
  onComplete,
}) => {
  const [displayText, setDisplayText] = useState('');
  
  useEffect(() => {
    if (!text) return;
    
    let frame = 0;
    const totalFrames = Math.floor(duration * 60);
    let animationId;
    
    const startTimeout = setTimeout(() => {
      const animate = () => {
        const progress = frame / totalFrames;
        let output = '';
        
        for (let i = 0; i < text.length; i++) {
          if (i < progress * text.length) {
            output += text[i];
          } else {
            output += chars[Math.floor(Math.random() * chars.length)];
          }
        }
        
        setDisplayText(output);
        frame++;
        
        if (frame <= totalFrames) {
          animationId = requestAnimationFrame(animate);
        } else {
          setDisplayText(text);
          onComplete?.();
        }
      };
      animate();
    }, delay);
    
    return () => {
      clearTimeout(startTimeout);
      cancelAnimationFrame(animationId);
    };
  }, [text, duration, delay, chars]);
  
  return <span className={className}>{displayText || '\u00A0'}</span>;
};

/**
 * Text with wave animation
 */
export const WaveText = ({
  text,
  waveHeight = 8,
  duration = 0.5,
  stagger = 0.05,
  className = '',
}) => {
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const chars = containerRef.current.querySelectorAll('.wave-char');
    
    gsap.to(chars, {
      y: -waveHeight,
      duration,
      stagger: {
        each: stagger,
        repeat: -1,
        yoyo: true,
      },
      ease: 'sine.inOut',
    });
  }, [text, waveHeight, duration, stagger]);
  
  return (
    <span ref={containerRef} className={`inline-flex ${className}`}>
      {text.split('').map((char, i) => (
        <span 
          key={`${char}-${i}`} 
          className="wave-char inline-block"
          style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  );
};

/**
 * Text with gradient animation
 */
export const GradientText = ({
  text,
  colors = ['#818cf8', '#c084fc', '#f472b6', '#818cf8'],
  duration = 3,
  className = '',
}) => {
  const textRef = useRef(null);
  
  useEffect(() => {
    if (!textRef.current) return;
    
    const gradient = colors.join(', ');
    textRef.current.style.backgroundImage = `linear-gradient(90deg, ${gradient})`;
    textRef.current.style.backgroundSize = '300% 100%';
    
    gsap.to(textRef.current, {
      backgroundPosition: '-200% 0',
      duration,
      repeat: -1,
      ease: 'none',
    });
  }, [colors, duration]);
  
  return (
    <span 
      ref={textRef}
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${colors.join(', ')})`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
      }}
    >
      {text}
    </span>
  );
};

/**
 * Text with neon glow effect
 */
export const NeonText = ({
  text,
  color = '#818cf8',
  flickerIntensity = 20,
  className = '',
}) => {
  const textRef = useRef(null);
  
  useEffect(() => {
    if (!textRef.current) return;
    
    const tl = gsap.timeline({ repeat: -1 });
    
    tl.to(textRef.current, {
      textShadow: `0 0 ${flickerIntensity}px ${color}, 0 0 ${flickerIntensity * 2}px ${color}`,
      duration: 0.1,
    })
    .to(textRef.current, {
      textShadow: `0 0 ${flickerIntensity / 2}px ${color}`,
      duration: 0.1,
    })
    .to(textRef.current, {
      textShadow: `0 0 ${flickerIntensity}px ${color}, 0 0 ${flickerIntensity * 2}px ${color}, 0 0 ${flickerIntensity * 3}px ${color}`,
      duration: 0.5,
    })
    .to(textRef.current, {
      textShadow: `0 0 ${flickerIntensity}px ${color}`,
      duration: 0.2,
    });
    
    return () => tl.kill();
  }, [color, flickerIntensity]);
  
  return (
    <span 
      ref={textRef}
      className={className}
      style={{ color }}
    >
      {text}
    </span>
  );
};

/**
 * Text with split/reveal animation
 */
export const SplitRevealText = ({
  text,
  duration = 0.8,
  stagger = 0.03,
  delay = 0,
  from = 'bottom', // 'bottom' | 'top' | 'left' | 'right'
  className = '',
  onComplete,
}) => {
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const chars = containerRef.current.querySelectorAll('.split-char');
    
    const directions = {
      bottom: { y: 40, x: 0 },
      top: { y: -40, x: 0 },
      left: { y: 0, x: -40 },
      right: { y: 0, x: 40 },
    };
    
    const dir = directions[from] || directions.bottom;
    
    gsap.from(chars, {
      opacity: 0,
      ...dir,
      duration,
      stagger,
      delay,
      ease: 'power3.out',
      onComplete,
    });
  }, [text, duration, stagger, delay, from]);
  
  return (
    <span ref={containerRef} className={`inline-flex flex-wrap ${className}`}>
      {text.split('').map((char, i) => (
        <span 
          key={`${char}-${i}`} 
          className="split-char inline-block"
          style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  );
};

/**
 * Counter animation
 */
export const AnimatedCounter = ({
  from = 0,
  to,
  duration = 2,
  delay = 0,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
  onComplete,
}) => {
  const counterRef = useRef(null);
  const valueRef = useRef({ value: from });
  
  useEffect(() => {
    if (!counterRef.current) return;
    
    gsap.to(valueRef.current, {
      value: to,
      duration,
      delay,
      ease: 'power2.out',
      onUpdate: () => {
        if (counterRef.current) {
          counterRef.current.textContent = 
            prefix + valueRef.current.value.toFixed(decimals) + suffix;
        }
      },
      onComplete,
    });
  }, [from, to, duration, delay, decimals, prefix, suffix]);
  
  return (
    <span ref={counterRef} className={className}>
      {prefix}{from.toFixed(decimals)}{suffix}
    </span>
  );
};

export default {
  TypewriterText,
  ScrambleText,
  WaveText,
  GradientText,
  NeonText,
  SplitRevealText,
  AnimatedCounter,
};






