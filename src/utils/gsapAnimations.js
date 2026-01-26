import { gsap } from 'gsap';

// ============================================
// GSAP ANIMATION UTILITIES
// Professional-grade animations for DevForge
// ============================================

/**
 * Glitch text effect - cyberpunk style
 */
export const glitchText = (element, options = {}) => {
  const { 
    duration = 0.1, 
    iterations = 5,
    intensity = 5 
  } = options;
  
  const tl = gsap.timeline();
  
  for (let i = 0; i < iterations; i++) {
    tl.to(element, {
      x: gsap.utils.random(-intensity, intensity),
      y: gsap.utils.random(-intensity / 2, intensity / 2),
      skewX: gsap.utils.random(-2, 2),
      filter: `hue-rotate(${gsap.utils.random(0, 360)}deg)`,
      duration: duration,
      ease: 'steps(1)',
    })
    .to(element, {
      x: 0,
      y: 0,
      skewX: 0,
      filter: 'hue-rotate(0deg)',
      duration: duration,
      ease: 'steps(1)',
    });
  }
  
  return tl;
};

/**
 * Text scramble/reveal effect
 */
export const scrambleText = (element, finalText, options = {}) => {
  const { duration = 1.5, chars = '!<>-_\\/[]{}—=+*^?#________' } = options;
  
  let frame = 0;
  const totalFrames = Math.floor(duration * 60);
  const originalText = element.textContent || '';
  
  const animate = () => {
    const progress = frame / totalFrames;
    let output = '';
    
    for (let i = 0; i < finalText.length; i++) {
      if (i < progress * finalText.length) {
        output += finalText[i];
      } else {
        output += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    
    element.textContent = output;
    frame++;
    
    if (frame <= totalFrames) {
      requestAnimationFrame(animate);
    } else {
      element.textContent = finalText;
    }
  };
  
  animate();
};

/**
 * Magnetic button effect
 */
export const createMagneticEffect = (element, strength = 0.3) => {
  const handleMouseMove = (e) => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    
    gsap.to(element, {
      x: x * strength,
      y: y * strength,
      duration: 0.3,
      ease: 'power2.out',
    });
  };
  
  const handleMouseLeave = () => {
    gsap.to(element, {
      x: 0,
      y: 0,
      duration: 0.5,
      ease: 'elastic.out(1, 0.3)',
    });
  };
  
  element.addEventListener('mousemove', handleMouseMove);
  element.addEventListener('mouseleave', handleMouseLeave);
  
  return () => {
    element.removeEventListener('mousemove', handleMouseMove);
    element.removeEventListener('mouseleave', handleMouseLeave);
  };
};

/**
 * Stagger reveal animation
 */
export const staggerReveal = (elements, options = {}) => {
  const { 
    from = 'start', 
    duration = 0.6, 
    stagger = 0.08,
    y = 30,
    ease = 'power3.out'
  } = options;
  
  return gsap.from(elements, {
    opacity: 0,
    y,
    duration,
    stagger: {
      each: stagger,
      from,
    },
    ease,
  });
};

/**
 * Progress bar fill with glow
 */
export const animateProgress = (element, percent, options = {}) => {
  const { duration = 0.8, ease = 'power2.inOut', color = '#818cf8' } = options;
  
  return gsap.to(element, {
    width: `${percent}%`,
    duration,
    ease,
    onUpdate: function() {
      const progress = this.progress();
      element.style.boxShadow = `0 0 ${20 * progress}px ${color}`;
    },
  });
};

/**
 * Particle explosion effect
 */
export const particleExplosion = (container, options = {}) => {
  const { 
    count = 30, 
    colors = ['#818cf8', '#a78bfa', '#c084fc', '#22d3ee'],
    radius = 150 
  } = options;
  
  const particles = [];
  
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.style.cssText = `
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      pointer-events: none;
    `;
    container.appendChild(particle);
    particles.push(particle);
    
    const angle = (Math.PI * 2 * i) / count;
    const velocity = gsap.utils.random(0.5, 1) * radius;
    
    gsap.set(particle, {
      x: container.offsetWidth / 2,
      y: container.offsetHeight / 2,
    });
    
    gsap.to(particle, {
      x: container.offsetWidth / 2 + Math.cos(angle) * velocity,
      y: container.offsetHeight / 2 + Math.sin(angle) * velocity,
      opacity: 0,
      scale: 0,
      duration: gsap.utils.random(0.8, 1.5),
      ease: 'power2.out',
      onComplete: () => particle.remove(),
    });
  }
};

/**
 * Matrix rain effect
 */
