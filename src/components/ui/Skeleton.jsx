import React from 'react';
import { motion } from 'framer-motion';

// Base skeleton with shimmer effect
export const Skeleton = ({ 
  className = '', 
  width, 
  height, 
  rounded = 'md',
  animate = true 
}) => {
  return (
    <div
      className={`
        relative overflow-hidden
        bg-gradient-to-r from-white/5 via-white/8 to-white/5
        rounded-${rounded}
        ${className}
      `}
      style={{ width, height }}
    >
      {animate && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          animate={{
            x: ['-100%', '100%'],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      )}
    </div>
  );
};

// Message skeleton for loading chat messages
export const MessageSkeleton = ({ isUser = false }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 p-4 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <Skeleton 
        className="flex-shrink-0" 
        width={36} 
        height={36} 
        rounded="full" 
      />
      
      {/* Message content */}
      <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} max-w-[70%]`}>
        {/* Sender name */}
        <Skeleton width={80} height={14} />
        
        {/* Message bubble */}
        <div className={`
          p-4 rounded-2xl 
          ${isUser 
            ? 'bg-indigo-500/10 border border-indigo-500/20' 
            : 'bg-white/5 border border-white/10'
          }
        `}>
          <div className="flex flex-col gap-2">
            <Skeleton width={200} height={14} />
            <Skeleton width={280} height={14} />
            <Skeleton width={150} height={14} />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Conversation list skeleton
export const ConversationSkeleton = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-3 rounded-lg bg-white/3"
    >
      <div className="flex items-start gap-3">
        <Skeleton width={20} height={20} rounded="md" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton width="70%" height={14} />
          <Skeleton width="90%" height={12} className="opacity-50" />
        </div>
      </div>
    </motion.div>
  );
};

// Model card skeleton
export const ModelCardSkeleton = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-4 rounded-xl bg-white/5 border border-white/10"
    >
      <div className="flex items-start gap-3">
        <Skeleton width={48} height={48} rounded="xl" />
        <div className="flex-1 flex flex-col gap-2">
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" height={12} className="opacity-50" />
          <div className="flex gap-2 mt-2">
            <Skeleton width={60} height={20} rounded="full" />
            <Skeleton width={80} height={20} rounded="full" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Settings section skeleton
export const SettingsSkeleton = () => {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton width="30%" height={24} />
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center justify-between p-3 bg-white/3 rounded-lg">
            <div className="flex flex-col gap-1">
              <Skeleton width={120} height={14} />
              <Skeleton width={200} height={12} className="opacity-50" />
            </div>
            <Skeleton width={50} height={24} rounded="full" />
          </div>
        ))}
      </div>
    </div>
  );
};

// Full page skeleton loader
export const PageSkeleton = () => {
  return (
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton width={200} height={32} />
        <div className="flex gap-2">
          <Skeleton width={100} height={36} rounded="lg" />
          <Skeleton width={100} height={36} rounded="lg" />
        </div>
      </div>
      
      {/* Content grid */}
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <ModelCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
};

// Chat area loading
export const ChatAreaSkeleton = () => {
  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        <MessageSkeleton isUser={false} />
        <MessageSkeleton isUser={true} />
        <MessageSkeleton isUser={false} />
      </div>
      
      {/* Input area */}
      <div className="p-4 border-t border-white/10">
        <Skeleton height={48} rounded="xl" />
      </div>
    </div>
  );
};

export default Skeleton;






