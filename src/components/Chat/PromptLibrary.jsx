import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Library, 
  Search, 
  Star, 
  Clock, 
  Tag, 
  Plus,
  Copy,
  Edit2,
  Trash2,
  Folder,
  X,
  Check
} from 'lucide-react';

/**
 * Default prompt templates organized by category
 */
const DEFAULT_TEMPLATES = {
  coding: [
    { 
      id: 'code-explain',
      title: 'Explain Code',
      prompt: 'Explain this code step by step, including what each part does and why:\n\n```\n[paste code here]\n```',
      tags: ['code', 'learning'],
    },
    {
      id: 'code-review',
      title: 'Code Review',
      prompt: 'Review this code for bugs, performance issues, and best practices. Suggest improvements:\n\n```\n[paste code here]\n```',
      tags: ['code', 'review'],
    },
    {
      id: 'code-convert',
      title: 'Convert Code',
      prompt: 'Convert this code from [source language] to [target language], maintaining the same functionality:\n\n```\n[paste code here]\n```',
      tags: ['code', 'conversion'],
    },
    {
      id: 'debug',
      title: 'Debug Error',
      prompt: 'I\'m getting this error:\n\n[paste error]\n\nIn this code:\n\n```\n[paste code]\n```\n\nHelp me fix it.',
      tags: ['code', 'debug'],
    },
  ],
  writing: [
    {
      id: 'write-blog',
      title: 'Blog Post',
      prompt: 'Write a blog post about [topic]. Include an engaging introduction, 3-5 main points with examples, and a compelling conclusion.',
      tags: ['writing', 'blog'],
    },
    {
      id: 'write-email',
      title: 'Professional Email',
      prompt: 'Write a professional email for [purpose]. Keep it concise and clear. Recipient: [who]. Key points: [what].',
      tags: ['writing', 'email'],
    },
    {
      id: 'improve-text',
      title: 'Improve Writing',
      prompt: 'Improve this text for clarity, flow, and engagement while keeping the original meaning:\n\n[paste text]',
      tags: ['writing', 'editing'],
    },
  ],
  analysis: [
    {
      id: 'summarize',
      title: 'Summarize',
      prompt: 'Summarize the following in [number] bullet points, capturing the key insights:\n\n[paste content]',
      tags: ['analysis', 'summary'],
    },
    {
      id: 'compare',
      title: 'Compare & Contrast',
      prompt: 'Compare and contrast [A] and [B]. Include pros, cons, and recommendations for when to use each.',
      tags: ['analysis', 'comparison'],
    },
    {
      id: 'pros-cons',
      title: 'Pros & Cons',
      prompt: 'List the pros and cons of [topic/decision]. Be specific and consider different perspectives.',
      tags: ['analysis', 'decision'],
    },
  ],
  creative: [
    {
      id: 'brainstorm',
      title: 'Brainstorm Ideas',
      prompt: 'Brainstorm 10 creative ideas for [topic]. Include both conventional and unconventional approaches.',
      tags: ['creative', 'ideation'],
    },
    {
      id: 'story',
      title: 'Story Starter',
      prompt: 'Write a short story opening in the style of [genre] featuring [character/setting]. Make it intriguing.',
      tags: ['creative', 'story'],
    },
  ],
};

/**
 * PromptLibrary - Searchable prompt template library
 */
