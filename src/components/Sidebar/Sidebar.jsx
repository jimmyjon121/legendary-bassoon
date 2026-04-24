import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircle, Briefcase, Code2, Beaker, Settings, Image,
  Plus, ChevronLeft, ChevronRight, Search, Cpu,
  Globe, Download,
  GripVertical, RotateCcw, SlidersHorizontal, EyeOff, FolderKanban, Link2, Lock, Shield,
} from 'lucide-react';
import { useAppStore, WORKSPACES } from '../../stores/appStore';
import { HardwareMonitorCompact } from '../HardwareMonitor/HardwareMonitor';
import { PowerModeToggle } from '../PowerMode/PowerModeToggle';
import { FolderTree } from './FolderTree';
import { QuickFilters, QuickFiltersCompact } from './QuickFilters';
import { ConversationCard } from './ConversationCard';

const ICONS = { MessageCircle, Briefcase, Code2, Beaker, Lock };
const FALLBACK_ICON = MessageCircle;
const ENABLED_WORKSPACES = ['casual', 'work', 'research', 'code', 'nsfw'];

// Static workspace colors - no recomputation
const WS_COLORS = {
  casual: '#818cf8',
  work: '#10b981',
  research: '#38bdf8',
  code: '#f59e0b',
  nsfw: '#f472b6',
};

const WS_SUMMARIES = {
  casual: 'Open-ended chat, search, and quick questions',
  work: 'Structured help for planning, writing, and decisions',
  research: 'Source-grounded investigation and synthesis',
  code: 'Project-aware debugging, patching, and review',
  nsfw: 'Private encrypted vault workspace',
};

const SIDEBAR_SECTION_META = {
  workspaces: { label: 'Workspaces' },
  projects: { label: 'Projects' },
  compose: { label: 'Start' },
  filters: { label: 'Filters' },
  folders: { label: 'Folders' },
  conversations: { label: 'Conversations' },
  system: { label: 'System' },
  actions: { label: 'Shortcuts' },
};
const COLLAPSED_SIDEBAR_WIDTH = 72;

const SidebarSectionShell = memo(function SidebarSectionShell({
  sectionId,
  label,
  customizing,
  isDropTarget,
  accentColor,
  onHide,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  fillSpace = false,
  children,
}) {
  return (
    <section
      draggable={customizing}
      onDragStart={customizing ? onDragStart : undefined}
      onDragOver={customizing ? onDragOver : undefined}
      onDrop={customizing ? onDrop : undefined}
      onDragEnd={customizing ? onDragEnd : undefined}
      className={[
        fillSpace ? 'flex min-h-0 flex-1 flex-col' : '',
        customizing
          ? 'relative rounded-2xl border border-dashed bg-white/[0.02] transition-colors'
          : '',
      ].join(' ')}
      style={customizing ? {
        borderColor: isDropTarget ? `${accentColor}55` : 'rgba(255,255,255,0.08)',
        background: isDropTarget ? `${accentColor}12` : 'rgba(255,255,255,0.02)',
      } : undefined}
      data-sidebar-section={sectionId}
    >
      {customizing && (
        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-text-muted">
            <GripVertical size={13} />
            <span>{label}</span>
          </div>
          <button
            type="button"
            onClick={onHide}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-white/16 hover:text-text-primary"
            title={`Hide ${label}`}
          >
            <EyeOff size={12} />
            Hide
          </button>
        </div>
      )}
      <div className={fillSpace ? 'min-h-0 flex-1' : ''}>
        {children}
      </div>
    </section>
  );
});

