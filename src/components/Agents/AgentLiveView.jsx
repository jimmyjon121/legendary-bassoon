import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAgentStore } from '../../stores/agentStore';

export function AgentLiveView({ taskId }) {
  const { tasks, reloadTask } = useAgentStore((state) => ({
    tasks: state.tasks,
    reloadTask: state.reloadTask,
  }));

  const task = tasks.find((t) => t.id === taskId);

  useEffect(() => {
    if (!taskId) return;
    // Simple polling loop while task is running
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      await reloadTask(taskId);
      const updated = useAgentStore.getState().tasks.find((t) => t.id === taskId);
      if (
        updated &&
        (updated.status === 'completed' ||
          updated.status === 'error' ||
          updated.status === 'cancelled')
      ) {
        return;
      }
      setTimeout(poll, 1500);
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [taskId, reloadTask]);

  if (!task) {
    return (
      <div className="text-xs text-text-muted px-4 py-3">
        No agent selected.
      </div>
    );
  }

  const statusColor =
    task.status === 'completed'
      ? 'text-emerald-400'
      : task.status === 'error'
      ? 'text-status-error'
      : task.status === 'cancelled'
      ? 'text-text-muted'
      : 'text-workspace-casual';

  return (
    <motion.div
      key={task.id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-forge-border">
        <div className="flex flex-col">
          <span className="text-xs font-medium text-text-primary">
            {task.type === 'browser_search' ? 'Browser search agent' : 'Desktop agent'}
          </span>
          <span className="text-[11px] text-text-muted line-clamp-1">
            {task.input}
          </span>
        </div>
        <span className={`text-[11px] uppercase tracking-wide ${statusColor}`}>
          {task.status}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 text-[11px] font-mono bg-forge-bg/60">
        {(task.logs || []).map((line, idx) => (
          <div key={idx} className="text-text-muted">
            {line}
          </div>
        ))}

        {task.output && (
          <div className="mt-2 pt-2 border-t border-forge-border text-text-primary whitespace-pre-wrap">
            {task.output}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default AgentLiveView;






