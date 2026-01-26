import React from 'react';
import { motion } from 'framer-motion';
import { 
  MessageSquare, 
  Sparkles, 
  Zap, 
  Brain,
  Rocket,
  Coffee
} from 'lucide-react';

// Floating particles for background
const FloatingParticle = ({ delay = 0 }) => (
  <motion.div
    className="absolute w-1 h-1 rounded-full bg-indigo-400/30"
    initial={{ opacity: 0 }}
    animate={{
      opacity: [0, 0.5, 0],
      y: [0, -40],
      x: [0, Math.random() * 20 - 10],
    }}
    transition={{
      duration: 3,
      delay,
      repeat: Infinity,
      ease: 'easeOut',
    }}
    style={{
      left: `${Math.random() * 100}%`,
      bottom: '30%',
    }}
  />
);

// Animated icon showcase
const AnimatedIcon = () => {
  const icons = [MessageSquare, Sparkles, Brain, Zap];
  
  return (
    <div className="relative w-24 h-24 mb-6">
      {/* Outer glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      
      {/* Inner circle with icon */}
      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 
                      border border-indigo-500/20 flex items-center justify-center">
        <motion.div
          animate={{
            rotate: [0, 360],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'linear',
          }}
        >
          {/* Orbiting icons */}
          {icons.map((Icon, i) => (
            <motion.div
              key={i}
              className="absolute"
              style={{
                transform: `rotate(${i * 90}deg) translateY(-32px)`,
              }}
            >
              <motion.div
                animate={{
                  scale: [0.8, 1.1, 0.8],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  delay: i * 0.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                <Icon className="w-4 h-4 text-indigo-400" />
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
        
        {/* Center icon */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <Sparkles className="w-8 h-8 text-indigo-400" />
        </motion.div>
      </div>
    </div>
  );
};

export const EmptyState = ({
  title = "No conversations yet",
  subtitle = "Start a new conversation to begin",
  icon = null,
  action = null,
  variant = 'default', // 'default' | 'minimal' | 'fun'
}) => {
  if (variant === 'minimal') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-full text-center p-8"
      >
        <div className="text-white/30 mb-3">
          {icon || <MessageSquare className="w-12 h-12" />}
        </div>
        <p className="text-white/50 text-sm">{title}</p>
      </motion.div>
    );
  }
  
  if (variant === 'fun') {
    const funMessages = [
      { icon: Coffee, text: "Grab a coffee and let's chat!" },
      { icon: Rocket, text: "Ready for takeoff?" },
      { icon: Brain, text: "Let's think together!" },
    ];
    const random = funMessages[Math.floor(Math.random() * funMessages.length)];
    const FunIcon = random.icon;
    
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center h-full text-center p-8 relative"
      >
        {/* Floating particles */}
        {[...Array(8)].map((_, i) => (
          <FloatingParticle key={i} delay={i * 0.3} />
        ))}
        
        <motion.div
          animate={{
            y: [0, -5, 0],
            rotate: [-5, 5, -5],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <FunIcon className="w-16 h-16 text-indigo-400 mb-4" />
        </motion.div>
        
        <motion.p
          className="text-white/70 text-lg font-medium"
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {random.text}
        </motion.p>
        
        {action}
      </motion.div>
    );
  }
  
  // Default variant
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center h-full text-center p-8 relative"
    >
      {/* Background particles */}
      {[...Array(6)].map((_, i) => (
        <FloatingParticle key={i} delay={i * 0.5} />
      ))}
      
      {/* Animated icon display */}
      <AnimatedIcon />
      
      {/* Title */}
      <motion.h3
        className="text-xl font-semibold text-white/90 mb-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {title}
      </motion.h3>
      
      {/* Subtitle */}
      <motion.p
        className="text-white/50 text-sm max-w-xs mb-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {subtitle}
      </motion.p>
      
      {/* Suggestion chips */}
      <motion.div
        className="flex flex-wrap justify-center gap-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        {['💡 Ask a question', '📝 Get help writing', '🔧 Debug code'].map((chip, i) => (
          <motion.button
            key={chip}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            className="px-3 py-1.5 rounded-full text-xs
                       bg-white/5 border border-white/10
                       text-white/70 hover:text-white/90 hover:bg-white/10
                       transition-colors"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.1 }}
          >
            {chip}
          </motion.button>
        ))}
      </motion.div>
      
      {/* Action button if provided */}
      {action && (
        <motion.div
          className="mt-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          {action}
        </motion.div>
      )}
    </motion.div>
  );
};

// Specific variants for different contexts
export const NoConversationsState = () => (
  <EmptyState
    title="Start your first conversation"
    subtitle="Type a message below to begin chatting with AI"
  />
);

export const NoSearchResultsState = ({ query }) => (
  <EmptyState
    variant="minimal"
    title={`No results for "${query}"`}
    subtitle="Try a different search term"
  />
);

export const NoModelsState = () => (
  <EmptyState
    variant="fun"
    title="No models installed"
    subtitle="Browse the model library to get started"
  />
);

export default EmptyState;