export const createMatrixRain = (canvas, options = {}) => {
  const { 
    color = '#00ff41', 
    fontSize = 14,
    speed = 33 
  } = options;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const columns = Math.floor(canvas.width / fontSize);
  const drops = Array(columns).fill(1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()デブフォージ';
  
  let animationId;
  
  const draw = () => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = color;
    ctx.font = `${fontSize}px monospace`;
    
    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(char, i * fontSize, drops[i] * fontSize);
      
      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
    
    animationId = setTimeout(() => requestAnimationFrame(draw), speed);
  };
  
  draw();
  
  return () => {
    cancelAnimationFrame(animationId);
    clearTimeout(animationId);
  };
};

/**
 * Typing effect with cursor
 */
export const typeWriter = (element, text, options = {}) => {
  const { speed = 50, cursor = true, onComplete } = options;
  
  element.textContent = '';
  if (cursor) {
    element.style.borderRight = '2px solid #818cf8';
  }
  
  let i = 0;
  const timer = setInterval(() => {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
    } else {
      clearInterval(timer);
      if (cursor) {
        element.style.animation = 'blink 0.7s infinite';
      }
      onComplete?.();
    }
  }, speed);
  
  return () => clearInterval(timer);
};

/**
 * Morphing shape animation
 */
export const morphShape = (element, options = {}) => {
  const { duration = 2, ease = 'power1.inOut' } = options;
  
  const shapes = [
    'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', // Diamond
    'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)', // Pentagon
    'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)', // Hexagon
    'circle(50% at 50% 50%)', // Circle
  ];
  
  let index = 0;
  
  const animate = () => {
    index = (index + 1) % shapes.length;
    gsap.to(element, {
      clipPath: shapes[index],
      duration,
      ease,
      onComplete: animate,
    });
  };
  
  animate();
};

/**
 * 3D card tilt effect
 */
export const create3DTilt = (element, options = {}) => {
  const { maxTilt = 15, perspective = 1000, scale = 1.02 } = options;
  
  element.style.transformStyle = 'preserve-3d';
  element.style.perspective = `${perspective}px`;
  
  const handleMouseMove = (e) => {
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((y - centerY) / centerY) * -maxTilt;
    const rotateY = ((x - centerX) / centerX) * maxTilt;
    
    gsap.to(element, {
      rotateX,
      rotateY,
      scale,
      duration: 0.3,
      ease: 'power2.out',
    });
  };
  
  const handleMouseLeave = () => {
    gsap.to(element, {
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      duration: 0.5,
      ease: 'power2.out',
    });
  };
  
  element.addEventListener('mousemove', handleMouseMove);
  element.addEventListener('mouseleave', handleMouseLeave);
  
  return () => {
    element.removeEventListener('mousemove', handleMouseMove);
    element.removeEventListener('mouseleave', handleMouseLeave);
  };
};

/**
 * Wave text animation
 */
export const waveText = (element, options = {}) => {
  const { duration = 0.5, delay = 0.03, y = -10 } = options;
  
  const text = element.textContent;
  element.textContent = '';
  
  const chars = text.split('').map((char, i) => {
    const span = document.createElement('span');
    span.textContent = char === ' ' ? '\u00A0' : char;
    span.style.display = 'inline-block';
    element.appendChild(span);
    return span;
  });
  
  return gsap.to(chars, {
    y,
    duration,
    stagger: delay,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut',
  });
};

/**
 * Neon flicker effect
 */
export const neonFlicker = (element, options = {}) => {
  const { color = '#818cf8', intensity = 20 } = options;
  
  const tl = gsap.timeline({ repeat: -1 });
  
  tl.to(element, {
    textShadow: `0 0 ${intensity}px ${color}, 0 0 ${intensity * 2}px ${color}`,
    duration: 0.1,
  })
  .to(element, {
    textShadow: `0 0 ${intensity / 2}px ${color}`,
    duration: 0.1,
  })
  .to(element, {
    textShadow: `0 0 ${intensity}px ${color}, 0 0 ${intensity * 2}px ${color}, 0 0 ${intensity * 3}px ${color}`,
    duration: 0.5,
  })
  .to(element, {
    textShadow: `0 0 ${intensity}px ${color}`,
    duration: 0.2,
  });
  
  return tl;
};

export default {
  glitchText,
  scrambleText,
  createMagneticEffect,
  staggerReveal,
  animateProgress,
  particleExplosion,
  createMatrixRain,
  typeWriter,
  morphShape,
  create3DTilt,
  waveText,
  neonFlicker,
};






