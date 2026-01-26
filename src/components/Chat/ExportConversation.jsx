import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Download, 
  FileText, 
  FileJson, 
  FileType,
  Copy,
  Check,
  X,
  Share2
} from 'lucide-react';

/**
 * ExportConversation - Export chat to various formats
 */
export const ExportConversation = ({ 
  conversation, 
  messages,
  isOpen, 
  onClose 
}) => {
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('markdown');

  const formats = [
    { 
      id: 'markdown', 
      name: 'Markdown', 
      icon: FileText, 
      ext: '.md',
      description: 'Best for documentation and readability'
    },
    { 
      id: 'json', 
      name: 'JSON', 
      icon: FileJson, 
      ext: '.json',
      description: 'Structured data, includes metadata'
    },
    { 
      id: 'text', 
      name: 'Plain Text', 
      icon: FileType, 
      ext: '.txt',
      description: 'Simple text format'
    },
  ];

  const generateMarkdown = useCallback(() => {
    const lines = [
      `# ${conversation?.title || 'Conversation'}`,
      '',
      `**Date:** ${new Date(conversation?.createdAt || Date.now()).toLocaleDateString()}`,
      `**Messages:** ${messages?.length || 0}`,
      '',
      '---',
      '',
    ];

    messages?.forEach(msg => {
      const role = msg.role === 'user' ? '👤 **You**' : '🤖 **AI**';
      const timestamp = msg.timestamp 
        ? new Date(msg.timestamp).toLocaleTimeString() 
        : '';
      
      lines.push(`### ${role}${timestamp ? ` (${timestamp})` : ''}`);
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    return lines.join('\n');
  }, [conversation, messages]);

  const generateJSON = useCallback(() => {
    return JSON.stringify({
      title: conversation?.title,
      createdAt: conversation?.createdAt,
      updatedAt: conversation?.updatedAt,
      messageCount: messages?.length || 0,
      messages: messages?.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        model: msg.model,
      })),
    }, null, 2);
  }, [conversation, messages]);

  const generateText = useCallback(() => {
    const lines = [
      `${conversation?.title || 'Conversation'}`,
      `Date: ${new Date(conversation?.createdAt || Date.now()).toLocaleDateString()}`,
      '',
      '=' .repeat(50),
      '',
    ];

    messages?.forEach(msg => {
      const role = msg.role === 'user' ? 'You' : 'AI';
      lines.push(`[${role}]`);
      lines.push(msg.content || '');
      lines.push('');
      lines.push('-'.repeat(30));
      lines.push('');
    });

    return lines.join('\n');
  }, [conversation, messages]);

  const getContent = useCallback(() => {
    switch (selectedFormat) {
      case 'markdown': return generateMarkdown();
      case 'json': return generateJSON();
      case 'text': return generateText();
      default: return '';
    }
  }, [selectedFormat, generateMarkdown, generateJSON, generateText]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getContent());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [getContent]);

  const handleDownload = useCallback(async () => {
    setExporting(true);
    
    try {
      const content = getContent();
      const format = formats.find(f => f.id === selectedFormat);
      const filename = `${conversation?.title || 'conversation'}-${Date.now()}${format.ext}`;
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Small delay for visual feedback
      await new Promise(resolve => setTimeout(resolve, 500));
      onClose?.();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [getContent, selectedFormat, conversation, onClose, formats]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-lg bg-[#0a0a14] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <Share2 className="text-[var(--ws-primary)]" size={24} />
              <h2 className="text-lg font-semibold text-white">Export Conversation</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={20} className="text-white/60" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Format Selection */}
            <div>
              <label className="block text-sm text-white/60 mb-3">Export Format</label>
              <div className="grid grid-cols-3 gap-3">
                {formats.map(format => (
                  <motion.button
                    key={format.id}
                    onClick={() => setSelectedFormat(format.id)}
                    className={`p-4 rounded-xl border text-center transition-all ${
                      selectedFormat === format.id
                        ? 'bg-[var(--ws-primary)]/20 border-[var(--ws-primary)]/50'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <format.icon 
                      size={24} 
                      className={`mx-auto mb-2 ${
                        selectedFormat === format.id 
                          ? 'text-[var(--ws-primary)]' 
                          : 'text-white/50'
                      }`}
                    />
                    <div className={`text-sm font-medium ${
                      selectedFormat === format.id ? 'text-white' : 'text-white/70'
                    }`}>
                      {format.name}
                    </div>
                    <div className="text-xs text-white/40 mt-1">{format.ext}</div>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-white/60">Preview</label>
                <motion.button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-green-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </motion.button>
              </div>
              <pre className="max-h-[200px] overflow-auto p-4 bg-black/40 border border-white/10 rounded-lg text-xs text-white/70 font-mono">
                {getContent().slice(0, 1000)}
                {getContent().length > 1000 && '\n\n... (truncated)'}
              </pre>
            </div>

            {/* Info */}
            <div className="flex items-center gap-2 text-xs text-white/40">
              <FileText size={14} />
              <span>
                {messages?.length || 0} messages • 
                {' '}{Math.ceil((getContent().length / 1024))}KB
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-white/5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-white/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <motion.button
              onClick={handleDownload}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--ws-primary)] disabled:opacity-50 rounded-lg text-white font-medium"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Download size={16} />
              <span>{exporting ? 'Exporting...' : 'Download'}</span>
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ExportConversation;






