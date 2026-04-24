/**
 * Teammate Features
 * 
 * Advanced UX components that make the AI feel like a real teammate:
 * - InvestigateButton: Auto-search and summarize findings
 * - DraftPRPanel: Bundle patches into a PR-ready format
 * - CheckpointTimeline: Visual history with rewind capability
 */

import React, { useState, useCallback } from 'react';
import {
  Search,
  GitPullRequest,
  History,
  Play,
  RotateCcw,
  FileText,
  Check,
  X,
  ChevronRight,
  Clock,
  GitBranch,
  FileCode,
  Loader2,
  Copy,
  CheckCircle
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { shallow } from 'zustand/shallow';

// ============================================================================
// Investigate Button
// ============================================================================

export function InvestigateButton({ onInvestigate, disabled }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isInvestigating, setIsInvestigating] = useState(false);

  const handleInvestigate = async () => {
    if (!query.trim()) return;
    
    setIsInvestigating(true);
    try {
      await onInvestigate?.(query);
    } finally {
      setIsInvestigating(false);
      setIsOpen(false);
      setQuery('');
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-forge-bg/60 border border-forge-border/30 text-text-muted hover:text-text-primary hover:border-workspace-code/50 transition-all text-[11px] disabled:opacity-50"
        title="Auto-investigate the codebase"
      >
        <Search size={12} />
        Investigate
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-forge-bg/80 border border-workspace-code/30">
      <Search size={14} className="text-workspace-code flex-shrink-0" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleInvestigate()}
        placeholder="What to investigate..."
        className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
        autoFocus
      />
      <button
        onClick={handleInvestigate}
        disabled={!query.trim() || isInvestigating}
        className="p-1 rounded bg-workspace-code text-white hover:bg-workspace-code/80 disabled:opacity-50"
      >
        {isInvestigating ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Play size={14} />
        )}
      </button>
      <button
        onClick={() => {
          setIsOpen(false);
          setQuery('');
        }}
        className="p-1 rounded hover:bg-forge-hover text-text-muted"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ============================================================================
// Draft PR Panel
// ============================================================================

export function DraftPRPanel({ isOpen, onClose }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState(false);
  
  const { aiSession } = useEditorStore((state) => ({
    aiSession: state.aiSession
  }), shallow);
  
  const appliedPatches = aiSession?.appliedPatches || [];
  
  const generatePRMarkdown = useCallback(() => {
    const sections = [];
    
    // Title
    sections.push(`# ${title || 'Pull Request'}\n`);
    
    // Description
    if (description) {
      sections.push(`## Summary\n${description}\n`);
    }
    
    // Changes
    if (appliedPatches.length > 0) {
      sections.push(`## Changes\n`);
      appliedPatches.forEach((patch, i) => {
        sections.push(`### ${i + 1}. ${patch.path}`);
        sections.push(`- **Operation**: ${patch.operation}`);
        sections.push(`- **Rationale**: ${patch.rationale}`);
        if (patch.blastRadius) {
          sections.push(`- **Risk Level**: ${patch.blastRadius.riskLevel}`);
        }
        sections.push('');
      });
    }
    
    // Files Changed
    const filesChanged = [...new Set(appliedPatches.map(p => p.path))];
    if (filesChanged.length > 0) {
      sections.push(`## Files Changed (${filesChanged.length})\n`);
      filesChanged.forEach(f => sections.push(`- \`${f}\``));
      sections.push('');
    }
    
    // Test Plan
    sections.push(`## Test Plan\n- [ ] Verify changes work as expected\n- [ ] Run test suite\n- [ ] Manual testing\n`);
    
    return sections.join('\n');
  }, [title, description, appliedPatches]);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatePRMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-forge-bg border border-forge-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <div className="flex items-center gap-2">
            <GitPullRequest size={18} className="text-workspace-code" />
            <span className="font-medium text-text-primary">Draft Pull Request</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-forge-hover text-text-muted">
            <X size={18} />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-text-muted mb-1">PR Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="feat: Add new feature..."
              className="w-full px-3 py-2 bg-forge-surface border border-forge-border rounded text-sm text-text-primary"
            />
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this PR does..."
              rows={3}
              className="w-full px-3 py-2 bg-forge-surface border border-forge-border rounded text-sm text-text-primary resize-none"
            />
          </div>
          
          {/* Applied Patches */}
          <div>
            <label className="block text-xs text-text-muted mb-1">
              Changes ({appliedPatches.length} patches applied)
            </label>
            <div className="space-y-2">
              {appliedPatches.map((patch, i) => (
                <div key={patch.id || i} className="flex items-center gap-2 px-3 py-2 bg-forge-surface/50 rounded border border-forge-border/30">
                  <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                  <span className="text-xs font-mono text-text-primary truncate">{patch.path}</span>
                  <span className="text-[10px] text-text-muted">{patch.operation}</span>
                </div>
              ))}
              {appliedPatches.length === 0 && (
                <div className="text-xs text-text-muted italic px-3 py-2">
                  No patches have been applied yet
                </div>
              )}
            </div>
          </div>
          
          {/* Preview */}
          <div>
            <label className="block text-xs text-text-muted mb-1">Markdown Preview</label>
            <pre className="p-3 bg-forge-surface border border-forge-border rounded text-[11px] font-mono text-text-muted overflow-auto max-h-48">
              {generatePRMarkdown()}
            </pre>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-forge-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-text-muted hover:bg-forge-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-workspace-code text-white hover:bg-workspace-code/80 text-sm"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy Markdown'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Checkpoint Timeline
// ============================================================================

export function CheckpointTimeline({ onRewind, onCompare }) {
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);
  
  const { aiSession, createCheckpoint, rewindToCheckpoint } = useEditorStore((state) => ({
    aiSession: state.aiSession,
    createCheckpoint: state.createCheckpoint,
    rewindToCheckpoint: state.rewindToCheckpoint
  }), shallow);
  
  const checkpoints = aiSession?.checkpoints || [];
  
  const handleCreateCheckpoint = () => {
    createCheckpoint(`Manual checkpoint`);
  };
  
  const handleRewind = (checkpointId) => {
    if (confirm('Rewind to this checkpoint? This will restore file contents to that point.')) {
      rewindToCheckpoint(checkpointId);
      onRewind?.(checkpointId);
    }
  };
  
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  return (
    <div className="border border-forge-border rounded-lg bg-forge-bg/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/50 bg-forge-surface/50">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <History size={14} />
          <span>Checkpoints ({checkpoints.length})</span>
        </div>
        <button
          onClick={handleCreateCheckpoint}
          className="text-[10px] px-2 py-0.5 rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30"
        >
          + Save
        </button>
      </div>
      
      {/* Timeline */}
      <div className="max-h-48 overflow-auto">
        {checkpoints.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted text-center">
            No checkpoints yet. Click "Save" to create one.
          </div>
        ) : (
          <div className="divide-y divide-forge-border/30">
            {checkpoints.slice().reverse().map((checkpoint, idx) => (
              <div
                key={checkpoint.id}
                className={`px-3 py-2 hover:bg-forge-hover/50 cursor-pointer transition-colors ${
                  selectedCheckpoint === checkpoint.id ? 'bg-workspace-code/10' : ''
                }`}
                onClick={() => setSelectedCheckpoint(
                  selectedCheckpoint === checkpoint.id ? null : checkpoint.id
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-workspace-code" />
                    <span className="text-xs text-text-primary">{checkpoint.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">
                      {formatTime(checkpoint.createdAt)}
                    </span>
                  </div>
                </div>
                
                {selectedCheckpoint === checkpoint.id && (
                  <div className="mt-2 pt-2 border-t border-forge-border/30">
                    <div className="flex items-center gap-4 text-[10px] text-text-muted mb-2">
                      <span className="flex items-center gap-1">
                        <FileCode size={10} />
                        {checkpoint.filesRead} files read
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch size={10} />
                        {checkpoint.appliedPatches?.length || 0} patches
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRewind(checkpoint.id);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                      >
                        <RotateCcw size={10} />
                        Rewind
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Teammate Toolbar (combines all features)
// ============================================================================

export function TeammateToolbar({ onInvestigate }) {
  const [showPRPanel, setShowPRPanel] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  
  return (
    <>
      <div className="flex items-center gap-2">
        <InvestigateButton onInvestigate={onInvestigate} />
        
        <button
          onClick={() => setShowPRPanel(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-forge-bg/60 border border-forge-border/30 text-text-muted hover:text-text-primary hover:border-workspace-code/50 transition-all text-[11px]"
          title="Draft a pull request"
        >
          <GitPullRequest size={12} />
          Draft PR
        </button>
        
        <button
          onClick={() => setShowTimeline(!showTimeline)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-forge-bg/60 border transition-all text-[11px] ${
            showTimeline 
              ? 'border-workspace-code/50 text-workspace-code' 
              : 'border-forge-border/30 text-text-muted hover:text-text-primary hover:border-workspace-code/50'
          }`}
          title="View checkpoint timeline"
        >
          <History size={12} />
          Timeline
        </button>
      </div>
      
      {showTimeline && (
        <div className="mt-2">
          <CheckpointTimeline />
        </div>
      )}
      
      <DraftPRPanel isOpen={showPRPanel} onClose={() => setShowPRPanel(false)} />
    </>
  );
}

export default {
  InvestigateButton,
  DraftPRPanel,
  CheckpointTimeline,
  TeammateToolbar
};
