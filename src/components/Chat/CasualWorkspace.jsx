import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Layout, 
  FileText, 
  Clock, 
  Focus, 
  Grid3X3,
  ChevronDown,
  Check,
  Sparkles,
  Cpu,
  Zap,
  Globe,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { useCasualStore } from '../../stores/casualStore';
import { useModelExperience } from '../../services/modelExperience';

// Import view components
import { StreamView } from './views/StreamView';
import { CanvasView } from './views/CanvasView';
import { DocumentView } from './views/DocumentView';
import { TimelineView } from './views/TimelineView';
import { FocusView } from './views/FocusView';

const VIEWS = [
  {
    id: 'stream',
    name: 'Stream',
    icon: MessageSquare,
    description: 'Classic chat with streaming responses',
    shortcut: '1',
    color: '#818cf8',
  },
  {
    id: 'canvas',
    name: 'Canvas',
    icon: Layout,
    description: 'Visual mind-map of your conversation',
    shortcut: '2',
    color: '#10b981',
  },
  {
    id: 'document',
    name: 'Document',
    icon: FileText,
    description: 'Structured Q&A with markdown and export',
    shortcut: '3',
    color: '#f59e0b',
  },
  {
    id: 'timeline',
    name: 'Timeline',
    icon: Clock,
    description: 'Chronological view with stats and search',
    shortcut: '4',
    color: '#ec4899',
  },
  {
    id: 'focus',
    name: 'Focus',
    icon: Focus,
    description: 'Distraction-free zen mode',
    shortcut: '5',
    color: '#06b6d4',
  },
];

