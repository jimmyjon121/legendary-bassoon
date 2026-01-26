import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';

/**
 * CollapsibleSidebar - Animated collapsible sidebar wrapper
 */
export const CollapsibleSidebar = ({ 
  children, 
  defaultCollapsed = false,
  collapsedWidth = 64,
  expandedWidth = 280,
  side = 'left',
  className = ''
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const toggleSidebar = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const sidebarVariants = {
    expanded: {
      width: expandedWidth,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      },
    },
    collapsed: {
      width: collapsedWidth,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      },
    },
  };

  const contentVariants = {
    expanded: {
      opacity: 1,
      x: 0,
      transition: { delay: 0.1, duration: 0.2 },
    },
    collapsed: {
      opacity: 0,
      x: side === 'left' ? -20 : 20,
      transition: { duration: 0.1 },
    },
  };

  const toggleButtonVariants = {
    expanded: { rotate: side === 'left' ? 0 : 180 },
    collapsed: { rotate: side === 'left' ? 180 : 0 },
  };

  return (
    <motion.aside
      className={`relative h-full border-r border-white/10 bg-black/20 backdrop-blur-sm ${className}`}
      variants={sidebarVariants}
      initial={isCollapsed ? 'collapsed' : 'expanded'}
      animate={isCollapsed ? 'collapsed' : 'expanded'}
    >
      {/* Toggle Button */}
      <motion.button
        onClick={toggleSidebar}
        className={`absolute z-20 top-4 ${side === 'left' ? '-right-3' : '-left-3'} 
          w-6 h-6 rounded-full bg-[var(--ws-primary)] border-2 border-black/50
          flex items-center justify-center cursor-pointer shadow-lg
          hover:scale-110 transition-transform`}
        variants={toggleButtonVariants}
        initial={isCollapsed ? 'collapsed' : 'expanded'}
        animate={isCollapsed ? 'collapsed' : 'expanded'}
        whileHover={{ 
          boxShadow: '0 0 20px var(--ws-glow)',
        }}
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft size={14} className="text-white" />
      </motion.button>

      {/* Sidebar Content */}
      <AnimatePresence mode="wait">
        {!isCollapsed ? (
          <motion.div
            key="expanded-content"
            className="h-full overflow-hidden"
            variants={contentVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
          >
            {children}
          </motion.div>
        ) : (
          <motion.div
            key="collapsed-content"
            className="h-full flex flex-col items-center pt-16 gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.2 } }}
            exit={{ opacity: 0 }}
          >
            {/* Mini icons when collapsed */}
            <CollapsedIcon 
              icon={<Menu size={20} />} 
              tooltip="Menu" 
              onClick={toggleSidebar}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edge Glow Effect */}
      <div 
        className={`absolute top-0 ${side === 'left' ? 'right-0' : 'left-0'} 
          w-px h-full bg-gradient-to-b from-transparent via-[var(--ws-primary)]/30 to-transparent`}
      />
    </motion.aside>
  );
};

/**
 * CollapsedIcon - Icon button for collapsed state
 */
const CollapsedIcon = ({ icon, tooltip, onClick }) => {
  return (
    <motion.button
      onClick={onClick}
      className="relative group p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      <span className="text-white/60 group-hover:text-white transition-colors">
        {icon}
      </span>
      
      {/* Tooltip */}
      <motion.span
        className="absolute left-full ml-2 px-2 py-1 bg-black/90 rounded text-xs text-white whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
        initial={false}
      >
        {tooltip}
      </motion.span>
    </motion.button>
  );
};

/**
 * SidebarSection - Collapsible section within sidebar
 */
export const SidebarSection = ({ 
  title, 
  children, 
  defaultOpen = true,
  icon,
  count
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="py-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-white/50 hover:text-white/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-white/40">{icon}</span>}
          <span className="uppercase tracking-wider">{title}</span>
          {count !== undefined && (
            <span className="px-1.5 py-0.5 bg-white/10 rounded text-[10px]">
              {count}
            </span>
          )}
        </div>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight size={12} className="rotate-90" />
        </motion.span>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CollapsibleSidebar;






