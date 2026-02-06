import React, { useMemo, useState, useRef, useCallback } from 'react';
import { 
  FileText, 
  Download, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronRight,
  Bot,
  User,
  Sparkles,
  BookOpen,
  Search,
  List,
  Hash,
  Clock,
  FileDown,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { SmartInput } from '../SmartInput';
import { StreamingMarkdown } from '../StreamingMarkdown';

/**
 * Document View - Structures conversation into a readable document format
 * Groups Q&A pairs into sections with markdown rendering, TOC, export, and search
 */
export function DocumentView() {
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const sendMessage = useAppStore(s => s.sendMessage);
  
  const [copiedSection, setCopiedSection] = useState(null);
  const [expandedSections, setExpandedSections] = useState(new Set(['all']));
  const [searchQuery, setSearchQuery] = useState('');
  const [showTOC, setShowTOC] = useState(false);
  
  const contentRef = useRef(null);
  const sectionRefs = useRef({});

  // Build document sections from messages
  const documentSections = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    
    const sections = [];
    let currentSection = null;
    
    messages.forEach((message, index) => {
      if (message.role === 'user') {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          id: `section-${index}`,
          question: message.content,
          questionTime: message.created_at,
          responses: [],
          index: sections.length + 1
        };
      } else if (message.role === 'assistant' && currentSection) {
        currentSection.responses.push({
          content: message.content,
          model: message.model || currentModel,
          time: message.created_at
        });
      }
    });
    
    if (currentSection) {
      sections.push(currentSection);
    }
    
    return sections;
  }, [messages, currentModel]);

  // Filter sections by search
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return documentSections;
    const q = searchQuery.toLowerCase();
    return documentSections.filter(s => 
      s.question.toLowerCase().includes(q) || 
      s.responses.some(r => r.content.toLowerCase().includes(q))
    );
  }, [documentSections, searchQuery]);

  // Document stats
  const stats = useMemo(() => {
    if (documentSections.length === 0) return null;
    const totalWords = messages.reduce((acc, m) => acc + (m.content?.split(/\s+/).length || 0), 0);
    return {
      sections: documentSections.length,
      totalWords,
      avgWordsPerSection: Math.round(totalWords / documentSections.length),
    };
  }, [documentSections, messages]);

  const toggleSection = (sectionId) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSections(new Set(['all', ...documentSections.map(s => s.id)]));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  const copySection = async (section) => {
    const text = `## ${section.question}\n\n${section.responses.map(r => r.content).join('\n\n')}`;
    await navigator.clipboard.writeText(text);
    setCopiedSection(section.id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const copyAllAsDocument = async () => {
    const title = `# Conversation Document\n\n_Generated from ${documentSections.length} topics • ${stats?.totalWords?.toLocaleString() || 0} words_\n\n---\n\n`;
    const content = documentSections.map((section, idx) => 
      `## ${idx + 1}. ${section.question}\n\n${section.responses.map(r => r.content).join('\n\n')}`
    ).join('\n\n---\n\n');
    
    await navigator.clipboard.writeText(title + content);
    setCopiedSection('all');
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const exportAsMarkdownFile = useCallback(() => {
    const title = `# Conversation Document\n\n_Generated: ${new Date().toLocaleDateString()} • ${documentSections.length} topics • ${stats?.totalWords?.toLocaleString() || 0} words_\n\n---\n\n`;
    const content = documentSections.map((section, idx) => 
      `## ${idx + 1}. ${section.question}\n\n${section.responses.map(r => r.content).join('\n\n')}`
    ).join('\n\n---\n\n');
    
    const blob = new Blob([title + content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [documentSections, stats]);

  const scrollToSection = (sectionId) => {
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Ensure it's expanded
      setExpandedSections(prev => new Set([...prev, sectionId]));
    }
    setShowTOC(false);
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const countWords = (text) => text?.split(/\s+/).filter(Boolean).length || 0;

  const handleSubmit = async (message, options = {}) => {
    try {
      await sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Document Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <FileText size={20} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">Document View</h2>
            <p className="text-xs text-text-muted">
              {stats 
                ? `${stats.sections} topics • ${stats.totalWords.toLocaleString()} words • ~${stats.avgWordsPerSection} words/topic`
                : 'Start a conversation to build your document'
              }
            </p>
          </div>
        </div>
        
        {documentSections.length > 0 && (
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search document..."
                className="pl-8 pr-3 py-1.5 w-44 bg-surface-2 border border-border-subtle rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-amber-400/50 transition-colors"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* TOC toggle */}
            <button
              onClick={() => setShowTOC(!showTOC)}
              className={`p-2 rounded-lg text-xs transition-colors ${showTOC ? 'bg-amber-500/20 text-amber-400' : 'text-text-muted hover:text-text-primary hover:bg-surface-2'}`}
              title="Table of Contents"
            >
              <List size={16} />
            </button>

            <div className="w-px h-5 bg-border-subtle" />

            <button onClick={expandAll} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors">
              Expand All
            </button>
            <button onClick={collapseAll} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors">
              Collapse
            </button>

            <div className="w-px h-5 bg-border-subtle" />

            <button
              onClick={copyAllAsDocument}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors"
              title="Copy all as markdown"
            >
              {copiedSection === 'all' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copiedSection === 'all' ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={exportAsMarkdownFile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg transition-colors"
              title="Export as .md file"
            >
              <FileDown size={13} />
              Export
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Table of Contents sidebar */}
        <AnimatePresence>
          {showTOC && documentSections.length > 0 && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-r border-border-subtle bg-surface-0 overflow-y-auto flex-shrink-0"
            >
              <div className="p-4">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Table of Contents</h3>
                <div className="space-y-1">
                  {documentSections.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => scrollToSection(section.id)}
                      className="w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left hover:bg-surface-2 transition-colors group"
                    >
                      <span className="text-[10px] font-mono text-amber-400 mt-0.5 flex-shrink-0">
                        {String(section.index).padStart(2, '0')}
                      </span>
                      <span className="text-xs text-text-secondary group-hover:text-text-primary line-clamp-2 leading-relaxed">
                        {section.question}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Document Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto scrollbar-premium">
          <div className="max-w-4xl mx-auto p-6 space-y-4">
            {filteredSections.length === 0 && documentSections.length === 0 ? (
              <DocumentEmptyState onSendMessage={handleSubmit} />
            ) : filteredSections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Search size={32} className="text-text-muted mb-4" />
                <p className="text-sm text-text-muted">No sections match "{searchQuery}"</p>
                <button onClick={() => setSearchQuery('')} className="mt-2 text-xs text-amber-400 hover:underline">
                  Clear search
                </button>
              </div>
            ) : (
              filteredSections.map((section, idx) => {
                const isExpanded = expandedSections.has('all') || expandedSections.has(section.id);
                const sectionWordCount = countWords(section.question) + section.responses.reduce((a, r) => a + countWords(r.content), 0);
                
                return (
                  <motion.div
                    key={section.id}
                    ref={(el) => sectionRefs.current[section.id] = el}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden"
                  >
                    {/* Section Header */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSection(section.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSection(section.id);
                        }
                      }}
                      className="w-full flex items-start gap-3 p-4 text-left hover:bg-glass-2 transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-amber-400/30"
                    >
                      <div className="mt-1 text-text-muted transition-transform">
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            #{section.index}
                          </span>
                          <span className="text-[10px] text-text-muted flex items-center gap-1">
                            <Hash size={9} />
                            {section.responses.length} response{section.responses.length !== 1 ? 's' : ''}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            {sectionWordCount.toLocaleString()} words
                          </span>
                          {section.questionTime && (
                            <span className="text-[10px] text-text-muted flex items-center gap-1">
                              <Clock size={9} />
                              {formatTime(section.questionTime)}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-medium text-text-primary line-clamp-2">
                          {section.question}
                        </h3>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); copySection(section); }}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-glass-3 rounded-lg transition-colors flex-shrink-0"
                        title="Copy section as markdown"
                      >
                        {copiedSection === section.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>

                    {/* Section Content */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 space-y-3">
                            {/* Question card */}
                            <div className="flex gap-3 p-3 bg-glass-2 rounded-xl border-l-3 border-l-workspace-casual">
                              <div className="w-7 h-7 rounded-lg bg-workspace-casual/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <User size={14} className="text-workspace-casual" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Question</p>
                                <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{section.question}</p>
                              </div>
                            </div>

                            {/* Response cards with markdown rendering */}
                            {section.responses.map((response, rIdx) => (
                              <div 
                                key={rIdx} 
                                className="flex gap-3 p-3 bg-glass-1 rounded-xl border-l-3 border-l-accent-primary"
                              >
                                <div className="w-7 h-7 rounded-lg bg-accent-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <Bot size={14} className="text-accent-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <p className="text-[10px] uppercase tracking-wider text-text-muted">Response</p>
                                    {response.model && (
                                      <span className="text-[10px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">
                                        {response.model}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-text-muted">
                                      {countWords(response.content).toLocaleString()} words
                                    </span>
                                  </div>
                                  <div className="prose prose-sm prose-invert max-w-none text-text-secondary">
                                    <StreamingMarkdown content={response.content} isStreaming={false} />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}

            {/* Streaming indicator */}
            {isGenerating && streamingContent && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface-1 border border-accent-primary/30 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-accent-primary animate-pulse" />
                  <span className="text-xs text-accent-primary font-medium">Generating response...</span>
                </div>
                <div className="flex gap-3 p-3 bg-glass-1 rounded-xl border-l-3 border-l-accent-primary">
                  <div className="w-7 h-7 rounded-lg bg-accent-primary/20 flex items-center justify-center flex-shrink-0">
                    <Bot size={14} className="text-accent-primary" />
                  </div>
                  <div className="flex-1 min-w-0 prose prose-sm prose-invert max-w-none">
                    <StreamingMarkdown content={streamingContent} isStreaming={true} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-border-subtle bg-surface-0/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto p-4">
          <SmartInput onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state for document view
 */
function DocumentEmptyState({ onSendMessage }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-6 mx-auto border border-amber-500/20">
          <BookOpen size={32} className="text-amber-400" />
        </div>
        <h3 className="text-xl font-semibold text-text-primary mb-3">
          Build Your Knowledge Document
        </h3>
        <p className="text-sm text-text-muted text-center max-w-md mb-6 leading-relaxed">
          Start a conversation below. Each Q&A pair becomes a section in your document,
          complete with markdown rendering, word counts, and easy export.
        </p>
        <div className="flex flex-wrap gap-2 justify-center max-w-lg">
          {[
            'Explain quantum computing in depth',
            'Compare REST vs GraphQL architectures',
            'Write a business plan outline',
            'Summarize machine learning concepts'
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSendMessage(prompt)}
              className="px-4 py-2 text-xs text-text-secondary bg-surface-1 border border-border-subtle hover:border-amber-500/30 rounded-xl transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default DocumentView;
