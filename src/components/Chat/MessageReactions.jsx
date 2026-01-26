import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ThumbsUp, 
  ThumbsDown, 
  Heart, 
  Flame, 
  Bookmark,
  Copy,
  RotateCcw,
  MoreHorizontal
} from 'lucide-react';

const reactions = [
  { id: 'like', icon: ThumbsUp, label: 'Helpful', color: '#10b981', emoji: '👍' },
  { id: 'dislike', icon: ThumbsDown, label: 'Not helpful', color: '#ef4444', emoji: '👎' },
  { id: 'love', icon: Heart, label: 'Love it', color: '#ec4899', emoji: '❤️' },
  { id: 'fire', icon: Flame, label: 'Fire', color: '#f97316', emoji: '🔥' },
];

const ReactionButton = ({ reaction, isActive, onClick, count }) => {
  const [isHovered, setIsHovered] = useState(false);
  const Icon = reaction.icon;
  
  return (
    <motion.button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.85 }}
      className={`
        relative p-1.5 rounded-lg transition-colors
        ${isActive 
          ? 'bg-white/10' 
          : 'hover:bg-white/5'
        }
      `}
    >
      <motion.div
        animate={isActive ? { 
          scale: [1, 1.3, 1],
        } : {}}
        transition={{ duration: 0.3 }}
      >
        <Icon 
          className="w-4 h-4" 
          style={{ 
            color: isActive ? reaction.color : '#9ca3af',
            fill: isActive && reaction.id === 'love' ? reaction.color : 'none'
          }}
        />
      </motion.div>
      
      {/* Floating emoji on click */}
      <AnimatePresence>
        {isActive && (
          <motion.span
            initial={{ opacity: 0, y: 0, scale: 0 }}
            animate={{ opacity: [1, 0], y: -30, scale: [1.5, 0.5] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute -top-1 left-1/2 -translate-x-1/2 text-lg pointer-events-none"
          >
            {reaction.emoji}
          </motion.span>
        )}
      </AnimatePresence>
      
      {/* Tooltip */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 
                       bg-zinc-900 rounded-md text-xs text-white/80 whitespace-nowrap
                       border border-white/10 z-10"
          >
            {reaction.label}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Count badge */}
      {count > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1 -right-1 min-w-4 h-4 px-1
                     bg-indigo-500 rounded-full text-[10px] text-white
                     flex items-center justify-center font-medium"
        >
          {count}
        </motion.span>
      )}
    </motion.button>
  );
};

export const MessageReactions = ({ 
  messageId, 
  activeReactions = {},
  onReact,
  onCopy,
  onRegenerate,
  onBookmark,
  isBookmarked = false,
  isAssistant = false 
}) => {
  const [showAll, setShowAll] = useState(false);
  
  const handleReaction = (reactionId) => {
    const current = activeReactions[reactionId] || 0;
    onReact?.(messageId, reactionId, current > 0 ? 0 : 1);
  };
  
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1 mt-2"
    >
      {/* Reactions */}
      <div className="flex items-center gap-0.5 p-1 rounded-lg bg-white/5 border border-white/5">
        {reactions.map(reaction => (
          <ReactionButton
            key={reaction.id}
            reaction={reaction}
            isActive={(activeReactions[reaction.id] || 0) > 0}
            count={activeReactions[reaction.id] || 0}
            onClick={() => handleReaction(reaction.id)}
          />
        ))}
      </div>
      
      {/* Divider */}
      <div className="w-px h-5 bg-white/10 mx-1" />
      
      {/* Actions */}
      <div className="flex items-center gap-0.5">
        {/* Copy */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onCopy}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/80 
                     hover:bg-white/5 transition-colors"
          title="Copy message"
        >
          <Copy className="w-4 h-4" />
        </motion.button>
        
        {/* Regenerate - only for assistant messages */}
        {isAssistant && (
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onRegenerate}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/80 
                       hover:bg-white/5 transition-colors"
            title="Regenerate response"
          >
            <RotateCcw className="w-4 h-4" />
          </motion.button>
        )}
        
        {/* Bookmark */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onBookmark}
          className={`p-1.5 rounded-lg transition-colors
            ${isBookmarked 
              ? 'text-amber-400 bg-amber-400/10' 
              : 'text-white/40 hover:text-white/80 hover:bg-white/5'
            }`}
          title={isBookmarked ? "Remove bookmark" : "Bookmark message"}
        >
          <Bookmark 
            className="w-4 h-4" 
            fill={isBookmarked ? 'currentColor' : 'none'}
          />
        </motion.button>
      </div>
    </motion.div>
  );
};

export default MessageReactions;






