import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, Terminal, Code2 } from 'lucide-react';

/**
 * CodeBlock - Enhanced code block with one-click copy
 */
export const CodeBlock = ({ 
  code, 
  language = 'javascript',
  filename,
  showLineNumbers = true,
  maxHeight = 400
}) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [code]);

  const lines = code.split('\n');
  const needsExpansion = lines.length > 20;

  const languageIcons = {
    javascript: '🟨',
    typescript: '🔷',
    python: '🐍',
    rust: '🦀',
    go: '🔵',
    bash: '💻',
    shell: '💻',
    css: '🎨',
    html: '🌐',
    json: '📋',
    sql: '🗃️',
  };

  const getLanguageColor = () => {
    const colors = {
      javascript: '#f7df1e',
      typescript: '#3178c6',
      python: '#3776ab',
      rust: '#dea584',
      go: '#00add8',
      bash: '#4eaa25',
      css: '#264de4',
      html: '#e34f26',
    };
    return colors[language] || '#818cf8';
  };

  return (
    <div className="code-block-wrapper group relative my-4 rounded-lg overflow-hidden border border-white/10">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/10"
        style={{ borderLeft: `3px solid ${getLanguageColor()}` }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{languageIcons[language] || <Code2 size={14} />}</span>
          <span className="text-xs text-white/60 font-mono">
            {filename || language}
          </span>
        </div>
        
        <motion.button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
            color: copied ? '#10b981' : 'rgba(255, 255, 255, 0.7)',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <AnimatePresence mode="wait">
            {copied ? (
              <motion.div
                key="check"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex items-center gap-1"
              >
                <Check size={14} />
                <span>Copied!</span>
              </motion.div>
            ) : (
              <motion.div
                key="copy"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex items-center gap-1"
              >
                <Copy size={14} />
                <span>Copy</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Code Content */}
      <div 
        className="relative overflow-auto bg-black/30"
        style={{ 
          maxHeight: !isExpanded && needsExpansion ? maxHeight : 'none'
        }}
      >
        <pre className="p-4 m-0 text-sm leading-relaxed">
          <code className={`language-${language} font-mono`}>
            {lines.map((line, i) => (
              <div key={`line-${i}-${line.slice(0, 20)}`} className="flex">
                {showLineNumbers && (
                  <span className="select-none text-white/20 text-right pr-4 min-w-[3rem]">
                    {i + 1}
                  </span>
                )}
                <span className="text-white/90">{line || ' '}</span>
              </div>
            ))}
          </code>
        </pre>

        {/* Fade overlay when collapsed */}
        {needsExpansion && !isExpanded && (
          <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
        )}
      </div>

      {/* Expand/Collapse button */}
      {needsExpansion && (
        <motion.button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full py-2 text-xs text-white/60 hover:text-white bg-black/40 border-t border-white/10 transition-colors"
          whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}
        >
          {isExpanded ? '▲ Show Less' : `▼ Show All ${lines.length} Lines`}
        </motion.button>
      )}
    </div>
  );
};

/**
 * InlineCode - Styled inline code
 */
export const InlineCode = ({ children }) => {
  return (
    <code className="px-1.5 py-0.5 bg-white/10 rounded text-sm font-mono text-pink-400">
      {children}
    </code>
  );
};

export default CodeBlock;






