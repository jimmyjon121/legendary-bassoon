import React from 'react';
import { motion } from 'framer-motion';
import { 
  Zap, 
  Brain, 
  Sparkles, 
  Gauge, 
  Cpu, 
  Clock,
  TrendingUp,
  Star
} from 'lucide-react';

/**
 * Model performance categories and their styling
 */
const BADGE_TYPES = {
  fast: {
    icon: Zap,
    label: 'Fast',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    description: 'Quick responses, ideal for chat',
  },
  smart: {
    icon: Brain,
    label: 'Smart',
    color: '#818cf8',
    bgColor: 'rgba(129, 140, 248, 0.15)',
    borderColor: 'rgba(129, 140, 248, 0.3)',
    description: 'High reasoning capability',
  },
  creative: {
    icon: Sparkles,
    label: 'Creative',
    color: '#ec4899',
    bgColor: 'rgba(236, 72, 153, 0.15)',
    borderColor: 'rgba(236, 72, 153, 0.3)',
    description: 'Great for writing & ideation',
  },
  powerful: {
    icon: Gauge,
    label: 'Powerful',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    description: 'High parameter count',
  },
  efficient: {
    icon: Cpu,
    label: 'Efficient',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.15)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
    description: 'Low resource usage',
  },
  coding: {
    icon: Star,
    label: 'Coding',
    color: '#a855f7',
    bgColor: 'rgba(168, 85, 247, 0.15)',
    borderColor: 'rgba(168, 85, 247, 0.3)',
    description: 'Optimized for code',
  },
};

/**
 * ModelBadge - Individual performance badge
 */
export const ModelBadge = ({ type, size = 'sm', showLabel = true, animated = true }) => {
  const badge = BADGE_TYPES[type];
  if (!badge) return null;

  const Icon = badge.icon;
  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[10px] gap-1',
    sm: 'px-2 py-1 text-xs gap-1.5',
    md: 'px-3 py-1.5 text-sm gap-2',
  };

  const iconSizes = { xs: 10, sm: 12, md: 14 };

  return (
    <motion.span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses[size]}`}
      style={{
        background: badge.bgColor,
        border: `1px solid ${badge.borderColor}`,
        color: badge.color,
      }}
      initial={animated ? { scale: 0 } : false}
      animate={{ scale: 1 }}
      whileHover={animated ? { scale: 1.05 } : undefined}
      title={badge.description}
    >
      <Icon size={iconSizes[size]} />
      {showLabel && <span>{badge.label}</span>}
    </motion.span>
  );
};

/**
 * ModelPerformanceCard - Full performance visualization
 */
export const ModelPerformanceCard = ({ model, className = '' }) => {
  // Calculate performance scores (mock - would come from actual model data)
  const performance = {
    speed: model.speed || 85,
    quality: model.quality || 90,
    efficiency: model.efficiency || 75,
    context: model.contextLength ? Math.min((model.contextLength / 128000) * 100, 100) : 50,
  };

  return (
    <div className={`glass-card p-4 space-y-4 ${className}`}>
      {/* Model Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-white">{model.name}</h3>
          <p className="text-sm text-white/50">{model.family || 'Unknown'}</p>
        </div>
        <div className="flex gap-1.5">
          {model.badges?.map(badge => (
            <ModelBadge key={badge} type={badge} size="xs" showLabel={false} />
          ))}
        </div>
      </div>

      {/* Performance Bars */}
      <div className="space-y-3">
        <PerformanceBar label="Speed" value={performance.speed} color="#10b981" icon={<Clock size={12} />} />
        <PerformanceBar label="Quality" value={performance.quality} color="#818cf8" icon={<Brain size={12} />} />
        <PerformanceBar label="Efficiency" value={performance.efficiency} color="#06b6d4" icon={<Cpu size={12} />} />
        <PerformanceBar label="Context" value={performance.context} color="#f59e0b" icon={<TrendingUp size={12} />} />
      </div>

      {/* Recommended Tasks */}
      {model.recommendedTasks && (
        <div className="pt-2 border-t border-white/10">
          <span className="text-xs text-white/40">Recommended for:</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {model.recommendedTasks.map(task => (
              <span
                key={task}
                className="px-2 py-0.5 bg-white/5 rounded text-xs text-white/70"
              >
                {task}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * PerformanceBar - Animated performance indicator
 */
const PerformanceBar = ({ label, value, color, icon }) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-white/60">
          {icon}
          {label}
        </span>
        <span style={{ color }}>{value}%</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ 
            background: `linear-gradient(90deg, ${color}, ${color}88)`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
};

/**
 * ModelRecommendations - Task-based model recommendations
 */
export const ModelRecommendations = ({ task, models, onSelect }) => {
  const taskRecommendations = {
    chat: { badges: ['fast', 'smart'], title: 'Quick Chat' },
    coding: { badges: ['coding', 'smart'], title: 'Code Generation' },
    writing: { badges: ['creative', 'smart'], title: 'Creative Writing' },
    analysis: { badges: ['powerful', 'smart'], title: 'Deep Analysis' },
    summarization: { badges: ['fast', 'efficient'], title: 'Summarization' },
  };

  const recommendation = taskRecommendations[task];
  if (!recommendation) return null;

  // Filter models that match the recommended badges
  const recommendedModels = models.filter(model =>
    model.badges?.some(b => recommendation.badges.includes(b))
  ).slice(0, 3);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-white/70">Recommended for</span>
        <span className="text-sm font-medium text-[var(--ws-primary)]">
          {recommendation.title}
        </span>
      </div>
      
      <div className="grid gap-2">
        {recommendedModels.map((model, index) => (
          <motion.button
            key={model.id}
            onClick={() => onSelect?.(model)}
            className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 hover:border-[var(--ws-primary)]/50 transition-all text-left"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ x: 4 }}
          >
            <div>
              <div className="text-sm font-medium text-white">{model.name}</div>
              <div className="text-xs text-white/50">{model.size || 'Unknown size'}</div>
            </div>
            <div className="flex gap-1">
              {model.badges?.slice(0, 2).map(badge => (
                <ModelBadge key={badge} type={badge} size="xs" showLabel={false} />
              ))}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

/**
 * ModelComparisonView - Side by side model comparison
 */
export const ModelComparisonView = ({ models, className = '' }) => {
  if (!models || models.length < 2) return null;

  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {models.slice(0, 2).map(model => (
        <ModelPerformanceCard key={model.id} model={model} />
      ))}
    </div>
  );
};

export default ModelBadge;






