/**
 * Forge Console
 * 
 * Central hub for all deep cognitive tools.
 * Tabs: Replay | Runs | Forks | Mindprint | Insights
 */

import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { 
  X, Play, Clock, GitBranch, Brain, LineChart, 
  Pause, SkipForward, SkipBack, RefreshCw, ChevronRight,
  FileText, Zap, CheckCircle, XCircle, AlertTriangle,
  Sparkles, Filter, Search, MessageSquare, Code, Coffee,
  Moon, Sun, Sunrise, Sunset, Activity, TrendingUp,
  BarChart2, PieChart, Calendar, Target, Award, Eye,
  Edit3, RotateCcw, ThumbsDown, ChevronDown, ChevronUp,
  Cpu, HardDrive, Users, Hash, Layers, Database
} from 'lucide-react';
import { useSoulStore } from '../../stores/soulStore';
import { useAppStore } from '../../stores/appStore';
import { isElectron, safeCall } from '../../utils/electronAPI';

// Tab configuration
const TABS = [
  { id: 'replay', label: 'Replay', icon: Play, description: 'Session timeline & replay' },
  { id: 'runs', label: 'Runs', icon: Zap, description: 'Intent → Actions history' },
  { id: 'forks', label: 'Forks', icon: GitBranch, description: 'Counterfactual comparisons' },
  { id: 'mindprint', label: 'Mindprint', icon: Brain, description: 'LMA adapters & training' },
  { id: 'insights', label: 'Insights', icon: LineChart, description: 'Mirror dashboard' },
];

// Workspace colors
const WORKSPACE_COLORS = {
  casual: '#60a5fa',
  work: '#34d399',
  code: '#a78bfa',
  nsfw: '#f472b6',
};

