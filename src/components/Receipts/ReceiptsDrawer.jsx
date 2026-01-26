/**
 * Receipts Drawer
 * 
 * Expandable drawer showing evidence items (citations) for AI responses.
 * Supports: doc chunks, file lines, tool outputs, web sources.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, FileText, Code, Terminal, Globe, ChevronRight, 
  ExternalLink, Copy, Check, Hash, BookOpen, Zap
} from 'lucide-react';
import { isElectron, safeCall } from '../../utils/electronAPI';

// Evidence kind icons and colors
const EVIDENCE_CONFIG = {
  doc_chunk: {
    icon: BookOpen,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
    borderColor: 'border-emerald-400/30',
    label: 'Document',
  },
  file_lines: {
    icon: Code,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    borderColor: 'border-amber-400/30',
    label: 'Code',
  },
  tool_output: {
    icon: Terminal,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-400/10',
    borderColor: 'border-cyan-400/30',
    label: 'Tool Output',
  },
  web_source: {
    icon: Globe,
    color: 'text-violet-400',
    bgColor: 'bg-violet-400/10',
    borderColor: 'border-violet-400/30',
    label: 'Web',
  },
  reasoning: {
    icon: Zap,
    color: 'text-rose-400',
    bgColor: 'bg-rose-400/10',
    borderColor: 'border-rose-400/30',
    label: 'Reasoning',
  },
};

/**
 * Main Receipts Drawer Component
 */
export function ReceiptsDrawer({ isOpen, onClose, evidenceItems = [], messageId }) {
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  
  // Load evidence from ledger if not provided
  const [loadedEvidence, setLoadedEvidence] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    if (isOpen && evidenceItems.length === 0 && messageId) {
      loadEvidence();
    }
  }, [isOpen, messageId]);
  
  const loadEvidence = async () => {
    if (!isElectron()) return;
    setIsLoading(true);
    try {
      const evidence = await safeCall('ledger:getEvidence', [messageId], []);
      setLoadedEvidence(evidence);
    } catch (error) {
      console.error('Failed to load evidence:', error);
    }
    setIsLoading(false);
  };
  
  const items = evidenceItems.length > 0 ? evidenceItems : loadedEvidence;
  
  const handleCopy = async (content, id) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };
  
  const handleJumpToSource = (item) => {
    if (item.kind === 'file_lines' && item.ref?.filePath) {
      // Open file at specific line in code workspace
      if (window.electronAPI?.openFileAtLine) {
        window.electronAPI.openFileAtLine(item.ref.filePath, item.ref.startLine || 1);
      }
    } else if (item.kind === 'doc_chunk' && item.ref?.documentId) {
      // Could open document viewer
      console.log('Jump to document:', item.ref.documentId, 'chunk:', item.ref.chunkIndex);
    } else if (item.kind === 'web_source' && item.ref?.url) {
      // Open URL in browser
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(item.ref.url);
      }
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex justify-end"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        
        {/* Drawer */}
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="relative w-full max-w-md h-full bg-forge-bg border-l border-forge-border shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-400/10">
                <Hash size={16} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Provenance Receipts</h2>
                <p className="text-xs text-text-muted">{items.length} source{items.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-forge-hover transition-colors"
            >
              <X size={16} className="text-text-muted" />
            </button>
          </div>
          
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-6 h-6 border-2 border-text-muted border-t-transparent rounded-full" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Hash size={32} className="text-text-muted mb-3" />
                <p className="text-sm text-text-secondary">No receipts available</p>
                <p className="text-xs text-text-muted mt-1">
                  This response was generated without tracked sources
                </p>
              </div>
            ) : (
              items.map((item, idx) => (
                <EvidenceCard
                  key={item.id || idx}
                  item={item}
                  isExpanded={expandedId === (item.id || idx)}
                  onToggle={() => setExpandedId(expandedId === (item.id || idx) ? null : (item.id || idx))}
                  onCopy={(content) => handleCopy(content, item.id || idx)}
                  isCopied={copiedId === (item.id || idx)}
                  onJumpToSource={() => handleJumpToSource(item)}
                />
              ))
            )}
          </div>
          
          {/* Footer */}
          <div className="px-5 py-3 border-t border-forge-border bg-forge-surface/50">
            <p className="text-[10px] text-text-muted text-center">
              Receipts are cryptographically linked to the response via hash chain
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Individual Evidence Card
 */
