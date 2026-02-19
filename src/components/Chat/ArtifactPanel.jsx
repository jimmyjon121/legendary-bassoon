import React, { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { 
  X, Copy, Check, ExternalLink, Maximize2, Minimize2, 
  RefreshCw, Code2, Eye, Image, GitBranch, Palette, FileText,
  ChevronLeft, ChevronRight, Play, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  detectArtifacts, 
  prepareArtifactForIframe, 
  ARTIFACT_TYPES 
} from './ArtifactDetector';

// Icon mapping for artifact types
const ICON_MAP = {
  Code2,
  Image,
  GitBranch,
  Palette,
  FileText,
  Atom: Code2, // Fallback for React icon
};

/**
 * ArtifactPanel - Side panel for live preview of renderable content
 * 
 * Similar to Claude's Artifacts feature - when the AI generates HTML, SVG,
 * Mermaid diagrams, or React components, this panel shows a live preview.
 */
export const ArtifactPanel = memo(function ArtifactPanel({
  content,
  isOpen,
  onClose,
  onToggle,
  initialArtifactIndex = 0,
}) {
  const [currentIndex, setCurrentIndex] = useState(initialArtifactIndex);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const iframeRef = useRef(null);
  
  // Detect all artifacts in the content
  const artifacts = useMemo(() => {
    return detectArtifacts(content || '');
  }, [content]);
  
  // Current artifact
  const currentArtifact = artifacts[currentIndex] || null;
  
  // Prepare iframe content
  // NOTE: We must not call setError inside useMemo (violates React rules).
  // Instead, store the error in a ref and sync it via useEffect.
  const iframePrepError = React.useRef(null);
  const iframeSrcDoc = useMemo(() => {
    iframePrepError.current = null;
    if (!currentArtifact) return '';
    try {
      return prepareArtifactForIframe(currentArtifact);
    } catch (e) {
      iframePrepError.current = e.message;
      return '';
    }
  }, [currentArtifact]);

  // Sync iframe preparation errors into state safely
  useEffect(() => {
    if (iframePrepError.current) {
      setError(iframePrepError.current);
    }
  }, [iframeSrcDoc]);
  
  // Reset loading state when artifact changes
  useEffect(() => {
    setIsLoading(true);
    setError(null);
  }, [currentIndex, content]);
  
  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);
  
  // Handle iframe error
  const handleIframeError = useCallback((e) => {
    setError('Failed to render preview');
    setIsLoading(false);
  }, []);
  
  // Copy code to clipboard
  const handleCopy = useCallback(async () => {
    if (!currentArtifact?.code) return;
    try {
      await navigator.clipboard.writeText(currentArtifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }, [currentArtifact]);
  
  // Navigate between artifacts
  const goToPrevious = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);
  
  const goToNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(artifacts.length - 1, i + 1));
  }, [artifacts.length]);
  
  // Refresh iframe
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = 'about:blank';
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.srcdoc = iframeSrcDoc;
        }
      }, 50);
    }
  }, [iframeSrcDoc]);
  
  // Open in new tab
  const handleOpenExternal = useCallback(() => {
    if (!iframeSrcDoc) return;
    const blob = new Blob([iframeSrcDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [iframeSrcDoc]);
  
  // Get icon component for artifact type
  const getIconComponent = (iconName) => {
    return ICON_MAP[iconName] || Code2;
  };
  
  // Don't render if no artifacts
  if (artifacts.length === 0) {
    return null;
  }
  
  // Collapsed state - just show a button
  if (!isOpen) {
    return (
      <motion.button
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        onClick={onToggle}
        className="fixed right-4 top-1/2 -translate-y-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-lg bg-forge-surface border border-forge-border shadow-lg hover:bg-forge-hover transition-colors"
        title="Show Artifact Preview"
      >
        <Eye size={16} className="text-workspace-casual" />
        <span className="text-xs text-text-secondary">Preview ({artifacts.length})</span>
      </motion.button>
    );
  }
  
  const IconComponent = currentArtifact ? getIconComponent(currentArtifact.icon) : Code2;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 300 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 300 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`
          fixed z-50 bg-forge-surface border-l border-forge-border shadow-2xl
          flex flex-col
          ${isFullscreen 
            ? 'inset-0' 
            : 'right-0 top-0 bottom-0 w-[420px]'
          }
        `}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-forge-border/50 bg-forge-bg/50">
          <div className="flex items-center gap-3">
            {/* Artifact type indicator */}
            {currentArtifact && (
              <div className={`flex items-center gap-2 px-2 py-1 rounded ${currentArtifact.bg}`}>
                <IconComponent size={14} className={currentArtifact.color} />
                <span className={`text-xs font-medium ${currentArtifact.color}`}>
                  {currentArtifact.typeName}
                </span>
              </div>
            )}
            
            {/* Navigation for multiple artifacts */}
            {artifacts.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrevious}
                  disabled={currentIndex === 0}
                  className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-text-muted">
                  {currentIndex + 1} / {artifacts.length}
                </span>
                <button
                  onClick={goToNext}
                  disabled={currentIndex === artifacts.length - 1}
                  className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            {/* Toggle code view */}
            <button
              onClick={() => setShowCode(!showCode)}
              className={`p-2 rounded transition-colors ${
                showCode 
                  ? 'bg-workspace-casual/20 text-workspace-casual' 
                  : 'text-text-muted hover:text-text-primary hover:bg-forge-hover'
              }`}
              title={showCode ? 'Show Preview' : 'Show Code'}
            >
              {showCode ? <Eye size={16} /> : <Code2 size={16} />}
            </button>
            
            {/* Copy */}
            <button
              onClick={handleCopy}
              className={`p-2 rounded transition-colors ${
                copied 
                  ? 'bg-status-success/20 text-status-success' 
                  : 'text-text-muted hover:text-text-primary hover:bg-forge-hover'
              }`}
              title={copied ? 'Copied!' : 'Copy Code'}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            
            {/* Refresh */}
            <button
              onClick={handleRefresh}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors"
              title="Refresh Preview"
            >
              <RefreshCw size={16} />
            </button>
            
            {/* Open external */}
            <button
              onClick={handleOpenExternal}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors"
              title="Open in New Tab"
            >
              <ExternalLink size={16} />
            </button>
            
            {/* Fullscreen toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            
            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-forge-hover transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 min-h-0 relative">
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-forge-bg/80 z-10">
              <div className="flex items-center gap-2 text-text-muted">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">Rendering...</span>
              </div>
            </div>
          )}
          
          {/* Error state */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-forge-bg/80 z-10">
              <div className="text-center p-4">
                <p className="text-status-error text-sm mb-2">{error}</p>
                <button
                  onClick={handleRefresh}
                  className="px-3 py-1.5 text-xs bg-forge-elevated rounded hover:bg-forge-hover transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
          
          {/* Code view */}
          {showCode ? (
            <div className="h-full overflow-auto p-4 bg-forge-bg">
              <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">
                {currentArtifact?.code || ''}
              </pre>
            </div>
          ) : (
            /* Preview iframe */
            <iframe
              ref={iframeRef}
              srcDoc={iframeSrcDoc}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              sandbox="allow-scripts"
              className="w-full h-full bg-[#1a1a2e] border-none"
              title="Artifact Preview"
            />
          )}
        </div>
        
        {/* Footer with language info */}
        {currentArtifact && (
          <div className="flex-shrink-0 px-4 py-2 border-t border-forge-border/50 bg-forge-bg/50">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>Language: {currentArtifact.language}</span>
              <span>{currentArtifact.code?.length || 0} characters</span>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
});

/**
 * ArtifactButton - Small button to show in message bubbles
 * Indicates that an artifact is available for preview
 */
export const ArtifactButton = memo(function ArtifactButton({ 
  content, 
  onClick,
  className = '' 
}) {
  const artifacts = useMemo(() => detectArtifacts(content || ''), [content]);
  
  if (artifacts.length === 0) return null;
  
  const firstArtifact = artifacts[0];
  const IconComponent = ICON_MAP[firstArtifact.icon] || Code2;
  
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg
        bg-forge-elevated border border-forge-border/50
        hover:bg-forge-hover hover:border-forge-border
        transition-colors group
        ${className}
      `}
      title="Preview Artifact"
    >
      <IconComponent size={14} className={`${firstArtifact.color} group-hover:scale-110 transition-transform`} />
      <span className="text-xs text-text-secondary group-hover:text-text-primary">
        Preview {artifacts.length > 1 ? `(${artifacts.length})` : firstArtifact.typeName}
      </span>
      <Play size={12} className="text-text-muted group-hover:text-workspace-casual transition-colors" />
    </button>
  );
});

export default ArtifactPanel;
