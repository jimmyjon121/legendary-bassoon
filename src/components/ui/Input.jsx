import React, { useState, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Check, AlertCircle, Loader2 } from 'lucide-react';

export const Input = forwardRef(({
  label,
  icon: Icon,
  type = 'text',
  error,
  success,
  loading,
  hint,
  className = '',
  containerClassName = '',
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const isPassword = type === 'password';
  const actualType = isPassword && showPassword ? 'text' : type;
  
  const hasValue = props.value?.length > 0;
  
  return (
    <div className={`relative ${containerClassName}`}>
      {/* Floating label */}
      {label && (
        <motion.label
          initial={false}
          animate={{
            y: isFocused || hasValue ? -24 : 0,
            x: isFocused || hasValue ? -4 : Icon ? 28 : 0,
            scale: isFocused || hasValue ? 0.8 : 1,
            color: isFocused 
              ? '#818cf8' 
              : error 
                ? '#ef4444' 
                : '#6b7280',
          }}
          className="absolute left-3 top-3 text-sm pointer-events-none
                     origin-left z-10 bg-[#0a0a14] px-1"
        >
          {label}
        </motion.label>
      )}
      
      {/* Input wrapper */}
      <div className="relative">
        {/* Left icon */}
        {Icon && (
          <div className={`absolute left-3 top-1/2 -translate-y-1/2 
                          transition-colors ${isFocused ? 'text-indigo-400' : 'text-white/30'}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        
        {/* Input element */}
        <motion.input
          ref={ref}
          type={actualType}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className={`
            w-full px-3 py-3 rounded-lg
            bg-white/5 border
            text-white placeholder-white/30
            outline-none transition-all
            ${Icon ? 'pl-10' : ''}
            ${isPassword || loading || error || success ? 'pr-10' : ''}
            ${error 
              ? 'border-red-500/50 focus:border-red-500' 
              : success 
                ? 'border-emerald-500/50 focus:border-emerald-500'
                : 'border-white/10 focus:border-indigo-500/50'
            }
            ${className}
          `}
          {...props}
        />
        
        {/* Focus glow effect */}
        <AnimatePresence>
          {isFocused && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 rounded-lg pointer-events-none"
              style={{
                boxShadow: `0 0 0 3px ${error ? 'rgba(239, 68, 68, 0.1)' : 'rgba(129, 140, 248, 0.1)'}`,
              }}
            />
          )}
        </AnimatePresence>
        
        {/* Right elements */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {/* Loading spinner */}
          {loading && (
            <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
          )}
          
          {/* Success check */}
          {success && !loading && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-emerald-400"
            >
              <Check className="w-4 h-4" />
            </motion.div>
          )}
          
          {/* Error icon */}
          {error && !loading && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-red-400"
            >
              <AlertCircle className="w-4 h-4" />
            </motion.div>
          )}
          
          {/* Password toggle */}
          {isPassword && !loading && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-white/30 hover:text-white/60 transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* Error/hint message */}
      <AnimatePresence mode="wait">
        {(error || hint) && (
          <motion.p
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className={`text-xs mt-1.5 ${error ? 'text-red-400' : 'text-white/40'}`}
          >
            {error || hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
});

Input.displayName = 'Input';

// Textarea with auto-resize
export const Textarea = forwardRef(({
  label,
  error,
  hint,
  minRows = 3,
  maxRows = 10,
  className = '',
  containerClassName = '',
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <div className={`relative ${containerClassName}`}>
      {label && (
        <label className="block text-sm text-white/60 mb-1.5">{label}</label>
      )}
      
      <div className="relative">
        <motion.textarea
          ref={ref}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          rows={minRows}
          className={`
            w-full px-3 py-3 rounded-lg resize-none
            bg-white/5 border
            text-white placeholder-white/30
            outline-none transition-all
            ${error 
              ? 'border-red-500/50 focus:border-red-500' 
              : 'border-white/10 focus:border-indigo-500/50'
            }
            ${className}
          `}
          style={{ maxHeight: `${maxRows * 1.5}rem` }}
          {...props}
        />
        
        <AnimatePresence>
          {isFocused && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 rounded-lg pointer-events-none"
              style={{
                boxShadow: '0 0 0 3px rgba(129, 140, 248, 0.1)',
              }}
            />
          )}
        </AnimatePresence>
      </div>
      
      <AnimatePresence mode="wait">
        {(error || hint) && (
          <motion.p
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className={`text-xs mt-1.5 ${error ? 'text-red-400' : 'text-white/40'}`}
          >
            {error || hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
});

Textarea.displayName = 'Textarea';

// Search input with special styling
export const SearchInput = forwardRef(({
  onClear,
  isSearching = false,
  className = '',
  ...props
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <div className="relative group">
      <motion.div
        className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.1), rgba(167, 139, 250, 0.05))',
        }}
      />
      
      <input
        ref={ref}
        type="text"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`
          relative w-full px-4 py-2 pl-10 pr-8
          bg-white/5 border border-white/10
          rounded-lg text-sm text-white
          placeholder-white/30 outline-none
          focus:border-indigo-500/50
          transition-all
          ${className}
        `}
        {...props}
      />
      
      {/* Search icon with animation */}
      <motion.div
        className="absolute left-3 top-1/2 -translate-y-1/2"
        animate={{
          scale: isSearching ? [1, 1.1, 1] : 1,
        }}
        transition={{ duration: 0.5, repeat: isSearching ? Infinity : 0 }}
      >
        {isSearching ? (
          <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
        ) : (
          <motion.svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isFocused ? '#818cf8' : '#6b7280'}
            strokeWidth="2"
            className="transition-colors"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </motion.svg>
        )}
      </motion.div>
      
      {/* Clear button */}
      {props.value && onClear && (
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 
                     text-white/30 hover:text-white/60 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </motion.button>
      )}
    </div>
  );
});

SearchInput.displayName = 'SearchInput';

export default Input;






