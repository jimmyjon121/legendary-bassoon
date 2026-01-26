import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Loader } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { CompareResults } from './CompareResults';

export function CompareMode({ isOpen, onClose }) {
  const { availableModels, currentModel, currentWorkspace, appendFromCompare } = useAppStore();

  const [selectedModels, setSelectedModels] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    // Preselect current model if available
    if (currentModel && !selectedModels.includes(currentModel)) {
      setSelectedModels([currentModel]);
    }
    setResults([]);
    setError(null);
  }, [isOpen, currentModel]);

  const toggleModel = (name) => {
    setSelectedModels((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
  };

  const runComparison = async () => {
    if (!prompt.trim() || selectedModels.length === 0) return;
    if (!window.electronAPI?.sendToLLM) {
      setError('Model comparison is only available in the desktop app.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResults([]);

    const systemPrompt = ''; // We can extend to use workspace system prompt later

    const tasks = selectedModels.map(async (modelName) => {
      const started = performance.now();
      try {
        const res = await window.electronAPI.sendToLLM({
          model: modelName,
          prompt,
          system: systemPrompt,
          options: { temperature: 0.7, top_p: 0.9 },
        });
        const ms = Math.round(performance.now() - started);
        const text = typeof res === 'string' ? res : res?.response || JSON.stringify(res);
        return { model: modelName, text, ms };
      } catch (e) {
        const ms = Math.round(performance.now() - started);
        return { model: modelName, text: '', ms, error: e.message || 'Request failed' };
      }
    });

    const settled = await Promise.all(tasks);
    setResults(settled);
    setIsRunning(false);
  };

  const handlePromote = async (res) => {
    if (!res || !res.text) return;
    await appendFromCompare(res.text, res.model);
    onClose?.();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && !isRunning && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-4xl max-h-[85vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-code/20">
                <Sparkles className="w-5 h-5 text-workspace-code" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Compare Models</h2>
                <p className="text-xs text-text-muted">
                  Select up to 4 models and generate responses side by side.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isRunning}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-primary uppercase tracking-wide">
                  Models
                </span>
                <span className="text-[11px] text-text-muted">
                  Selected {selectedModels.length} / 4
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableModels && availableModels.length > 0 ? (
                  availableModels.map((m) => {
                    const name = typeof m === 'string' ? m : m.name || m.model || m.id;
                    const active = selectedModels.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleModel(name)}
                        disabled={
                          !active && selectedModels.length >= 4
                        }
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                          active
                            ? 'bg-workspace-code text-white border-workspace-code'
                            : 'border-forge-border text-text-secondary hover:bg-forge-hover'
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs text-text-muted">
                    No models available. Make sure your backend is running.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-text-primary uppercase tracking-wide">
                Prompt
              </label>
              <textarea
                className="input text-sm h-24 resize-none"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask a question to compare how models respond…"
              />
            </div>

            {error && (
              <div className="text-xs text-status-error bg-status-error/10 border border-status-error/40 rounded px-3 py-2">
                {error}
              </div>
            )}

            <CompareResults results={results} onPromote={handlePromote} />
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-forge-border">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose?.();
              }}
              disabled={isRunning}
              className="btn btn-secondary text-sm"
            >
              Close
            </button>
            <button
              type="button"
              onClick={runComparison}
              disabled={isRunning || !prompt.trim() || selectedModels.length === 0}
              className="btn btn-primary text-sm"
            >
              {isRunning ? <Loader className="w-4 h-4 animate-spin" /> : 'Run comparison'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default CompareMode;


