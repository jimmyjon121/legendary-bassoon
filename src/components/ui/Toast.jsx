import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Info, 
  Loader2, 
  X,
  Zap,
  Sparkles
} from 'lucide-react';
import { useToastStore } from '../../stores/toastStore';

const toastIcons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
};

const toastStyles = {
  success: {
    bg: 'from-emerald-500/20 to-emerald-600/10',
    border: 'border-emerald-500/40',
    icon: 'text-emerald-400',
    glow: 'shadow-emerald-500/20',
    accent: '#10b981',
  },
  error: {
    bg: 'from-red-500/20 to-red-600/10',
    border: 'border-red-500/40',
    icon: 'text-red-400',
    glow: 'shadow-red-500/20',
    accent: '#ef4444',
  },
  warning: {
    bg: 'from-amber-500/20 to-amber-600/10',
    border: 'border-amber-500/40',
    icon: 'text-amber-400',
    glow: 'shadow-amber-500/20',
    accent: '#f59e0b',
  },
  info: {
    bg: 'from-indigo-500/20 to-indigo-600/10',
    border: 'border-indigo-500/40',
    icon: 'text-indigo-400',
    glow: 'shadow-indigo-500/20',
    accent: '#818cf8',
  },
  loading: {
    bg: 'from-cyan-500/20 to-cyan-600/10',
    border: 'border-cyan-500/40',
    icon: 'text-cyan-400',
    glow: 'shadow-cyan-500/20',
    accent: '#22d3ee',
  },
};

const Toast = ({ toast }) => {
  const { removeToast } = useToastStore();
  const [isHovered, setIsHovered] = useState(false);
  const [progress, setProgress] = useState(100);
  
  const style = toastStyles[toast.type] || toastStyles.info;
  const Icon = toast.icon || toastIcons[toast.type] || Info;
  
  useEffect(() => {
    if (toast.persist || toast.type === 'loading') return;
    
    const duration = 4000;
    const interval = 50;
    const decrement = (100 / duration) * interval;
    
    const timer = setInterval(() => {
      if (!isHovered) {
        setProgress(p => Math.max(0, p - decrement));
      }
    }, interval);
    
    return () => clearInterval(timer);
  }, [toast.persist, toast.type, isHovered]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.9 }}
      transition={{ 
        type: "spring", 
        stiffness: 400, 
        damping: 25 
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative group min-w-[320px] max-w-[420px]
        bg-gradient-to-r ${style.bg}
        backdrop-blur-xl
        border ${style.border}
        rounded-xl overflow-hidden
        shadow-lg ${style.glow}
      `}
    >
      {/* Animated glow effect */}
      <motion.div
        className="absolute inset-0 opacity-0 group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${style.accent}20, transparent 70%)`,
        }}
        animate={{
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      
      {/* Content */}
      <div className="relative p-4 flex items-start gap-3">
        {/* Icon with glow */}
        <div className={`relative ${style.icon}`}>
          <motion.div
            className="absolute inset-0 blur-md opacity-50"
            style={{ backgroundColor: style.accent }}
          />
          <Icon 
            className={`relative w-5 h-5 ${toast.type === 'loading' ? 'animate-spin' : ''}`}
          />
        </div>
        
        {/* Text content */}
        <div className="flex-1 min-w-0">
          {toast.title && (
            <h4 className="font-semibold text-white/90 text-sm leading-tight">
              {toast.title}
            </h4>
          )}
          {toast.message && (
            <p className="text-white/60 text-sm mt-0.5 leading-relaxed">
              {toast.message}
            </p>
          )}
          
          {/* Action button */}
          {toast.action && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={toast.action.onClick}
              className={`
                mt-2 px-3 py-1 text-xs font-medium
                rounded-lg border ${style.border}
                ${style.icon} bg-white/5
                hover:bg-white/10 transition-colors
              `}
            >
              {toast.action.label}
            </motion.button>
          )}
        </div>
        
        {/* Close button */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => removeToast(toast.id)}
          className="text-white/40 hover:text-white/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </motion.button>
      </div>
      
      {/* Progress bar */}
      {!toast.persist && toast.type !== 'loading' && (
        <div className="h-0.5 bg-white/5">
          <motion.div
            className="h-full"
            style={{ 
              backgroundColor: style.accent,
              width: `${progress}%`,
            }}
            transition={{ duration: 0.1 }}
          />
        </div>
      )}
      
      {/* Sparkle effects for success */}
      {toast.type === 'success' && (
        <motion.div
          className="absolute top-2 right-10"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Sparkles className="w-3 h-3 text-emerald-300" />
        </motion.div>
      )}
    </motion.div>
  );
};

export const ToastContainer = () => {
  const { toasts } = useToastStore();
  
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;






