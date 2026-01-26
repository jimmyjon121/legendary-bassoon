import React, { useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder, 
  FolderOpen, 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderPlus
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

// Color options for folders
const FOLDER_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

// Single folder item
const FolderItem = memo(function FolderItem({ 
  folder, 
  isActive, 
  conversationCount,
  onSelect, 
  onEdit, 
  onDelete 
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={`
        relative group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer
        transition-colors
        ${isActive ? 'bg-glass-4' : 'hover:bg-glass-2'}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setShowMenu(false); }}
      onClick={() => onSelect(folder.id)}
    >
      {/* Folder icon */}
      <div style={{ color: folder.color || '#6366f1' }}>
        {isActive ? <FolderOpen size={16} /> : <Folder size={16} />}
      </div>
      
      {/* Folder name */}
      <span className={`flex-1 text-sm truncate ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
        {folder.name}
      </span>
      
      {/* Conversation count */}
      {conversationCount > 0 && (
        <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded-full bg-glass-2">
          {conversationCount}
        </span>
      )}
      
      {/* Actions menu */}
      {isHovered && (
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-1 rounded hover:bg-glass-3 text-text-muted hover:text-text-secondary transition-colors"
          >
            <MoreHorizontal size={14} />
          </button>
          
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-full mt-1 bg-forge-surface border border-forge-border rounded-lg shadow-xl py-1 z-30 min-w-[120px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { onEdit(folder); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-forge-hover hover:text-text-primary transition-colors"
                >
                  <Pencil size={12} />
                  Rename
                </button>
                <button
                  onClick={() => { onDelete(folder.id); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent-error hover:bg-accent-error/10 transition-colors"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      
      {/* Active indicator */}
      {isActive && (
        <div 
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
          style={{ background: folder.color || '#6366f1' }}
        />
      )}
    </div>
  );
});

// Create folder modal/form
function CreateFolderForm({ onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(FOLDER_COLORS[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit({ name: name.trim(), color });
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="px-2 py-2 space-y-2"
      onSubmit={handleSubmit}
    >
      <input
        type="text"
        placeholder="Folder name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        className="w-full px-3 py-2 text-sm bg-forge-bg border border-forge-border rounded-lg
          placeholder:text-text-muted/60 focus:border-forge-hover focus:outline-none"
      />
      
      {/* Color picker */}
      <div className="flex items-center gap-1.5">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white/30' : 'hover:scale-110'}`}
            style={{ background: c }}
          />
        ))}
      </div>
      
      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Create
        </button>
      </div>
    </motion.form>
  );
}

// Main FolderTree component
export function FolderTree({ className = '' }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  
  const folders = useAppStore(s => s.folders);
  const activeFolderId = useAppStore(s => s.activeFolderId);
  const conversations = useAppStore(s => s.conversations);
  const createFolder = useAppStore(s => s.createFolder);
  const updateFolder = useAppStore(s => s.updateFolder);
  const deleteFolder = useAppStore(s => s.deleteFolder);
  const setActiveFolder = useAppStore(s => s.setActiveFolder);

  // Count conversations per folder
  const folderCounts = React.useMemo(() => {
    const counts = {};
    (conversations || []).forEach(c => {
      if (c.folder_id) {
        counts[c.folder_id] = (counts[c.folder_id] || 0) + 1;
      }
    });
    return counts;
  }, [conversations]);

  // Count unfiled conversations
  const unfiledCount = React.useMemo(() => {
    return (conversations || []).filter(c => !c.folder_id).length;
  }, [conversations]);

  const handleCreateFolder = async ({ name, color }) => {
    await createFolder(name, color);
    setShowCreateForm(false);
  };

  const handleEditFolder = (folder) => {
    setEditingFolder(folder);
  };

  const handleDeleteFolder = async (folderId) => {
    if (window.confirm('Delete this folder? Conversations will be moved to unfiled.')) {
      await deleteFolder(folderId);
    }
  };

  if (folders.length === 0 && !showCreateForm) {
    return (
      <div className={`px-2 ${className}`}>
        <button
          onClick={() => setShowCreateForm(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-text-muted 
            hover:text-text-secondary hover:bg-glass-2 rounded-lg transition-colors"
        >
          <FolderPlus size={14} />
          Create folder
        </button>
        
        <AnimatePresence>
          {showCreateForm && (
            <CreateFolderForm 
              onSubmit={handleCreateFolder}
              onCancel={() => setShowCreateForm(false)}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[11px] font-medium text-text-muted uppercase tracking-wide hover:text-text-secondary transition-colors"
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Folders
        </button>
        
        <button
          onClick={() => setShowCreateForm(true)}
          className="p-1 rounded hover:bg-glass-2 text-text-muted hover:text-text-secondary transition-colors"
          title="Create folder"
        >
          <Plus size={14} />
        </button>
      </div>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-0.5 px-1"
          >
            {/* All (unfiled) option */}
            <div
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors
                ${activeFolderId === null ? 'bg-glass-4' : 'hover:bg-glass-2'}
              `}
              onClick={() => setActiveFolder(null)}
            >
              <Folder size={16} className="text-text-muted" />
              <span className={`flex-1 text-sm ${activeFolderId === null ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                All Chats
              </span>
              <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded-full bg-glass-2">
                {conversations?.length || 0}
              </span>
            </div>
            
            {/* Folder list */}
            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                isActive={activeFolderId === folder.id}
                conversationCount={folderCounts[folder.id] || 0}
                onSelect={setActiveFolder}
                onEdit={handleEditFolder}
                onDelete={handleDeleteFolder}
              />
            ))}
            
            {/* Create folder form */}
            <AnimatePresence>
              {showCreateForm && (
                <CreateFolderForm 
                  onSubmit={handleCreateFolder}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default FolderTree;


