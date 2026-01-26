import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Map, 
  FileText, 
  Clock, 
  Focus, 
  Grid3X3,
  ChevronDown,
  Check,
  Sparkles
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
    description: 'Traditional chat flow',
    shortcut: '1',
    color: '#818cf8',
  },
  {
    id: 'canvas',
    name: 'Canvas',
    icon: Map,
    description: 'Visual mind mapping',
    shortcut: '2',
    color: '#10b981',
  },
  {
    id: 'document',
    name: 'Document',
    icon: FileText,
    description: 'Build knowledge docs',
    shortcut: '3',
    color: '#f59e0b',
  },
  {
    id: 'timeline',
    name: 'Timeline',
    icon: Clock,
    description: 'Chronological view',
    shortcut: '4',
    color: '#ec4899',
  },
  {
    id: 'focus',
    name: 'Focus',
    icon: Focus,
    description: 'Distraction-free mode',
    shortcut: '5',
    color: '#06b6d4',
  },
];

// #region agent log - render counter
let casualWorkspaceRenderCount = 0;
// #endregion

export function CasualWorkspace() {
  // #region agent log - track renders
  casualWorkspaceRenderCount++;
  const renderNum = casualWorkspaceRenderCount;
  // #endregion

  // Use selective subscriptions for optimal re-render performance
  const isGenerating = useAppStore(s => s.isGenerating);
  const messages = useAppStore(s => s.messages);
  
  const currentView = useCasualStore(s => s.currentView);
  const setCurrentView = useCasualStore(s => s.setCurrentView);
  const conversationMetadata = useCasualStore(s => s.conversationMetadata);
  
  // Model experience for adaptive UI - use selective subscription
  const preferredView = useModelExperience(s => s.uiConfig?.preferredView);

  // #region agent log - log state values
  // #endregion

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

  // Auto-switch view based on model recommendation
  useEffect(() => {
    // #region agent log - useEffect for view switch
    // #endregion
    if (preferredView && preferredView !== currentView) {
      // Only auto-switch if user hasn't manually selected a view recently
      const lastManualSwitch = localStorage.getItem('lastManualViewSwitch');
      const threshold = 5 * 60 * 1000; // 5 minutes
      
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
      // Escape to close dropdown
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-surface-0">
        {/* View Tabs - Quick Access */}
        <div className="flex items-center gap-1">
          {VIEWS.map((view) => {
            const Icon = view.icon;
            const isActive = view.id === currentView;
            
            return (
              <button
                key={view.id}
                onClick={() => switchView(view.id, true)}
                className={`
                  group relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                  transition-all duration-150 cursor-pointer
                  ${isActive 
                    ? 'text-white shadow-lg' 
                    : 'text-text-muted hover:text-text-primary hover:bg-glass-3'
                  }
                `}
                style={isActive ? { 
                  background: `linear-gradient(135deg, ${view.color}dd, ${view.color}aa)`,
                  boxShadow: `0 4px 12px ${view.color}40`
                } : {}}
                title={`${view.name} - ${view.description} (Alt+${view.shortcut})`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{view.name}</span>
                
                {/* Active indicator - simplified */}
                {isActive && (
                  <div className="absolute inset-0 rounded-lg bg-white/5" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {/* Conversation Metadata */}
          {messages.length > 0 && (
            <div className="hidden md:flex items-center gap-2 text-xs text-text-muted px-2 py-1 bg-glass-2 rounded-lg">
              <Sparkles size={12} className="text-accent-primary" />
              <span>{messages.length} messages</span>
              {conversationMetadata?.topicCount > 0 && (
                <>
                  <span className="text-border-emphasis">•</span>
                  <span>{conversationMetadata.topicCount} topics</span>
                </>
              )}
            </div>
          )}

          {/* Expanded View Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowViewSelector(!showViewSelector)}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                transition-all duration-150
                ${showViewSelector 
                  ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/40' 
                  : 'text-text-muted hover:text-text-primary hover:bg-glass-3 border border-transparent'
                }
              `}
              title="View options (Shift+Tab)"
            >
              <Grid3X3 size={16} />
              <span className="hidden sm:inline">More</span>
              <ChevronDown 
                size={14} 
                className={`transition-transform duration-200 ${showViewSelector ? 'rotate-180' : ''}`} 
              />
            </button>

            <AnimatePresence>
              {showViewSelector && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.1 }}
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
                            w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left
                            transition-all duration-150 cursor-pointer
                            ${isActive 
                              ? 'bg-glass-4' 
                              : 'hover:bg-glass-3'
                            }
                          `}
                        >
                          <div 
                            className="w-9 h-9 rounded-lg flex items-center justify-center"
                            style={{ 
                              background: isActive ? view.color : `${view.color}20`,
                              color: isActive ? 'white' : view.color
                            }}
                          >
                            <Icon size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>
                                {view.name}
                              </span>
                              {isActive && (
                                <Check size={14} className="text-accent-success" />
                              )}
                            </div>
                            <p className="text-xs text-text-muted truncate">{view.description}</p>
                          </div>
                          <kbd className="text-[10px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded border border-border-subtle font-mono">
                            Alt+{view.shortcut}
                          </kbd>
                        </button>
                      );
                    })}
                  </div>
                  
                  {/* Dropdown Footer */}
                  <div className="px-4 py-2.5 border-t border-border-subtle bg-surface-0/50">
                    <p className="text-[10px] text-text-muted">
                      <kbd className="bg-surface-2 px-1 py-0.5 rounded text-[9px] border border-border-subtle">Shift</kbd>
                      <span className="mx-1">+</span>
                      <kbd className="bg-surface-2 px-1 py-0.5 rounded text-[9px] border border-border-subtle">Tab</kbd>
                      <span className="ml-1.5">to toggle this menu</span>
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
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
