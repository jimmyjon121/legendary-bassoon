import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { Loader2 } from 'lucide-react';
import { particleExplosion } from '../../utils/gsapAnimations';

const variants = {
  primary: {
    bg: 'bg-gradient-to-r from-indigo-500 to-purple-500',
    text: 'text-white',
    glow: '#818cf8',
    particles: ['#818cf8', '#a78bfa', '#c084fc', '#e879f9'],
  },
  success: {
    bg: 'bg-gradient-to-r from-emerald-500 to-teal-500',
    text: 'text-white',
    glow: '#10b981',
    particles: ['#10b981', '#14b8a6', '#22d3ee', '#6ee7b7'],
  },
  danger: {
    bg: 'bg-gradient-to-r from-red-500 to-rose-500',
    text: 'text-white',
    glow: '#ef4444',
    particles: ['#ef4444', '#f43f5e', '#fb7185', '#fda4af'],
  },
  cyber: {
    bg: 'bg-black border-2 border-cyan-400',
    text: 'text-cyan-400',
    glow: '#22d3ee',
    particles: ['#22d3ee', '#06b6d4', '#67e8f9', '#a5f3fc'],
  },
  ghost: {
    bg: 'bg-transparent border border-white/20',
    text: 'text-white/80',
    glow: 'rgba(255,255,255,0.3)',
    particles: ['#ffffff', '#e5e7eb', '#d1d5db'],
  },
};

export const MagneticButton = ({
  children,
  variant = 'primary',
  icon: Icon,
  loading = false,
  disabled = false,
  magnetic = true,
  particles = true,
  glow = true,
  size = 'md',
  className = '',
  onClick,
  ...props
}) => {
  const buttonRef = useRef(null);
  const textRef = useRef(null);
  const glowRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  
  const style = variants[variant] || variants.primary;
  
  const sizes = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg',
    xl: 'px-10 py-5 text-xl',
  };
  
  useEffect(() => {
    if (!buttonRef.current || !magnetic || disabled) return;
    
    const button = buttonRef.current;
    const text = textRef.current;
    const glowEl = glowRef.current;
    
    const handleMouseMove = (e) => {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      
      // Magnetic pull effect
      gsap.to(button, {
        x: x * 0.3,
        y: y * 0.3,
        duration: 0.3,
        ease: 'power2.out',
      });
      
      // Text follows cursor more aggressively
      if (text) {
        gsap.to(text, {
          x: x * 0.4,
          y: y * 0.4,
          duration: 0.3,
          ease: 'power2.out',
        });
      }
      
      // Glow follows cursor
      if (glowEl && glow) {
        gsap.to(glowEl, {
          x: x * 0.5 + rect.width / 2,
          y: y * 0.5 + rect.height / 2,
          duration: 0.3,
          ease: 'power2.out',
        });
      }
    };
    
    const handleMouseEnter = () => {
      setIsHovered(true);
      gsap.to(button, {
        scale: 1.05,
        duration: 0.3,
        ease: 'power2.out',
      });
    };
    
    const handleMouseLeave = () => {
      setIsHovered(false);
      gsap.to(button, {
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.5,
        ease: 'elastic.out(1, 0.3)',
      });
      
      if (text) {
        gsap.to(text, {
          x: 0,
          y: 0,
          duration: 0.5,
          ease: 'elastic.out(1, 0.3)',
        });
      }
      
      if (glowEl) {
        gsap.to(glowEl, {
          x: button.offsetWidth / 2,
          y: button.offsetHeight / 2,
          duration: 0.3,
        });
      }
    };
    
    button.addEventListener('mousemove', handleMouseMove);
    button.addEventListener('mouseenter', handleMouseEnter);
    button.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      button.removeEventListener('mousemove', handleMouseMove);
      button.removeEventListener('mouseenter', handleMouseEnter);
      button.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [magnetic, disabled, glow]);
  
  const handleClick = (e) => {
    if (disabled || loading) return;
    
    // Particle explosion on click
    if (particles && buttonRef.current) {
      particleExplosion(buttonRef.current, {
        count: 20,
        colors: style.particles,
        radius: 100,
      });
    }
    
    // Click animation
    gsap.to(buttonRef.current, {
      scale: 0.95,
      duration: 0.1,
      yoyo: true,
      repeat: 1,
      ease: 'power2.inOut',
    });
    
    onClick?.(e);
  };
  
  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      disabled={disabled || loading}
      className={`
        relative inline-flex items-center justify-center gap-2
        ${style.bg} ${style.text}
        ${sizes[size]}
        rounded-xl font-medium
        overflow-hidden
        transition-shadow duration-300
        disabled:opacity-50 disabled:cursor-not-allowed
        ${isHovered && glow ? `shadow-lg shadow-[${style.glow}]/40` : ''}
        ${className}
      `}
      style={{
        boxShadow: isHovered && glow ? `0 0 30px ${style.glow}40` : 'none',
      }}
      {...props}
    >
      {/* Glow orb that follows cursor */}
      {glow && (
        <div
          ref={glowRef}
          className="absolute w-32 h-32 rounded-full pointer-events-none opacity-30 blur-xl"
          style={{
            background: `radial-gradient(circle, ${style.glow}, transparent 70%)`,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
      
      {/* Content */}
      <span ref={textRef} className="relative z-10 flex items-center gap-2">
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : Icon ? (
          <Icon className="w-5 h-5" />
        ) : null}
        {children}
      </span>
      
      {/* Shine effect */}
      <div
        className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500"
        style={{
          background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%)',
          transform: 'translateX(-100%)',
          animation: isHovered ? 'shine 0.8s forwards' : 'none',
        }}
      />
    </button>
  );
};

// Add shine animation
if (typeof document !== 'undefined') {
  const existingStyle = document.getElementById('magnetic-button-styles');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'magnetic-button-styles';
    style.textContent = `
      @keyframes shine {
        to { transform: translateX(100%); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default MagneticButton;






