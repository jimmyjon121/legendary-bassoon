import React, { useMemo, useState } from 'react';
import { Sparkles, X, Code2 } from 'lucide-react';
import { listCodeTemplates, applyTemplateToName } from '../../services/templateService';
import { useEditorStore } from '../../stores/editorStore';

export function CodeTemplateLibrary({ isOpen, onClose, onInsert }) {
  const { activeFilePath } = useEditorStore();
  const [name, setName] = useState('');

  const templates = useMemo(() => listCodeTemplates(), []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-forge-surface border border-forge-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-forge-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-workspace-code/20">
              <Code2 size={16} className="text-workspace-code" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">Code templates</div>
              <div className="text-[11px] text-text-muted">
                Drop in a structured snippet, then let the agent refine it.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-forge-hover"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-forge-border flex items-center gap-2 text-[11px]">
          <span className="text-text-muted">Name / identifier</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={activeFilePath ? activeFilePath.split(/[\\/]/).pop().split('.')[0] : 'ComponentName'}
            className="input h-7 text-[11px] max-w-[200px]"
          />
        </div>
        <div className="p-5 grid grid-cols-3 gap-3 max-h-[60vh] overflow-auto">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                const preferredName =
                  name ||
                  (activeFilePath ? activeFilePath.split(/[\\/]/).pop().split('.')[0] : tpl.name.replace(/\s+/g, ''));
                const code = applyTemplateToName(tpl, preferredName);
                onInsert?.(code);
                onClose?.();
              }}
              className="text-left border border-forge-border rounded-xl px-3 py-3 hover:border-workspace-code/50 hover:bg-forge-hover/60 transition-colors flex flex-col gap-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">{tpl.name}</span>
                <span className="text-[10px] text-text-muted uppercase">{tpl.category}</span>
              </div>
              <p className="text-[11px] text-text-secondary line-clamp-3">{tpl.description}</p>
            </button>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-forge-border flex items-center justify-between text-[11px] text-text-muted">
          <span>Templates are local to this app – no cloud calls.</span>
          <span className="flex items-center gap-1">
            <Sparkles size={12} />
            You can always ask the agent to refactor after inserting.
          </span>
        </div>
      </div>
    </div>
  );
}

export default CodeTemplateLibrary;














