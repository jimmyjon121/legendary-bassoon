import React, { useState } from 'react';
import { ChevronDown, FileText, Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useTemplatesStore } from '../../stores/templatesStore';
import { TemplateLibrary } from '../Templates/TemplateLibrary';

// Replace {{var}} placeholders in content using provided values
function applyVariables(content, values) {
  let result = content;
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`{{\\s*${name}\\s*}}`, 'g');
    result = result.replace(re, value || '');
  }
  return result;
}

export function TemplateSelector({ onInsert }) {
  const { currentWorkspace } = useAppStore();
  const { templates, loadTemplates } = useTemplatesStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);

  const handleToggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      await loadTemplates(currentWorkspace);
    }
  };

  const handleApplyTemplate = (template) => {
    if (!template || !onInsert) return;

    const vars =
      Array.isArray(template.variables) && template.variables.length > 0
        ? template.variables
        : [];

    const values = {};
    for (const name of vars) {
      // eslint-disable-next-line no-alert
      const value = window.prompt(`Value for ${name}:`, '');
      if (value === null) {
        // User cancelled; abort
        return;
      }
      values[name] = value;
    }

    const finalText = applyVariables(template.content, values);
    onInsert(finalText);
    setIsOpen(false);
  };

  const visibleTemplates =
    templates.filter(
      (t) => !t.workspace || t.workspace === currentWorkspace,
    ).slice(0, 6) || [];

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={handleToggle}
          className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors flex items-center gap-1"
          title="Insert prompt template"
        >
          <Sparkles size={18} />
          <ChevronDown size={14} />
        </button>

        {isOpen && (
          <div className="absolute right-0 bottom-10 w-64 bg-forge-surface border border-forge-border rounded-lg shadow-lg z-20">
            <div className="px-3 py-2 border-b border-forge-border flex items-center justify-between">
              <span className="text-xs font-medium text-text-primary">Templates</span>
              <button
                type="button"
                onClick={() => {
                  setShowLibrary(true);
                  setIsOpen(false);
                }}
                className="text-[10px] text-workspace-casual hover:underline"
              >
                Manage
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {visibleTemplates.length === 0 && (
                <div className="px-3 py-3 text-xs text-text-muted">
                  No templates yet. Click &quot;Manage&quot; to create one.
                </div>
              )}
              {visibleTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleApplyTemplate(tpl)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-forge-hover transition-colors"
                >
                  <FileText size={14} className="mt-0.5 text-text-muted" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-primary truncate">{tpl.name}</span>
                      <span className="text-[9px] uppercase tracking-wide text-text-muted">
                        {tpl.category || 'General'}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-muted line-clamp-2 mt-0.5">
                      {tpl.content}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Library modal */}
      <TemplateLibrary
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        onApply={handleApplyTemplate}
      />
    </>
  );
}

export default TemplateSelector;


