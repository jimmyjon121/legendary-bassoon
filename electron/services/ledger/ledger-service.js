/**
 * Ledger Service
 * 
 * High-level service for interacting with the Unified Ledger.
 * Provides event recording, session management, and query APIs.
 */

const ledgerDb = require('./ledger-db');
const crypto = require('crypto');

let currentSessionId = null;
let initialized = false;

/**
 * Initialize the ledger service
 */
async function initLedgerService(userDataPath) {
  await ledgerDb.initLedgerDb(userDataPath);
  currentSessionId = crypto.randomUUID();
  ledgerDb.getOrCreateSession(currentSessionId);
  initialized = true;
  
  console.log('[LedgerService] Initialized with session:', currentSessionId);
  
  // Record session start event
  recordEvent({
    type: 'session_start',
    payload: {
      startedAt: new Date().toISOString()
    }
  });
  
  return { sessionId: currentSessionId };
}

/**
 * Get current session ID
 */
function getSessionId() {
  return currentSessionId;
}

/**
 * Record an event (convenience wrapper)
 */
function recordEvent(event) {
  if (!initialized) {
    console.warn('[LedgerService] Not initialized, skipping event:', event.type);
    return null;
  }
  
  return ledgerDb.recordEvent({
    ...event,
    sessionId: event.sessionId || currentSessionId
  });
}

// ============================================
// SPECIFIC EVENT RECORDERS
// ============================================

/**
 * Record a message event (sent or received)
 */
function recordMessage(params) {
  const { role, workspace, model, length, hasAttachments, conversationId, messageId } = params;
  
  return recordEvent({
    type: role === 'user' ? 'message_sent' : 'message_received',
    workspace,
    payload: {
      role,
      model,
      length,
      hasAttachments,
      conversationId,
      messageId,
      ts: new Date().toISOString()
    }
  });
}

/**
 * Record workspace switch
 */
function recordWorkspaceSwitch(params) {
  const { from, to } = params;
  
  return recordEvent({
    type: 'workspace_switch',
    workspace: to,
    payload: {
      from,
      to,
      ts: new Date().toISOString()
    }
  });
}

/**
 * Record model switch
 */
function recordModelSwitch(params) {
  const { from, to, workspace } = params;
  
  return recordEvent({
    type: 'model_switch',
    workspace,
    payload: {
      from,
      to,
      ts: new Date().toISOString()
    }
  });
}

/**
 * Record generation start
 */
function recordGenerationStart(params) {
  const { model, workspace, promptLength, conversationId } = params;
  
  return recordEvent({
    type: 'generation_start',
    workspace,
    payload: {
      model,
      promptLength,
      conversationId,
      startedAt: new Date().toISOString()
    }
  });
}

/**
 * Record generation complete
 */
function recordGenerationComplete(params) {
  const { model, workspace, responseLength, durationMs, tokensEstimated, conversationId } = params;
  
  return recordEvent({
    type: 'generation_complete',
    workspace,
    payload: {
      model,
      responseLength,
      durationMs,
      tokensEstimated,
      conversationId,
      completedAt: new Date().toISOString()
    }
  });
}

/**
 * Record file open (Code workspace)
 */
function recordFileOpen(params) {
  const { path, workspace } = params;
  
  return recordEvent({
    type: 'file_open',
    workspace,
    payload: {
      path,
      ts: new Date().toISOString()
    }
  });
}

/**
 * Record typing burst (aggregated typing pattern)
 */
function recordTypingBurst(params) {
  const { workspace, wpm, backspaces, pauseCount, duration, characterCount } = params;
  
  return recordEvent({
    type: 'typing_burst',
    workspace,
    payload: {
      wpm,
      backspaces,
      pauseCount,
      duration,
      characterCount,
      ts: new Date().toISOString()
    }
  });
}

/**
 * Record accept/reject action (for friction signals)
 */
function recordUserAction(params) {
  const { action, workspace, relatedEventId, messageId, metadata } = params;
  
  const eventResult = recordEvent({
    type: `user_action_${action}`,
    workspace,
    payload: {
      action,
      relatedEventId,
      messageId,
      metadata,
      ts: new Date().toISOString()
    }
  });
  
  // Auto-generate friction signals for certain actions
  if (['regenerate', 'edit', 'abandon', 'revert'].includes(action)) {
    const severityMap = {
      regenerate: 0.6,
      edit: 0.4,
      abandon: 0.8,
      revert: 0.7
    };
    
    ledgerDb.recordFriction({
      relatedEventId: eventResult?.id,
      kind: action,
      severity: severityMap[action] || 0.5,
      payload: { messageId, metadata }
    });
  }
  
  return eventResult;
}

// ============================================
// EVIDENCE MANAGEMENT
// ============================================

/**
 * Add evidence to an event (receipts)
 */
function addEvidence(params) {
  return ledgerDb.addEvidence(params);
}

/**
 * Get evidence for an event
 */
function getEvidence(eventId) {
  return ledgerDb.getEvidence(eventId);
}

/**
 * Create a doc_chunk evidence (from RAG)
 */