// Memoized workspace tab
const WorkspaceTab = memo(function WorkspaceTab({ ws, isActive, isCollapsed, onClick }) {
  const Icon = ICONS[ws.icon] || FALLBACK_ICON;
  const color = WS_COLORS[ws.id] || WS_COLORS.casual;
  const summary = WS_SUMMARIES[ws.id] || ws.description || ws.name;
  const activeStyle = isActive
    ? {
        borderColor: `${color}30`,
        background: `${color}10`,
      }
    : {};
  const iconStyle = isActive
    ? { color }
    : { color: '#71717a' };

  return (
    <button
      onClick={onClick}
      className={[
        isCollapsed
          ? 'w-10 h-10 rounded-xl'
          : 'rounded-xl border p-2.5 text-left',
        'group relative overflow-hidden transition-all duration-150',
        isActive
          ? 'text-text-primary'
          : 'border-white/[0.06] bg-white/[0.015] text-text-muted hover:border-white/12 hover:bg-white/[0.04]',
      ].join(' ')}
      style={activeStyle}
      title={ws.name}
    >
      {isCollapsed ? (
        <span className="flex h-full w-full items-center justify-center" style={iconStyle}>
          <Icon size={17} />
        </span>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="shrink-0" style={iconStyle}>
            <Icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <span
              className="block truncate text-[13px] font-semibold"
              style={isActive ? { color } : undefined}
            >
              {ws.name}
            </span>
            <p className="mt-0.5 truncate text-[10px] leading-3 text-text-muted/70">
              {summary}
            </p>
          </div>
          {isActive && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          )}
        </div>
      )}
    </button>
  );
});

