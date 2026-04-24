import { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Pin, 
  Star, 
  Trash2, 
  MoreHorizontal, 
  Edit2, 
  FolderOpen,
  Archive,
  Copy
} from 'lucide-react';

/**
 * ConversationItem - Enhanced conversation list item with pin/star
 */
export const ConversationItem = memo(({ 
  conversation,
  isActive = false,
  onSelect,
  onPin,
  onStar,
  onDelete,
  onRename,
  onDuplicate,
  onArchive,
  onMoveToFolder
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const maskPrivateMeta = conversation.workspace === 'nsfw';
  const displayTitle = maskPrivateMeta ? 'Vault note' : conversation.title;
  const displayPreview = maskPrivateMeta ? '' : (conversation.preview || 'No messages yet');

  const handleRename = useCallback(() => {
    if (editTitle.trim() && editTitle !== conversation.title) {
      onRename?.(conversation.id, editTitle.trim());
    }
    setIsEditing(false);
  }, [editTitle, conversation, onRename]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setEditTitle(conversation.title);
      setIsEditing(false);
    }
  };

  const menuItems = [
    { icon: Pin, label: conversation.pinned ? 'Unpin' : 'Pin', action: () => onPin?.(conversation.id), color: 'text-amber-400' },
    { icon: Star, label: conversation.starred ? 'Unstar' : 'Star', action: () => onStar?.(conversation.id), color: 'text-yellow-400' },
    { icon: Edit2, label: 'Rename', action: () => setIsEditing(true), color: 'text-white/70' },
    { icon: Copy, label: 'Duplicate', action: () => onDuplicate?.(conversation.id), color: 'text-white/70' },
    { icon: FolderOpen, label: 'Move to Folder', action: () => onMoveToFolder?.(conversation.id), color: 'text-white/70' },
    { icon: Archive, label: 'Archive', action: () => onArchive?.(conversation.id), color: 'text-white/70' },
    { icon: Trash2, label: 'Delete', action: () => onDelete?.(conversation.id), color: 'text-red-400', danger: true },
  ];

  return (
    <motion.div
      className={`group relative px-3 py-2 mx-2 rounded-lg cursor-pointer transition-colors
        ${isActive 
          ? 'bg-[var(--ws-primary)]/20 border border-[var(--ws-primary)]/30' 
          : 'hover:bg-white/5 border border-transparent'
        }`}
      onClick={() => onSelect?.(conversation.id)}
      whileHover={{ x: 2 }}
      layout
    >
      {/* Pinned/Starred indicators */}
      <div className="absolute -left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
        {conversation.pinned && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-1.5 h-1.5 rounded-full bg-amber-400"
            title="Pinned"
          />
        )}
        {conversation.starred && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-1.5 h-1.5 rounded-full bg-yellow-400"
            title="Starred"
          />
        )}
      </div>

      {/* Content */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleKeyDown}
              className="w-full bg-black/30 border border-[var(--ws-primary)]/50 rounded px-2 py-0.5 text-sm text-white outline-none"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-white/90 truncate">
                  {displayTitle}
                </span>
                {conversation.pinned && (
                  <Pin size={10} className="text-amber-400 flex-shrink-0" />
                )}
                {conversation.starred && (
                  <Star size={10} className="text-yellow-400 fill-yellow-400 flex-shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-white/40 truncate">
                  {displayPreview}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Quick actions (visible on hover) */}
        <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${showMenu ? 'opacity-100' : ''}`}>
          <motion.button
            onClick={(e) => {
              e.stopPropagation();
              onStar?.(conversation.id);
            }}
            className={`p-1 rounded hover:bg-white/10 transition-colors ${
              conversation.starred ? 'text-yellow-400' : 'text-white/40 hover:text-white/70'
            }`}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <Star size={14} fill={conversation.starred ? 'currentColor' : 'none'} />
          </motion.button>
          
          <motion.button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 rounded text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <MoreHorizontal size={14} />
          </motion.button>
        </div>
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {showMenu && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -5 }}
              className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-black/90 backdrop-blur-lg border border-white/10 rounded-lg shadow-xl py-1 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {menuItems.map((item, index) => (
                <motion.button
                  key={item.label}
                  onClick={() => {
                    item.action();
                    setShowMenu(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${item.color} hover:bg-white/10 transition-colors ${
                    item.danger ? 'hover:bg-red-500/20' : ''
                  }`}
                  whileHover={{ x: 4 }}
                >
                  <item.icon size={14} />
                  <span>{item.label}</span>
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Timestamp */}
      <div className="absolute right-3 bottom-1 text-[10px] text-white/30">
        {formatTimestamp(conversation.updatedAt)}
      </div>
    </motion.div>
  );
});

/**
 * Format timestamp to relative time
 */
function formatTimestamp(date) {
  if (!date) return '';
  
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * PinnedConversations - Section for pinned conversations
 */
export const PinnedConversations = ({ conversations, ...props }) => {
  const pinned = conversations.filter(c => c.pinned);
  
  if (pinned.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-amber-400/70">
        <Pin size={12} />
        <span className="uppercase tracking-wider">Pinned</span>
      </div>
      <div className="space-y-1">
        {pinned.map(conv => (
          <ConversationItem 
            key={conv.id} 
            conversation={conv} 
            {...props}
          />
        ))}
      </div>
    </div>
  );
};

export default ConversationItem;





