import React, { useMemo, useState } from 'react';
import { 
  FileText, 
  Download, 
  Share, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronRight,
  MessageSquare,
  Bot,
  User,
  Sparkles,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../../stores/appStore';
import { SmartInput } from '../SmartInput';

/**
 * Document View - Structures conversation into a readable document format
 * Groups Q&A pairs into sections, summarizes key points
 */
export function DocumentView() {
  const messages = useAppStore(s => s.messages);
  const isGenerating = useAppStore(s => s.isGenerating);
  const streamingContent = useAppStore(s => s.streamingContent);
  const currentModel = useAppStore(s => s.currentModel);
  const sendMessage = useAppStore(s => s.sendMessage);
  
  const [copiedSection, setCopiedSection] = useState(null);
  const [expandedSections, setExpandedSections] = useState(new Set(['all']));

  // Build document sections from messages (Q&A pairs)
  const documentSections = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    
    const sections = [];
    let currentSection = null;
    
    messages.forEach((message, index) => {
      if (message.role === 'user') {
        // Start a new section for each user question
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
        // Add assistant response to current section
        currentSection.responses.push({
          content: message.content,
          model: message.model || currentModel,
          time: message.created_at
        });
      }
    });
    
    // Don't forget the last section
    if (currentSection) {
      sections.push(currentSection);
    }
    
    return sections;
  }, [messages, currentModel]);

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
    const title = `# Conversation Document\n\n_Generated from ${documentSections.length} topics_\n\n---\n\n`;
    const content = documentSections.map((section, idx) => 
      `## ${idx + 1}. ${section.question}\n\n${section.responses.map(r => r.content).join('\n\n')}`
    ).join('\n\n---\n\n');
    
    await navigator.clipboard.writeText(title + content);
    setCopiedSection('all');
    setTimeout(() => setCopiedSection(null), 2000);
  };

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
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <FileText size={20} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">Document View</h2>
            <p className="text-xs text-text-muted">
              {documentSections.length > 0 
                ? `${documentSections.length} topics • ${messages.length} messages`
                : 'Start a conversation to build your document'
              }
            </p>
          </div>
        </div>
        
        {documentSections.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-glass-3 rounded-lg transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-glass-3 rounded-lg transition-colors"
            >
              Collapse All
            </button>
            <button
              onClick={copyAllAsDocument}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg transition-colors"
            >
              {copiedSection === 'all' ? <Check size={14} /> : <Copy size={14} />}
              {copiedSection === 'all' ? 'Copied!' : 'Copy All'}
            </button>
          </div>
        )}
      </div>

      {/* Document Content */}
      <div className="flex-1 overflow-y-auto scrollbar-premium">
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          {documentSections.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-6">
                <BookOpen size={32} className="text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                Build Your Knowledge Document
              </h3>
              <p className="text-sm text-text-muted text-center max-w-md mb-6">
                Start a conversation below. Each Q&A pair becomes a section in your document,
                perfect for notes, research, and knowledge building.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['Explain quantum computing', 'Compare React vs Vue', 'Write a business plan outline'].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSubmit(prompt)}
                    className="px-3 py-2 text-xs text-text-secondary bg-glass-3 hover:bg-glass-4 rounded-lg transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Document sections
            documentSections.map((section, idx) => {
              const isExpanded = expandedSections.has('all') || expandedSections.has(section.id);
              
              return (
                <motion.div
                  key={section.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden"
                >
                  {/* Section Header */}
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-glass-2 transition-colors"
                  >
                    <div className="mt-1 text-text-muted">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          #{section.index}
                        </span>
                        <span className="text-[10px] text-text-muted">
                          {section.responses.length} response{section.responses.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-text-primary line-clamp-2">
                        {section.question}
                      </h3>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copySection(section);
                      }}
                      className="p-2 text-text-muted hover:text-text-primary hover:bg-glass-3 rounded-lg transition-colors"
                      title="Copy section"
                    >
                      {copiedSection === section.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </button>

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
                          <div className="flex gap-3 p-3 bg-glass-2 rounded-lg border-l-2 border-workspace-casual">
                            <User size={16} className="text-workspace-casual mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-text-muted mb-1">Question</p>
                              <p className="text-sm text-text-primary whitespace-pre-wrap">{section.question}</p>
                            </div>
                          </div>

                          {/* Response cards */}
                          {section.responses.map((response, rIdx) => (
                            <div 
                              key={rIdx} 
                              className="flex gap-3 p-3 bg-glass-1 rounded-lg border-l-2 border-accent-primary"
                            >
                              <Bot size={16} className="text-accent-primary mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-text-muted mb-1">
                                  Response {response.model && `• ${response.model}`}
                                </p>
                                <div className="prose prose-sm text-text-secondary">
                                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                    {response.content}
                                  </p>
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
              <div className="flex gap-3 p-3 bg-glass-1 rounded-lg border-l-2 border-accent-primary">
                <Bot size={16} className="text-accent-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{streamingContent}</p>
              </div>
            </motion.div>
          )}
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

export default DocumentView;
