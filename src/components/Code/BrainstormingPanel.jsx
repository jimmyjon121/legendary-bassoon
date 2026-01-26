import React, { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import brainstormingService from '../../services/brainstormingService';

export function BrainstormingPanel({ isOpen, onClose, context, onSelect }) {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    setOptions(brainstormingService.generateBrainstormOptions(context || {}));
  }, [isOpen, context]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-40">
      <div className="w-[520px] max-h-[80vh] bg-forge-bg border border-forge-border rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-forge-border">
          <div className="flex items-center gap-2 text-text-primary font-semibold">
            <Sparkles size={16} className="text-workspace-code" />
            Brainstorming Lab
          </div>
          <button type="button" className="text-text-muted hover:text-text-primary" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="w-full text-left border border-forge-border rounded-xl p-4 hover:border-workspace-code/50 hover:shadow-lg transition-all"
              onClick={() => {
                onSelect?.(option);
                onClose();
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-text-primary text-sm font-semibold">{option.title}</h4>
                <span className="text-[11px] text-text-muted uppercase">{option.estimate}</span>
              </div>
              <p className="text-sm text-text-secondary mb-3">{option.summary}</p>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="flex items-center gap-1 text-emerald-400 mb-1">
                    <CheckCircle2 size={11} />
                    Pros
                  </div>
                  <ul className="space-y-1 text-text-secondary">
                    {option.pros.map((pro) => (
                      <li key={pro}>• {pro}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-amber-400 mb-1">
                    <XCircle size={11} />
                    Cons
                  </div>
                  <ul className="space-y-1 text-text-secondary">
                    {option.cons.map((con) => (
                      <li key={con}>• {con}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {option.files.length > 0 && (
                <div className="mt-3 text-[11px] text-text-muted">
                  Touches: {option.files.map((file) => file.split('\\').pop()).join(', ')}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BrainstormingPanel;













