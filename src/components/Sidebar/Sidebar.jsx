import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircle, Briefcase, Code2, Beaker, Settings, Image,
  Plus, ChevronLeft, ChevronRight, ChevronDown, Cpu,
  Bot, Download,
  Calendar, CalendarDays, Star, Pin, Archive, Folder, FolderPlus,
  Activity, Command, FolderKanban, Lock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAppStore, WORKSPACES } from '../../stores/appStore';
import { HardwareMonitorCompact } from '../HardwareMonitor/HardwareMonitor';
import { PowerModeToggle } from '../PowerMode/PowerModeToggle';

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

const COLLAPSED_SIDEBAR_WIDTH = 72;

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
          : 'h-8 rounded-lg border px-2 text-left',
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
        <div className="flex h-full items-center gap-1.5">
          <span className="shrink-0" style={iconStyle}>
            <Icon size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <span
              className="block truncate text-[11px] font-semibold"
              style={isActive ? { color } : undefined}
            >
              {ws.name}
            </span>
          </div>
          {isActive && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} title={summary} />
          )}
        </div>
      )}
    </button>
  );
});

const SectionTitle = memo(function SectionTitle({ children, action }) {
  return (
    <div className="mb-1.5 flex h-5 items-center justify-between px-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted/55">
        {children}
      </span>
      {action}
    </div>
  );
});

