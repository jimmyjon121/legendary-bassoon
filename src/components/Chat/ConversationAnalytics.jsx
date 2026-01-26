import React, { useState, useMemo } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Clock, 
  MessageSquare, 
  Brain,
  Heart,
  Target,
  Calendar,
  Zap,
  Eye,
  Download,
  Filter,
  RefreshCw,
  Lightbulb,
  Activity,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { useAppStore } from '../../stores/appStore';
import { useCasualStore } from '../../stores/casualStore';
import conversationEngine from '../../services/conversationEngine';

const TIME_PERIODS = [
  { id: 'week', label: 'Last 7 days', days: 7 },
  { id: 'month', label: 'Last 30 days', days: 30 },
  { id: 'quarter', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

const METRIC_CARDS = [
  { id: 'conversations', label: 'Total Conversations', icon: MessageSquare, color: 'text-blue-400' },
  { id: 'messages', label: 'Messages Exchanged', icon: Activity, color: 'text-green-400' },
  { id: 'topics', label: 'Topics Explored', icon: Lightbulb, color: 'text-yellow-400' },
  { id: 'insights', label: 'Insights Generated', icon: Brain, color: 'text-purple-400' },
];

export function ConversationAnalytics({ isOpen, onClose }) {
  const { conversations } = useAppStore();
  const { conversationInsights } = useCasualStore();
  
  const [selectedPeriod, setSelectedPeriod] = useState('month');
  const [selectedMetric, setSelectedMetric] = useState('conversations');
  const [showDetails, setShowDetails] = useState(false);

  // Process analytics data
  const analyticsData = useMemo(() => {
    if (!conversations || conversations.length === 0) {
      return {
        overview: {},
        trends: [],
        topTopics: [],
        moodDistribution: {},
        engagementMetrics: {},
        learningProgress: [],
      };
    }

    const period = TIME_PERIODS.find(p => p.id === selectedPeriod);
    const cutoffDate = period?.days ? subDays(new Date(), period.days) : new Date(0);
    
    // Filter conversations by time period
    const filteredConversations = conversations.filter(conv => 
      new Date(conv.updated_at || conv.created_at || 0) >= cutoffDate
    );

    // Process each conversation
    const processedConversations = filteredConversations.map(conv => {
      const topics = conversationEngine.extractTopics(conv.messages || [], { maxTopics: 5 });
      const mood = conversationEngine.analyzeConversationMood(conv.messages || []);
      const summary = conversationEngine.generateConversationSummary(conv.messages || []);
      
      return {
        ...conv,
        topics,
        mood: mood.overall,
        moodConfidence: mood.confidence,
        messageCount: (conv.messages || []).length,
        wordCount: (conv.messages || []).reduce((sum, m) => sum + (m.content?.length || 0), 0),
        summary,
        date: new Date(conv.updated_at || conv.created_at || 0),
      };
    });

    // Generate insights
    const insights = conversationEngine.generateConversationInsights(processedConversations);
    
    // Build trend data
    const trendData = buildTrendData(processedConversations, period);
    
    // Mood distribution
    const moodCounts = processedConversations.reduce((acc, conv) => {
      acc[conv.mood] = (acc[conv.mood] || 0) + 1;
      return acc;
    }, {});

    // Engagement metrics
    const totalMessages = processedConversations.reduce((sum, conv) => sum + conv.messageCount, 0);
    const avgMessagesPerConversation = processedConversations.length > 0 
      ? totalMessages / processedConversations.length 
      : 0;
    
    const engagementMetrics = {
      totalMessages,
      avgMessagesPerConversation: Math.round(avgMessagesPerConversation * 10) / 10,
      totalWordCount: processedConversations.reduce((sum, conv) => sum + conv.wordCount, 0),
      avgSessionLength: calculateAvgSessionLength(processedConversations),
    };

    return {
      overview: {
        totalConversations: processedConversations.length,
        totalMessages,
        totalTopics: insights.topTopics.length,
        avgLength: insights.averageLength,
      },
      trends: trendData,
      topTopics: insights.topTopics,
      moodDistribution: moodCounts,
      engagementMetrics,
      learningProgress: insights.learningProgress,
      patterns: insights.patterns,
    };
  }, [conversations, selectedPeriod]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-6xl h-[90vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-forge-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-workspace-casual/20">
              <BarChart3 size={24} className="text-workspace-casual" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Conversation Analytics</h2>
              <p className="text-sm text-text-muted">Insights into your thinking patterns and conversation evolution</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="px-3 py-1.5 bg-forge-bg border border-forge-border rounded text-sm focus:outline-none focus:border-workspace-casual/50"
            >
              {TIME_PERIODS.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.label}
                </option>
              ))}
            </select>
            
            <button
              onClick={onClose}
              className="p-2 rounded text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {METRIC_CARDS.map((card) => {
              const Icon = card.icon;
              let value = 0;
              
              switch (card.id) {
                case 'conversations':
                  value = analyticsData.overview.totalConversations;
                  break;
                case 'messages':
                  value = analyticsData.overview.totalMessages;
                  break;
                case 'topics':
                  value = analyticsData.overview.totalTopics;
                  break;
                case 'insights':
                  value = analyticsData.patterns?.length || 0;
                  break;
              }
              
              return (
                <motion.div
                  key={card.id}
                  whileHover={{ scale: 1.02 }}
                  className="p-4 bg-forge-bg/50 border border-forge-border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded bg-forge-elevated">
                      <Icon size={20} className={card.color} />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-text-primary">{value}</div>
                      <div className="text-xs text-text-muted">{card.label}</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Topic Distribution */}
            <div className="bg-forge-bg/50 border border-forge-border rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Lightbulb size={18} />
                Top Topics
              </h3>
              <div className="space-y-2">
                {analyticsData.topTopics.slice(0, 8).map((topic, index) => {
                  const percentage = analyticsData.topTopics.length > 0 
                    ? (topic.score / analyticsData.topTopics[0].score) * 100
                    : 0;
                  
                  return (
                    <div key={topic.name} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-workspace-casual" />
                      <span className="text-sm text-text-primary flex-1 truncate">{topic.name}</span>
                      <div className="w-16 h-2 bg-forge-border rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-workspace-casual rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ delay: index * 0.1 }}
                        />
                      </div>
                      <span className="text-xs text-text-muted w-8 text-right">
                        {Math.round(topic.score)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mood Distribution */}
            <div className="bg-forge-bg/50 border border-forge-border rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Heart size={18} />
                Conversation Moods
              </h3>
              <div className="space-y-3">
                {Object.entries(analyticsData.moodDistribution).map(([mood, count]) => {
                  const total = Object.values(analyticsData.moodDistribution).reduce((sum, c) => sum + c, 0);
                  const percentage = total > 0 ? (count / total) * 100 : 0;
                  
                  const moodColors = {
                    positive: 'bg-green-400',
                    negative: 'bg-red-400',
                    neutral: 'bg-gray-400',
                  };
                  
                  return (
                    <div key={mood} className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${moodColors[mood] || 'bg-gray-400'}`} />
                      <span className="text-sm text-text-primary capitalize flex-1">{mood}</span>
                      <span className="text-sm text-text-primary font-medium">{count}</span>
                      <span className="text-xs text-text-muted">({Math.round(percentage)}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Engagement Metrics */}
            <div className="bg-forge-bg/50 border border-forge-border rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Activity size={18} />
                Engagement
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Avg Messages/Chat</span>
                  <span className="text-lg font-semibold text-text-primary">
                    {analyticsData.engagementMetrics.avgMessagesPerConversation}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Total Words</span>
                  <span className="text-lg font-semibold text-text-primary">
                    {analyticsData.engagementMetrics.totalWordCount?.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Avg Session</span>
                  <span className="text-lg font-semibold text-text-primary">
                    {analyticsData.engagementMetrics.avgSessionLength}
                  </span>
                </div>
              </div>
            </div>

            {/* Learning Patterns */}
            <div className="bg-forge-bg/50 border border-forge-border rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <TrendingUp size={18} />
                Learning Patterns
              </h3>
              {analyticsData.patterns && analyticsData.patterns.length > 0 ? (
                <div className="space-y-2">
                  {analyticsData.patterns.map((pattern, index) => (
                    <div key={pattern.type} className="p-2 bg-forge-elevated rounded border border-forge-border/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Target size={12} className="text-workspace-casual" />
                        <span className="text-sm font-medium text-text-primary">{pattern.name}</span>
                      </div>
                      <p className="text-xs text-text-muted">{pattern.description}</p>
                      {pattern.conversations && (
                        <div className="text-[10px] text-text-muted mt-1">
                          {pattern.conversations.length} conversations involved
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  Continue having conversations to see learning patterns emerge.
                </p>
              )}
            </div>
          </div>

          {/* Detailed Charts Section */}
          {showDetails && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-6 space-y-6"
            >
              {/* Activity Timeline */}
              <div className="bg-forge-bg/50 border border-forge-border rounded-lg p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Calendar size={18} />
                  Activity Timeline
                </h3>
                <ActivityChart data={analyticsData.trends} period={selectedPeriod} />
              </div>

              {/* Topic Evolution */}
              <div className="bg-forge-bg/50 border border-forge-border rounded-lg p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Brain size={18} />
                  Topic Evolution
                </h3>
                <TopicEvolutionChart topics={analyticsData.topTopics} />
              </div>
            </motion.div>
          )}

          {/* Toggle Details */}
          <div className="mt-6 text-center">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-4 py-2 bg-workspace-casual/20 hover:bg-workspace-casual/30 text-workspace-casual rounded-lg text-sm transition-colors flex items-center gap-2 mx-auto"
            >
              <Eye size={14} />
              {showDetails ? 'Hide' : 'Show'} Detailed Charts
            </button>
          </div>
        </div>

        {/* Export/Actions Footer */}
        <div className="p-4 border-t border-forge-border bg-forge-bg/30">
          <div className="flex items-center justify-between">
            <div className="text-xs text-text-muted">
              Analysis based on {analyticsData.overview.totalConversations} conversations
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // Export analytics data
                  const data = JSON.stringify(analyticsData, null, 2);
                  navigator.clipboard.writeText(data);
                }}
                className="px-3 py-1.5 bg-forge-elevated hover:bg-forge-hover text-text-primary rounded text-xs transition-colors flex items-center gap-1"
              >
                <Download size={12} />
                Export Data
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Chart components
function ActivityChart({ data, period }) {
  // Simple bar chart representation
  return (
    <div className="h-32 flex items-end gap-1">
      {data.slice(0, 14).map((point, index) => {
        const height = Math.max(8, (point.value / Math.max(...data.map(d => d.value))) * 100);
        
        return (
          <div
            key={index}
            className="flex-1 bg-workspace-casual/60 rounded-t transition-all hover:bg-workspace-casual"
            style={{ height: `${height}%` }}
            title={`${point.date}: ${point.value} conversations`}
          />
        );
      })}
    </div>
  );
}

function TopicEvolutionChart({ topics }) {
  return (
    <div className="space-y-2">
      {topics.slice(0, 6).map((topic, index) => {
        const width = topics.length > 0 ? (topic.score / topics[0].score) * 100 : 0;
        
        return (
          <div key={topic.name} className="flex items-center gap-3">
            <span className="text-sm text-text-primary w-24 truncate" title={topic.name}>
              {topic.name}
            </span>
            <div className="flex-1 h-4 bg-forge-border rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-workspace-casual to-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ delay: index * 0.1, duration: 0.8 }}
              />
            </div>
            <span className="text-xs text-text-muted w-8 text-right">
              {Math.round(topic.score)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Helper functions
function buildTrendData(conversations, period) {
  if (!period?.days) {
    // For "all time", group by month
    const monthlyData = {};
    conversations.forEach(conv => {
      const month = format(conv.date, 'yyyy-MM');
      monthlyData[month] = (monthlyData[month] || 0) + 1;
    });
    
    return Object.entries(monthlyData).map(([month, count]) => ({
      date: month,
      value: count,
    }));
  }

  // For specific periods, group by day
  const days = eachDayOfInterval({
    start: subDays(new Date(), period.days),
    end: new Date(),
  });

  return days.map(day => {
    const dayStr = format(day, 'yyyy-MM-dd');
    const count = conversations.filter(conv => 
      format(conv.date, 'yyyy-MM-dd') === dayStr
    ).length;
    
    return {
      date: format(day, 'MMM dd'),
      value: count,
    };
  });
}

function calculateAvgSessionLength(conversations) {
  if (conversations.length === 0) return '0 min';
  
  const totalMinutes = conversations.reduce((sum, conv) => {
    if (!conv.messages || conv.messages.length < 2) return sum;
    
    const first = new Date(conv.messages[0].created_at || 0);
    const last = new Date(conv.messages[conv.messages.length - 1].created_at || 0);
    const diffMs = last - first;
    const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    
    return sum + diffMins;
  }, 0);
  
  const avgMinutes = Math.round(totalMinutes / conversations.length);
  
  if (avgMinutes < 60) return `${avgMinutes} min`;
  
  const hours = Math.floor(avgMinutes / 60);
  const mins = avgMinutes % 60;
  
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default ConversationAnalytics;
