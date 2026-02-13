import React, { useState, memo, useCallback, useEffect, useMemo } from 'react';
import { 
  MessageCircle, Briefcase, Code2, Beaker, Lock, Settings, Image, 
  Plus, ChevronLeft, ChevronRight, Search, 
  Cpu, Globe, Command, Download
} from 'lucide-react';
import { useAppStore, WORKSPACES } from '../../stores/appStore';
import { HardwareMonitorCompact } from '../HardwareMonitor/HardwareMonitor';
import { PowerModeToggle } from '../PowerMode/PowerModeToggle';
import { VirtualizedConversationList } from './VirtualizedConversationList';
import { FolderTree } from './FolderTree';
import { QuickFilters, QuickFiltersCompact } from './QuickFilters';
import { ConversationCard } from './ConversationCard';

const ICONS = { MessageCircle, Briefcase, Code2, Beaker, Lock };

// Static workspace colors - no recomputation
const WS_COLORS = {
  casual: '#818cf8',
  work: '#10b981',
  code: '#f59e0b',
  research: '#0ea5e9',
  nsfw: '#f472b6',
};

// Memoized workspace tab
const WorkspaceTab = memo(function WorkspaceTab({ ws, isActive, isCollapsed, onClick }) {
  const Icon = ICONS[ws.icon];
  const color = WS_COLORS[ws.id];
  
  return (
    <button
      onClick={onClick}
      className={`${isCollapsed ? 'w-11 h-11' : 'flex-1 h-10'} 
        flex items-center justify-center gap-2 rounded-lg transition-colors
        ${isActive ? 'bg-glass-4' : 'text-text-muted hover:text-text-secondary hover:bg-glass-2'}`}
      style={isActive ? { borderColor: `${color}40`, border: '1px solid' } : {}}
      title={ws.name}
    >
      <Icon size={isCollapsed ? 18 : 15} style={isActive ? { color } : {}} />
      {!isCollapsed && (
        <span className="text-xs font-medium" style={isActive ? { color } : {}}>
          {ws.name}
        </span>
      )}
    </button>
  );
});

