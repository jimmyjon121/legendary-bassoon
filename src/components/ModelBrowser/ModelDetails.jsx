/**
 * ModelDetails Component
 * 
 * Shows detailed information about a selected model including
 * files, requirements, and download options.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Download, GitCompare, ExternalLink, Check, Cpu, HardDrive,
  Zap, Star, Clock, FileText, ChevronDown, ChevronUp, Loader2,
  AlertTriangle, CheckCircle, Info,
} from 'lucide-react';
import { useHuggingFaceStore } from '../../stores/huggingfaceStore';

const QUANT_RECOMMENDATIONS = {
  'Q4_K_M': { label: 'Recommended', color: 'text-green-400 bg-green-500/20' },
  'Q5_K_M': { label: 'High Quality', color: 'text-blue-400 bg-blue-500/20' },
  'Q4_K_S': { label: 'Balanced', color: 'text-cyan-400 bg-cyan-500/20' },
  'Q8_0': { label: 'Premium', color: 'text-purple-400 bg-purple-500/20' },
  'Q3_K_M': { label: 'Compact', color: 'text-yellow-400 bg-yellow-500/20' },
};

export function ModelDetails({ model, isLoading, onClose, onAddToCompare, isInCompare }) {
  const { downloadModel, quantizationGuide } = useHuggingFaceStore();
  const [expandedSection, setExpandedSection] = useState('files');
  const [selectedFile, setSelectedFile] = useState(null);

  if (isLoading || !model) {
    return (
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-96 border-l border-forge-border bg-forge-surface flex flex-col"
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 size={32} className="animate-spin text-accent-primary mx-auto mb-3" />
            <p className="text-sm text-text-secondary">Loading model details...</p>
          </div>
        </div>
      </motion.aside>
    );
  }

  const enriched = model.enriched || {};
  const ggufFiles = model.ggufFiles || [];
  const requirements = model.requirements || {};

  const handleDownload = (file) => {
    downloadModel(file);
  };

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="w-96 border-l border-forge-border bg-forge-surface flex flex-col"
    >
      {/* Header */}
      <div className="p-4 border-b border-forge-border">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-text-primary truncate">
              {enriched.displayName || model.id}
            </h2>
            <p className="text-xs text-text-muted">by {enriched.author}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-forge-hover text-text-muted"
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-3 text-xs text-text-muted">
          {enriched.family && (
            <span className="px-2 py-0.5 rounded bg-accent-primary/20 text-accent-primary">
              {enriched.family}
            </span>
          )}
          {enriched.params && (
            <span className="flex items-center gap-1">
              <Cpu size={12} />
              {enriched.params}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Download size={12} />
            {(model.downloads || 0).toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Star size={12} />
            {(model.likes || 0).toLocaleString()}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={onAddToCompare}
            className={`flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
              isInCompare
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'bg-forge-hover text-text-secondary hover:text-text-primary'
            }`}
          >
            {isInCompare ? <Check size={14} /> : <GitCompare size={14} />}
            {isInCompare ? 'In Compare' : 'Compare'}
          </button>
          <a
            href={`https://huggingface.co/${model.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-forge-hover text-text-secondary hover:text-text-primary flex items-center justify-center gap-2"
          >
            <ExternalLink size={14} />
            View on HF
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Files Section */}
        <div className="border-b border-forge-border">
          <button
            onClick={() => toggleSection('files')}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-forge-hover/50"
          >
            <span className="text-sm font-medium text-text-primary flex items-center gap-2">
              <FileText size={14} />
              Available Files ({ggufFiles.length})
            </span>
            {expandedSection === 'files' ? (
              <ChevronUp size={14} className="text-text-muted" />
            ) : (
              <ChevronDown size={14} className="text-text-muted" />
            )}
          </button>

          {expandedSection === 'files' && (
            <div className="px-4 pb-4 space-y-2">
              {ggufFiles.length === 0 ? (
                <p className="text-xs text-text-muted py-2">No GGUF files found</p>
              ) : (
                ggufFiles.map((file) => {
                  const rec = QUANT_RECOMMENDATIONS[file.quantization];
                  const quantInfo = quantizationGuide[file.quantization];

                  return (
                    <div
                      key={file.filename}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                        selectedFile?.filename === file.filename
                          ? 'border-accent-primary bg-accent-primary/10'
                          : 'border-forge-border bg-forge-bg/50 hover:border-accent-primary/50'
                      }`}
                      onClick={() => setSelectedFile(file)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-text-primary truncate" title={file.filename}>
                            {file.filename}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-text-muted">
                              {file.sizeFormatted}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              rec?.color || 'bg-gray-500/20 text-gray-400'
                            }`}>
                              {file.quantization}
                            </span>
                            {rec && (
                              <span className="text-[10px] text-green-400">{rec.label}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {quantInfo && (
                        <p className="text-[10px] text-text-muted mb-2">
                          {quantInfo.description}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                          className="flex-1 py-1.5 rounded bg-accent-primary/20 text-accent-primary text-[10px] font-medium flex items-center justify-center gap-1 hover:bg-accent-primary/30 transition-colors"
                        >
                          <Download size={12} />
                          Download
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Requirements Section */}
        <div className="border-b border-forge-border">
          <button
            onClick={() => toggleSection('requirements')}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-forge-hover/50"
          >
            <span className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Cpu size={14} />
              Hardware Requirements
            </span>
            {expandedSection === 'requirements' ? (
              <ChevronUp size={14} className="text-text-muted" />
            ) : (
              <ChevronDown size={14} className="text-text-muted" />
            )}
          </button>

          {expandedSection === 'requirements' && (
            <div className="px-4 pb-4">
              {requirements.recommended ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-forge-bg border border-forge-border">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                      Recommended
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-lg font-semibold text-green-400">
                          {requirements.recommended.vram || '?'}
                          <span className="text-xs text-text-muted ml-1">GB</span>
                        </p>
                        <p className="text-[10px] text-text-muted">VRAM</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-blue-400">
                          {requirements.recommended.ram || '?'}
                          <span className="text-xs text-text-muted ml-1">GB</span>
                        </p>
                        <p className="text-[10px] text-text-muted">RAM</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-yellow-400">
                          {requirements.recommended.storage || '?'}
                          <span className="text-xs text-text-muted ml-1">GB</span>
                        </p>
                        <p className="text-[10px] text-text-muted">Storage</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-forge-bg/50 border border-forge-border/50">
                    <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
                      Minimum
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-sm font-medium text-text-secondary">
                          {requirements.minimum?.vram || '?'} GB
                        </p>
                        <p className="text-[10px] text-text-muted">VRAM</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-secondary">
                          {requirements.minimum?.ram || '?'} GB
                        </p>
                        <p className="text-[10px] text-text-muted">RAM</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-secondary">
                          {requirements.minimum?.storage || '?'} GB
                        </p>
                        <p className="text-[10px] text-text-muted">Storage</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 p-2 rounded bg-blue-500/10 border border-blue-500/20">
                    <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[10px] text-blue-300">
                      Requirements are estimates based on Q4_K_M quantization. 
                      CPU inference requires more RAM but no VRAM.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-muted py-2">
                  Requirements not available. Select a file to see estimates.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Readme Section */}
        {model.readme && (
          <div className="border-b border-forge-border">
            <button
              onClick={() => toggleSection('readme')}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-forge-hover/50"
            >
              <span className="text-sm font-medium text-text-primary flex items-center gap-2">
                <FileText size={14} />
                Model Card
              </span>
              {expandedSection === 'readme' ? (
                <ChevronUp size={14} className="text-text-muted" />
              ) : (
                <ChevronDown size={14} className="text-text-muted" />
              )}
            </button>

            {expandedSection === 'readme' && (
              <div className="px-4 pb-4">
                <div className="prose prose-sm prose-invert max-w-none text-xs text-text-secondary max-h-64 overflow-y-auto p-3 bg-forge-bg rounded-lg border border-forge-border">
                  <pre className="whitespace-pre-wrap font-sans">
                    {model.readme.substring(0, 2000)}
                    {model.readme.length > 2000 && '...'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  );
}

export default ModelDetails;