const NavRow = memo(function NavRow({
  icon: Icon,
  label,
  count,
  active,
  accentColor,
  onClick,
  title,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      className={[
        'group flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] transition-colors',
        active
          ? 'bg-white/[0.055] text-text-primary'
          : 'text-text-muted hover:bg-white/[0.035] hover:text-text-secondary',
      ].join(' ')}
      style={active ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : undefined}
    >
      <Icon size={14} className="shrink-0" style={active ? { color: accentColor } : undefined} />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {Number.isFinite(count) && count > 0 && (
        <span className="rounded-md bg-white/[0.055] px-1.5 py-0.5 text-[10px] text-text-muted">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
});

const RecentConversationRow = memo(function RecentConversationRow({
  conv,
  isActive,
  accentColor,
  maskPrivateMeta,
  onSelect,
}) {
  const title = maskPrivateMeta ? 'Vault note' : (conv?.title || 'New conversation');
  const updatedAt = conv?.updated_at ? new Date(conv.updated_at) : null;
  const relative = updatedAt && !Number.isNaN(updatedAt.getTime())
    ? formatDistanceToNow(updatedAt, { addSuffix: true })
    : '';
  const messageCount = Number(conv?.message_count || 0);

  return (
    <button
      type="button"
      onClick={() => onSelect(conv.id)}
      className={[
        'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
        isActive
          ? 'bg-white/[0.055] text-text-primary'
          : 'text-text-secondary hover:bg-white/[0.035] hover:text-text-primary',
      ].join(' ')}
      style={isActive ? { boxShadow: `inset 2px 0 0 ${accentColor}` } : undefined}
      title={title}
    >
      <MessageCircle size={13} className="shrink-0 text-text-muted/70" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium leading-4">{title}</p>
        <p className="mt-0.5 truncate text-[10px] text-text-muted/70">
          {[relative, messageCount > 0 ? `${messageCount} msgs` : null].filter(Boolean).join(' · ')}
        </p>
      </div>
      {conv?.pinned === 1 && <Pin size={11} className="shrink-0 rotate-45 text-text-muted/70" />}
      {conv?.starred === 1 && <Star size={11} className="shrink-0 text-amber-300" fill="currentColor" />}
    </button>
  );
});

const SystemFooter = memo(function SystemFooter() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-white/[0.06] p-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-white/[0.035] hover:text-text-primary"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300">
          <Activity size={12} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium">Local Ready</span>
          <span className="block truncate text-[10px] text-text-muted">System healthy</span>
        </span>
        <ChevronDown size={13} className={`text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/10 py-1">
          <HardwareMonitorCompact />
        </div>
      )}
    </div>
  );
});

export function Sidebar() {
  const asideRef = useRef(null);
  const resizeFrameRef = useRef(0);
  const latestDragWidthRef = useRef(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // Store subscriptions
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const setWorkspace = useAppStore(s => s.setWorkspace);
  const currentConversationId = useAppStore(s => s.currentConversationId);
  const selectConversation = useAppStore(s => s.selectConversation);
  const createConversation = useAppStore(s => s.createConversation);
  const sidebarCollapsed = useAppStore(s => s.sidebarCollapsed);
  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth);
  const toggleSettings = useAppStore(s => s.toggleSettings);
  const toggleImageGen = useAppStore(s => s.toggleImageGen);
  const toggleModelHub = useAppStore(s => s.toggleModelHub);
  const toggleModelSelector = useAppStore(s => s.toggleModelSelector);
  const toggleDownloadCenter = useAppStore(s => s.toggleDownloadCenter);
  const projects = useAppStore(s => s.projects);
  const activeProjectId = useAppStore(s => s.activeProjectId);
  const loadProjects = useAppStore(s => s.loadProjects);
  const createProject = useAppStore(s => s.createProject);
  const setActiveProject = useAppStore(s => s.setActiveProject);

  // Organization state
  const folders = useAppStore(s => s.folders);
  const conversations = useAppStore(s => s.conversations);
  const loadConversations = useAppStore(s => s.loadConversations);
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const getFilteredConversations = useAppStore(s => s.getFilteredConversations);
  const loadFolders = useAppStore(s => s.loadFolders);
  const loadWorkspaceTags = useAppStore(s => s.loadWorkspaceTags);
  const createFolder = useAppStore(s => s.createFolder);
  const activeFilter = useAppStore(s => s.activeFilter);
  const setActiveFilter = useAppStore(s => s.setActiveFilter);
  const activeFolderId = useAppStore(s => s.activeFolderId);
  const setActiveFolder = useAppStore(s => s.setActiveFolder);

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

  const filteredConversations = getFilteredConversations();

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

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name');
    if (!name || !name.trim()) return;
    await createFolder?.(name.trim());
    await loadFolders?.();
  }, [createFolder, loadFolders]);

  const handleSmartView = useCallback((filterId) => {
    setActiveFilter?.(filterId);
    setActiveFolder?.(null);
  }, [setActiveFilter, setActiveFolder]);

  const accentColor = WS_COLORS[currentWorkspace] || WS_COLORS.casual;
  const maskPrivateMeta = currentWorkspace === 'nsfw';

  const workspaceTabs = useMemo(() => (
    ENABLED_WORKSPACES
      .map((id) => WORKSPACES[id])
      .filter(Boolean)
  ), []);

  const chatCounts = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    const list = conversations || [];
    return {
      all: list.length,
      today: list.filter((c) => new Date(c.updated_at) >= startOfToday).length,
      week: list.filter((c) => new Date(c.updated_at) >= startOfWeek).length,
      starred: list.filter((c) => c.starred === 1).length,
      pinned: list.filter((c) => c.pinned === 1).length,
      archived: list.filter((c) => c.archived === 1 || c.archived === true).length,
    };
  }, [conversations]);

  const folderCounts = useMemo(() => {
    const counts = {};
    (conversations || []).forEach((conversation) => {
      if (conversation.folder_id) {
        counts[conversation.folder_id] = (counts[conversation.folder_id] || 0) + 1;
      }
    });
    return counts;
  }, [conversations]);

  const recentConversations = useMemo(
    () => filteredConversations.slice(0, 14),
    [filteredConversations],
  );
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

  const smartViews = useMemo(() => ([
    { id: 'all', label: 'All Chats', icon: MessageCircle, count: chatCounts.all },
    { id: 'today', label: 'Today', icon: Calendar, count: chatCounts.today },
    { id: 'week', label: 'This Week', icon: CalendarDays, count: chatCounts.week },
    { id: 'starred', label: 'Starred', icon: Star, count: chatCounts.starred },
    { id: 'pinned', label: 'Pinned', icon: Pin, count: chatCounts.pinned },
    { id: 'archived', label: 'Archived', icon: Archive, count: chatCounts.archived },
  ]), [chatCounts]);

  const footerTools = useMemo(() => ([
    { action: toggleModelSelector, icon: Cpu, label: 'Pick', title: 'Pick the active chat model' },
    { action: toggleModelHub, icon: Bot, label: 'Hub', title: 'Open Model Hub / AI Runtime Manager' },
    { action: toggleDownloadCenter, icon: Download, label: 'Files', title: 'Downloads' },
    { action: toggleImageGen, icon: Image, label: 'Images', title: 'Image Gen' },
    { action: toggleSettings, icon: Settings, label: 'Setup', title: 'Settings' },
  ]), [toggleDownloadCenter, toggleImageGen, toggleModelHub, toggleModelSelector, toggleSettings]);

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full flex-col border-r border-border-subtle bg-surface-0 transition-[width] duration-200"
      style={{ width: sidebarCollapsed ? `${COLLAPSED_SIDEBAR_WIDTH}px` : `${sidebarWidth}px` }}
    >
      {!sidebarCollapsed && (
        <div className="shrink-0 px-3 pb-2 pt-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
              style={{ background: accentColor }}
            >
              DF
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-primary">DevForge</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Local Ready
              </div>
            </div>
          </div>
        </div>
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

            <div className="flex flex-col items-center gap-1">
              {smartViews.slice(0, 4).map((view) => (
                <button
                  key={view.id}
                  onClick={() => handleSmartView(view.id)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                    activeFilter === view.id
                      ? 'bg-white/[0.08]'
                      : 'text-text-muted hover:bg-white/[0.05] hover:text-text-primary'
                  }`}
                  style={activeFilter === view.id ? { color: accentColor } : undefined}
                  title={view.label}
                >
                  <view.icon size={15} />
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex flex-col items-center gap-1 border-t border-border-subtle p-2">
            <PowerModeToggle compact />
            {footerTools.map(({ action, icon: Icon, label, title }) => (
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-premium px-3 pb-3">
            <section className="pb-3">
              <SectionTitle
                action={(
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-primary"
                    title="Create project or scope"
                  >
                    <Plus size={13} />
                  </button>
                )}
              >
                Working In
              </SectionTitle>
              <label className="flex h-9 w-full items-center gap-2 rounded-lg bg-white/[0.025] px-2 text-[12px] text-text-muted ring-1 ring-white/[0.06] transition-colors focus-within:ring-white/15">
                <FolderKanban size={13} className="shrink-0" />
                <select
                  value={activeProjectId || ''}
                  onChange={(event) => handleProjectChange(event.target.value)}
                  className="w-full bg-transparent text-text-primary outline-none"
                >
                  <option value="">No project scope</option>
                  {(projects || []).map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            </section>

            <section className="pb-3">
              <SectionTitle>Primary Actions</SectionTitle>
              <button
                type="button"
                onClick={handleNewChat}
                className="mb-1.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-semibold text-white transition-opacity hover:opacity-95"
                style={{ background: accentColor }}
              >
                <Plus size={14} />
                New Chat
              </button>
              <label className="flex h-9 w-full items-center gap-2 rounded-lg bg-white/[0.025] px-2.5 text-[12px] text-text-muted ring-1 ring-white/[0.06] transition-colors focus-within:ring-white/15">
                <Command size={13} className="shrink-0" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search or command..."
                  className="min-w-0 flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-muted/65"
                />
              </label>
            </section>

            <section className="pb-3">
              <SectionTitle>Spaces</SectionTitle>
              <div className="space-y-0.5">
                {workspaceTabs.map((ws) => {
                  const Icon = ICONS[ws.icon] || FALLBACK_ICON;
                  return (
                    <NavRow
                      key={ws.id}
                      icon={Icon}
                      label={ws.id === 'nsfw' ? 'Vault' : ws.name}
                      active={currentWorkspace === ws.id}
                      accentColor={accentColor}
                      onClick={() => setWorkspace(ws.id)}
                    />
                  );
                })}
              </div>
            </section>

            <section className="pb-3">
              <SectionTitle>Smart Views</SectionTitle>
              <div className="space-y-0.5">
                {smartViews.map((view) => (
                  <NavRow
                    key={view.id}
                    icon={view.icon}
                    label={view.label}
                    count={view.count}
                    active={activeFilter === view.id && !activeFolderId}
                    accentColor={accentColor}
                    onClick={() => handleSmartView(view.id)}
                  />
                ))}
              </div>
            </section>

            <section className="pb-3">
              <SectionTitle>Recent Chats</SectionTitle>
              <div className="space-y-0.5">
                {recentConversations.length > 0 ? (
                  recentConversations.map((conv) => (
                    <RecentConversationRow
                      key={conv.id}
                      conv={conv}
                      isActive={currentConversationId === conv.id}
                      accentColor={accentColor}
                      maskPrivateMeta={maskPrivateMeta}
                      onSelect={selectConversation}
                    />
                  ))
                ) : (
                  <div className="rounded-lg px-2 py-3 text-[11px] text-text-muted">
                    No recent chats yet.
                  </div>
                )}
              </div>
            </section>

            <section className="pb-2">
              <SectionTitle
                action={(
                  <button
                    type="button"
                    onClick={handleCreateFolder}
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text-primary"
                    title="Create folder"
                  >
                    <FolderPlus size={12} />
                    New
                  </button>
                )}
              >
                Folders
              </SectionTitle>
              <div className="space-y-0.5">
                {(folders || []).length > 0 ? (
                  folders.map((folder) => (
                    <NavRow
                      key={folder.id}
                      icon={Folder}
                      label={folder.name}
                      count={folderCounts[folder.id] || 0}
                      active={activeFolderId === folder.id}
                      accentColor={folder.color || accentColor}
                      onClick={() => setActiveFolder?.(folder.id)}
                    />
                  ))
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateFolder}
                    className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-text-muted transition-colors hover:bg-white/[0.035] hover:text-text-secondary"
                  >
                    <FolderPlus size={13} />
                    Create folder
                  </button>
                )}
              </div>
            </section>
          </div>

          <div className="shrink-0 border-t border-white/[0.06] p-2">
            <div className="mb-1 grid grid-cols-5 gap-1">
              <PowerModeToggle compact />
              {footerTools.map(({ action, icon: Icon, label, title }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => action()}
                  className="flex h-7 items-center justify-center rounded-md text-text-muted/80 transition-colors hover:bg-white/[0.05] hover:text-text-primary"
                  title={title}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>

          <SystemFooter />
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