export function Sidebar() {
  // Store subscriptions
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const setWorkspace = useAppStore(s => s.setWorkspace);
  const currentConversationId = useAppStore(s => s.currentConversationId);
  const selectConversation = useAppStore(s => s.selectConversation);
  const createConversation = useAppStore(s => s.createConversation);
  const deleteConversation = useAppStore(s => s.deleteConversation);
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const toggleSettings = useAppStore(s => s.toggleSettings);
  const toggleImageGen = useAppStore(s => s.toggleImageGen);
  const toggleModelLibrary = useAppStore(s => s.toggleModelLibrary);
  const toggleModelHub = useAppStore(s => s.toggleModelHub);
  const toggleModelSelector = useAppStore(s => s.toggleModelSelector);
  const toggleDownloadCenter = useAppStore(s => s.toggleDownloadCenter);
  
  // Organization state
  const conversations = useAppStore(s => s.conversations);
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const getFilteredConversations = useAppStore(s => s.getFilteredConversations);
  const loadFolders = useAppStore(s => s.loadFolders);
  const loadWorkspaceTags = useAppStore(s => s.loadWorkspaceTags);
  // Subscribe to activeFilter so component re-renders when filter changes
  const activeFilter = useAppStore(s => s.activeFilter);
  const activeFolderId = useAppStore(s => s.activeFolderId);
  
  // Show global search modal
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);

  // Get filtered conversations using the organization slice
  // This will re-run when activeFilter, activeFolderId, searchQuery, or conversations change
  const filteredConversations = useMemo(() => {
    return getFilteredConversations();
  }, [getFilteredConversations, activeFilter, activeFolderId, searchQuery, conversations]);
  
  // Load folders and tags when workspace changes
  useEffect(() => {
    loadFolders?.();
    loadWorkspaceTags?.();
  }, [currentWorkspace]);

  const handleNewChat = useCallback(() => createConversation(), [createConversation]);
  const accentColor = WS_COLORS[currentWorkspace] || WS_COLORS.casual;

  // Global search keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowGlobalSearch(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Get lock function for private workspace exit
  const lockNsfw = useAppStore(s => s.lockNsfw);
  const isInPrivateWorkspace = currentWorkspace === 'nsfw';
  const isResearchWorkspace = currentWorkspace === 'research';

  return (
    <aside className={`${sidebarCollapsed ? 'w-[68px]' : 'w-[280px]'} 
      h-full flex flex-col relative bg-surface-0 border-r border-border-subtle transition-all duration-200
      ${isInPrivateWorkspace ? 'ring-1 ring-pink-500/30' : ''}`}
    >
      {/* Private Workspace Banner */}
      {isInPrivateWorkspace && (
        <div className={`${sidebarCollapsed ? 'p-2' : 'px-3 py-2'} bg-gradient-to-r from-pink-500/10 to-purple-500/10 border-b border-pink-500/20`}>
          {sidebarCollapsed ? (
            <button
              onClick={lockNsfw}
              className="w-11 h-8 flex items-center justify-center rounded-lg bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 transition-colors"
              title="Exit Private Mode"
            >
              <Lock size={14} />
            </button>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-pink-500/20 flex items-center justify-center">
                  <Lock size={12} className="text-pink-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-pink-300">Private Mode</p>
                  <p className="text-[10px] text-pink-400/60">Encrypted & isolated</p>
                </div>
              </div>
              <button
                onClick={lockNsfw}
                className="px-2 py-1 text-[10px] rounded bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 transition-colors"
              >
                Exit
              </button>
            </div>
          )}
        </div>
      )}

      {/* Workspace Tabs - only show if NOT in private workspace */}
      {!isInPrivateWorkspace && (
        <div className={`p-2 ${sidebarCollapsed ? 'flex flex-col items-center gap-1' : 'flex gap-1'}`}>
          {Object.values(WORKSPACES)
            .filter(ws => ws.id !== 'nsfw')
            .map(ws => (
              <WorkspaceTab
                key={ws.id}
                ws={ws}
                isActive={currentWorkspace === ws.id}
                isCollapsed={sidebarCollapsed}
                onClick={() => setWorkspace(ws.id)}
              />
            ))}
        </div>
      )}

      {/* New Chat + Search */}
      {!sidebarCollapsed && !isResearchWorkspace && (
        <div className="px-3 pb-2 space-y-2">
          <button
            onClick={handleNewChat}
            className="w-full h-10 flex items-center justify-center gap-2 rounded-lg 
              font-medium text-sm text-white transition-opacity hover:opacity-90"
            style={{ background: accentColor }}
          >
            <Plus size={16} />
            New Chat
          </button>
          
          {/* Search bar - opens global search */}
          <button
            onClick={() => setShowGlobalSearch(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm bg-surface-1 border border-border-muted rounded-lg
              text-text-muted hover:border-border-emphasis transition-colors text-left"
          >
            <Search size={14} />
            <span className="flex-1">Search...</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-glass-2 rounded border border-border-muted">
              <Command size={10} className="inline" />K
            </kbd>
          </button>
        </div>
      )}

      {/* Quick Filters */}
      {!sidebarCollapsed && !isResearchWorkspace && (
        <div className="px-3 pb-2">
          <QuickFilters />
        </div>
      )}

      {/* Collapsed: New Chat + Filters */}
      {sidebarCollapsed && !isResearchWorkspace && (
        <div className="p-2 flex flex-col items-center gap-2">
          <button
            onClick={handleNewChat}
            className="w-11 h-11 flex items-center justify-center rounded-lg transition-colors"
            style={{ background: `${accentColor}20`, color: accentColor }}
            title="New Chat"
          >
            <Plus size={18} />
          </button>
          
          <button
            onClick={() => setShowGlobalSearch(true)}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-text-muted hover:text-text-secondary hover:bg-glass-2 transition-colors"
            title="Search (Cmd+K)"
          >
            <Search size={18} />
          </button>
          
          <QuickFiltersCompact />
        </div>
      )}

      {/* Folders (expanded only) */}
      {!sidebarCollapsed && !isResearchWorkspace && (
        <div className="px-1 pb-2 border-b border-border-subtle">
          <FolderTree />
        </div>
      )}

      {/* Conversations List */}
      <div className="flex-1 overflow-hidden">
        {isResearchWorkspace && !sidebarCollapsed ? (
          <div className="h-full px-4 py-8 text-center">
            <p className="text-sm text-text-secondary">Research mode</p>
            <p className="text-xs text-text-muted mt-1">Projects and runs are managed in the main panel.</p>
          </div>
        ) : !sidebarCollapsed && filteredConversations.length > 20 ? (
          <VirtualizedConversationList
            conversations={filteredConversations}
            currentConversationId={currentConversationId}
            onSelect={selectConversation}
            onDelete={deleteConversation}
            accentColor={accentColor}
          />
        ) : !sidebarCollapsed && filteredConversations.length > 0 ? (
          <div className="h-full overflow-y-auto scrollbar-premium px-2 py-1">
            {filteredConversations.map((conv) => (
              <ConversationCard
                key={conv.id}
                conv={conv}
                isActive={currentConversationId === conv.id}
                onSelect={selectConversation}
                onDelete={deleteConversation}
                accentColor={accentColor}
              />
            ))}
          </div>
        ) : !sidebarCollapsed && (
          <div className="text-center py-12 px-4">
            <p className="text-text-secondary text-sm">No conversations yet</p>
            <p className="text-text-muted text-xs mt-1">Start a new chat</p>
          </div>
        )}
      </div>

      {/* Hardware Monitor */}
      {!sidebarCollapsed && (
        <div className="border-t border-border-subtle">
          <HardwareMonitorCompact />
        </div>
      )}

      {/* Bottom Actions - Scrollable when needed */}
      <div className={`p-2 border-t border-border-subtle overflow-y-auto max-h-32 scrollbar-premium ${sidebarCollapsed ? 'flex flex-col items-center gap-1' : 'flex flex-wrap gap-1'}`}>
        <PowerModeToggle compact />
        
        {[
          { action: toggleModelSelector, icon: Cpu, label: 'Model', title: 'Select Model' },
          { action: toggleModelHub, icon: Globe, label: 'Hub', title: 'Model Hub' },
          { action: toggleDownloadCenter, icon: Download, label: 'Downloads', title: 'Downloads' },
          { action: toggleImageGen, icon: Image, label: 'Images', title: 'Image Gen' },
          { action: toggleSettings, icon: Settings, label: 'Settings', title: 'Settings' },
        ].map(({ action, icon: Icon, label, title }) => (
          <button
            key={label}
            onClick={action}
            className={`${sidebarCollapsed ? 'w-11 h-11' : 'flex-1 min-w-fit h-10'}
              flex items-center justify-center gap-1.5 rounded-lg
              text-text-muted hover:text-text-primary hover:bg-glass-3 transition-colors`}
            title={title}
          >
            <Icon size={16} />
            {!sidebarCollapsed && <span className="text-xs font-medium">{label}</span>}
          </button>
        ))}
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-14 rounded-r-lg
          bg-surface-2 border border-border-muted border-l-0
          flex items-center justify-center text-text-muted hover:text-text-primary
          hover:bg-surface-3 transition-colors z-20"
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  );
}