export const PromptLibrary = ({ 
  onSelectPrompt, 
  customTemplates = [],
  onSaveTemplate,
  onDeleteTemplate,
  isOpen,
  onClose
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [favorites, setFavorites] = useState([]);

  // Combine default and custom templates
  const allTemplates = useMemo(() => {
    const templates = [];
    Object.entries(DEFAULT_TEMPLATES).forEach(([category, items]) => {
      items.forEach(item => templates.push({ ...item, category }));
    });
    customTemplates.forEach(item => templates.push({ ...item, category: 'custom' }));
    return templates;
  }, [customTemplates]);

  // Filter templates based on search and category
  const filteredTemplates = useMemo(() => {
    return allTemplates.filter(template => {
      const matchesSearch = !searchQuery || 
        template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = activeCategory === 'all' || 
        activeCategory === 'favorites' ? favorites.includes(template.id) :
        template.category === activeCategory;

      return matchesSearch && matchesCategory;
    });
  }, [allTemplates, searchQuery, activeCategory, favorites]);

  const toggleFavorite = (id) => {
    setFavorites(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const categories = [
    { id: 'all', label: 'All', icon: Library },
    { id: 'favorites', label: 'Favorites', icon: Star },
    { id: 'coding', label: 'Coding', icon: Tag },
    { id: 'writing', label: 'Writing', icon: Tag },
    { id: 'analysis', label: 'Analysis', icon: Tag },
    { id: 'creative', label: 'Creative', icon: Tag },
    { id: 'custom', label: 'My Templates', icon: Folder },
  ];

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
          className="w-full max-w-3xl max-h-[80vh] bg-[#0a0a14] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <Library className="text-[var(--ws-primary)]" size={24} />
              <h2 className="text-lg font-semibold text-white">Prompt Library</h2>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                onClick={() => setShowNewTemplate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--ws-primary)] rounded-lg text-sm font-medium text-white"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus size={16} />
                <span>New Template</span>
              </motion.button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={20} className="text-white/60" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-white/10">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search templates..."
                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 outline-none focus:border-[var(--ws-primary)]/50"
              />
            </div>
          </div>

          {/* Categories */}
          <div className="flex gap-2 px-6 py-3 border-b border-white/10 overflow-x-auto">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-[var(--ws-primary)] text-white'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                <cat.icon size={14} />
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Templates Grid */}
          <div className="p-6 overflow-y-auto max-h-[50vh]">
            <div className="grid gap-3">
              {filteredTemplates.map((template, index) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  index={index}
                  isFavorite={favorites.includes(template.id)}
                  onToggleFavorite={() => toggleFavorite(template.id)}
                  onSelect={() => {
                    onSelectPrompt?.(template.prompt);
                    onClose();
                  }}
                  onDelete={template.category === 'custom' ? () => onDeleteTemplate?.(template.id) : undefined}
                />
              ))}
              
              {filteredTemplates.length === 0 && (
                <div className="text-center py-12 text-white/40">
                  <Library size={48} className="mx-auto mb-3 opacity-50" />
                  <p>No templates found</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* New Template Modal */}
        {showNewTemplate && (
          <NewTemplateModal
            onSave={(template) => {
              onSaveTemplate?.(template);
              setShowNewTemplate(false);
            }}
            onClose={() => setShowNewTemplate(false)}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
};

/**
 * TemplateCard - Individual template display
 */
const TemplateCard = ({ 
  template, 
  index, 
  isFavorite, 
  onToggleFavorite, 
  onSelect,
  onDelete 
}) => {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <motion.div
      className="group relative p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[var(--ws-primary)]/30 rounded-xl transition-all cursor-pointer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => setShowPreview(!showPreview)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-medium text-white">{template.title}</h3>
          <p className="text-sm text-white/50 mt-1 line-clamp-2">
            {template.prompt}
          </p>
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <motion.button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              isFavorite ? 'text-yellow-400' : 'text-white/40 hover:text-white/70'
            }`}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
          </motion.button>
          
          <motion.button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Copy size={16} />
          </motion.button>
          
          {onDelete && (
            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <Trash2 size={16} />
            </motion.button>
          )}
        </div>
      </div>

      {/* Tags */}
      {template.tags && template.tags.length > 0 && (
        <div className="flex gap-1.5 mt-3">
          {template.tags.map(tag => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-white/5 rounded text-xs text-white/50"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Full Preview */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-4 pt-4 border-t border-white/10 overflow-hidden"
          >
            <pre className="text-sm text-white/70 whitespace-pre-wrap font-mono bg-black/30 p-3 rounded-lg">
              {template.prompt}
            </pre>
            <motion.button
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="mt-3 w-full py-2 bg-[var(--ws-primary)] hover:bg-[var(--ws-primary)]/80 rounded-lg text-sm font-medium text-white transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Use This Template
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * NewTemplateModal - Create custom template
 */
const NewTemplateModal = ({ onSave, onClose }) => {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tags, setTags] = useState('');

  const handleSave = () => {
    if (!title.trim() || !prompt.trim()) return;
    
    onSave({
      id: `custom-${Date.now()}`,
      title: title.trim(),
      prompt: prompt.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      category: 'custom',
    });
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-lg bg-[#0a0a14] border border-white/10 rounded-2xl shadow-2xl p-6"
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white mb-4">New Template</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., API Documentation"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 outline-none focus:border-[var(--ws-primary)]/50"
            />
          </div>
          
          <div>
            <label className="block text-sm text-white/60 mb-1">Prompt Template</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Write your prompt template here..."
              rows={6}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 outline-none focus:border-[var(--ws-primary)]/50 resize-none"
            />
          </div>
          
          <div>
            <label className="block text-sm text-white/60 mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="e.g., code, documentation"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 outline-none focus:border-[var(--ws-primary)]/50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-white/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <motion.button
            onClick={handleSave}
            disabled={!title.trim() || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--ws-primary)] disabled:opacity-50 rounded-lg text-white font-medium"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Check size={16} />
            Save Template
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PromptLibrary;






