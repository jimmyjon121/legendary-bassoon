import React, { useState } from 'react';
import { X, Download, FileText, FileJson, FileCode2, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';

const FORMATS = [
  { id: 'markdown', label: 'Markdown (.md)', icon: FileText },
  { id: 'json', label: 'JSON (.json)', icon: FileJson },
  { id: 'html', label: 'HTML (.html)', icon: FileCode2 },
  { id: 'text', label: 'Plain text (.txt)', icon: FileText },
];

export function ExportModal({ onClose }) {
  const { conversations, currentConversationId } = useAppStore();

  const [scope, setScope] = useState('current');
  const [format, setFormat] = useState('markdown');
  const [isExporting, setIsExporting] = useState(false);
  const [resultMessage, setResultMessage] = useState(null);
  const [error, setError] = useState(null);

  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setResultMessage(null);

    try {
      if (!window.electronAPI) {
        throw new Error('Electron APIs are not available in browser preview.');
      }

      if (scope === 'current' && !currentConversationId) {
        throw new Error('No active conversation to export.');
      }

      const dest = await window.electronAPI.selectExportDestination({
        scope: scope === 'all' ? 'all' : 'single',
        defaultPath: undefined,
        defaultFileName: currentConversation?.title,
      });

      if (dest?.canceled) {
        setIsExporting(false);
        return;
      }

      if (scope === 'current') {
        const payload = {
          conversationId: currentConversationId,
          format,
          targetPath: dest.filePath || dest.directory,
        };
        const res = await window.electronAPI.exportConversation(payload);
        if (!res?.success) {
          throw new Error(res?.error || 'Export failed');
        }
        setResultMessage(`Conversation exported to ${res.filePath}`);
      } else {
        const payload = {
          format,
          directory: dest.directory || dest.filePath,
        };
        const res = await window.electronAPI.exportAllConversations(payload);
        if (!res?.success) {
          throw new Error(res?.error || 'Export failed');
        }
        setResultMessage(`Exported ${res.results?.length || 0} conversations.`);
      }
    } catch (err) {
      console.error('Export failed:', err);
      setError(err.message || String(err));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-lg bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-work/20">
                <Download size={18} className="text-workspace-work" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Export Conversations</h2>
                <p className="text-xs text-text-muted">
                  Save your chats to files for backup, sharing, or documentation.
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
          <div className="p-6 space-y-5">
            {/* Scope */}
            <div>
              <h3 className="text-xs font-medium text-text-primary mb-2">What to export</h3>
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scope"
                    value="current"
                    checked={scope === 'current'}
                    onChange={() => setScope('current')}
                    disabled={!currentConversationId}
                    className="w-4 h-4 rounded border-forge-border text-workspace-casual focus:ring-workspace-casual/50"
                  />
                  <span className={!currentConversationId ? 'text-text-muted' : 'text-text-secondary'}>
                    Current conversation
                    {!currentConversationId && ' (no active conversation)'}
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scope"
                    value="all"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                    className="w-4 h-4 rounded border-forge-border text-workspace-casual focus:ring-workspace-casual/50"
                  />
                  <span className="text-text-secondary">
                    All conversations ({conversations.length})
                  </span>
                </label>
              </div>
            </div>

            {/* Format */}
            <div>
              <h3 className="text-xs font-medium text-text-primary mb-2">Format</h3>
              <div className="grid grid-cols-2 gap-2">
                {FORMATS.map((fmt) => {
                  const Icon = fmt.icon;
                  const isActive = format === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setFormat(fmt.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                        isActive
                          ? 'border-workspace-work bg-workspace-work/20 text-text-primary'
                          : 'border-forge-border bg-forge-bg text-text-secondary hover:bg-forge-hover'
                      }`}
                    >
                      <Icon size={14} />
                      <span className="truncate">{fmt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Result / Error */}
            {error && (
              <div className="p-2 rounded bg-status-error/10 border border-status-error/40 text-xs text-status-error">
                {error}
              </div>
            )}
            {resultMessage && !error && (
              <div className="p-2 rounded bg-status-success/10 border border-status-success/40 text-xs text-status-success flex items-center gap-2">
                <FolderOpen size={12} />
                <span>{resultMessage}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-forge-border">
            <button
              onClick={onClose}
              className="btn btn-secondary"
              disabled={isExporting}
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              className="btn btn-primary"
              disabled={isExporting || (!currentConversationId && scope === 'current')}
            >
              {isExporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default ExportModal;


