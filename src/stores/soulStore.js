/**
 * Soul Store
 * 
 * State management for the Soul Engine (cognitive state, patterns, suggestions).
 * Connects to the backend ledger and soul services.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isElectron, safeCall } from '../utils/electronAPI';

// Circadian time periods
const CIRCADIAN_PERIODS = {
  morning: { start: 6, end: 9, label: 'Morning', tone: 'calm, organized' },
  workday: { start: 9, end: 17, label: 'Workday', tone: 'efficient, focused' },
  evening: { start: 17, end: 22, label: 'Evening', tone: 'casual, creative' },
  nightowl: { start: 22, end: 2, label: 'Night Owl', tone: 'philosophical, playful' },
  latenight: { start: 2, end: 6, label: 'Late Night', tone: 'gentle, minimal' },
};

function getCircadianPeriod(hour = new Date().getHours()) {
  if (hour >= 6 && hour < 9) return 'morning';
  if (hour >= 9 && hour < 17) return 'workday';
  if (hour >= 17 && hour < 22) return 'evening';
  if (hour >= 22 || hour < 2) return 'nightowl';
  return 'latenight';
}

export const useSoulStore = create(
  persist(
    (set, get) => ({
      // Current inferred state
      currentState: null, // 'focused' | 'stressed' | 'creative' | 'exploratory' | 'tired' | 'flow'
      stateConfidence: 0,
      stateSignals: [],
      
      // Circadian
      circadianPeriod: getCircadianPeriod(),
      circadianInfo: CIRCADIAN_PERIODS[getCircadianPeriod()],
      
      // Proactive suggestions
      suggestions: [],
      dismissedSuggestionIds: [],
      lastSuggestionTime: null,
      
      // Insights (from Mirror)
      recentInsights: [],
      unacknowledgedInsights: 0,
      
      // Ledger stats
      ledgerStats: null,
      sessionId: null,
      
      // UI state
      showSoulDashboard: false,
      showForgeConsole: false,
      forgeConsoleTab: 'replay', // 'replay' | 'runs' | 'forks' | 'mindprint' | 'insights'
      
      // Settings
      enabled: true,
      receiptsRequired: false,
      adaptToState: true,
      adaptToCircadian: true,
      
      // Actions
      setState: (state, confidence, signals) => set({
        currentState: state,
        stateConfidence: confidence,
        stateSignals: signals || [],
      }),
      
      updateCircadian: () => {
        const period = getCircadianPeriod();
        set({
          circadianPeriod: period,
          circadianInfo: CIRCADIAN_PERIODS[period],
        });
      },
      
      addSuggestion: (suggestion) => {
        const { suggestions, dismissedSuggestionIds } = get();
        
        // Don't add if recently dismissed
        if (dismissedSuggestionIds.includes(suggestion.id)) {
          return;
        }
        
        // Rate limit: max 1 suggestion per 5 minutes
        const now = Date.now();
        const lastTime = get().lastSuggestionTime;
        if (lastTime && now - lastTime < 5 * 60 * 1000) {
          return;
        }
        
        set({
          suggestions: [...suggestions.slice(-4), suggestion], // Keep max 5
          lastSuggestionTime: now,
        });
      },
      
      dismissSuggestion: (id) => {
        const { suggestions, dismissedSuggestionIds } = get();
        set({
          suggestions: suggestions.filter(s => s.id !== id),
          dismissedSuggestionIds: [...dismissedSuggestionIds.slice(-50), id], // Keep last 50
        });
      },
      
      clearSuggestions: () => set({ suggestions: [] }),
      
      addInsight: (insight) => {
        const { recentInsights } = get();
        set({
          recentInsights: [insight, ...recentInsights.slice(0, 9)], // Keep 10
          unacknowledgedInsights: get().unacknowledgedInsights + 1,
        });
      },
      
      acknowledgeInsights: () => set({ unacknowledgedInsights: 0 }),
      
      setLedgerStats: (stats) => set({ ledgerStats: stats }),
      setSessionId: (id) => set({ sessionId: id }),
      
      toggleSoulDashboard: () => set(s => ({ showSoulDashboard: !s.showSoulDashboard })),
      toggleForgeConsole: () => set(s => ({ showForgeConsole: !s.showForgeConsole })),
      setForgeConsoleTab: (tab) => set({ forgeConsoleTab: tab }),
      
      setEnabled: (enabled) => set({ enabled }),
      setReceiptsRequired: (required) => set({ receiptsRequired: required }),
      setAdaptToState: (adapt) => set({ adaptToState: adapt }),
      setAdaptToCircadian: (adapt) => set({ adaptToCircadian: adapt }),
      
      // Get state adaptation for prompts
      getStateAdaptation: () => {
        const { currentState, stateConfidence, adaptToState, circadianPeriod, circadianInfo, adaptToCircadian } = get();
        
        if (!adaptToState && !adaptToCircadian) {
          return null;
        }
        
        const adaptations = [];
        
        if (adaptToState && currentState && stateConfidence > 0.5) {
          const stateInstructions = {
            focused: 'Be concise and actionable. User is in deep focus.',
            stressed: 'Be brief and solution-oriented. User seems pressed for time.',
            creative: 'Feel free to explore tangents and offer creative alternatives.',
            exploratory: 'Provide detailed explanations and multiple perspectives.',
            tired: 'Keep responses short. Check if user wants to continue.',
            flow: 'Match their energy. They\'re in the zone.',
          };
          
          adaptations.push({
            type: 'state',
            state: currentState,
            confidence: stateConfidence,
            instruction: stateInstructions[currentState] || '',
          });
        }
        
        if (adaptToCircadian && circadianInfo) {
          adaptations.push({
            type: 'circadian',
            period: circadianPeriod,
            label: circadianInfo.label,
            tone: circadianInfo.tone,
          });
        }
        
        if (adaptations.length === 0) {
          return null;
        }
        
        return {
          primary: currentState || circadianPeriod,
          confidence: stateConfidence || 0.7,
          adaptations,
          instruction: adaptations.map(a => a.instruction || `Tone: ${a.tone}`).filter(Boolean).join(' '),
        };
      },
      
      // Initialize from backend
      initialize: async () => {
        if (!isElectron()) return;
        
        try {
          // Get session ID
          const sessionId = await safeCall('ledgerGetSessionId', [], null);
          if (sessionId) {
            set({ sessionId });
          }
          
          // Get ledger stats
          const stats = await safeCall('ledgerGetStats', [], null);
          if (stats) {
            set({ ledgerStats: stats });
          }
          
          // Update circadian
          get().updateCircadian();
          
          // Start circadian update interval
          setInterval(() => {
            get().updateCircadian();
          }, 60000); // Check every minute
          
        } catch (error) {
          console.error('[Soul] Failed to initialize:', error);
        }
      },
      
      // Record events to ledger
      recordMessage: async (params) => {
        if (!isElectron() || !get().enabled) return;
        await safeCall('ledger:recordMessage', [params], null);
      },
      
      recordWorkspaceSwitch: async (from, to) => {
        if (!isElectron() || !get().enabled) return;
        await safeCall('ledger:recordWorkspaceSwitch', [{ from, to }], null);
      },
      
      recordModelSwitch: async (from, to, workspace) => {
        if (!isElectron() || !get().enabled) return;
        await safeCall('ledger:recordModelSwitch', [{ from, to, workspace }], null);
      },
      
      recordUserAction: async (action, params) => {
        if (!isElectron() || !get().enabled) return;
        await safeCall('ledger:recordUserAction', [{ action, ...params }], null);
      },
    }),
    {
      name: 'devforge-soul',
      partialize: (state) => ({
        enabled: state.enabled,
        receiptsRequired: state.receiptsRequired,
        adaptToState: state.adaptToState,
        adaptToCircadian: state.adaptToCircadian,
        dismissedSuggestionIds: state.dismissedSuggestionIds,
      }),
    }
  )
);

// Export circadian utilities
export { CIRCADIAN_PERIODS, getCircadianPeriod };