function EvidenceCard({ item, isExpanded, onToggle, onCopy, isCopied, onJumpToSource }) {
  const config = EVIDENCE_CONFIG[item.kind] || EVIDENCE_CONFIG.doc_chunk;
  const Icon = config.icon;
  
  // Extract display info based on kind
  const getDisplayInfo = () => {
    switch (item.kind) {
      case 'doc_chunk':
        return {
          title: item.ref?.filename || 'Document',
          subtitle: item.ref?.chunkIndex !== undefined ? `Chunk ${item.ref.chunkIndex + 1}` : null,
          score: item.ref?.score,
        };
      case 'file_lines':
        return {
          title: item.ref?.filePath?.split(/[/\\]/).pop() || 'File',
          subtitle: item.ref?.startLine 
            ? `Lines ${item.ref.startLine}-${item.ref.endLine || item.ref.startLine}` 
            : null,
        };
      case 'tool_output':
        return {
          title: item.ref?.toolName || 'Tool',
          subtitle: item.ref?.command ? `$ ${item.ref.command.slice(0, 40)}...` : null,
          exitCode: item.ref?.exitCode,
        };
      case 'web_source':
        return {
          title: item.ref?.title || new URL(item.ref?.url || '').hostname,
          subtitle: item.ref?.url,
        };
      default:
        return {
          title: item.kind,
          subtitle: null,
        };
    }
  };
  
  const info = getDisplayInfo();
  
  return (
    <motion.div
      layout
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} overflow-hidden`}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className={`p-1.5 rounded-lg ${config.bgColor}`}>
          <Icon size={14} className={config.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {info.title}
            </span>
            {info.score !== undefined && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-400">
                {Math.round(info.score * 100)}%
              </span>
            )}
            {info.exitCode !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                info.exitCode === 0 
                  ? 'bg-emerald-400/20 text-emerald-400' 
                  : 'bg-rose-400/20 text-rose-400'
              }`}>
                exit {info.exitCode}
              </span>
            )}
          </div>
          {info.subtitle && (
            <p className="text-xs text-text-muted truncate">{info.subtitle}</p>
          )}
        </div>
        <ChevronRight 
          size={14} 
          className={`text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </button>
      
      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/10"
          >
            <div className="p-4 space-y-3">
              {/* Content preview */}
              {item.content && (
                <div className="relative">
                  <pre className="text-xs text-text-secondary bg-black/30 rounded-lg p-3 overflow-x-auto max-h-48">
                    <code>{item.content}</code>
                  </pre>
                </div>
              )}
              
              {/* Hash */}
              {item.content_hash && (
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <Hash size={10} />
                  <span className="font-mono">{item.content_hash.slice(0, 16)}...</span>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex items-center gap-2">
                {item.content && (
                  <button
                    onClick={() => onCopy(item.content)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    {isCopied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{isCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
                
                {(item.kind === 'file_lines' || item.kind === 'doc_chunk' || item.kind === 'web_source') && (
                  <button
                    onClick={onJumpToSource}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <ExternalLink size={12} />
                    <span>Jump to source</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Receipt Pill - Inline indicator for messages with receipts
 */
export function ReceiptPill({ count, onClick, isVerified = true }) {
  return (
    <button
      onClick={onClick}
      className="receipt-pill inline-flex items-center gap-1 receipt-glow"
      title={`${count} source${count !== 1 ? 's' : ''} available`}
    >
      <Hash size={10} />
      <span>{count} receipt{count !== 1 ? 's' : ''}</span>
      {isVerified && (
        <Check size={10} className="text-emerald-400" />
      )}
    </button>
  );
}

/**
 * Hook for managing receipts drawer state
 */
export function useReceiptsDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMessageId, setCurrentMessageId] = useState(null);
  const [currentEvidence, setCurrentEvidence] = useState([]);
  
  const openDrawer = (messageId, evidence = []) => {
    setCurrentMessageId(messageId);
    setCurrentEvidence(evidence);
    setIsOpen(true);
  };
  
  const closeDrawer = () => {
    setIsOpen(false);
    setCurrentMessageId(null);
    setCurrentEvidence([]);
  };
  
  return {
    isOpen,
    currentMessageId,
    currentEvidence,
    openDrawer,
    closeDrawer,
  };
}

export default ReceiptsDrawer;




