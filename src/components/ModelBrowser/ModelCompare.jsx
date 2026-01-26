/**
 * ModelCompare Component
 * 
 * Side-by-side comparison of multiple models.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  X, GitCompare, Trash2, Play, Download, Star, Cpu, HardDrive,
  Zap, CheckCircle, XCircle,
} from 'lucide-react';
import { useHuggingFaceStore } from '../../stores/huggingfaceStore';

export function ModelCompare({ compareList, onRemove, onClose, onRunComparison }) {
  const { comparisonData, isComparing, searchResults, collectionModels } = useHuggingFaceStore();

  // Get model info from results
  const getModelInfo = (modelId) => {
    // Search in all collections
    for (const models of Object.values(collectionModels)) {
      const found = models.find(m => (m.id || m.modelId) === modelId);
      if (found) return found;
    }
    // Search in current results
    return searchResults.find(m => (m.id || m.modelId) === modelId);
  };

  const models = compareList.map(id => ({
    id,
    ...getModelInfo(id),
  }));

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="fixed bottom-0 left-0 right-0 h-80 bg-forge-surface border-t border-forge-border shadow-2xl z-50"
    >
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-forge-border">
        <div className="flex items-center gap-3">
          <GitCompare size={18} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-text-primary">
            Compare Models ({compareList.length}/4)
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {compareList.length >= 2 && (
            <button
              onClick={onRunComparison}
              disabled={isComparing}
              className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-400 text-xs font-medium flex items-center gap-2 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
            >
              <Play size={14} />
              {isComparing ? 'Comparing...' : 'Run Comparison'}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-forge-hover text-text-muted"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-x-auto p-4">
        {compareList.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <GitCompare size={32} className="text-text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-text-secondary">No models to compare</p>
              <p className="text-xs text-text-muted">Add models using the compare button</p>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 min-w-max">
            {models.map((model) => {
              const enriched = model.enriched || model;
              const ggufFiles = model.ggufFiles || [];
              const q4File = ggufFiles.find(f => f.quantization?.includes('Q4_K_M')) || ggufFiles[0];

              return (
                <div
                  key={model.id}
                  className="w-64 rounded-lg border border-forge-border bg-forge-bg/50 overflow-hidden flex-shrink-0"
                >
                  {/* Header */}
                  <div className="p-3 border-b border-forge-border flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-text-primary truncate">
                        {enriched.displayName || model.id?.split('/').pop()}
                      </h4>
                      <p className="text-[10px] text-text-muted truncate">
                        {enriched.author || model.id?.split('/')[0]}
                      </p>
                    </div>
                    <button
                      onClick={() => onRemove(model.id)}
                      className="p-1 rounded hover:bg-forge-hover text-text-muted hover:text-status-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="p-3 space-y-3">
                    {/* Family & Params */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {enriched.family && (
                        <span className="px-2 py-0.5 rounded bg-accent-primary/20 text-accent-primary text-[10px]">
                          {enriched.family}
                        </span>
                      )}
                      {enriched.params && (
                        <span className="px-2 py-0.5 rounded bg-forge-hover text-text-secondary text-[10px]">
                          {enriched.params}
                        </span>
                      )}
                    </div>

                    {/* Downloads & Likes */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center p-2 rounded bg-forge-bg">
                        <Download size={12} className="mx-auto text-text-muted mb-1" />
                        <p className="text-xs font-medium text-text-primary">
                          {((model.downloads || 0) / 1000).toFixed(1)}K
                        </p>
                        <p className="text-[10px] text-text-muted">Downloads</p>
                      </div>
                      <div className="text-center p-2 rounded bg-forge-bg">
                        <Star size={12} className="mx-auto text-text-muted mb-1" />
                        <p className="text-xs font-medium text-text-primary">
                          {model.likes || 0}
                        </p>
                        <p className="text-[10px] text-text-muted">Likes</p>
                      </div>
                    </div>

                    {/* Size & Capability */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center p-2 rounded bg-forge-bg">
                        <HardDrive size={12} className="mx-auto text-text-muted mb-1" />
                        <p className="text-xs font-medium text-text-primary">
                          {q4File ? `${q4File.sizeGB} GB` : 'N/A'}
                        </p>
                        <p className="text-[10px] text-text-muted">Q4_K_M Size</p>
                      </div>
                      <div className="text-center p-2 rounded bg-forge-bg">
                        <Zap size={12} className="mx-auto text-text-muted mb-1" />
                        <p className="text-xs font-medium text-text-primary capitalize">
                          {enriched.capability || 'General'}
                        </p>
                        <p className="text-[10px] text-text-muted">Type</p>
                      </div>
                    </div>

                    {/* Files count */}
                    <div className="text-center text-[10px] text-text-muted">
                      {ggufFiles.length} GGUF files available
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add More Slot */}
            {compareList.length < 4 && (
              <div className="w-64 rounded-lg border-2 border-dashed border-forge-border bg-forge-bg/30 flex items-center justify-center flex-shrink-0">
                <div className="text-center p-4">
                  <GitCompare size={24} className="mx-auto text-text-muted mb-2 opacity-50" />
                  <p className="text-xs text-text-muted">Add more models</p>
                  <p className="text-[10px] text-text-muted">Up to 4 models</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default ModelCompare;












