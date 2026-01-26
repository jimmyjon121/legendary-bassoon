import React, { useState, useRef, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Tag, 
  X, 
  Plus, 
  Check,
  Hash
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

// Tag chip component
const TagChip = memo(function TagChip({ tag, onRemove, editable = true }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
        bg-accent-primary/10 text-accent-primary border border-accent-primary/20"
    >
      <Hash size={10} />
      <span>{tag}</span>
      {editable && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          className="p-0.5 rounded-full hover:bg-accent-primary/20 transition-colors"
        >
          <X size={10} />
        </button>
      )}
    </motion.span>
  );
});

// Tag input with autocomplete
function TagInput({ value, onChange, onAdd, suggestions, placeholder = 'Add tag...' }) {
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);
  
  const filteredSuggestions = suggestions.filter(s => 
    s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()
  ).slice(0, 5);
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onAdd(value.trim());
      onChange('');
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  };
  
  const handleSuggestionClick = (suggestion) => {
    onAdd(suggestion);
    onChange('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };
  
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <Tag size={14} className="text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { setIsFocused(true); setShowSuggestions(true); }}
          onBlur={() => { setIsFocused(false); setTimeout(() => setShowSuggestions(false), 200); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted/60 outline-none"
        />
        {value && (
          <button
            onClick={() => { onAdd(value.trim()); onChange(''); }}
            className="p-1 rounded hover:bg-glass-2 text-text-muted hover:text-accent-primary transition-colors"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      
      {/* Suggestions dropdown */}
      <AnimatePresence>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute top-full left-0 right-0 mt-1 bg-forge-surface border border-forge-border rounded-lg shadow-xl z-10 overflow-hidden"
          >
            {filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-forge-hover hover:text-text-primary transition-colors"
              >
                <Hash size={12} className="text-text-muted" />
                {suggestion}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Main TagEditor component
export function TagEditor({ 
  conversationId, 
  tags = [], 
  onTagsChange,
  compact = false,
  className = '' 
}) {
  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  
  const workspaceTags = useAppStore(s => s.workspaceTags) || [];
  const setTags = useAppStore(s => s.setTags);
  
  const handleAddTag = async (tag) => {
    if (!tag.trim() || tags.includes(tag.trim())) return;
    
    const newTags = [...tags, tag.trim().toLowerCase()];
    
    if (onTagsChange) {
      onTagsChange(newTags);
    } else if (conversationId) {
      await setTags(conversationId, newTags);
    }
  };
  
  const handleRemoveTag = async (tagToRemove) => {
    const newTags = tags.filter(t => t !== tagToRemove);
    
    if (onTagsChange) {
      onTagsChange(newTags);
    } else if (conversationId) {
      await setTags(conversationId, newTags);
    }
  };
  
  // Compact mode: just show tags with edit button
  if (compact) {
    return (
      <div className={`flex items-center gap-1 flex-wrap ${className}`}>
        <AnimatePresence>
          {tags.map((tag) => (
            <TagChip 
              key={tag} 
              tag={tag} 
              onRemove={handleRemoveTag}
              editable={isEditing}
            />
          ))}
        </AnimatePresence>
        
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
              text-text-muted hover:text-text-secondary hover:bg-glass-2 transition-colors"
          >
            <Plus size={10} />
            Add tag
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  handleAddTag(inputValue);
                  setInputValue('');
                }
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setInputValue('');
                }
              }}
              autoFocus
              placeholder="tag name"
              className="w-20 px-2 py-0.5 text-[10px] bg-forge-bg border border-forge-border rounded-full
                text-text-primary placeholder-text-muted/60 outline-none focus:border-accent-primary"
            />
            <button
              onClick={() => { setIsEditing(false); setInputValue(''); }}
              className="p-0.5 rounded-full text-text-muted hover:text-text-secondary transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }
  
  // Full mode: complete tag editor
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Tag size={14} />
          Tags
        </h3>
        {tags.length > 0 && (
          <span className="text-[10px] text-text-muted">
            {tags.length} tag{tags.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      
      {/* Tags display */}
      <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
        <AnimatePresence>
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} onRemove={handleRemoveTag} />
          ))}
        </AnimatePresence>
        
        {tags.length === 0 && (
          <span className="text-xs text-text-muted">No tags yet</span>
        )}
      </div>
      
      {/* Add tag input */}
      <div className="p-2 bg-forge-bg border border-forge-border rounded-lg">
        <TagInput
          value={inputValue}
          onChange={setInputValue}
          onAdd={handleAddTag}
          suggestions={workspaceTags.filter(t => !tags.includes(t))}
        />
      </div>
      
      {/* Suggested tags */}
      {workspaceTags.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-text-muted uppercase tracking-wide">Suggested</p>
          <div className="flex items-center gap-1 flex-wrap">
            {workspaceTags
              .filter(t => !tags.includes(t))
              .slice(0, 5)
              .map((tag) => (
                <button
                  key={tag}
                  onClick={() => handleAddTag(tag)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
                    text-text-muted hover:text-text-secondary bg-glass-2 hover:bg-glass-3 transition-colors"
                >
                  <Plus size={8} />
                  {tag}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Quick tag button for inline use
export function QuickTagButton({ conversationId, tags = [], className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const setTags = useAppStore(s => s.setTags);
  
  const handleAddTag = async (tag) => {
    if (!tag.trim() || tags.includes(tag.trim())) return;
    await setTags(conversationId, [...tags, tag.trim().toLowerCase()]);
  };
  
  const handleRemoveTag = async (tagToRemove) => {
    await setTags(conversationId, tags.filter(t => t !== tagToRemove));
  };
  
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-glass-2 transition-colors"
        title="Edit tags"
      >
        <Tag size={13} />
        {tags.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] flex items-center justify-center
            bg-accent-primary text-white rounded-full">
            {tags.length}
          </span>
        )}
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute right-0 top-full mt-1 w-64 p-3 bg-forge-surface border border-forge-border rounded-lg shadow-xl z-30"
            onClick={(e) => e.stopPropagation()}
          >
            <TagEditor
              conversationId={conversationId}
              tags={tags}
            />
            
            <button
              onClick={() => setIsOpen(false)}
              className="w-full mt-3 py-1.5 text-xs text-text-muted hover:text-text-secondary
                bg-glass-2 hover:bg-glass-3 rounded-lg transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default TagEditor;



