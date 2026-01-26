import React, { useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Star, 
  Pin, 
  Trash2, 
  MoreHorizontal,
  FolderInput,
  Tag,
  MessageSquare
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAppStore } from '../../stores/appStore';

// Parse tags from JSON string safely
function parseTags(tagsStr) {
  if (!tagsStr) return [];
  try {
    const parsed = JSON.parse(tagsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Enhanced conversation card with organization features
export const ConversationCard = memo(function ConversationCard({ 
  conv, 
  isActive, 
  onSelect, 
  onDelete, 
  accentColor,
  style = {}
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  
  const toggleStar = useAppStore(s => s.toggleStar);
  const togglePin = useAppStore(s => s.togglePin);
  const folders = useAppStore(s => s.folders);
  const moveToFolder = useAppStore(s => s.moveToFolder);
  
  const tags = parseTags(conv.tags);
  const isStarred = conv.starred === 1;
  const isPinned = conv.pinned === 1;

  const handleStarClick = async (e) => {
    e.stopPropagation();
    await toggleStar(conv.id);
  };

  const handlePinClick = async (e) => {
    e.stopPropagation();
    await togglePin(conv.id);
  };

  const handleMoveToFolder = async (folderId) => {
    await moveToFolder(conv.id, folderId);
    setShowMenu(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setShowMenu(false); }}
      onClick={() => onSelect(conv.id)}
      className={`
        relative group rounded-lg cursor-pointer transition-colors
        ${isActive ? 'bg-glass-4' : 'hover:bg-glass-2'}
      `}
      style={style}
    >
      <div className="px-3 py-2.5">
        {/* Header row: title + indicators */}
        <div className="flex items-start gap-2">
          {/* Pinned/Starred indicators */}
          <div className="flex-shrink-0 flex flex-col gap-0.5 mt-0.5">
            {isPinned && (
              <Pin size={12} className="text-accent-primary" style={{ transform: 'rotate(45deg)' }} />
            )}
            {isStarred && (
              <Star size={12} className="text-amber-400" fill="currentColor" />
            )}
          </div>
          
          {/* Title and preview */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${isActive ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
              {conv.title || 'New conversation'}
            </p>
            
            {/* Preview text */}
            {conv.preview && (
              <p className="text-[11px] text-text-muted truncate mt-0.5 opacity-70">
                {conv.preview}
              </p>
            )}
            
            {/* Meta row: time, message count */}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-text-muted">
                {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true })}
              </span>
              
              {conv.message_count > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
                  <MessageSquare size={10} />
                  {conv.message_count}
                </span>
              )}
            </div>
          </div>
          
          {/* Action buttons (visible on hover) */}
          <div className={`flex items-center gap-0.5 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            {/* Star button */}
            <button
              onClick={handleStarClick}
              className={`p-1.5 rounded-lg transition-colors ${
                isStarred 
                  ? 'text-amber-400 hover:bg-amber-400/10' 
                  : 'text-text-muted hover:text-amber-400 hover:bg-glass-2'
              }`}
              title={isStarred ? 'Unstar' : 'Star'}
            >
              <Star size={13} fill={isStarred ? 'currentColor' : 'none'} />
            </button>
            
            {/* Pin button */}
            <button
              onClick={handlePinClick}
              className={`p-1.5 rounded-lg transition-colors ${
                isPinned 
                  ? 'text-accent-primary hover:bg-accent-primary/10' 
                  : 'text-text-muted hover:text-accent-primary hover:bg-glass-2'
              }`}
              style={{ transform: 'rotate(45deg)' }}
              title={isPinned ? 'Unpin' : 'Pin'}
            >
              <Pin size={13} />
            </button>
            
            {/* More menu */}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-secondary hover:bg-glass-2 transition-colors"
                title="More options"
              >
                <MoreHorizontal size={13} />
              </button>
              
              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute right-0 top-full mt-1 bg-forge-surface border border-forge-border rounded-lg shadow-xl py-1 z-30 min-w-[150px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Move to folder submenu */}
                    {folders.length > 0 && (
                      <div className="px-1 py-1 border-b border-forge-border">
                        <p className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wide">Move to folder</p>
                        <button
                          onClick={() => handleMoveToFolder(null)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors
                            ${!conv.folder_id ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary hover:bg-forge-hover'}`}
                        >
                          <FolderInput size={12} />
                          Unfiled
                        </button>
                        {folders.map((folder) => (
                          <button
                            key={folder.id}
                            onClick={() => handleMoveToFolder(folder.id)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors
                              ${conv.folder_id === folder.id ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary hover:bg-forge-hover'}`}
                          >
                            <div className="w-3 h-3 rounded" style={{ background: folder.color }} />
                            {folder.name}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Delete option */}
                    <button
                      onClick={() => { onDelete(conv.id); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent-error hover:bg-accent-error/10 transition-colors"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        
        {/* Tags row */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {tags.slice(0, 3).map((tag, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 text-[10px] rounded bg-accent-primary/10 text-accent-primary/80"
              >
                #{tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-text-muted">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
      
      {/* Active indicator */}
      {isActive && (
        <div 
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
          style={{ background: accentColor }}
        />
      )}
    </motion.div>
  );
});

export default ConversationCard;



