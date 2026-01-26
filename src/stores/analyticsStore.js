/**
 * Analytics Store - Track usage metrics and statistics
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Calculate statistics from an array of numbers
 */
function calculateStats(values) {
  if (!values || values.length === 0) {
    return { min: 0, max: 0, avg: 0, total: 0, count: 0 };
  }
  
  const total = values.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: total / values.length,
    total,
    count: values.length
  };
}

/**
 * Get the start of today
 */
function getToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString().split('T')[0];
}

/**
 * Get the start of this week (Monday)
 */
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  now.setDate(diff);
  now.setHours(0, 0, 0, 0);
  return now.toISOString().split('T')[0];
}

export const useAnalyticsStore = create(
  persist(
    (set, get) => ({
      // Daily metrics
      dailyMetrics: {},
      
      // Session metrics
      sessionStart: Date.now(),
      messagesThisSession: 0,
      tokensThisSession: 0,
      
      // Model usage
      modelUsage: {},
      
      // Response times
      responseTimes: [],
      
      // Feature usage
      featureUsage: {},
      
      // Workspace usage
      workspaceUsage: {},
      
      /**
       * Track a message sent/received
       */
      trackMessage: (data) => {
        const { role, model, tokens = 0, responseTime = 0 } = data;
        const today = getToday();
        
        set(state => {
          const daily = state.dailyMetrics[today] || {
            messages: 0,
            userMessages: 0,
            aiMessages: 0,
            tokens: 0,
            conversations: new Set(),
            models: {}
          };
          
          daily.messages++;
          if (role === 'user') {
            daily.userMessages++;
          } else {
            daily.aiMessages++;
          }
          daily.tokens += tokens;
          
          if (model) {
            daily.models[model] = (daily.models[model] || 0) + 1;
          }
          
          // Track model usage overall
          const modelUsage = { ...state.modelUsage };
          if (model) {
            modelUsage[model] = (modelUsage[model] || 0) + 1;
          }
          
          // Track response times (keep last 100)
          const responseTimes = [...state.responseTimes, responseTime].slice(-100);
          
          return {
            dailyMetrics: {
              ...state.dailyMetrics,
              [today]: daily
            },
            messagesThisSession: state.messagesThisSession + 1,
            tokensThisSession: state.tokensThisSession + tokens,
            modelUsage,
            responseTimes
          };
        });
      },
      
      /**
       * Track conversation activity
       */
      trackConversation: (conversationId, action) => {
        const today = getToday();
        
        set(state => {
          const daily = state.dailyMetrics[today] || {
            messages: 0,
            tokens: 0,
            conversationsCreated: 0,
            conversationsActive: new Set()
          };
          
          if (action === 'created') {
            daily.conversationsCreated = (daily.conversationsCreated || 0) + 1;
          }
          
          // Track active conversations
          const activeSet = new Set(daily.conversationsActive || []);
          activeSet.add(conversationId);
          daily.conversationsActive = Array.from(activeSet);
          
          return {
            dailyMetrics: {
              ...state.dailyMetrics,
              [today]: daily
            }
          };
        });
      },
      
      /**
       * Track workspace usage
       */
      trackWorkspace: (workspace) => {
        set(state => ({
          workspaceUsage: {
            ...state.workspaceUsage,
            [workspace]: (state.workspaceUsage[workspace] || 0) + 1
          }
        }));
      },
      
      /**
       * Track feature usage
       */
      trackFeature: (feature) => {
        set(state => ({
          featureUsage: {
            ...state.featureUsage,
            [feature]: (state.featureUsage[feature] || 0) + 1
          }
        }));
      },
      
      /**
       * Get today's metrics
       */
      getTodayMetrics: () => {
        const state = get();
        const today = getToday();
        return state.dailyMetrics[today] || {
          messages: 0,
          userMessages: 0,
          aiMessages: 0,
          tokens: 0,
          conversationsCreated: 0
        };
      },
      
      /**
       * Get this week's metrics
       */
      getWeekMetrics: () => {
        const state = get();
        const weekStart = getWeekStart();
        const today = new Date();
        
        let totalMessages = 0;
        let totalTokens = 0;
        let totalConversations = 0;
        const dailyData = [];
        
        // Iterate through the last 7 days
        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateKey = date.toISOString().split('T')[0];
          const dayMetrics = state.dailyMetrics[dateKey] || { messages: 0, tokens: 0 };
          
          totalMessages += dayMetrics.messages || 0;
          totalTokens += dayMetrics.tokens || 0;
          totalConversations += dayMetrics.conversationsCreated || 0;
          
          dailyData.unshift({
            date: dateKey,
            day: date.toLocaleDateString('en-US', { weekday: 'short' }),
            messages: dayMetrics.messages || 0,
            tokens: dayMetrics.tokens || 0
          });
        }
        
        return {
          totalMessages,
          totalTokens,
          totalConversations,
          dailyData,
          avgMessagesPerDay: totalMessages / 7
        };
      },
      
      /**
       * Get response time statistics
       */
      getResponseTimeStats: () => {
        const state = get();
        return calculateStats(state.responseTimes);
      },
      
      /**
       * Get model usage breakdown
       */
      getModelBreakdown: () => {
        const state = get();
        const total = Object.values(state.modelUsage).reduce((a, b) => a + b, 0);
        
        return Object.entries(state.modelUsage)
          .map(([model, count]) => ({
            model,
            count,
            percentage: total > 0 ? ((count / total) * 100).toFixed(1) : 0
          }))
          .sort((a, b) => b.count - a.count);
      },
      
      /**
       * Get workspace breakdown
       */
      getWorkspaceBreakdown: () => {
        const state = get();
        const total = Object.values(state.workspaceUsage).reduce((a, b) => a + b, 0);
        
        return Object.entries(state.workspaceUsage)
          .map(([workspace, count]) => ({
            workspace,
            count,
            percentage: total > 0 ? ((count / total) * 100).toFixed(1) : 0
          }))
          .sort((a, b) => b.count - a.count);
      },
      
      /**
       * Get session duration
       */
      getSessionDuration: () => {
        const state = get();
        const duration = Date.now() - state.sessionStart;
        const minutes = Math.floor(duration / 60000);
        const hours = Math.floor(minutes / 60);
        
        return {
          ms: duration,
          minutes,
          hours,
          formatted: hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
        };
      },
      
      /**
       * Get all statistics
       */
      getAllStats: () => {
        const state = get();
        const today = state.getTodayMetrics();
        const week = state.getWeekMetrics();
        const responseTimes = state.getResponseTimeStats();
        const modelBreakdown = state.getModelBreakdown();
        const workspaceBreakdown = state.getWorkspaceBreakdown();
        const session = state.getSessionDuration();
        
        return {
          today,
          week,
          responseTimes,
          modelBreakdown,
          workspaceBreakdown,
          session: {
            ...session,
            messages: state.messagesThisSession,
            tokens: state.tokensThisSession
          }
        };
      },
      
      /**
       * Reset session metrics
       */
      resetSession: () => {
        set({
          sessionStart: Date.now(),
          messagesThisSession: 0,
          tokensThisSession: 0,
          responseTimes: []
        });
      },
      
      /**
       * Clear old data (keep last 30 days)
       */
      cleanupOldData: () => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffKey = cutoff.toISOString().split('T')[0];
        
        set(state => {
          const dailyMetrics = {};
          for (const [date, metrics] of Object.entries(state.dailyMetrics)) {
            if (date >= cutoffKey) {
              dailyMetrics[date] = metrics;
            }
          }
          return { dailyMetrics };
        });
      }
    }),
    {
      name: 'devforge-analytics',
      partialize: (state) => ({
        dailyMetrics: state.dailyMetrics,
        modelUsage: state.modelUsage,
        workspaceUsage: state.workspaceUsage,
        featureUsage: state.featureUsage
      })
    }
  )
);

export default useAnalyticsStore;






