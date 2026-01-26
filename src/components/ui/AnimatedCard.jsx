import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';

export const AnimatedCard = ({
  children,
  className = '',
  tilt = true,
  glow = true,
  glowColor = '#818cf8',
  maxTilt = 10,
  scale = 1.02,
  perspective = 1000,
  onClick,
  ...props
}) => {
  const cardRef = useRef(null);
  const glowRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  
  useEffect(() => {
    if (!cardRef.current || !tilt) return;
    
    const card = cardRef.current;
    const glowEl = glowRef.current;
    
    const handleMouseMove = (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = ((y - centerY) / centerY) * -maxTilt;
      const rotateY = ((x - centerX) / centerX) * maxTilt;
      
      gsap.to(card, {
        rotateX,
        rotateY,
        scale,
        duration: 0.3,
        ease: 'power2.out',
        transformPerspective: perspective,
      });
      
      // Move glow to cursor position
      if (glowEl && glow) {
        gsap.to(glowEl, {
          x: x,
          y: y,
          opacity: 0.6,
          duration: 0.2,
        });
      }
    };
    
    const handleMouseEnter = () => {
      setIsHovered(true);
    };
    
    const handleMouseLeave = () => {
      setIsHovered(false);
      
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        scale: 1,
        duration: 0.5,
        ease: 'power2.out',
      });
      
      if (glowEl) {
        gsap.to(glowEl, {
          opacity: 0,
          duration: 0.3,
        });
      }
    };
    
    card.addEventListener('mousemove', handleMouseMove);
    card.addEventListener('mouseenter', handleMouseEnter);
    card.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      card.removeEventListener('mousemove', handleMouseMove);
      card.removeEventListener('mouseenter', handleMouseEnter);
      card.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [tilt, glow, maxTilt, scale, perspective]);
  
  return (
    <div
      ref={cardRef}
      onClick={onClick}
      className={`
        relative overflow-hidden
        bg-gradient-to-br from-white/5 to-white/2
        border border-white/10
        rounded-2xl
        transition-shadow duration-300
        ${isHovered ? 'shadow-xl' : 'shadow-lg'}
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
      style={{
        transformStyle: 'preserve-3d',
        boxShadow: isHovered && glow
          ? `0 20px 40px rgba(0,0,0,0.3), 0 0 30px ${glowColor}20`
          : '0 10px 30px rgba(0,0,0,0.2)',
      }}
      {...props}
    >
      {/* Glow follower */}
      {glow && (
        <div
          ref={glowRef}
          className="absolute w-64 h-64 rounded-full pointer-events-none opacity-0"
          style={{
            background: `radial-gradient(circle, ${glowColor}30, transparent 70%)`,
            transform: 'translate(-50%, -50%)',
            filter: 'blur(40px)',
          }}
        />
      )}
      
      {/* Content with 3D depth */}
      <div 
        className="relative z-10"
        style={{ transform: 'translateZ(20px)' }}
      >
        {children}
      </div>
      
      {/* Shine effect */}
      <div
        className="absolute inset-0 opacity-0 pointer-events-none"
        style={{
          background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.3s',
        }}
      />
    </div>
  );
};

/**
 * Animated feature card with icon
 */
export const FeatureCard = ({
  icon: Icon,
  title,
  description,
  color = '#818cf8',
  delay = 0,
  className = '',
}) => {
  const cardRef = useRef(null);
  
  useEffect(() => {
    if (!cardRef.current) return;
    
    gsap.from(cardRef.current, {
      opacity: 0,
      y: 30,
      duration: 0.6,
      delay,
      ease: 'power3.out',
    });
  }, [delay]);
  
  return (
    <AnimatedCard 
      ref={cardRef}
      glowColor={color} 
      className={`p-6 ${className}`}
    >
      {/* Icon */}
      <div 
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ 
          background: `linear-gradient(135deg, ${color}20, ${color}10)`,
          border: `1px solid ${color}30`,
        }}
      >
        {Icon && <Icon className="w-6 h-6" style={{ color }} />}
      </div>
      
      {/* Title */}
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      
      {/* Description */}
      <p className="text-sm text-white/60">{description}</p>
    </AnimatedCard>
  );
};

export default AnimatedCard;