export function Sidebar() {
  const asideRef = useRef(null);
  const resizeFrameRef = useRef(0);
  const latestDragWidthRef = useRef(320);
  const draggedSectionRef = useRef(null);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [dragOverSectionId, setDragOverSectionId] = useState(null);

  // Store subscriptions
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const setWorkspace = useAppStore(s => s.setWorkspace);
  const currentConversationId = useAppStore(s => s.currentConversationId);
  const selectConversation = useAppStore(s => s.selectConversation);
  const createConversation = useAppStore(s => s.createConversation);
  const deleteConversation = useAppStore(s => s.deleteConversation);
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed);
  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const sidebarCustomizing = useAppStore(s => s.sidebarCustomizing);
  const sidebarSectionOrder = useAppStore(s => s.sidebarSectionOrder);
  const sidebarSectionVisibility = useAppStore(s => s.sidebarSectionVisibility);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth);
  const toggleSidebarCustomizing = useAppStore(s => s.toggleSidebarCustomizing);
  const setSidebarSectionVisibility = useAppStore(s => s.setSidebarSectionVisibility);
  const reorderSidebarSection = useAppStore(s => s.reorderSidebarSection);
  const resetSidebarCustomization = useAppStore(s => s.resetSidebarCustomization);
  const toggleSettings = useAppStore(s => s.toggleSettings);
  const toggleImageGen = useAppStore(s => s.toggleImageGen);
  const toggleModelHub = useAppStore(s => s.toggleModelHub);
  const toggleModelSelector = useAppStore(s => s.toggleModelSelector);
  const toggleDownloadCenter = useAppStore(s => s.toggleDownloadCenter);
  const isLocked = useAppStore(s => s.isLocked);
  const lockNsfw = useAppStore(s => s.lockNsfw);
  const projects = useAppStore(s => s.projects);
  const projectsLoading = useAppStore(s => s.projectsLoading);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const activeProject = useAppStore(s => s.activeProject);
  const activeProjectConversationIds = useAppStore(s => s.activeProjectConversationIds);
  const activeProjectDocumentIds = useAppStore(s => s.activeProjectDocumentIds);
  const loadProjects = useAppStore(s => s.loadProjects);
  const createProject = useAppStore(s => s.createProject);
  const setActiveProject = useAppStore(s => s.setActiveProject);
  const linkConversationToActiveProject = useAppStore(s => s.linkConversationToActiveProject);
  const refreshActiveProjectLinks = useAppStore(s => s.refreshActiveProjectLinks);

  // Organization state
  const conversations = useAppStore(s => s.conversations);
  const loadConversations = useAppStore(s => s.loadConversations);
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const getFilteredConversations = useAppStore(s => s.getFilteredConversations);
  const loadFolders = useAppStore(s => s.loadFolders);
  const loadWorkspaceTags = useAppStore(s => s.loadWorkspaceTags);
  // Subscribe to activeFilter so component re-renders when filter changes
  const activeFilter = useAppStore(s => s.activeFilter);
  const activeFolderId = useAppStore(s => s.activeFolderId);

  const refreshConversationList = useCallback(async () => {
    const next = await loadConversations?.();
    if (Array.isArray(next)) {
      useAppStore.setState({ conversations: next });
    }
  }, [loadConversations]);

  // Listen for auto-title updates from Chat V2
  useEffect(() => {
    const handleTitleUpdate = () => {
      void refreshConversationList();
    };
    window.addEventListener('chat-v2-title-updated', handleTitleUpdate);
    return () => window.removeEventListener('chat-v2-title-updated', handleTitleUpdate);
  }, [refreshConversationList]);

  // Get filtered conversations using the organization slice
  // This will re-run when activeFilter, activeFolderId, searchQuery, or conversations change
  const filteredConversations = useMemo(() => {
    return getFilteredConversations();
  }, [getFilteredConversations, activeFilter, activeFolderId, searchQuery, conversations]);

  // Load folders and tags when workspace changes
  useEffect(() => {
    loadFolders?.();
    loadWorkspaceTags?.();
  }, [currentWorkspace, loadFolders, loadWorkspaceTags]);

  useEffect(() => {
    loadProjects?.(currentWorkspace).catch(() => {});
  }, [currentWorkspace, loadProjects]);

  const handleNewChat = useCallback(() => createConversation(), [createConversation]);
  const handleCreateProject = useCallback(async () => {
    const name = window.prompt('Project name');
    if (!name || !name.trim()) return;
    await createProject?.({ name: name.trim() });
    await loadProjects?.(currentWorkspace);
  }, [createProject, currentWorkspace, loadProjects]);

  const handleProjectChange = useCallback(async (nextProjectId) => {
    await setActiveProject?.(nextProjectId || null, {
      persist: true,
      linkCurrentConversation: Boolean(currentConversationId),
    });
    await refreshConversationList();
  }, [currentConversationId, refreshConversationList, setActiveProject]);

  const handleLinkCurrentConversation = useCallback(async () => {
    if (!currentConversationId || !activeProjectId) return;
    await linkConversationToActiveProject?.(currentConversationId);
    await refreshActiveProjectLinks?.();
    await refreshConversationList();
  }, [
    activeProjectId,
    currentConversationId,
    linkConversationToActiveProject,
    refreshActiveProjectLinks,
    refreshConversationList,
  ]);
  const accentColor = WS_COLORS[currentWorkspace] || WS_COLORS.casual;
  const maskPrivateMeta = currentWorkspace === 'nsfw';
  const isVaultWorkspace = currentWorkspace === 'nsfw';

  const workspaceTabs = useMemo(() => (
    ENABLED_WORKSPACES
      .map((id) => WORKSPACES[id])
      .filter(Boolean)
  ), []);
  const visibleSectionMap = sidebarSectionVisibility || {};
  const orderedSectionIds = useMemo(() => (
    Array.isArray(sidebarSectionOrder)
      ? sidebarSectionOrder.filter((id) => SIDEBAR_SECTION_META[id])
      : Object.keys(SIDEBAR_SECTION_META)
  ), [sidebarSectionOrder]);
  const renderedSectionIds = useMemo(() => (
    orderedSectionIds.filter((id) => visibleSectionMap[id] !== false)
  ), [orderedSectionIds, visibleSectionMap]);
  useEffect(() => {
    latestDragWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => () => {
    if (resizeFrameRef.current) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
  }, []);

  const handleResizeStart = useCallback((event) => {
    if (sidebarCollapsed) return;
    const asideRect = asideRef.current?.getBoundingClientRect();
    if (!asideRect) return;

    event.preventDefault();
    event.stopPropagation();
    setIsResizingSidebar(true);

    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const commitWidth = (rawWidth, persist) => {
      latestDragWidthRef.current = rawWidth;
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        setSidebarWidth(rawWidth, { persist, expand: true });
      });
    };

    const handleMove = (moveEvent) => {
      commitWidth(moveEvent.clientX - asideRect.left, false);
    };

    const handleUp = () => {
      commitWidth(latestDragWidthRef.current, true);
      setIsResizingSidebar(false);
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [setSidebarWidth, sidebarCollapsed]);

  const handleSectionDragStart = useCallback((sectionId) => (event) => {
    draggedSectionRef.current = sectionId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sectionId);
  }, []);

  const handleSectionDragOver = useCallback((sectionId) => (event) => {
    event.preventDefault();
    if (dragOverSectionId !== sectionId) {
      setDragOverSectionId(sectionId);
    }
  }, [dragOverSectionId]);

  const handleSectionDrop = useCallback((sectionId) => (event) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain') || draggedSectionRef.current;
    if (draggedId && draggedId !== sectionId) {
      reorderSidebarSection(draggedId, sectionId);
    }
    draggedSectionRef.current = null;
    setDragOverSectionId(null);
  }, [reorderSidebarSection]);

  const handleSectionDragEnd = useCallback(() => {
    draggedSectionRef.current = null;
    setDragOverSectionId(null);
  }, []);

  const renderSectionContent = useCallback((sectionId) => {
    switch (sectionId) {
      case 'workspaces':
        return (
          <div className="px-3 pb-2">
            <div className="mb-2.5 flex items-center justify-between px-0.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-muted/60">Workspaces</span>
              <div
                className="rounded-md border px-2 py-0.5 text-[10px] font-medium"
                style={{ borderColor: `${accentColor}28`, color: accentColor, background: `${accentColor}0e` }}
              >
                {WORKSPACES[currentWorkspace]?.name || 'Casual'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {workspaceTabs.map((ws) => (
                <WorkspaceTab
                  key={ws.id}
                  ws={ws}
                  isActive={currentWorkspace === ws.id}
                  isCollapsed={false}
                  onClick={() => setWorkspace(ws.id)}
                />
              ))}
            </div>
          </div>
        );
      case 'compose':
        return (
          <div className="px-3 pb-2.5 space-y-1.5">
            <button
              onClick={handleNewChat}
              className="h-10 w-full rounded-xl text-[13px] font-medium text-white transition-all flex items-center justify-center gap-2"
              style={{
                background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%)`,
              }}
            >
              <Plus size={15} />
              New Chat
            </button>

            <label className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-[13px] text-text-muted transition-colors focus-within:border-white/15">
              <Search size={13} className="shrink-0" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search..."
                className="flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted/70"
              />
            </label>
          </div>
        );
      case 'projects':
        return (
          <div className="px-3 pb-2.5 space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-muted/60">Project Scope</span>
              <button
                type="button"
                onClick={handleCreateProject}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[11px] text-text-muted transition-colors hover:border-white/16 hover:text-text-primary"
                title="Create project"
              >
                <Plus size={12} />
                New
              </button>
            </div>

            <label className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-[13px] text-text-muted transition-colors focus-within:border-white/15">
              <FolderKanban size={13} className="shrink-0" />
              <select
                value={activeProjectId || ''}
                onChange={(event) => handleProjectChange(event.target.value)}
                className="w-full bg-transparent text-text-primary outline-none"
              >
                <option value="">No project scope</option>
                {(projects || []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            {activeProject ? (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
                <p className="text-xs font-medium text-text-primary truncate">{activeProject.name}</p>
                {activeProject.description ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">{activeProject.description}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-text-muted">Project instructions, linked chats, and docs are injected into prompts.</p>
                )}
                <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
                  <span>{activeProjectConversationIds.length} chats</span>
                  <span>{activeProjectDocumentIds.length} docs</span>
                  {projectsLoading && <span>Syncing...</span>}
                </div>
                <button
                  type="button"
                  onClick={handleLinkCurrentConversation}
                  disabled={!currentConversationId}
                  className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[11px] text-text-muted transition-colors hover:border-white/16 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  title={currentConversationId ? 'Link current chat to project' : 'Open a conversation first'}
                >
                  <Link2 size={11} />
                  Link Current Chat
                </button>
              </div>
            ) : (
              <p className="px-0.5 text-[11px] text-text-muted">
                Pick a project to keep chats, memory, and docs together.
              </p>
            )}
          </div>
        );
      case 'filters':
        return (
          <div className="px-3 pb-2">
            <QuickFilters />
          </div>
        );
      case 'folders':
        return (
          <div className="px-1 pb-2">
            <FolderTree />
          </div>
        );
      case 'conversations':
        return (
          <div className="min-h-[180px] overflow-hidden">
            {filteredConversations.length > 0 ? (
              <div className="max-h-[42vh] overflow-y-auto scrollbar-premium px-2 py-2">
                <div className="space-y-2">
                  {filteredConversations.map((conv) => (
                    <ConversationCard
                      key={conv.id}
                      conv={conv}
                      isActive={currentConversationId === conv.id}
                      onSelect={selectConversation}
                      onDelete={deleteConversation}
                      accentColor={accentColor}
                      maskPrivateMeta={maskPrivateMeta}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-text-secondary">No conversations yet</p>
                <p className="mt-1 text-xs text-text-muted">Start a new chat</p>
              </div>
            )}
          </div>
        );
      case 'system':
        return (
          <div className="border-t border-border-subtle">
            <HardwareMonitorCompact />
          </div>
        );
      case 'actions':
        return (
          <div className="border-t border-border-subtle p-2">
            <div className="flex flex-wrap gap-1">
              <PowerModeToggle compact />
              {[
                { action: () => setWorkspace('nsfw'), icon: Lock, label: isLocked ? 'Vault' : 'Vault On', title: isLocked ? 'Open Vault' : 'Vault unlocked' },
                { action: toggleModelSelector, icon: Cpu, label: 'Model', title: 'Select Model' },
                { action: toggleModelHub, icon: Globe, label: 'Hub', title: 'Model Hub' },
                { action: toggleDownloadCenter, icon: Download, label: 'Downloads', title: 'Downloads' },
                { action: toggleImageGen, icon: Image, label: 'Images', title: 'Image Gen' },
                { action: toggleSettings, icon: Settings, label: 'Settings', title: 'Settings' },
              ].map(({ action, icon: Icon, label, title }) => (
                <button
                  key={label}
                  onClick={() => action()}
                  className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-text-muted/80 transition-colors hover:bg-white/[0.05] hover:text-text-primary"
                  title={title}
                >
                  <Icon size={14} />
                  <span className="text-[11px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      default:
        return null;
    }
  }, [
    activeProject,
    activeProjectConversationIds,
    activeProjectDocumentIds,
    activeProjectId,
    accentColor,
    currentConversationId,
    currentWorkspace,
    deleteConversation,
    filteredConversations,
    handleCreateProject,
    handleNewChat,
    handleLinkCurrentConversation,
    handleProjectChange,
    isLocked,
    maskPrivateMeta,
    projects,
    projectsLoading,
    searchQuery,
    selectConversation,
    setSearchQuery,
    setWorkspace,
    toggleDownloadCenter,
    toggleImageGen,
    toggleModelHub,
    toggleModelSelector,
    toggleSettings,
    workspaceTabs,
  ]);

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full flex-col border-r border-border-subtle bg-surface-0 transition-[width] duration-200"
      style={{ width: sidebarCollapsed ? `${COLLAPSED_SIDEBAR_WIDTH}px` : `${sidebarWidth}px` }}
    >
      {!sidebarCollapsed && (
        <>
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">Chats</div>
                <div className="mt-0.5 text-[11px] text-text-muted">
                  {isVaultWorkspace
                    ? 'Vault mode: encrypted, private, and lockable'
                    : 'Clean workspace and project-scoped context'}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className="rounded-md border px-2 py-0.5 text-[10px] font-medium"
                  style={{ borderColor: `${accentColor}28`, color: accentColor, background: `${accentColor}0e` }}
                >
                  {WORKSPACES[currentWorkspace]?.name || 'Casual'}
                </div>
                {isVaultWorkspace && !isLocked && (
                  <button
                    type="button"
                    onClick={() => lockNsfw?.()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-pink-400/30 bg-pink-500/10 px-2.5 text-[11px] text-pink-300 transition-colors hover:bg-pink-500/20"
                    title="Lock Vault and return to safe workspace"
                  >
                    <Shield size={13} />
                    Lock
                  </button>
                )}
                {sidebarCustomizing && (
                  <button
                    type="button"
                    onClick={resetSidebarCustomization}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-text-muted transition-colors hover:border-white/16 hover:text-text-primary"
                    title="Reset sidebar layout"
                  >
                    <RotateCcw size={13} />
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleSidebarCustomizing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] text-text-secondary transition-colors hover:border-white/16 hover:text-text-primary"
                  title="Customize sidebar layout"
                >
                  <SlidersHorizontal size={13} />
                  {sidebarCustomizing ? 'Done' : 'Customize'}
                </button>
              </div>
            </div>
          </div>

          {sidebarCustomizing && (
            <div className="px-3 pb-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-sm font-semibold text-text-primary">Layout edit mode</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Drag sections to reorder them, use the sidebar edge to resize, and hide anything you do not want in view.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {orderedSectionIds.map((sectionId) => {
                    const visible = visibleSectionMap[sectionId] !== false;
                    return (
                      <button
                        key={sectionId}
                        type="button"
                        onClick={() => setSidebarSectionVisibility(sectionId, !visible)}
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                          visible
                            ? 'border-white/12 bg-white/[0.05] text-text-secondary hover:text-text-primary'
                            : 'text-text-primary'
                        }`}
                        style={visible ? undefined : {
                          borderColor: `${accentColor}32`,
                          background: `${accentColor}14`,
                          color: accentColor,
                        }}
                      >
                        {visible ? 'Hide' : 'Add'} {SIDEBAR_SECTION_META[sectionId]?.label || sectionId}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {sidebarCollapsed ? (
        <>
          <div className="flex flex-col items-center gap-1.5 p-2">
            {workspaceTabs.map((ws) => (
              <WorkspaceTab
                key={ws.id}
                ws={ws}
                isActive={currentWorkspace === ws.id}
                isCollapsed
                onClick={() => setWorkspace(ws.id)}
              />
            ))}
          </div>

          <div className="flex flex-col items-center gap-2 p-2">
            <button
              onClick={handleNewChat}
              className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors"
              style={{ background: `${accentColor}20`, color: accentColor }}
              title="New Chat"
            >
              <Plus size={18} />
            </button>

            <QuickFiltersCompact />
          </div>

          <div className="flex-1" />

          <div className="flex flex-col items-center gap-1 border-t border-border-subtle p-2">
            <PowerModeToggle compact />
            {[
              { action: () => setWorkspace('nsfw'), icon: Lock, label: isLocked ? 'Vault' : 'Vault On', title: isLocked ? 'Open Vault' : 'Vault unlocked' },
              { action: toggleModelSelector, icon: Cpu, label: 'Model', title: 'Select Model' },
              { action: toggleModelHub, icon: Globe, label: 'Hub', title: 'Model Hub' },
              { action: toggleDownloadCenter, icon: Download, label: 'Downloads', title: 'Downloads' },
              { action: toggleImageGen, icon: Image, label: 'Images', title: 'Image Gen' },
              { action: toggleSettings, icon: Settings, label: 'Settings', title: 'Settings' },
            ].map(({ action, icon: Icon, label, title }) => (
              <button
                key={label}
                onClick={() => action()}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted/80 transition-colors hover:bg-white/[0.05] hover:text-text-primary"
                title={title}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-premium pb-2">
          {renderedSectionIds.map((sectionId) => (
            <SidebarSectionShell
              key={sectionId}
              sectionId={sectionId}
              label={SIDEBAR_SECTION_META[sectionId]?.label || sectionId}
              customizing={sidebarCustomizing}
              isDropTarget={dragOverSectionId === sectionId}
              accentColor={accentColor}
              onHide={() => setSidebarSectionVisibility(sectionId, false)}
              onDragStart={handleSectionDragStart(sectionId)}
              onDragOver={handleSectionDragOver(sectionId)}
              onDragEnd={handleSectionDragEnd}
              onDrop={handleSectionDrop(sectionId)}
            >
              {renderSectionContent(sectionId)}
            </SidebarSectionShell>
          ))}
        </div>
      )}

      {!sidebarCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className={`absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors ${isResizingSidebar ? 'bg-white/12' : 'bg-transparent hover:bg-white/8'}`}
          aria-hidden="true"
          title="Drag to resize sidebar"
        />
      )}

      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 z-30 flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-r-lg border border-border-muted border-l-0 bg-surface-2 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  );
}
