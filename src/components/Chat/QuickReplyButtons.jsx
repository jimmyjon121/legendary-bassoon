import React from 'react';
import { motion } from 'framer-motion';
import { 
  ThumbsUp, 
  ThumbsDown, 
  RefreshCw, 
  Sparkles, 
  MessageSquare,
  Zap,
  ChevronRight
} from 'lucide-react';

/**
 * QuickReplyButtons - Suggested quick actions after AI responses
 */
export const QuickReplyButtons = ({ 
  onReply, 
  context = 'general',
  customReplies = [],
  className = ''
}) => {
  // Context-specific quick replies
  const contextReplies = {
    general: [
      { text: 'Tell me more', icon: MessageSquare },
      { text: 'Give an example', icon: Sparkles },
      { text: 'Simplify this', icon: Zap },
    ],
    code: [
      { text: 'Explain the code', icon: MessageSquare },
      { text: 'Add comments', icon: Sparkles },
      { text: 'Optimize this', icon: Zap },
      { text: 'Show alternatives', icon: RefreshCw },
    ],
    creative: [
      { text: 'Make it longer', icon: ChevronRight },
      { text: 'Different style', icon: RefreshCw },
      { text: 'More creative', icon: Sparkles },
    ],
    analysis: [
      { text: 'Go deeper', icon: ChevronRight },
      { text: 'Summarize', icon: Zap },
      { text: 'Compare alternatives', icon: RefreshCw },
    ],
  };

  const replies = customReplies.length > 0 
    ? customReplies 
    : contextReplies[context] || contextReplies.general;

  const containerVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  const buttonVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 },
    hover: { 
      scale: 1.05,
      y: -2,
      transition: { type: 'spring', stiffness: 400 }
    },
    tap: { scale: 0.95 },
  };

  return (
    <motion.div 
      className={`flex flex-wrap gap-2 py-3 ${className}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {replies.map((reply, index) => {
        const Icon = reply.icon || MessageSquare;
        return (
          <motion.button
            key={`reply-${reply.text}-${index}`}
            variants={buttonVariants}
            whileHover="hover"
            whileTap="tap"
            onClick={() => onReply(reply.text)}
            className="group flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-[var(--ws-primary)] border border-white/10 hover:border-[var(--ws-primary)] rounded-full text-sm text-white/70 hover:text-white transition-colors"
          >
            <Icon size={14} className="text-[var(--ws-primary)] group-hover:text-white" />
            <span>{reply.text}</span>
          </motion.button>
        );
      })}
    </motion.div>
  );
};

/**
 * FeedbackButtons - Thumbs up/down for AI responses
 */
export const FeedbackButtons = ({ 
  onFeedback, 
  messageId,
  initialFeedback = null 
}) => {
  const [feedback, setFeedback] = React.useState(initialFeedback);

  const handleFeedback = (type) => {
    const newFeedback = feedback === type ? null : type;
    setFeedback(newFeedback);
    onFeedback?.(messageId, newFeedback);
  };

  return (
    <div className="flex items-center gap-1">
      <motion.button
        onClick={() => handleFeedback('positive')}
        className={`p-1.5 rounded-md transition-colors ${
          feedback === 'positive' 
            ? 'bg-green-500/20 text-green-400' 
            : 'text-white/40 hover:text-white/70 hover:bg-white/5'
        }`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        title="Good response"
      >
        <ThumbsUp size={14} />
      </motion.button>
      
      <motion.button
        onClick={() => handleFeedback('negative')}
        className={`p-1.5 rounded-md transition-colors ${
          feedback === 'negative' 
            ? 'bg-red-500/20 text-red-400' 
            : 'text-white/40 hover:text-white/70 hover:bg-white/5'
        }`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        title="Poor response"
      >
        <ThumbsDown size={14} />
      </motion.button>
      
      <motion.button
        onClick={() => onFeedback?.(messageId, 'regenerate')}
        className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
        whileHover={{ scale: 1.1, rotate: 180 }}
        whileTap={{ scale: 0.9 }}
        title="Regenerate response"
      >
        <RefreshCw size={14} />
      </motion.button>
    </div>
  );
};

export default QuickReplyButtons;






