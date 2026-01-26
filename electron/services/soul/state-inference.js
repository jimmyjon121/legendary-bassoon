/**
 * State Inference Engine
 * 
 * Analyzes behavioral signals from the ledger to infer user cognitive state.
 * States: focused | stressed | creative | exploratory | tired | flow
 */

const ledgerService = require('../ledger/ledger-service');

// State definitions with signal weights
const STATES = {
  focused: {
    label: 'Focused',
    description: 'Deep concentration, goal-oriented',
    signals: {
      high_wpm: 0.3,
      low_pauses: 0.2,
      low_workspace_switches: 0.2,
      consistent_model: 0.1,
      long_sessions: 0.2,
    },
  },
  stressed: {
    label: 'Stressed',
    description: 'Under pressure, time-constrained',
    signals: {
      high_backspace_ratio: 0.3,
      frequent_regenerations: 0.3,
      short_messages: 0.2,
      rapid_workspace_switches: 0.2,
    },
  },
  creative: {
    label: 'Creative',
    description: 'Exploratory, open to ideas',
    signals: {
      moderate_wpm: 0.2,
      long_messages: 0.2,
      varied_topics: 0.2,
      evening_time: 0.2,
      few_edits_to_responses: 0.2,
    },
  },
  exploratory: {
    label: 'Exploratory',
    description: 'Learning, asking questions',
    signals: {
      many_pauses: 0.3,
      question_heavy_messages: 0.3,
      frequent_searches: 0.2,
      low_action_completion: 0.2,
    },
  },
  tired: {
    label: 'Tired',
    description: 'Low energy, reduced focus',
    signals: {
      low_wpm: 0.3,
      high_backspace_ratio: 0.2,
      late_night_time: 0.3,
      long_idle_gaps: 0.2,
    },
  },
  flow: {
    label: 'In Flow',
    description: 'Peak performance, effortless productivity',
    signals: {
      high_wpm: 0.2,
      low_backspace_ratio: 0.2,
      long_uninterrupted_session: 0.3,
      high_completion_rate: 0.2,
      smooth_typing: 0.1,
    },
  },
};

// Time-based modifiers
function getTimeModifiers() {
  const hour = new Date().getHours();
  
  return {
    morning: hour >= 6 && hour < 9,
    workday: hour >= 9 && hour < 17,
    evening: hour >= 17 && hour < 22,
    night_owl: hour >= 22 || hour < 2,
    late_night: hour >= 2 && hour < 6,
  };
}

/**
 * Analyze recent typing bursts
 */
async function analyzeTypingPatterns(limit = 20) {
  const bursts = ledgerService.listEvents({
    types: ['typing_burst'],
    limit,
    order: 'desc',
  });
  
  if (bursts.length === 0) {
    return {
      avgWpm: null,
      avgBackspaceRatio: null,
      avgPauseRatio: null,
    };
  }
  
  const totals = bursts.reduce((acc, event) => {
    const payload = event.payload || {};
    acc.wpm += payload.wpm || 0;
    acc.backspaces += payload.backspaces || 0;
    acc.chars += payload.characterCount || 0;
    acc.pauses += payload.pauseCount || 0;
    return acc;
  }, { wpm: 0, backspaces: 0, chars: 0, pauses: 0 });
  
  return {
    avgWpm: totals.wpm / bursts.length,
    avgBackspaceRatio: totals.chars > 0 ? totals.backspaces / totals.chars : 0,
    avgPauseRatio: totals.pauses / bursts.length,
    sampleSize: bursts.length,
  };
}

/**
 * Analyze recent user actions (friction signals)
 */
