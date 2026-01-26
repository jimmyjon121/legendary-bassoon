/**
 * NSFW Model Browser
 * 
 * Dedicated browser for uncensored/adult models.
 * Only accessible from the private workspace.
 */

import React, { useState, useEffect } from 'react';
import { X, Download, Search, AlertTriangle, Lock, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';

// Curated list of uncensored model sources (no actual adult content, just unfiltered LLMs)
const UNCENSORED_MODELS = [
  {
    id: 'dolphin-mixtral',
    name: 'Dolphin Mixtral 8x7B',
    description: 'Uncensored Mixtral fine-tune with excellent reasoning',
    size: '26GB',
    quantization: 'Q4_K_M',
    provider: 'cognitivecomputations',
  },
  {
    id: 'dolphin-llama3',
    name: 'Dolphin Llama 3 8B',
    description: 'Uncensored Llama 3 with broad knowledge',
    size: '4.7GB',
    quantization: 'Q4_K_M',
    provider: 'cognitivecomputations',
  },
  {
    id: 'nous-hermes-uncensored',
    name: 'Nous Hermes 2 Mistral',
    description: 'High quality uncensored assistant',
    size: '4.1GB',
    quantization: 'Q4_K_M',
    provider: 'NousResearch',
  },
  {
    id: 'wizard-vicuna-uncensored',
    name: 'Wizard Vicuna Uncensored',
    description: 'Classic uncensored model',
    size: '4.0GB',
    quantization: 'Q4_K_M',
    provider: 'ehartford',
  },
];

export function NSFWModelBrowser({ onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const currentWorkspace = useAppStore((state) => state.currentWorkspace);

  // Filter models based on search
  const filteredModels = UNCENSORED_MODELS.filter((model) =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Only accessible from private workspace
  if (currentWorkspace !== 'nsfw') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-forge-surface border border-forge-border rounded-xl p-8 max-w-md text-center"
        >
          <Lock size={48} className="mx-auto mb-4 text-workspace-nsfw" />
          <h2 className="text-lg font-semibold text-text-primary mb-2">
            Private Workspace Required
          </h2>
          <p className="text-sm text-text-muted mb-4">
            This model browser is only accessible from the Private workspace.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-forge-hover rounded-lg text-text-primary hover:bg-forge-elevated transition-colors"
          >
            Close
          </button>
        </motion.div>
      </div>
    );
  }

  const handleDownload = async (model) => {
    if (!window.electronAPI?.pullOllamaModel) {
      console.error('Ollama model pull not available');
      return;
    }

    setSelectedModel(model);
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      // Subscribe to progress updates
      const unsubscribe = window.electronAPI?.onOllamaProgress?.((progress) => {
        setDownloadProgress(progress.percent || 0);
      });

      await window.electronAPI.pullOllamaModel(model.id);
      
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      
      setIsDownloading(false);
      setSelectedModel(null);
    } catch (err) {
      console.error('Download failed:', err);
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="bg-forge-surface border border-workspace-nsfw/30 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-forge-border bg-workspace-nsfw/10">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-workspace-nsfw" />
            <div>
              <h2 className="font-semibold text-text-primary">Uncensored Models</h2>
              <p className="text-xs text-text-muted">Models without content restrictions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-forge-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-forge-border">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search uncensored models..."
              className="w-full pl-10 pr-4 py-2 bg-forge-bg border border-forge-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-workspace-nsfw/50"
            />
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredModels.map((model) => (
            <div
              key={model.id}
              className="p-4 bg-forge-bg border border-forge-border rounded-lg hover:border-workspace-nsfw/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-medium text-text-primary">{model.name}</h3>
                  <p className="text-sm text-text-muted mt-1">{model.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-text-muted bg-forge-surface px-2 py-0.5 rounded">
                      {model.size}
                    </span>
                    <span className="text-xs text-text-muted bg-forge-surface px-2 py-0.5 rounded">
                      {model.quantization}
                    </span>
                    <span className="text-xs text-workspace-nsfw">
                      {model.provider}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(model)}
                  disabled={isDownloading}
                  className="flex items-center gap-2 px-3 py-2 bg-workspace-nsfw/20 text-workspace-nsfw rounded-lg hover:bg-workspace-nsfw/30 transition-colors disabled:opacity-50"
                >
                  {isDownloading && selectedModel?.id === model.id ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-sm">{downloadProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span className="text-sm">Download</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
          
          {filteredModels.length === 0 && (
            <div className="text-center py-8">
              <p className="text-text-muted">No models match your search</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-forge-border bg-forge-bg/50">
          <p className="text-xs text-text-muted text-center">
            These models have no content filters. Use responsibly and ensure compliance with local laws.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default NSFWModelBrowser;
