import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Reusable progress bar component with multiple styles
 */
export function ProgressBar({
  progress = 0, // 0-100, or -1 for indeterminate
  label = '',
  sublabel = '',
  size = 'md', // 'sm', 'md', 'lg'
  variant = 'default', // 'default', 'success', 'warning', 'error'
  showPercentage = true,
  animated = true,
  className = '',
}) {
  const isIndeterminate = progress < 0;
  const clampedProgress = Math.min(100, Math.max(0, progress));

  const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  const variantClasses = {
    default: 'bg-workspace-code',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
  };

  return (
    <div className={`w-full ${className}`}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-text-primary font-medium truncate">
            {label}
          </span>
          {showPercentage && !isIndeterminate && (
            <span className="text-xs text-text-muted ml-2">
              {Math.round(clampedProgress)}%
            </span>
          )}
        </div>
      )}
      
      <div className={`w-full bg-forge-border/50 rounded-full overflow-hidden ${sizeClasses[size]}`}>
        {isIndeterminate ? (
          <div
            className={`h-full ${variantClasses[variant]} rounded-full animate-progress-indeterminate`}
            style={{ width: '30%' }}
          />
        ) : (
          <div
            className={`h-full ${variantClasses[variant]} rounded-full transition-all duration-300 ${
              animated ? 'ease-out' : ''
            }`}
            style={{ width: `${clampedProgress}%` }}
          />
        )}
      </div>
      
      {sublabel && (
        <p className="text-[10px] text-text-muted mt-1 truncate">{sublabel}</p>
      )}
    </div>
  );
}

/**
 * Spinning loader with optional text
 */
export function LoadingSpinner({ size = 16, text = '', className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Loader2 size={size} className="animate-spin text-workspace-code" />
      {text && <span className="text-xs text-text-muted">{text}</span>}
    </div>
  );
}

/**
 * Full-width progress overlay for modal/panel operations
 */
export function ProgressOverlay({
  isVisible,
  progress = -1,
  title = 'Processing...',
  subtitle = '',
  onCancel,
}) {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 bg-forge-bg/90 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
      <div className="text-center p-6 max-w-sm">
        <LoadingSpinner size={32} className="justify-center mb-4" />
        <h3 className="text-sm font-medium text-text-primary mb-2">{title}</h3>
        {subtitle && (
          <p className="text-xs text-text-muted mb-4">{subtitle}</p>
        )}
        <ProgressBar
          progress={progress}
          showPercentage={progress >= 0}
          size="md"
          className="mb-4"
        />
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline progress indicator for list items
 */
export function InlineProgress({ progress = -1, status = 'loading', text = '' }) {
  const statusColors = {
    loading: 'text-workspace-code',
    success: 'text-emerald-400',
    error: 'text-red-400',
    warning: 'text-amber-400',
  };

  return (
    <div className="flex items-center gap-2">
      {status === 'loading' && (
        <Loader2 size={14} className="animate-spin text-workspace-code" />
      )}
      {progress >= 0 && status === 'loading' && (
        <div className="w-16">
          <ProgressBar progress={progress} size="sm" showPercentage={false} />
        </div>
      )}
      <span className={`text-xs ${statusColors[status]}`}>
        {text || (progress >= 0 ? `${Math.round(progress)}%` : 'Processing...')}
      </span>
    </div>
  );
}

export default ProgressBar;













