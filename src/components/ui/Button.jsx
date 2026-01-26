import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

const variants = {
  primary: {
    base: `bg-gradient-to-r from-indigo-500 to-purple-500 
           text-white border-transparent
           shadow-lg shadow-indigo-500/25`,
    hover: `hover:from-indigo-400 hover:to-purple-400
            hover:shadow-xl hover:shadow-indigo-500/30`,
    glow: 'rgba(99, 102, 241, 0.5)',
  },
  secondary: {
    base: `bg-white/5 text-white/90 
           border-white/10`,
    hover: `hover:bg-white/10 hover:border-white/20`,
    glow: 'rgba(255, 255, 255, 0.1)',
  },
  ghost: {
    base: `bg-transparent text-white/70 border-transparent`,
    hover: `hover:bg-white/5 hover:text-white/90`,
    glow: 'rgba(255, 255, 255, 0.05)',
  },
  danger: {
    base: `bg-gradient-to-r from-red-500 to-rose-500 
           text-white border-transparent
           shadow-lg shadow-red-500/25`,
    hover: `hover:from-red-400 hover:to-rose-400
            hover:shadow-xl hover:shadow-red-500/30`,
    glow: 'rgba(239, 68, 68, 0.5)',
  },
  success: {
    base: `bg-gradient-to-r from-emerald-500 to-teal-500 
           text-white border-transparent
           shadow-lg shadow-emerald-500/25`,
    hover: `hover:from-emerald-400 hover:to-teal-400
            hover:shadow-xl hover:shadow-emerald-500/30`,
    glow: 'rgba(16, 185, 129, 0.5)',
  },
  workspace: {
    base: `bg-gradient-to-r from-[var(--ws-primary)] to-[var(--ws-secondary)]
           text-white border-transparent
           shadow-lg`,
    hover: `hover:opacity-90`,
    glow: 'var(--ws-glow)',
  },
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2.5',
  xl: 'px-8 py-4 text-lg gap-3',
  icon: 'p-2',
  'icon-sm': 'p-1.5',
  'icon-lg': 'p-3',
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  children,
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  glow = false,
  ripple = true,
  rounded = 'lg',
  fullWidth = false,
  className = '',
  onClick,
  ...props
}) => {
  const v = variants[variant] || variants.primary;
  const s = sizes[size] || sizes.md;
  
  const handleClick = (e) => {
    if (disabled || loading) return;
    
    // Ripple effect
    if (ripple) {
      const button = e.currentTarget;
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const rippleEl = document.createElement('span');
      rippleEl.className = 'absolute rounded-full bg-white/30 animate-ripple';
      rippleEl.style.left = `${x}px`;
      rippleEl.style.top = `${y}px`;
      rippleEl.style.width = rippleEl.style.height = `${Math.max(rect.width, rect.height) * 2}px`;
      rippleEl.style.transform = 'translate(-50%, -50%) scale(0)';
      
      button.appendChild(rippleEl);
      setTimeout(() => rippleEl.remove(), 600);
    }
    
    onClick?.(e);
  };
  
  return (
    <motion.button
      whileHover={!disabled && !loading ? { scale: 1.02, y: -1 } : {}}
      whileTap={!disabled && !loading ? { scale: 0.98 } : {}}
      onClick={handleClick}
      disabled={disabled || loading}
      className={`
        relative inline-flex items-center justify-center
        font-medium
        border
        rounded-${rounded}
        transition-all duration-200
        overflow-hidden
        ${v.base}
        ${!disabled && !loading ? v.hover : ''}
        ${s}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      style={glow ? {
        boxShadow: `0 0 20px ${v.glow}`,
      } : {}}
      {...props}
    >
      {/* Glow effect on hover */}
      {glow && (
        <motion.div
          className="absolute inset-0 opacity-0"
          whileHover={{ opacity: 1 }}
          style={{
            background: `radial-gradient(circle at center, ${v.glow}, transparent 70%)`,
          }}
        />
      )}
      
      {/* Loading state */}
      {loading && (
        <Loader2 className="w-4 h-4 animate-spin" />
      )}
      
      {/* Icon - left */}
      {Icon && iconPosition === 'left' && !loading && (
        <Icon className="w-4 h-4" />
      )}
      
      {/* Content */}
      {children && (
        <span className="relative z-10">
          {children}
        </span>
      )}
      
      {/* Icon - right */}
      {Icon && iconPosition === 'right' && !loading && (
        <Icon className="w-4 h-4" />
      )}
    </motion.button>
  );
};

// Icon-only button
export const IconButton = ({
  icon: Icon,
  variant = 'ghost',
  size = 'icon',
  tooltip,
  className = '',
  ...props
}) => {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      className={`
        relative inline-flex items-center justify-center
        rounded-lg transition-colors
        ${variants[variant]?.base || variants.ghost.base}
        ${!props.disabled ? (variants[variant]?.hover || variants.ghost.hover) : ''}
        ${sizes[size]}
        ${props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      title={tooltip}
      {...props}
    >
      {Icon && <Icon className="w-4 h-4" />}
    </motion.button>
  );
};

// Button group
export const ButtonGroup = ({ children, className = '' }) => {
  return (
    <div className={`inline-flex rounded-lg overflow-hidden border border-white/10 ${className}`}>
      {React.Children.map(children, (child, i) => 
        React.cloneElement(child, {
          className: `${child.props.className || ''} 
                     ${i === 0 ? '' : 'border-l border-white/10'}
                     rounded-none`,
        })
      )}
    </div>
  );
};

// Add ripple animation to globals
const style = document.createElement('style');
style.textContent = `
  @keyframes ripple {
    to {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0;
    }
  }
  .animate-ripple {
    animation: ripple 0.6s ease-out forwards;
  }
`;
document.head.appendChild(style);

export default Button;