async function analyzeUserActions(limit = 50) {
  const actions = ledgerService.listEvents({
    types: ['user_action_regenerate', 'user_action_edit', 'user_action_abandon', 'user_action_accept'],
    limit,
    order: 'desc',
  });
  
  const counts = {
    regenerate: 0,
    edit: 0,
    abandon: 0,
    accept: 0,
  };
  
  actions.forEach(event => {
    const action = event.type.replace('user_action_', '');
    if (counts[action] !== undefined) {
      counts[action]++;
    }
  });
  
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  
  return {
    regenerationRate: total > 0 ? counts.regenerate / total : 0,
    editRate: total > 0 ? counts.edit / total : 0,
    abandonRate: total > 0 ? counts.abandon / total : 0,
    acceptRate: total > 0 ? counts.accept / total : 0,
    sampleSize: total,
  };
}

/**
 * Analyze session patterns
 */
async function analyzeSessionPatterns() {
  const events = ledgerService.getSessionEvents(100);
  
  if (events.length === 0) {
    return {
      sessionDuration: 0,
      workspaceSwitches: 0,
      modelSwitches: 0,
      messageCount: 0,
    };
  }
  
  const firstEvent = events[events.length - 1];
  const lastEvent = events[0];
  const sessionDuration = new Date(lastEvent.ts) - new Date(firstEvent.ts);
  
  const workspaceSwitches = events.filter(e => e.type === 'workspace_switch').length;
  const modelSwitches = events.filter(e => e.type === 'model_switch').length;
  const messageCount = events.filter(e => e.type === 'message_sent').length;
  
  return {
    sessionDuration,
    workspaceSwitches,
    modelSwitches,
    messageCount,
    eventsPerMinute: sessionDuration > 0 
      ? events.length / (sessionDuration / 60000) 
      : 0,
  };
}

/**
 * Main state inference function
 */
