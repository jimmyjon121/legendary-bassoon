import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';

/**
 * Matrix rain effect background
 */
export const MatrixRain = ({
  color = '#00ff41',
  fontSize = 14,
  speed = 50,
  density = 1,
  opacity = 0.3,
  className = '',
}) => {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    
    resize();
    window.addEventListener('resize', resize);
    
    const columns = Math.floor((canvas.offsetWidth / fontSize) * density);
    const drops = Array(columns).fill(1);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()アイウエオカキクケコサシスセソ';
    
    let animationId;
    
    const draw = () => {
      ctx.fillStyle = `rgba(0, 0, 0, 0.05)`;
      ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      
      ctx.fillStyle = color;
      ctx.font = `${fontSize}px monospace`;
      
      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * (fontSize / density);
        const y = drops[i] * fontSize;
        
        // Fade effect based on position
        const fadeOpacity = Math.min(1, drops[i] / 20);
        ctx.globalAlpha = fadeOpacity;
        
        ctx.fillText(char, x, y);
        
        if (y > canvas.offsetHeight && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      
      ctx.globalAlpha = 1;
      animationId = setTimeout(() => requestAnimationFrame(draw), speed);
    };
    
    draw();
    
    return () => {
      window.removeEventListener('resize', resize);
      clearTimeout(animationId);
    };
  }, [color, fontSize, speed, density]);
  
  return (
    <canvas 
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ opacity }}
    />
  );
};

/**
 * Floating particles background
 */
export const ParticleField = ({
  count = 50,
  color = '#818cf8',
  maxSize = 4,
  speed = 1,
  connected = true,
  connectionDistance = 150,
  opacity = 0.5,
  className = '',
}) => {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    
    resize();
    window.addEventListener('resize', resize);
    
    // Create particles
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      size: Math.random() * maxSize + 1,
      speedX: (Math.random() - 0.5) * speed,
      speedY: (Math.random() - 0.5) * speed,
      opacity: Math.random() * 0.5 + 0.5,
    }));
    
    let animationId;
    
    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      
      // Draw connections
      if (connected) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < connectionDistance) {
              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.globalAlpha = (1 - distance / connectionDistance) * 0.3;
              ctx.lineWidth = 0.5;
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.stroke();
            }
          }
        }
      }
      
      // Draw particles
      particles.forEach(p => {
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = p.opacity;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Update position
        p.x += p.speedX;
        p.y += p.speedY;
        
        // Wrap around edges
        if (p.x < 0) p.x = canvas.offsetWidth;
        if (p.x > canvas.offsetWidth) p.x = 0;
        if (p.y < 0) p.y = canvas.offsetHeight;
        if (p.y > canvas.offsetHeight) p.y = 0;
      });
      
      ctx.globalAlpha = 1;
      animationId = requestAnimationFrame(draw);
    };
    
    draw();
    
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [count, color, maxSize, speed, connected, connectionDistance]);
  
  return (
    <canvas 
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ opacity }}
    />
  );
};

/**
 * Gradient mesh background with GSAP animation
 */
export const GradientMesh = ({
  colors = ['#818cf8', '#c084fc', '#f472b6', '#22d3ee'],
  speed = 10,
  blur = 100,
  className = '',
}) => {
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const orbs = containerRef.current.querySelectorAll('.gradient-orb');
    
    orbs.forEach((orb, i) => {
      gsap.to(orb, {
        x: `random(-100, 100)`,
        y: `random(-100, 100)`,
        duration: speed + Math.random() * 5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
        delay: i * 0.5,
      });
    });
  }, [speed]);
  
  return (
    <div ref={containerRef} className={`absolute inset-0 overflow-hidden ${className}`}>
      {colors.map((color, i) => (
        <div
          key={i}
          className="gradient-orb absolute rounded-full"
          style={{
            width: '50%',
            height: '50%',
            background: `radial-gradient(circle, ${color}60, transparent 70%)`,
            filter: `blur(${blur}px)`,
            left: `${(i % 2) * 50}%`,
            top: `${Math.floor(i / 2) * 50}%`,
            transform: 'translate(-25%, -25%)',
          }}
        />
      ))}
    </div>
  );
};

/**
 * Grid background with pulse effect
 */
export const PulsingGrid = ({
  size = 30,
  color = '#818cf8',
  pulseSpeed = 3,
  opacity = 0.1,
  className = '',
}) => {
  const gridRef = useRef(null);
  
  useEffect(() => {
    if (!gridRef.current) return;
    
    gsap.to(gridRef.current, {
      opacity: opacity * 1.5,
      duration: pulseSpeed / 2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  }, [opacity, pulseSpeed]);
  
  return (
    <div
      ref={gridRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        opacity,
        backgroundImage: `
          linear-gradient(${color}20 1px, transparent 1px),
          linear-gradient(90deg, ${color}20 1px, transparent 1px)
        `,
        backgroundSize: `${size}px ${size}px`,
      }}
    />
  );
};

/**
 * Aurora/Northern lights effect
 */
export const Aurora = ({
  colors = ['#818cf8', '#c084fc', '#22d3ee'],
  speed = 8,
  opacity = 0.3,
  className = '',
}) => {
  const containerRef = useRef(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const waves = containerRef.current.querySelectorAll('.aurora-wave');
    
    waves.forEach((wave, i) => {
      gsap.to(wave, {
        x: '10%',
        skewX: 5,
        duration: speed + i * 2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
      
      gsap.to(wave, {
        opacity: [0.3, 0.6, 0.3],
        duration: speed / 2,
        repeat: -1,
        ease: 'sine.inOut',
        delay: i * 0.3,
      });
    });
  }, [speed]);
  
  return (
    <div 
      ref={containerRef} 
      className={`absolute inset-0 overflow-hidden ${className}`}
      style={{ opacity }}
    >
      {colors.map((color, i) => (
        <div
          key={i}
          className="aurora-wave absolute w-full h-1/2"
          style={{
            top: `${i * 20}%`,
            background: `linear-gradient(180deg, transparent, ${color}40, transparent)`,
            filter: 'blur(60px)',
            transform: `rotate(${-5 + i * 3}deg) skewX(-10deg)`,
          }}
        />
      ))}
    </div>
  );
};

/**
 * Scanlines overlay
 */
export const Scanlines = ({
  opacity = 0.05,
  speed = 8,
  className = '',
}) => {
  const linesRef = useRef(null);
  
  useEffect(() => {
    if (!linesRef.current) return;
    
    gsap.to(linesRef.current, {
      backgroundPosition: '0 100%',
      duration: speed,
      repeat: -1,
      ease: 'none',
    });
  }, [speed]);
  
  return (
    <div
      ref={linesRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        opacity,
        background: `repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0, 0, 0, 0.3) 2px,
          rgba(0, 0, 0, 0.3) 4px
        )`,
        backgroundSize: '100% 8px',
      }}
    />
  );
};

export default {
  MatrixRain,
  ParticleField,
  GradientMesh,
  PulsingGrid,
  Aurora,
  Scanlines,
};






