import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  MessageSquare, Zap, Clock, Brain, Folder,
  TrendingUp, Activity, BarChart2, PieChart,
  Timer
} from 'lucide-react';
import { useAnalyticsStore } from '../../stores/analyticsStore';

/**
 * AnalyticsDashboard - Usage statistics and metrics visualization
 */
export function AnalyticsDashboard({ className = '' }) {
  const getAllStats = useAnalyticsStore(state => state.getAllStats);
  const stats = useMemo(() => getAllStats(), [getAllStats]);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Analytics Dashboard</h2>
          <p className="text-sm text-white/50">Track your AI usage and performance</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-white/40">
          <Timer size={14} />
          <span>Session: {stats.session?.formatted || '0m'}</span>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={MessageSquare}
          label="Today's Messages"
          value={stats.today?.messages || 0}
          trend={stats.today?.messages > (stats.week?.avgMessagesPerDay || 0) ? 'up' : 'down'}
          color="indigo"
        />
        <StatCard
          icon={Zap}
          label="Tokens Used"
          value={formatNumber(stats.today?.tokens || 0)}
          subtext="today"
          color="amber"
        />
        <StatCard
          icon={Clock}
          label="Avg Response"
          value={`${Math.round(stats.responseTimes?.avg || 0)}ms`}
          subtext={`min: ${stats.responseTimes?.min || 0}ms`}
          color="emerald"
        />
        <StatCard
          icon={Brain}
          label="Models Used"
          value={stats.modelBreakdown?.length || 0}
          subtext="this session"
          color="purple"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Weekly Activity Chart */}
        <div className="glass-panel p-4 rounded-xl">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={18} className="text-[var(--ws-primary)]" />
            <h3 className="font-medium text-white">Weekly Activity</h3>
          </div>
          <WeeklyChart data={stats.week?.dailyData || []} />
        </div>

        {/* Model Usage Pie */}
        <div className="glass-panel p-4 rounded-xl">
          <div className="flex items-center gap-2 mb-4">
            <PieChart size={18} className="text-[var(--ws-primary)]" />
            <h3 className="font-medium text-white">Model Usage</h3>
          </div>
          <ModelUsageChart data={stats.modelBreakdown || []} />
        </div>
      </div>

      {/* Workspace & Feature Usage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Workspace Usage */}
        <div className="glass-panel p-4 rounded-xl">
          <div className="flex items-center gap-2 mb-4">
            <Folder size={18} className="text-[var(--ws-primary)]" />
            <h3 className="font-medium text-white">Workspace Usage</h3>
          </div>
          <WorkspaceUsage data={stats.workspaceBreakdown || []} />
        </div>

        {/* Session Summary */}
        <div className="glass-panel p-4 rounded-xl">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={18} className="text-[var(--ws-primary)]" />
            <h3 className="font-medium text-white">Session Summary</h3>
          </div>
          <SessionSummary session={stats.session} responseTimes={stats.responseTimes} />
        </div>
      </div>
    </div>
  );
}

/**
 * StatCard - Individual statistic display
 */
function StatCard({ icon: Icon, label, value, subtext, trend, color = 'indigo' }) {
  const colors = {
    indigo: 'from-indigo-500/20 to-indigo-600/10 border-indigo-500/30',
    amber: 'from-amber-500/20 to-amber-600/10 border-amber-500/30',
    emerald: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
  };

  return (
    <motion.div
      className={`p-4 rounded-xl bg-gradient-to-br ${colors[color]} border`}
      whileHover={{ scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 400 }}
    >
      <div className="flex items-start justify-between">
        <Icon size={20} className="text-white/60" />
        {trend && (
          <TrendingUp 
            size={16} 
            className={trend === 'up' ? 'text-green-400' : 'text-red-400 rotate-180'} 
          />
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-xs text-white/50">{label}</div>
        {subtext && <div className="text-xs text-white/30 mt-1">{subtext}</div>}
      </div>
    </motion.div>
  );
}

/**
 * WeeklyChart - Bar chart for weekly activity
 */
function WeeklyChart({ data }) {
  const maxMessages = Math.max(...data.map(d => d.messages), 1);

  return (
    <div className="flex items-end justify-between h-32 gap-2">
      {data.map((day, index) => (
        <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
          <motion.div
            className="w-full bg-[var(--ws-primary)]/20 rounded-t-md relative overflow-hidden"
            style={{ height: `${(day.messages / maxMessages) * 100}%`, minHeight: 4 }}
            initial={{ height: 0 }}
            animate={{ height: `${(day.messages / maxMessages) * 100}%` }}
            transition={{ delay: index * 0.1, duration: 0.5 }}
          >
            <div 
              className="absolute bottom-0 left-0 right-0 bg-[var(--ws-primary)]"
              style={{ height: '100%', opacity: 0.6 }}
            />
          </motion.div>
          <span className="text-xs text-white/40">{day.day}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * ModelUsageChart - Horizontal bar chart for model usage
 */
function ModelUsageChart({ data }) {
  if (data.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-white/30">
        <span>No model usage data yet</span>
      </div>
    );
  }

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const topModels = data.slice(0, 5);

  return (
    <div className="space-y-3">
      {topModels.map((item, index) => (
        <div key={item.model} className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-white/70 truncate max-w-[150px]">{item.model}</span>
            <span className="text-white/40">{item.percentage}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[var(--ws-primary)] to-[var(--ws-secondary)]"
              initial={{ width: 0 }}
              animate={{ width: `${(item.count / maxCount) * 100}%` }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * WorkspaceUsage - Workspace distribution
 */
function WorkspaceUsage({ data }) {
  const workspaceColors = {
    casual: 'bg-indigo-500',
    work: 'bg-emerald-500',
    code: 'bg-amber-500',
    nsfw: 'bg-pink-500',
    private: 'bg-pink-500'
  };

  const workspaceLabels = {
    casual: 'Casual',
    work: 'Work',
    code: 'Code',
    nsfw: 'Vault',
    private: 'Vault'
  };

  if (data.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-white/30">
        <span>No workspace data yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mini pie visualization */}
      <div className="flex items-center justify-center gap-1 h-4">
        {data.map((item, index) => (
          <motion.div
            key={item.workspace}
            className={`h-full rounded-full ${workspaceColors[item.workspace] || 'bg-gray-500'}`}
            style={{ width: `${item.percentage}%`, minWidth: 8 }}
            initial={{ width: 0 }}
            animate={{ width: `${item.percentage}%` }}
            transition={{ delay: index * 0.1 }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {data.map(item => (
          <div key={item.workspace} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${workspaceColors[item.workspace] || 'bg-gray-500'}`} />
            <span className="text-xs text-white/60">{workspaceLabels[item.workspace] || item.workspace}</span>
            <span className="text-xs text-white/40 ml-auto">{item.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SessionSummary - Current session statistics
 */
function SessionSummary({ session, responseTimes }) {
  const items = [
    { label: 'Duration', value: session?.formatted || '0m', icon: Timer },
    { label: 'Messages', value: session?.messages || 0, icon: MessageSquare },
    { label: 'Tokens', value: formatNumber(session?.tokens || 0), icon: Zap },
    { label: 'Avg Response', value: `${Math.round(responseTimes?.avg || 0)}ms`, icon: Clock },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="p-2 bg-white/5 rounded-lg">
            <item.icon size={16} className="text-white/40" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">{item.value}</div>
            <div className="text-xs text-white/40">{item.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Format large numbers
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

export default AnalyticsDashboard;