function createDocChunkEvidence(params) {
  const { eventId, documentId, chunkIndex, filename, content, score } = params;
  
  return ledgerDb.addEvidence({
    eventId,
    kind: 'doc_chunk',
    ref: {
      documentId,
      chunkIndex,
      filename,
      score
    },
    contentHash: ledgerDb.sha256(content || '')
  });
}

/**
 * Create a file_lines evidence
 */
function createFileLinesEvidence(params) {
  const { eventId, filePath, startLine, endLine, content } = params;
  
  return ledgerDb.addEvidence({
    eventId,
    kind: 'file_lines',
    ref: {
      filePath,
      startLine,
      endLine
    },
    contentHash: ledgerDb.sha256(content || '')
  });
}

/**
 * Create a tool_output evidence
 */
function createToolOutputEvidence(params) {
  const { eventId, toolName, command, stdout, stderr, exitCode } = params;
  
  return ledgerDb.addEvidence({
    eventId,
    kind: 'tool_output',
    ref: {
      toolName,
      command,
      exitCode
    },
    contentHash: ledgerDb.sha256((stdout || '') + (stderr || ''))
  });
}

// ============================================
// ACTION RUNS (Intent → Actions)
// ============================================

/**
 * Create a new action run
 */
function createRun(params) {
  return ledgerDb.createRun(params);
}

/**
 * Update an action run
 */
function updateRun(runId, updates) {
  return ledgerDb.updateRun(runId, updates);
}

/**
 * Add a step to an action run
 */
function addRunStep(step) {
  return ledgerDb.addRunStep(step);
}

/**
 * Get all steps for a run
 */
function getRunSteps(runId) {
  return ledgerDb.getRunSteps(runId);
}

// ============================================
// DECISION FORKS (Counterfactuals)
// ============================================

/**
 * Create a decision fork
 */
function createDecisionFork(fork) {
  return ledgerDb.createDecisionFork(fork);
}

// ============================================
// QUERIES
// ============================================

/**
 * List events with filters
 */
function listEvents(filters = {}) {
  return ledgerDb.listEvents(filters);
}

/**
 * Get recent events for current session
 */
function getSessionEvents(limit = 100) {
  return ledgerDb.listEvents({
    sessionId: currentSessionId,
    limit,
    order: 'desc'
  });
}

/**
 * Get events by type
 */
function getEventsByType(types, limit = 50) {
  return ledgerDb.listEvents({
    types: Array.isArray(types) ? types : [types],
    limit,
    order: 'desc'
  });
}

/**
 * Get friction signals (for LMA training)
 */
function getFrictionSignals(filters = {}) {
  return ledgerDb.getFrictionSignals(filters);
}

/**
 * Get ledger statistics
 */
function getStats() {
  return ledgerDb.getStats();
}

/**
 * Verify chain integrity
 */
function verifyChain(limit = 1000) {
  return ledgerDb.verifyChain(limit);
}

/**
 * Save database (for manual flush)
 */
function save() {
  ledgerDb.saveLedgerDb();
}

/**
 * Clear events
 */
function clearEvents() {
  ledgerDb.clearEvents();
}

/**
 * Clear friction signals
 */
function clearFrictionSignals() {
  ledgerDb.clearFrictionSignals();
}

/**
 * Clear all data
 */
function clearAll() {
  ledgerDb.clearAll();
}

// ============================================
// SESSION TIMELINE (For Replay)
// ============================================

/**
 * Get session timeline with all events
 */
function getSessionTimeline(sessionId, options = {}) {
  const events = ledgerDb.listEvents({
    sessionId: sessionId || currentSessionId,
    order: 'asc',
    limit: options.limit || 1000
  });
  
  // Group by time buckets for visualization
  const timeline = [];
  let currentBucket = null;
  const bucketDuration = options.bucketMs || 60000; // 1 minute buckets
  
  for (const event of events) {
    const eventTime = new Date(event.ts).getTime();
    const bucketStart = Math.floor(eventTime / bucketDuration) * bucketDuration;
    
    if (!currentBucket || currentBucket.start !== bucketStart) {
      currentBucket = {
        start: bucketStart,
        end: bucketStart + bucketDuration,
        events: []
      };
      timeline.push(currentBucket);
    }
    
    currentBucket.events.push(event);
  }
  
  return {
    sessionId: sessionId || currentSessionId,
    eventCount: events.length,
    timeline
  };
}

module.exports = {
  initLedgerService,
  getSessionId,
  recordEvent,
  recordMessage,
  recordWorkspaceSwitch,
  recordModelSwitch,
  recordGenerationStart,
  recordGenerationComplete,
  recordFileOpen,
  recordTypingBurst,
  recordUserAction,
  addEvidence,
  getEvidence,
  createDocChunkEvidence,
  createFileLinesEvidence,
  createToolOutputEvidence,
  createRun,
  updateRun,
  addRunStep,
  getRunSteps,
  createDecisionFork,
  listEvents,
  getSessionEvents,
  getEventsByType,
  getFrictionSignals,
  getStats,
  verifyChain,
  save,
  getSessionTimeline,
  clearEvents,
  clearFrictionSignals,
  clearAll
};

