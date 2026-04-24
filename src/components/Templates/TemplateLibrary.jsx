import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Sparkles, Trash2, Edit3 } from 'lucide-react';
import { useTemplatesStore } from '../../stores/templatesStore';
import { useAppStore } from '../../stores/appStore';
import { TemplateEditor } from './TemplateEditor';

export function TemplateLibrary({ isOpen, onClose, onApply }) {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const { templates, isLoading, loadTemplates, deleteTemplate, saveTemplate } = useTemplatesStore();

  const [editingTemplate, setEditingTemplate] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadTemplates(currentWorkspace);
      setEditingTemplate(null);
    }
  }, [isOpen, currentWorkspace, loadTemplates]);

  const handleApply = async (template) => {
    if (!onApply) return;
    onApply(template);
    onClose?.();
  };

  const handleSaveTemplate = async (tpl) => {
    const saved = await saveTemplate(tpl);
    if (saved) {
      setEditingTemplate(null);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-2xl bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-casual/20">
                <Sparkles size={18} className="text-workspace-casual" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Prompt Templates</h2>
                <p className="text-xs text-text-muted">
                  Save and reuse prompts across conversations. Use variables like {'{{input}}'} to be
                  filled when you apply a template.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 grid grid-cols-2 gap-6">
            {/* List */}
            <div className="space-y-3 border-r border-forge-border pr-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-medium text-text-primary uppercase tracking-wide">
                  Templates
                </h3>
                <button
                  onClick={() => setEditingTemplate({})}
                  className="flex items-center gap-1 text-xs text-workspace-casual hover:underline"
                  type="button"
                >
                  <Plus size={14} />
                  New
                </button>
              </div>

              <div className="h-72 overflow-y-auto rounded border border-forge-border bg-forge-bg/40">
                {isLoading && (
                  <div className="p-4 text-xs text-text-muted">Loading templates…</div>
                )}
                {!isLoading && templates.length === 0 && (
                  <div className="p-4 text-xs text-text-muted">
                    No templates yet. Click &quot;New&quot; to create your first one.
                  </div>
                )}
                {!isLoading &&
                  templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleApply(tpl)}
                      className="w-full text-left px-3 py-2 border-b border-forge-border/60 hover:bg-forge-hover/60 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary truncate">{tpl.name}</span>
                        <span className="text-[10px] uppercase tracking-wide text-text-muted ml-2">
                          {tpl.category || 'General'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-text-muted line-clamp-2">
                        {tpl.content}
                      </p>
                      <div className="mt-1 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTemplate(tpl);
                          }}
                          className="text-[10px] text-text-muted hover:text-text-secondary flex items-center gap-1"
                        >
                          <Edit3 size={12} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTemplate(tpl.id);
                          }}
                          className="text-[10px] text-status-error hover:text-status-error/80 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            {/* Editor */}
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-text-primary uppercase tracking-wide">
                {editingTemplate ? 'Edit template' : 'Details'}
              </h3>
              {editingTemplate ? (
                <TemplateEditor
                  template={editingTemplate.id ? editingTemplate : null}
                  workspace={currentWorkspace}
                  onSave={handleSaveTemplate}
                  onCancel={() => setEditingTemplate(null)}
                />
              ) : (
                <div className="text-xs text-text-muted h-72 flex items-center justify-center border border-dashed border-forge-border rounded">
                  Select a template on the left to apply it, or create a new one.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default TemplateLibrary;