export function CasualWorkspace() {
  const isGenerating = useAppStore(s => s.isGenerating);
  const messages = useAppStore(s => s.messages);
  const currentModel = useAppStore(s => s.currentModel);
  const contextUtilization = useAppStore(s => s.contextUtilization);
  const generationMetadata = useAppStore(s => s.generationMetadata);
  
  const currentView = useCasualStore(s => s.currentView);
  const setCurrentView = useCasualStore(s => s.setCurrentView);
  const conversationMetadata = useCasualStore(s => s.conversationMetadata);
  
  const preferredView = useModelExperience(s => s.uiConfig?.preferredView);

  const [showViewSelector, setShowViewSelector] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowViewSelector(false);
      }
    };
    
    if (showViewSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showViewSelector]);

  // Auto-switch view based on model recommendation (only if user hasn't manually selected)
  useEffect(() => {
    if (preferredView && preferredView !== currentView) {
      const lastManualSwitch = localStorage.getItem('lastManualViewSwitch');
      const threshold = 5 * 60 * 1000;
      
      if (!lastManualSwitch || Date.now() - parseInt(lastManualSwitch) > threshold) {
        setCurrentView(preferredView);
      }
    }
  }, [preferredView, currentView, setCurrentView]);

  // Keyboard shortcuts for view switching
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const viewIndex = parseInt(e.key) - 1;
        if (VIEWS[viewIndex]) {
          switchView(VIEWS[viewIndex].id, true);
        }
      }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setShowViewSelector(prev => !prev);
      }
      if (e.key === 'Escape' && showViewSelector) {
        setShowViewSelector(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showViewSelector]);

  const switchView = (viewId, manual = false) => {
    if (viewId === currentView) return;
    
    if (manual) {
      localStorage.setItem('lastManualViewSwitch', Date.now().toString());
    }
    
    setCurrentView(viewId);
    setShowViewSelector(false);
  };

  const getCurrentViewComponent = () => {
    switch (currentView) {
      case 'stream': return <StreamView />;
      case 'canvas': return <CanvasView />;
      case 'document': return <DocumentView />;
      case 'timeline': return <TimelineView />;
      case 'focus': return <FocusView />;
      default: return <StreamView />;
    }
  };

  const currentViewConfig = VIEWS.find(v => v.id === currentView) || VIEWS[0];

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* View Header with Tab-style Navigation */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-surface-0">
        {/* View Tabs */}
        <div className="flex items-center gap-0.5">
          {VIEWS.map((view) => {
            const Icon = view.icon;
            const isActive = view.id === currentView;
            
            return (
              <button
                key={view.id}
                onClick={() => switchView(view.id, true)}
                className={`
                  group relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                  transition-all duration-200 cursor-pointer
                  ${isActive 
                    ? 'text-white shadow-lg' 
                    : 'text-text-muted hover:text-text-primary hover:bg-glass-3'
                  }
                `}
                style={isActive ? { 
                  background: `linear-gradient(135deg, ${view.color}dd, ${view.color}99)`,
                  boxShadow: `0 2px 10px ${view.color}35`
                } : {}}
                title={`${view.name} - ${view.description} (Alt+${view.shortcut})`}
              >
                <Icon size={15} />
                <span className="hidden sm:inline text-[13px]">{view.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* Model + Status indicators */}
          <div className="hidden md:flex items-center gap-2 text-[11px]">
            {/* Current Model */}
            {currentModel && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-2/50 rounded-lg text-text-secondary">
                <Cpu size={11} className="text-accent-primary" />
                <span className="truncate max-w-[140px]">{currentModel.split(':')[0]}</span>
              </div>
            )}
            
            {/* Context usage */}
            {contextUtilization?.utilizationPercent > 0 && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                contextUtilization.utilizationPercent > 80 ? 'bg-red-500/10 text-red-400' :
                contextUtilization.utilizationPercent > 50 ? 'bg-amber-500/10 text-amber-400' :
                'bg-emerald-500/10 text-emerald-400'
              }`}>
                <div className="w-14 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${
                      contextUtilization.utilizationPercent > 80 ? 'bg-red-400' :
                      contextUtilization.utilizationPercent > 50 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(100, contextUtilization.utilizationPercent)}%` }}
                  />
                </div>
                <span>{contextUtilization.utilizationPercent}%</span>
              </div>
            )}

            {/* Generation status */}
            {isGenerating && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-primary/10 rounded-lg text-accent-primary">
                <Loader2 size={11} className="animate-spin" />
                <span>
                  {generationMetadata?.tokensPerSecond > 0 
                    ? `${generationMetadata.tokensPerSecond} tok/s`
                    : 'Generating'
                  }
                </span>
              </div>
            )}
            
            {/* Message count */}
            {messages.length > 0 && !isGenerating && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-2/50 rounded-lg text-text-muted">
                <MessageSquare size={11} />
                <span>{messages.length}</span>
              </div>
            )}
          </div>

          {/* Expanded View Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowViewSelector(!showViewSelector)}
              className={`
                flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm
                transition-all duration-150
                ${showViewSelector 
                  ? 'bg-accent-primary/15 text-accent-primary border border-accent-primary/30' 
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-2 border border-transparent'
                }
              `}
              title="View options (Shift+Tab)"
            >
              <Grid3X3 size={15} />
              <ChevronDown 
                size={13} 
                className={`transition-transform duration-200 ${showViewSelector ? 'rotate-180' : ''}`} 
              />
            </button>

            <AnimatePresence>
              {showViewSelector && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full right-0 mt-2 w-72 bg-surface-1 border border-border-muted rounded-xl shadow-2xl z-50 overflow-hidden"
                >
                  {/* Dropdown Header */}
                  <div className="px-4 py-3 border-b border-border-subtle bg-surface-0">
                    <h3 className="text-sm font-semibold text-text-primary">Switch View</h3>
                    <p className="text-xs text-text-muted mt-0.5">Choose how to display your conversation</p>
                  </div>
                  
                  {/* View Options */}
                  <div className="p-2">
                    {VIEWS.map((view) => {
                      const Icon = view.icon;
                      const isActive = view.id === currentView;
                      
                      return (
                        <button
                          key={view.id}
                          onClick={() => switchView(view.id, true)}
                          className={`
                            w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                            transition-all duration-150 cursor-pointer
                            ${isActive 
                              ? 'bg-glass-4' 
                              : 'hover:bg-glass-3'
                            }
                          `}
                        >
                          <div 
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ 
                              background: isActive ? view.color : `${view.color}15`,
                              color: isActive ? 'white' : view.color
                            }}
                          >
                            <Icon size={17} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>
                                {view.name}
                              </span>
                              {isActive && (
                                <Check size={13} className="text-accent-success" />
                              )}
                            </div>
                            <p className="text-[11px] text-text-muted truncate">{view.description}</p>
                          </div>
                          <kbd className="text-[10px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded border border-border-subtle font-mono">
                            Alt+{view.shortcut}
                          </kbd>
                        </button>
                      );
                    })}
                  </div>
                  
                  {/* Dropdown Footer */}
                  <div className="px-4 py-2 border-t border-border-subtle bg-surface-0/50">
                    <p className="text-[10px] text-text-muted">
                      <kbd className="bg-surface-2 px-1 py-0.5 rounded text-[9px] border border-border-subtle">Shift</kbd>
                      <span className="mx-1">+</span>
                      <kbd className="bg-surface-2 px-1 py-0.5 rounded text-[9px] border border-border-subtle">Tab</kbd>
                      <span className="ml-1.5">toggle this menu</span>
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* View Content */}
      <div className="flex-1 relative min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-0 flex flex-col"
          >
            {getCurrentViewComponent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default CasualWorkspace;