export function ForgeConsole() {
  const { 
    showForgeConsole, 
    forgeConsoleTab, 
    setForgeConsoleTab,
    toggleForgeConsole,
    ledgerStats,
    sessionId,
    acknowledgeInsights,
  } = useSoulStore();
  
  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showForgeConsole) {
        toggleForgeConsole();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForgeConsole, toggleForgeConsole]);
  
  // Acknowledge insights when opening insights tab
  useEffect(() => {
    if (forgeConsoleTab === 'insights') {
      acknowledgeInsights();
    }
  }, [forgeConsoleTab, acknowledgeInsights]);
  
  if (!showForgeConsole) return null;
  
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8 anim-fade-in"
      onClick={(e) => e.target === e.currentTarget && toggleForgeConsole()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      
      {/* Console Panel */}
      <div className="forge-console relative w-full max-w-6xl h-[85vh] rounded-2xl flex flex-col overflow-hidden anim-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neural-pulse/10">
              <Sparkles size={18} className="text-neural-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Forge Console</h2>
              <p className="text-xs text-text-muted">Cognitive Tools & Analytics</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Session info */}
            {sessionId && (
              <div className="text-[11px] text-text-muted font-mono">
                Session: {sessionId.slice(0, 8)}...
              </div>
            )}
            
            {/* Ledger stats */}
            {ledgerStats && (
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-text-muted">
                  <span className="text-text-secondary">{ledgerStats.events}</span> events
                </span>
                <span className="text-text-muted">
                  <span className="text-text-secondary">{ledgerStats.runs}</span> runs
                </span>
              </div>
            )}
            
            <button
              onClick={toggleForgeConsole}
              className="p-2 rounded-lg hover:bg-forge-hover transition-colors"
            >
              <X size={18} className="text-text-muted" />
            </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-forge-border/30">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setForgeConsoleTab(tab.id)}
              className={`forge-console-tab flex items-center gap-2 px-5 py-3 text-sm transition-all ${
                forgeConsoleTab === tab.id ? 'active' : ''
              }`}
            >
              <tab.icon size={14} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <div key={forgeConsoleTab} className="h-full overflow-y-auto custom-scrollbar anim-fade-in">
            {forgeConsoleTab === 'replay' && <ReplayTab />}
            {forgeConsoleTab === 'runs' && <RunsTab />}
            {forgeConsoleTab === 'forks' && <ForksTab />}
            {forgeConsoleTab === 'mindprint' && <MindprintTab />}
            {forgeConsoleTab === 'insights' && <InsightsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// REPLAY TAB - Enhanced Timeline
// ============================================

function ReplayTab() {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  useEffect(() => {
    loadEvents();
  }, []);
  
  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const data = await safeCall('ledger:listEvents', [{ limit: 200, order: 'desc' }], []);
      setEvents(data || []);
    } catch (error) {
      console.error('Failed to load events:', error);
    }
    setIsLoading(false);
  };
  
  const EVENT_TYPES = {
    all: { label: 'All Events', icon: Layers },
    message: { label: 'Messages', icon: MessageSquare },
    generation: { label: 'Generations', icon: Zap },
    workspace: { label: 'Workspace', icon: RefreshCw },
    action: { label: 'Actions', icon: Activity },
  };
  
  const filteredEvents = useMemo(() => {
    let filtered = events;
    
    if (filter !== 'all') {
      filtered = filtered.filter(e => e.type.includes(filter));
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        e.type.toLowerCase().includes(query) ||
        JSON.stringify(e.payload || {}).toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [events, filter, searchQuery]);
  
  // Group events by date
  const groupedEvents = useMemo(() => {
    const groups = {};
    for (const event of filteredEvents) {
      const date = new Date(event.ts).toLocaleDateString();
      if (!groups[date]) groups[date] = [];
      groups[date].push(event);
    }
    return groups;
  }, [filteredEvents]);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="flex h-full">
      {/* Event List */}
      <div className="flex-1 border-r border-forge-border/30">
        {/* Filters */}
        <div className="p-4 border-b border-forge-border/30 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search events..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-forge-surface border border-forge-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neural-pulse"
              />
            </div>
            <button
              onClick={loadEvents}
              className="p-2 rounded-lg bg-forge-surface border border-forge-border hover:bg-forge-hover transition-colors"
            >
              <RefreshCw size={14} className="text-text-muted" />
            </button>
          </div>
          
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(EVENT_TYPES).map(([key, { label, icon: Icon }]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                  filter === key
                    ? 'bg-neural-pulse/20 text-neural-pulse'
                    : 'bg-forge-surface text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Event List */}
        <div className="overflow-y-auto h-[calc(100%-120px)] custom-scrollbar">
          {Object.entries(groupedEvents).length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Clock size={32} className="text-text-muted mb-3" />
              <p className="text-text-secondary">No events recorded yet</p>
              <p className="text-xs text-text-muted mt-1">Events will appear here as you use Anvil</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {Object.entries(groupedEvents).map(([date, dateEvents]) => (
                <div key={date}>
                  <div className="text-xs font-medium text-text-muted mb-2 flex items-center gap-2">
                    <Calendar size={12} />
                    {date}
                    <span className="text-text-muted/50">({dateEvents.length})</span>
                  </div>
                  <div className="space-y-1">
                    {dateEvents.map((event) => (
                      <EventRow 
                        key={event.id} 
                        event={event} 
                        isSelected={selectedEvent?.id === event.id}
                        onClick={() => setSelectedEvent(event)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Event Detail Panel */}
      <div className="w-80 p-4">
        {selectedEvent ? (
          <EventDetail event={selectedEvent} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Eye size={24} className="text-text-muted mb-2" />
            <p className="text-sm text-text-muted">Select an event to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, isSelected, onClick }) {
  const getEventConfig = (type) => {
    if (type.includes('message_sent')) return { icon: MessageSquare, color: 'text-blue-400', bg: 'bg-blue-400/10' };
    if (type.includes('message_received')) return { icon: MessageSquare, color: 'text-emerald-400', bg: 'bg-emerald-400/10' };
    if (type.includes('generation')) return { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-400/10' };
    if (type.includes('workspace')) return { icon: RefreshCw, color: 'text-purple-400', bg: 'bg-purple-400/10' };
    if (type.includes('action')) return { icon: Activity, color: 'text-pink-400', bg: 'bg-pink-400/10' };
    if (type.includes('typing')) return { icon: Edit3, color: 'text-cyan-400', bg: 'bg-cyan-400/10' };
    if (type.includes('session')) return { icon: Users, color: 'text-orange-400', bg: 'bg-orange-400/10' };
    return { icon: Clock, color: 'text-text-muted', bg: 'bg-forge-surface' };
  };
  
  const config = getEventConfig(event.type);
  const Icon = config.icon;
  const time = new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-100 hover:translate-x-0.5 ${
        isSelected ? 'bg-neural-pulse/10 border border-neural-pulse/30' : 'hover:bg-forge-hover/50'
      }`}
    >
      <div className={`p-1.5 rounded ${config.bg}`}>
        <Icon size={12} className={config.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-secondary truncate">
          {event.type.replace(/_/g, ' ')}
        </div>
        <div className="text-[10px] text-text-muted">{time}</div>
      </div>
      {event.workspace && (
        <span 
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: WORKSPACE_COLORS[event.workspace] || '#888' }}
          title={event.workspace}
        />
      )}
    </div>
  );
}

function EventDetail({ event }) {
  const time = new Date(event.ts).toLocaleString();
  
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">
          {event.type.replace(/_/g, ' ')}
        </h3>
        <p className="text-xs text-text-muted">{time}</p>
      </div>
      
      {event.workspace && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Workspace:</span>
          <span 
            className="px-2 py-0.5 rounded text-xs"
            style={{ 
              backgroundColor: `${WORKSPACE_COLORS[event.workspace]}20`,
              color: WORKSPACE_COLORS[event.workspace]
            }}
          >
            {event.workspace}
          </span>
        </div>
      )}
      
      {event.payload && Object.keys(event.payload).length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">Payload</h4>
          <pre className="text-[10px] text-text-muted bg-forge-surface p-3 rounded-lg overflow-x-auto custom-scrollbar">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
      
      <div className="text-[10px] text-text-muted font-mono">
        ID: {event.id}
      </div>
    </div>
  );
}

// ============================================
// RUNS TAB - Intent → Actions
// ============================================

function RunsTab() {
  const [runs, setRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [intentInput, setIntentInput] = useState('');
  
  useEffect(() => {
    loadRuns();
  }, []);
  
  const loadRuns = async () => {
    setIsLoading(true);
    try {
      const data = await safeCall('ledger:listEvents', [{ types: ['run_created'], limit: 50 }], []);
      setRuns(data || []);
    } catch (error) {
      console.error('Failed to load runs:', error);
    }
    setIsLoading(false);
  };
  
  const handleCompileIntent = async () => {
    if (!intentInput.trim()) return;
    
    try {
      const result = await safeCall('intent:compile', [{ intent: intentInput }], null);
      if (result?.plan) {
        setSelectedRun(result);
        setShowCreateDialog(false);
        setIntentInput('');
        loadRuns();
      }
    } catch (error) {
      console.error('Failed to compile intent:', error);
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Intent → Actions</h3>
          <p className="text-xs text-text-muted mt-0.5">Compile natural language into executable plans</p>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="px-4 py-2 rounded-lg bg-neural-pulse/20 text-neural-pulse text-sm font-medium hover:bg-neural-pulse/30 transition-colors"
        >
          + New Intent
        </button>
      </div>
      
      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="p-4 rounded-xl bg-forge-surface border border-forge-border anim-slide-up">
          <h4 className="text-sm font-medium text-text-primary mb-3">Describe Your Intent</h4>
          <textarea
            value={intentInput}
            onChange={(e) => setIntentInput(e.target.value)}
            placeholder="e.g., Refactor the authentication module to use JWT tokens, update all tests, and create a migration guide..."
            className="w-full h-32 px-3 py-2 rounded-lg bg-forge-hover border border-forge-border text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-neural-pulse"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => setShowCreateDialog(false)}
              className="px-4 py-2 rounded-lg text-text-muted text-sm hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCompileIntent}
              disabled={!intentInput.trim()}
              className="px-4 py-2 rounded-lg bg-neural-pulse/20 text-neural-pulse text-sm font-medium hover:bg-neural-pulse/30 transition-colors disabled:opacity-50"
            >
              Compile to Plan
            </button>
          </div>
        </div>
      )}
      
      {/* Runs List */}
      {runs.length === 0 && !showCreateDialog ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Zap size={32} className="text-text-muted mb-3" />
          <p className="text-text-secondary">No action runs yet</p>
          <p className="text-xs text-text-muted mt-1">
            Use Intent → Actions to compile instructions into executable plans
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div 
              key={run.id}
              className="p-4 rounded-xl bg-forge-surface border border-forge-border hover:border-forge-border/80 transition-colors cursor-pointer"
              onClick={() => setSelectedRun(run)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    run.payload?.status === 'completed' ? 'bg-emerald-400/10' :
                    run.payload?.status === 'failed' ? 'bg-red-400/10' :
                    'bg-amber-400/10'
                  }`}>
                    {run.payload?.status === 'completed' ? (
                      <CheckCircle size={16} className="text-emerald-400" />
                    ) : run.payload?.status === 'failed' ? (
                      <XCircle size={16} className="text-red-400" />
                    ) : (
                      <Activity size={16} className="text-amber-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {run.payload?.intent?.slice(0, 50) || 'Run'}...
                    </p>
                    <p className="text-xs text-text-muted">
                      {run.payload?.steps?.length || 0} steps • {new Date(run.ts).toLocaleString()}
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-text-muted" />
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* How it works */}
      <div className="p-4 rounded-xl bg-forge-surface/30 border border-forge-border/30">
        <h3 className="text-sm font-semibold text-text-primary mb-2">How Intent → Actions Works</h3>
        <div className="grid grid-cols-4 gap-4 text-center">
          {[
            { icon: MessageSquare, label: 'Describe Intent', desc: 'Natural language' },
            { icon: Code, label: 'Compile Plan', desc: 'AI generates steps' },
            { icon: Eye, label: 'Review & Edit', desc: 'Approve changes' },
            { icon: Zap, label: 'Execute', desc: 'Automated actions' },
          ].map((step, idx) => (
            <div key={idx} className="p-3">
              <step.icon size={20} className="text-neural-pulse mx-auto mb-2" />
              <p className="text-xs font-medium text-text-secondary">{step.label}</p>
              <p className="text-[10px] text-text-muted">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// FORKS TAB - Counterfactuals
// ============================================

function ForksTab() {
  const [forks, setForks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    loadForks();
  }, []);
  
  const loadForks = async () => {
    setIsLoading(true);
    try {
      const data = await safeCall('ledger:listEvents', [{ types: ['fork_created'], limit: 50 }], []);
      setForks(data || []);
    } catch (error) {
      console.error('Failed to load forks:', error);
    }
    setIsLoading(false);
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">Decision Forks</h3>
        <p className="text-xs text-text-muted mt-0.5">Explore "what if" scenarios and compare outcomes</p>
      </div>
      
      {forks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <GitBranch size={32} className="text-text-muted mb-3" />
          <p className="text-text-secondary">No decision forks recorded</p>
          <p className="text-xs text-text-muted mt-1 max-w-md">
            Forks are created when you explore alternative approaches or compare different AI responses
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {forks.map((fork) => (
            <ForkCard key={fork.id} fork={fork} />
          ))}
        </div>
      )}
      
      {/* Visual Fork Tree Placeholder */}
      <div className="p-6 rounded-xl bg-forge-surface/30 border border-forge-border/30">
        <h4 className="text-sm font-semibold text-text-primary mb-4">Fork Visualization</h4>
        <div className="h-48 flex items-center justify-center border-2 border-dashed border-forge-border/50 rounded-lg">
          <div className="text-center">
            <GitBranch size={32} className="text-text-muted mx-auto mb-2" />
            <p className="text-xs text-text-muted">Fork tree visualization coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForkCard({ fork }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <GitBranch size={16} className="text-purple-400" />
          <div>
            <p className="text-sm font-medium text-text-primary">{fork.payload?.question || 'Decision Point'}</p>
            <p className="text-xs text-text-muted">{fork.payload?.branches?.length || 2} branches</p>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
      </div>
      
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-forge-border/50 anim-slide-up">
          <div className="grid grid-cols-2 gap-4">
            {(fork.payload?.branches || []).map((branch, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-forge-hover/50">
                <p className="text-xs font-medium text-text-secondary mb-1">Branch {idx + 1}</p>
                <p className="text-xs text-text-muted">{branch.summary || 'No summary'}</p>
                {branch.outcome && (
                  <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] ${
                    branch.outcome === 'chosen' ? 'bg-emerald-400/20 text-emerald-400' :
                    'bg-forge-surface text-text-muted'
                  }`}>
                    {branch.outcome}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// MINDPRINT TAB - Enhanced
// ============================================

function MindprintTab() {
  const [frictionSignals, setFrictionSignals] = useState([]);
  const [lmaStatus, setLmaStatus] = useState(null);
  const [adapters, setAdapters] = useState([]);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedBaseModel, setSelectedBaseModel] = useState('');
  const [newAdapterName, setNewAdapterName] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState('general');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('models'); // 'models' | 'signals' | 'insights'
  
  useEffect(() => {
    loadStatus();
  }, []);
  
  const loadStatus = async () => {
    setIsLoading(true);
    try {
      let signals = [];
      let status = null;
      let models = [];
      
      signals = await safeCall('ledger:getFrictionSignals', [{ limit: 100 }], []);
      status = await safeCall('lma:getStatus', [], null);
      models = await safeCall('lma:getOllamaModels', [], []);
      
      if (!status || !status.ollamaAvailable) {
        try {
          const ollamaResponse = await fetch('http://localhost:11434/api/tags');
          if (ollamaResponse.ok) {
            const ollamaData = await ollamaResponse.json();
            models = ollamaData.models || [];
            status = {
              ollamaAvailable: true,
              backend: 'ollama',
              ollamaAdapters: models.filter(m => 
                m.name.includes('mindprint') || m.name.includes('personalized')
              ),
            };
          }
        } catch (e) {
          console.log('Direct Ollama check failed:', e.message);
        }
      }
      
      setFrictionSignals(signals);
      setLmaStatus(status);
      setAdapters(status?.ollamaAdapters || []);
      
      const baseModels = (models || []).filter(m => 
        !m.name.includes('mindprint') && !m.name.includes('personalized')
      );
      setOllamaModels(baseModels);
      
      if (baseModels.length > 0 && !selectedBaseModel) {
        setSelectedBaseModel(baseModels[0].name);
      }
    } catch (error) {
      console.error('Failed to load LMA status:', error);
    }
    setIsLoading(false);
  };
  
  const handleCreateAdapter = async () => {
    if (!selectedBaseModel || !newAdapterName) return;
    
    setIsCreating(true);
    setCreateSuccess(null);
    
    try {
      const adapterName = `mindprint-${selectedWorkspace}-${newAdapterName.toLowerCase().replace(/\s+/g, '-')}`;
      
      let result = await safeCall('lma:createOllamaAdapter', [{
        baseModel: selectedBaseModel,
        adapterName,
        workspace: selectedWorkspace,
      }], null);
      
      if (!result) {
        const workspacePrompts = {
          general: 'You are a helpful AI assistant personalized for this user.',
          casual: 'You are a friendly, conversational AI. Be relaxed and casual.',
          work: 'You are a professional AI assistant. Be efficient and focused.',
          code: 'You are an expert programmer. Provide clean, well-documented code.',
        };
        
        const modelfile = `FROM ${selectedBaseModel}

SYSTEM """
${workspacePrompts[selectedWorkspace] || workspacePrompts.general}

## Learned Preferences
Based on past interactions, adapt your responses to be:
1. Clear, well-structured responses
2. Practical examples when relevant
3. Concise but thorough when needed
"""

PARAMETER temperature ${selectedWorkspace === 'code' ? '0.3' : '0.7'}
PARAMETER top_p 0.9
`;

        const response = await fetch('http://localhost:11434/api/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: adapterName, modelfile }),
        });
        
        if (response.ok) result = { success: true };
      }
      
      if (result?.success) {
        setCreateSuccess(true);
        setNewAdapterName('');
        setShowCreateForm(false);
        await loadStatus();
      } else {
        setCreateSuccess(false);
      }
    } catch (error) {
      console.error('Failed to create adapter:', error);
      setCreateSuccess(false);
    }
    
    setIsCreating(false);
    setTimeout(() => setCreateSuccess(null), 3000);
  };
  
  const handleDeleteAdapter = async (modelName) => {
    try {
      const result = await safeCall('lma:deleteOllamaAdapter', [modelName], null);
      if (!result) {
        await fetch('http://localhost:11434/api/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName }),
        });
      }
      await loadStatus();
    } catch (error) {
      console.error('Failed to delete adapter:', error);
    }
  };
  
  // Calculate friction stats
  const frictionStats = useMemo(() => {
    const stats = {
      regenerate: 0,
      edit: 0,
      abandon: 0,
      revert: 0,
      total: frictionSignals.length,
    };
    
    for (const signal of frictionSignals) {
      if (stats[signal.kind] !== undefined) {
        stats[signal.kind]++;
      }
    }
    
    return stats;
  }, [frictionSignals]);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }
  
  const ollamaAvailable = lmaStatus?.ollamaAvailable;
  
  return (
    <div className="p-6 space-y-6">
      {/* Status Overview */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard 
          label="Personalized Models" 
          value={adapters.length} 
          icon={Brain}
          color="text-purple-400"
        />
        <StatCard 
          label="Friction Signals" 
          value={frictionStats.total} 
          icon={Activity}
          color="text-amber-400"
        />
        <StatCard 
          label="Base Models" 
          value={ollamaModels.length} 
          icon={Cpu}
          color="text-blue-400"
        />
        <StatCard 
          label="Ollama Status" 
          value={ollamaAvailable ? 'Online' : 'Offline'} 
          icon={Database}
          color={ollamaAvailable ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>
      
      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-forge-surface/50">
        {[
          { id: 'models', label: 'Models', icon: Brain },
          { id: 'signals', label: 'Friction Signals', icon: Activity },
          { id: 'insights', label: 'Training Insights', icon: TrendingUp },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
              activeSubTab === tab.id
                ? 'bg-neural-pulse/20 text-neural-pulse'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Success/Error Toast */}
      {createSuccess !== null && (
        <div
          className={`p-3 rounded-lg anim-slide-up ${
            createSuccess 
              ? 'bg-emerald-400/20 border border-emerald-400/30' 
              : 'bg-red-400/20 border border-red-400/30'
          }`}
        >
          <div className="flex items-center gap-2">
            {createSuccess ? (
              <CheckCircle size={16} className="text-emerald-400" />
            ) : (
              <XCircle size={16} className="text-red-400" />
            )}
            <span className={`text-sm ${createSuccess ? 'text-emerald-400' : 'text-red-400'}`}>
              {createSuccess ? 'Personalized model created!' : 'Failed to create model'}
            </span>
          </div>
        </div>
      )}
      
      {/* Models Tab Content */}
      {activeSubTab === 'models' && (
        <>
          {/* Create New Adapter */}
          {ollamaAvailable && (
            <div className="p-4 rounded-xl bg-forge-surface/50 border border-forge-border/50">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Create Personalized Model</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Train a model variant for a specific workspace
                  </p>
                </div>
                {!showCreateForm && (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="px-3 py-1.5 rounded-lg bg-neural-pulse/20 text-neural-pulse text-xs font-medium hover:bg-neural-pulse/30 transition-colors"
                  >
                    + New Model
                  </button>
                )}
              </div>
              
              {showCreateForm && (
                <div className="space-y-3 mt-4 anim-slide-up">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1.5">Base Model</label>
                      <select
                        value={selectedBaseModel}
                        onChange={(e) => setSelectedBaseModel(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-forge-surface border border-forge-border text-sm text-text-primary focus:outline-none focus:border-neural-pulse"
                      >
                        {ollamaModels.map(model => (
                          <option key={model.name} value={model.name}>
                            {model.name} ({Math.round(model.size / 1e9 * 10) / 10}GB)
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-xs text-text-muted mb-1.5">Workspace</label>
                      <select
                        value={selectedWorkspace}
                        onChange={(e) => setSelectedWorkspace(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-forge-surface border border-forge-border text-sm text-text-primary focus:outline-none focus:border-neural-pulse"
                      >
                        <option value="general">General (All)</option>
                        <option value="casual">Casual</option>
                        <option value="work">Work</option>
                        <option value="code">Code</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">Model Name</label>
                    <input
                      type="text"
                      value={newAdapterName}
                      onChange={(e) => setNewAdapterName(e.target.value)}
                      placeholder="e.g., my-helper"
                      className="w-full px-3 py-2 rounded-lg bg-forge-surface border border-forge-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-neural-pulse"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateAdapter}
                      disabled={isCreating || !newAdapterName || !selectedBaseModel}
                      className="flex-1 px-4 py-2 rounded-lg bg-neural-pulse/20 text-neural-pulse text-sm font-medium hover:bg-neural-pulse/30 transition-colors disabled:opacity-50"
                    >
                      {isCreating ? (
                        <span className="flex items-center justify-center gap-2">
                          <RefreshCw size={14} className="anim-spin" />
                          Creating...
                        </span>
                      ) : (
                        'Create Model'
                      )}
                    </button>
                    <button
                      onClick={() => setShowCreateForm(false)}
                      className="px-4 py-2 rounded-lg bg-forge-hover text-text-muted text-sm hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Adapters List */}
          {adapters.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-3">Your Personalized Models</h3>
              <div className="grid grid-cols-2 gap-3">
                {adapters.map(adapter => (
                  <div key={adapter.name} className="p-4 rounded-xl bg-forge-surface border border-forge-border group">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-neural-pulse/10">
                          <Brain size={14} className="text-neural-pulse" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">{adapter.name}</p>
                          <p className="text-[10px] text-text-muted">
                            {Math.round(adapter.size / 1e9 * 10) / 10}GB
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteAdapter(adapter.name)}
                        className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-400/20 transition-all"
                      >
                        <X size={14} className="text-red-400" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="mindprint-badge">
                        <Sparkles size={10} />
                        <span>Personalized</span>
                      </span>
                      <span className="text-[10px] text-text-muted">
                        Modified {new Date(adapter.modified_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {!ollamaAvailable && (
            <div className="p-4 rounded-xl border border-dashed border-amber-400/30 bg-amber-400/5 text-center">
              <AlertTriangle size={24} className="text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-text-secondary">Ollama not connected</p>
              <p className="text-xs text-text-muted mt-1">Start Ollama to enable model personalization</p>
              <code className="block mt-2 text-[10px] text-text-muted font-mono bg-forge-surface px-2 py-1 rounded">
                ollama serve
              </code>
            </div>
          )}
        </>
      )}
      
      {/* Friction Signals Tab Content */}
      {activeSubTab === 'signals' && (
        <div className="space-y-4">
          {/* Signal Type Breakdown */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { type: 'regenerate', label: 'Regenerates', icon: RotateCcw, color: 'text-amber-400' },
              { type: 'edit', label: 'Edits', icon: Edit3, color: 'text-blue-400' },
              { type: 'abandon', label: 'Abandons', icon: ThumbsDown, color: 'text-red-400' },
              { type: 'revert', label: 'Reverts', icon: RotateCcw, color: 'text-purple-400' },
            ].map(({ type, label, icon: Icon, color }) => (
              <div key={type} className="p-3 rounded-lg bg-forge-surface border border-forge-border">
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={12} className={color} />
                  <span className="text-xs text-text-muted">{label}</span>
                </div>
                <p className="text-lg font-bold text-text-primary">{frictionStats[type]}</p>
              </div>
            ))}
          </div>
          
          {/* Signal List */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">Recent Signals</h4>
            {frictionSignals.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-forge-border/50 text-center">
                <Activity size={24} className="text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-secondary">No friction signals yet</p>
                <p className="text-xs text-text-muted mt-1">
                  Signals are recorded when you regenerate, edit, or abandon AI responses
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                {frictionSignals.slice(0, 20).map((signal, idx) => (
                  <FrictionSignalRow key={signal.id || idx} signal={signal} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Training Insights Tab Content */}
      {activeSubTab === 'insights' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-forge-surface/50 border border-forge-border/50">
            <h4 className="text-sm font-semibold text-text-primary mb-3">Learning Progress</h4>
            
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Data Collected</span>
                  <span className="text-text-secondary">{frictionStats.total} signals</span>
                </div>
                <div className="h-2 bg-forge-surface rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-neural-pulse to-purple-400 transition-all"
                    style={{ width: `${Math.min(frictionStats.total, 100)}%` }}
                  />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Model Coverage</span>
                  <span className="text-text-secondary">{adapters.length} / {ollamaModels.length}</span>
                </div>
                <div className="h-2 bg-forge-surface rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
                    style={{ width: `${ollamaModels.length > 0 ? (adapters.length / ollamaModels.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
              <h4 className="text-xs font-medium text-text-secondary mb-2">Top Learned Patterns</h4>
              <div className="space-y-2">
                {frictionStats.regenerate > 5 && (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <CheckCircle size={12} className="text-emerald-400" />
                    Prefers more detailed responses
                  </div>
                )}
                {frictionStats.edit > 3 && (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <CheckCircle size={12} className="text-emerald-400" />
                    Often refines code formatting
                  </div>
                )}
                {frictionStats.total < 5 && (
                  <p className="text-xs text-text-muted">
                    Keep using Anvil to reveal patterns...
                  </p>
                )}
              </div>
            </div>
            
            <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
              <h4 className="text-xs font-medium text-text-secondary mb-2">Recommendations</h4>
              <div className="space-y-2">
                {adapters.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle size={12} />
                    Create your first personalized model
                  </div>
                )}
                {frictionStats.total < 50 && (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Target size={12} />
                    Need {50 - frictionStats.total} more signals for optimal training
                  </div>
                )}
                {frictionStats.total >= 50 && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <Award size={12} />
                    Ready for advanced personalization!
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FrictionSignalRow({ signal }) {
  const getSignalConfig = (kind) => {
    switch (kind) {
      case 'regenerate': return { icon: RotateCcw, color: 'text-amber-400', bg: 'bg-amber-400/10' };
      case 'edit': return { icon: Edit3, color: 'text-blue-400', bg: 'bg-blue-400/10' };
      case 'abandon': return { icon: ThumbsDown, color: 'text-red-400', bg: 'bg-red-400/10' };
      case 'revert': return { icon: RotateCcw, color: 'text-purple-400', bg: 'bg-purple-400/10' };
      default: return { icon: Activity, color: 'text-text-muted', bg: 'bg-forge-surface' };
    }
  };
  
  const config = getSignalConfig(signal.kind);
  const Icon = config.icon;
  
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-forge-hover/50 transition-colors">
      <div className={`p-1.5 rounded ${config.bg}`}>
        <Icon size={12} className={config.color} />
      </div>
      <div className="flex-1">
        <span className="text-xs text-text-secondary capitalize">{signal.kind}</span>
        <span className="text-[10px] text-text-muted ml-2">
          severity: {Math.round((signal.severity || 0.5) * 100)}%
        </span>
      </div>
      <span className="text-[10px] text-text-muted">
        {new Date(signal.ts).toLocaleTimeString()}
      </span>
    </div>
  );
}

// ============================================
// INSIGHTS TAB - Analytics Dashboard
// ============================================

function InsightsTab() {
  const { recentInsights } = useSoulStore();
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [events, setEvents] = useState([]);
  
  useEffect(() => {
    loadInsights();
  }, []);
  
  const loadInsights = async () => {
    setIsLoading(true);
    try {
      const [ledgerStats, allEvents] = await Promise.all([
        safeCall('ledgerGetStats', [], null),
        safeCall('ledger:listEvents', [{ limit: 500 }], []),
      ]);
      
      setStats(ledgerStats);
      setEvents(allEvents || []);
    } catch (error) {
      console.error('Failed to load insights:', error);
    }
    setIsLoading(false);
  };
  
  // Calculate analytics from events
  const analytics = useMemo(() => {
    if (!events.length) return null;
    
    const result = {
      totalMessages: 0,
      totalGenerations: 0,
      workspaceUsage: { casual: 0, work: 0, code: 0, nsfw: 0 },
      hourlyActivity: Array(24).fill(0),
      modelUsage: {},
      avgResponseTime: 0,
      sessionsCount: new Set(),
    };
    
    let totalResponseTime = 0;
    let responseCount = 0;
    
    for (const event of events) {
      // Count by type
      if (event.type.includes('message_sent')) result.totalMessages++;
      if (event.type.includes('generation_complete')) {
        result.totalGenerations++;
        if (event.payload?.durationMs) {
          totalResponseTime += event.payload.durationMs;
          responseCount++;
        }
      }
      
      // Workspace usage
      if (event.workspace && result.workspaceUsage[event.workspace] !== undefined) {
        result.workspaceUsage[event.workspace]++;
      }
      
      // Hourly activity
      const hour = new Date(event.ts).getHours();
      result.hourlyActivity[hour]++;
      
      // Model usage
      if (event.payload?.model) {
        result.modelUsage[event.payload.model] = (result.modelUsage[event.payload.model] || 0) + 1;
      }
      
      // Sessions
      if (event.sessionId) {
        result.sessionsCount.add(event.sessionId);
      }
    }
    
    result.avgResponseTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0;
    result.sessionsCount = result.sessionsCount.size;
    
    return result;
  }, [events]);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="p-6 space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard 
          label="Sessions" 
          value={analytics?.sessionsCount || 0} 
          icon={Users}
          color="text-blue-400"
        />
        <StatCard 
          label="Messages" 
          value={analytics?.totalMessages || 0} 
          icon={MessageSquare}
          color="text-emerald-400"
        />
        <StatCard 
          label="Generations" 
          value={analytics?.totalGenerations || 0} 
          icon={Zap}
          color="text-amber-400"
        />
        <StatCard 
          label="Avg Response" 
          value={analytics?.avgResponseTime ? `${(analytics.avgResponseTime / 1000).toFixed(1)}s` : '--'} 
          icon={Clock}
          color="text-purple-400"
        />
        <StatCard 
          label="Total Events" 
          value={stats?.events || 0} 
          icon={Activity}
          color="text-pink-400"
        />
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        {/* Workspace Distribution */}
        <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Workspace Distribution</h3>
          {analytics && (
            <div className="space-y-3">
              {Object.entries(analytics.workspaceUsage).map(([workspace, count]) => {
                const total = Object.values(analytics.workspaceUsage).reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? (count / total) * 100 : 0;
                
                return (
                  <div key={workspace}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary capitalize">{workspace}</span>
                      <span className="text-text-muted">{count} events ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 bg-forge-hover rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-500"
                        style={{ 
                          width: `${percentage}%`,
                          backgroundColor: WORKSPACE_COLORS[workspace] 
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Activity Heatmap */}
        <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Hourly Activity</h3>
          {analytics && (
            <div className="grid grid-cols-12 gap-1">
              {analytics.hourlyActivity.map((count, hour) => {
                const maxCount = Math.max(...analytics.hourlyActivity, 1);
                const intensity = count / maxCount;
                
                return (
                  <div
                    key={hour}
                    className="aspect-square rounded flex items-center justify-center text-[8px] text-text-muted relative group cursor-pointer"
                    style={{ 
                      backgroundColor: `rgba(139, 92, 246, ${intensity * 0.8})`,
                    }}
                  >
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-6 left-1/2 -translate-x-1/2 bg-forge-surface px-1 py-0.5 rounded text-[10px] whitespace-nowrap z-10">
                      {hour}:00 - {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-between text-[10px] text-text-muted mt-2">
            <span>12am</span>
            <span>6am</span>
            <span>12pm</span>
            <span>6pm</span>
            <span>12am</span>
          </div>
        </div>
      </div>
      
      {/* Model Usage */}
      {analytics && Object.keys(analytics.modelUsage).length > 0 && (
        <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Model Usage</h3>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(analytics.modelUsage)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 6)
              .map(([model, count]) => (
                <div key={model} className="p-3 rounded-lg bg-forge-hover/50">
                  <p className="text-xs font-medium text-text-secondary truncate">{model}</p>
                  <p className="text-lg font-bold text-text-primary">{count}</p>
                  <p className="text-[10px] text-text-muted">uses</p>
                </div>
              ))}
          </div>
        </div>
      )}
      
      {/* Recent Insights */}
      <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
        <h3 className="text-sm font-semibold text-text-primary mb-4">AI-Generated Insights</h3>
        {recentInsights.length === 0 ? (
          <div className="text-center py-8">
            <LineChart size={32} className="text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">No insights yet</p>
            <p className="text-xs text-text-muted mt-1">
              Insights generate as patterns emerge from your usage
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentInsights.map((insight, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-forge-hover/50">
                <p className="text-sm text-text-primary">{insight.message}</p>
                <p className="text-xs text-text-muted mt-1">{insight.timestamp}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// SHARED COMPONENTS
// ============================================

function StatCard({ label, value, icon: Icon, color = 'text-text-primary' }) {
  return (
    <div className="p-4 rounded-xl bg-forge-surface border border-forge-border">
      <div className="flex items-center justify-between mb-2">
        <Icon size={16} className={color} />
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}

export default ForgeConsole;
