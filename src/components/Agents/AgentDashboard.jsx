import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Globe2, MonitorSmartphone, PlayCircle, X } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import { AgentLiveView } from './AgentLiveView';

export function AgentDashboard({ isOpen, onClose }) {
  const { tasks, isLoading, refreshTasks, createTask, cancelTask } = useAgentStore(
    (state) => ({
      tasks: state.tasks,
      isLoading: state.isLoading,
      refreshTasks: state.refreshTasks,
      createTask: state.createTask,
      cancelTask: state.cancelTask,
    }),
  );

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      refreshTasks();
    }
  }, [isOpen, refreshTasks]);

  const handleCreateBrowserAgent = async () => {
    if (!query.trim()) return;
    const task = await createTask({ type: 'browser_search', input: query.trim() });
    if (task) {
      setSelectedTaskId(task.id);
      setQuery('');
    }
  };

  const handleCreateDesktopProbe = async () => {
    const task = await createTask({ type: 'desktop_probe', input: '' });
    if (task) {
      setSelectedTaskId(task.id);
    }
  };

  const renderStatusPill = (status) => {
    let color = 'bg-forge-elevated text-text-muted';
    if (status === 'running') color = 'bg-workspace-casual/20 text-workspace-casual';
    else if (status === 'completed') color = 'bg-emerald-500/10 text-emerald-400';
    else if (status === 'error') color = 'bg-status-error/10 text-status-error';
    else if (status === 'cancelled') color = 'bg-forge-elevated text-text-muted';

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${color}`}
      >
        {status}
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-4xl h-[540px] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-forge-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-casual/20">
                <Bot size={18} className="text-workspace-casual" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Agent Command Center</h2>
                <p className="text-xs text-text-muted">
                  Launch autonomous agents to browse, probe the desktop, or run background tasks.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex flex-1 divide-x divide-forge-border">
            {/* Left: Task list & launchers */}
            <div className="w-2/5 flex flex-col">
              <div className="px-4 py-3 border-b border-forge-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-primary uppercase tracking-wide">
                    Launch agent
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Ask an agent to find something (for example, the best travel backpack)"
                        className="input text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateBrowserAgent}
                      disabled={!query.trim()}
                      className="btn btn-primary text-[11px] flex items-center gap-1"
                    >
                      <Globe2 size={12} />
                      Go
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateDesktopProbe}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-forge-border bg-forge-bg/40 hover:bg-forge-hover/60 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <MonitorSmartphone size={14} className="text-text-muted" />
                      <span className="text-xs text-text-primary">Test desktop agent</span>
                    </div>
                    <span className="text-[10px] text-text-muted">Probe screen</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {isLoading && (
                  <div className="p-4 text-xs text-text-muted">Loading agents…</div>
                )}
                {!isLoading && tasks.length === 0 && (
                  <div className="p-4 text-xs text-text-muted">
                    No agents yet. Launch one using the controls above.
                  </div>
                )}
                {!isLoading &&
                  tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`w-full text-left px-4 py-3 border-b border-forge-border/60 hover:bg-forge-hover/60 transition-colors ${
                        selectedTaskId === task.id ? 'bg-forge-hover/60' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="text-xs text-text-primary">
                            {task.type === 'browser_search'
                              ? 'Browser search'
                              : task.type === 'desktop_probe'
                              ? 'Desktop probe'
                              : task.type}
                          </span>
                          {task.input && (
                            <span className="text-[11px] text-text-muted line-clamp-1">
                              {task.input}
                            </span>
                          )}
                        </div>
                        {renderStatusPill(task.status)}
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                        <span>
                          {task.created_at
                            ? new Date(task.created_at).toLocaleTimeString()
                            : ''}
                        </span>
                        {(task.status === 'running' || task.status === 'pending') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelTask(task.id);
                            }}
                            className="inline-flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            </div>

            {/* Right: Live view */}
            <div className="w-3/5 flex flex-col">
              {selectedTaskId ? (
                <AgentLiveView taskId={selectedTaskId} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                  <PlayCircle size={42} className="mb-3 text-workspace-casual/70" />
                  <h3 className="text-sm font-medium text-text-primary mb-1">
                    No agent selected
                  </h3>
                  <p className="text-xs text-text-muted max-w-sm">
                    Launch a new browser or desktop agent on the left, or select an existing one
                    from the list to watch its progress and output.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default AgentDashboard;