async function inferState() {
  try {
    // Gather all signals
    const [typing, actions, session] = await Promise.all([
      analyzeTypingPatterns(),
      analyzeUserActions(),
      analyzeSessionPatterns(),
    ]);
    
    const timeModifiers = getTimeModifiers();
    
    // Score each state
    const scores = {};
    
    for (const [stateId, stateDef] of Object.entries(STATES)) {
      let score = 0;
      let totalWeight = 0;
      const matchedSignals = [];
      
      for (const [signal, weight] of Object.entries(stateDef.signals)) {
        totalWeight += weight;
        let signalMatch = 0;
        
        switch (signal) {
          // Typing signals
          case 'high_wpm':
            if (typing.avgWpm && typing.avgWpm > 50) signalMatch = Math.min(1, (typing.avgWpm - 50) / 30);
            break;
          case 'moderate_wpm':
            if (typing.avgWpm && typing.avgWpm >= 30 && typing.avgWpm <= 50) signalMatch = 1;
            break;
          case 'low_wpm':
            if (typing.avgWpm && typing.avgWpm < 25) signalMatch = Math.min(1, (25 - typing.avgWpm) / 15);
            break;
          case 'low_pauses':
            if (typing.avgPauseRatio !== null && typing.avgPauseRatio < 0.2) signalMatch = 1 - typing.avgPauseRatio * 5;
            break;
          case 'many_pauses':
            if (typing.avgPauseRatio !== null && typing.avgPauseRatio > 0.3) signalMatch = Math.min(1, (typing.avgPauseRatio - 0.3) * 3);
            break;
          case 'high_backspace_ratio':
            if (typing.avgBackspaceRatio > 0.25) signalMatch = Math.min(1, (typing.avgBackspaceRatio - 0.25) * 4);
            break;
          case 'low_backspace_ratio':
            if (typing.avgBackspaceRatio !== null && typing.avgBackspaceRatio < 0.15) signalMatch = 1 - typing.avgBackspaceRatio * 6;
            break;
          case 'smooth_typing':
            if (typing.avgBackspaceRatio !== null && typing.avgBackspaceRatio < 0.1 && typing.avgPauseRatio < 0.15) signalMatch = 1;
            break;
            
          // Action signals
          case 'frequent_regenerations':
            if (actions.regenerationRate > 0.3) signalMatch = Math.min(1, (actions.regenerationRate - 0.3) * 3);
            break;
          case 'few_edits_to_responses':
            if (actions.editRate < 0.1) signalMatch = 1 - actions.editRate * 10;
            break;
          case 'high_completion_rate':
            if (actions.acceptRate > 0.7) signalMatch = Math.min(1, (actions.acceptRate - 0.7) * 3);
            break;
            
          // Session signals
          case 'low_workspace_switches':
            if (session.workspaceSwitches < 3) signalMatch = 1 - session.workspaceSwitches / 3;
            break;
          case 'rapid_workspace_switches':
            if (session.workspaceSwitches > 5) signalMatch = Math.min(1, (session.workspaceSwitches - 5) / 5);
            break;
          case 'long_sessions':
            if (session.sessionDuration > 30 * 60000) signalMatch = Math.min(1, session.sessionDuration / (60 * 60000));
            break;
          case 'long_uninterrupted_session':
            if (session.sessionDuration > 45 * 60000 && session.workspaceSwitches < 2) signalMatch = 1;
            break;
          case 'long_idle_gaps':
            if (session.eventsPerMinute < 1 && session.sessionDuration > 10 * 60000) signalMatch = 1;
            break;
            
          // Time signals
          case 'evening_time':
            if (timeModifiers.evening) signalMatch = 1;
            break;
          case 'late_night_time':
            if (timeModifiers.late_night) signalMatch = 1;
            break;
            
          default:
            // Unknown signal, skip
            break;
        }
        
        if (signalMatch > 0) {
          matchedSignals.push({ signal, match: signalMatch, weight });
        }
        
        score += signalMatch * weight;
      }
      
      scores[stateId] = {
        score: totalWeight > 0 ? score / totalWeight : 0,
        matchedSignals,
      };
    }
    
    // Find best state
    let bestState = null;
    let bestScore = 0;
    
    for (const [stateId, data] of Object.entries(scores)) {
      if (data.score > bestScore) {
        bestScore = data.score;
        bestState = stateId;
      }
    }
    
    // Require minimum confidence
    if (bestScore < 0.3) {
      return {
        state: null,
        confidence: 0,
        scores,
        raw: { typing, actions, session, timeModifiers },
      };
    }
    
    return {
      state: bestState,
      confidence: bestScore,
      label: STATES[bestState]?.label || bestState,
      description: STATES[bestState]?.description || '',
      signals: scores[bestState]?.matchedSignals || [],
      scores,
      raw: { typing, actions, session, timeModifiers },
    };
    
  } catch (error) {
    console.error('[StateInference] Failed:', error);
    return {
      state: null,
      confidence: 0,
      error: error.message,
    };
  }
}

/**
 * Get state-aware prompt adjustments
 */
function getPromptAdjustments(state, confidence) {
  if (!state || confidence < 0.4) {
    return null;
  }
  
  const adjustments = {
    focused: {
      tone: 'concise and actionable',
      instruction: 'Be direct. User is in deep focus mode.',
      temperature: -0.1, // Slightly lower for more precise answers
    },
    stressed: {
      tone: 'brief and solution-oriented',
      instruction: 'Be very brief. User seems pressed for time. Get to the point immediately.',
      temperature: 0,
    },
    creative: {
      tone: 'exploratory and inspiring',
      instruction: 'Feel free to offer creative alternatives and explore tangents.',
      temperature: 0.1, // Slightly higher for more creative responses
    },
    exploratory: {
      tone: 'educational and thorough',
      instruction: 'Provide detailed explanations. User is learning and exploring.',
      temperature: 0,
    },
    tired: {
      tone: 'gentle and minimal',
      instruction: 'Keep responses very short. Check if user wants to continue.',
      temperature: -0.05,
    },
    flow: {
      tone: 'matched energy',
      instruction: 'User is in flow state. Match their pace and energy.',
      temperature: 0,
    },
  };
  
  return adjustments[state] || null;
}

module.exports = {
  STATES,
  inferState,
  analyzeTypingPatterns,
  analyzeUserActions,
  analyzeSessionPatterns,
  getPromptAdjustments,
};




