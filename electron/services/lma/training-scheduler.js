/**
 * LMA Training Scheduler
 * 
 * Schedules and manages overnight adapter training.
 * Monitors system idle state and GPU availability.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const llamaBridge = require('../llama/llama-bridge');
const datasetBuilder = require('./dataset-builder');

// Scheduler state
let schedulerState = {
  enabled: false,
  lastTraining: null,
  nextScheduled: null,
  currentTraining: null,
  queue: [],
  history: [],
};

// Configuration
const CONFIG = {
  // Training window (default: 2am - 6am)
  trainingWindowStart: 2,  // Hour (24h format)
  trainingWindowEnd: 6,
  
  // Minimum idle time before starting (minutes)
  minIdleMinutes: 30,
  
  // Minimum friction signals before training
  minFrictionSignals: 50,
  
  // Maximum training duration (hours)
  maxTrainingHours: 4,
  
  // Check interval (minutes)
  checkIntervalMinutes: 15,
  
  // Auto-train workspaces with enough data
  autoTrainWorkspaces: true,
  
  // Path for scheduler state persistence
  stateFile: null, // Set during initialization
};

let checkInterval = null;
let trainingTimeout = null;

/**
 * Initialize the training scheduler
 */
async function initialize(userDataPath) {
  CONFIG.stateFile = path.join(userDataPath, 'training-scheduler-state.json');
  
  // Load persisted state
  try {
    const stateContent = await fs.readFile(CONFIG.stateFile, 'utf-8');
    const savedState = JSON.parse(stateContent);
    schedulerState = { ...schedulerState, ...savedState };
  } catch {
    // No saved state, use defaults
  }
  
  console.log('[TrainingScheduler] Initialized');
  
  return {
    enabled: schedulerState.enabled,
    lastTraining: schedulerState.lastTraining,
    config: CONFIG,
  };
}

/**
 * Enable the scheduler
 */
function enable() {
  schedulerState.enabled = true;
  
  // Start checking
  if (!checkInterval) {
    checkInterval = setInterval(checkAndTrain, CONFIG.checkIntervalMinutes * 60 * 1000);
    console.log('[TrainingScheduler] Enabled - checking every', CONFIG.checkIntervalMinutes, 'minutes');
  }
  
  saveState();
  return { enabled: true };
}

/**
 * Disable the scheduler
 */
function disable() {
  schedulerState.enabled = false;
  
  // Stop checking
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  // Cancel any scheduled training
  if (trainingTimeout) {
    clearTimeout(trainingTimeout);
    trainingTimeout = null;
  }
  
  saveState();
  return { enabled: false };
}

/**
 * Check if we should train and do it
 */
async function checkAndTrain() {
  if (!schedulerState.enabled) return;
  if (schedulerState.currentTraining) return; // Already training
  
  // Check if we're in the training window
  const hour = new Date().getHours();
  const inWindow = hour >= CONFIG.trainingWindowStart && hour < CONFIG.trainingWindowEnd;
  
  if (!inWindow) {
    console.log('[TrainingScheduler] Outside training window');
    return;
  }
  
  // Check system idle time
  const idleMinutes = await getSystemIdleMinutes();
  if (idleMinutes < CONFIG.minIdleMinutes) {
    console.log('[TrainingScheduler] System not idle enough:', idleMinutes, 'minutes');
    return;
  }
  
  // Check if llama.cpp is available
  if (!llamaBridge.isAvailable()) {
    console.log('[TrainingScheduler] llama.cpp not available');
    return;
  }
  
  // Check if we have enough friction data
  const frictionSignals = require('../ledger/ledger-service').getFrictionSignals({ limit: CONFIG.minFrictionSignals + 1 });
  if (frictionSignals.length < CONFIG.minFrictionSignals) {
    console.log('[TrainingScheduler] Not enough friction signals:', frictionSignals.length);
    return;
  }
  
  // All conditions met - start training
  console.log('[TrainingScheduler] Starting overnight training');
  await runTraining();
}

/**
 * Get system idle time in minutes
 */
async function getSystemIdleMinutes() {
  try {
    // Try to use systeminformation if available
    const si = require('systeminformation');
    const time = await si.time();
    return Math.floor(time.uptime / 60); // Rough approximation
  } catch {
    // Fallback: assume idle if in training window
    return CONFIG.minIdleMinutes + 1;
  }
}

/**
 * Run training for all eligible workspaces/tasks
 */
async function runTraining() {
  const startTime = Date.now();
  const maxDuration = CONFIG.maxTrainingHours * 60 * 60 * 1000;
  
  schedulerState.currentTraining = {
    startedAt: new Date().toISOString(),
    status: 'running',
    adaptersCreated: [],
    errors: [],
  };
  
  saveState();
  
  try {
    // Build datasets for each workspace
    const datasets = await datasetBuilder.buildWorkspaceDatasets();
    
    for (const [workspace, dataset] of Object.entries(datasets)) {
      // Check if we've exceeded max duration
      if (Date.now() - startTime > maxDuration) {
        console.log('[TrainingScheduler] Max duration reached, stopping');
        break;
      }
      
      // Skip if not enough samples
      if (dataset.samples.length < 20) {
        console.log(`[TrainingScheduler] Skipping ${workspace}: only ${dataset.samples.length} samples`);
        continue;
      }
      
      console.log(`[TrainingScheduler] Training adapter for ${workspace} with ${dataset.samples.length} samples`);
      
      // Find a base model to use
      const models = await llamaBridge.listModels();
      if (models.length === 0) {
        console.log('[TrainingScheduler] No base models available');
        schedulerState.currentTraining.errors.push('No base models available');
        continue;
      }
      
      const baseModel = models[0].name; // Use first available
      const adapterName = `${workspace}_mindprint_${Date.now()}`;
      
      // Format dataset
      const formattedData = datasetBuilder.formatForLlama(dataset, { format: 'alpaca' });
      const trainingData = formattedData.map(f => ({
        prompt: typeof f.text === 'object' ? f.text.instruction : f.text,
        completion: typeof f.text === 'object' ? f.text.output : '',
        weight: f.weight,
      }));
      
      // Train adapter
      const result = await llamaBridge.trainAdapter({
        baseModel,
        adapterName,
        trainingData,
        config: {
          epochs: 1,
          rank: 16, // Lower rank for quick training
        },
      });
      
      if (result.success) {
        schedulerState.currentTraining.adaptersCreated.push({
          name: adapterName,
          workspace,
          samples: dataset.samples.length,
          path: result.adapterPath,
        });
        console.log(`[TrainingScheduler] Created adapter: ${adapterName}`);
      } else {
        schedulerState.currentTraining.errors.push({
          workspace,
          error: result.error,
        });
        console.error(`[TrainingScheduler] Failed to train ${workspace}:`, result.error);
      }
    }
    
    // Training complete
    schedulerState.currentTraining.status = 'completed';
    schedulerState.currentTraining.finishedAt = new Date().toISOString();
    schedulerState.currentTraining.duration = Date.now() - startTime;
    
    // Add to history
    schedulerState.history.unshift(schedulerState.currentTraining);
    if (schedulerState.history.length > 10) {
      schedulerState.history = schedulerState.history.slice(0, 10);
    }
    
    schedulerState.lastTraining = schedulerState.currentTraining;
    schedulerState.currentTraining = null;
    
    saveState();
    
    console.log('[TrainingScheduler] Training complete');
    
  } catch (error) {
    console.error('[TrainingScheduler] Training failed:', error);
    
    if (schedulerState.currentTraining) {
      schedulerState.currentTraining.status = 'failed';
      schedulerState.currentTraining.error = error.message;
      schedulerState.currentTraining.finishedAt = new Date().toISOString();
      
      schedulerState.history.unshift(schedulerState.currentTraining);
      schedulerState.currentTraining = null;
    }
    
    saveState();
  }
}

/**
 * Manually trigger training
 */
async function triggerTraining(options = {}) {
  if (schedulerState.currentTraining) {
    return { error: 'Training already in progress' };
  }
  
  if (!llamaBridge.isAvailable()) {
    return { error: 'llama.cpp not available' };
  }
  
  // Run training in background
  runTraining().catch(console.error);
  
  return {
    success: true,
    message: 'Training started',
  };
}

/**
 * Cancel current training
 */
function cancelTraining() {
  if (!schedulerState.currentTraining) {
    return { error: 'No training in progress' };
  }
  
  llamaBridge.stopInference();
  
  schedulerState.currentTraining.status = 'cancelled';
  schedulerState.currentTraining.finishedAt = new Date().toISOString();
  
  schedulerState.history.unshift(schedulerState.currentTraining);
  schedulerState.currentTraining = null;
  
  saveState();
  
  return { success: true };
}

/**
 * Queue a training job
 */
function queueTraining(job) {
  schedulerState.queue.push({
    ...job,
    queuedAt: new Date().toISOString(),
  });
  
  saveState();
  
  return { success: true, position: schedulerState.queue.length };
}

/**
 * Get scheduler status
 */
function getStatus() {
  return {
    enabled: schedulerState.enabled,
    currentTraining: schedulerState.currentTraining,
    lastTraining: schedulerState.lastTraining,
    queueLength: schedulerState.queue.length,
    config: {
      trainingWindow: `${CONFIG.trainingWindowStart}:00 - ${CONFIG.trainingWindowEnd}:00`,
      minIdleMinutes: CONFIG.minIdleMinutes,
      minFrictionSignals: CONFIG.minFrictionSignals,
    },
  };
}

/**
 * Get training history
 */
function getHistory() {
  return schedulerState.history;
}

/**
 * Update configuration
 */
function updateConfig(updates) {
  if (updates.trainingWindowStart !== undefined) {
    CONFIG.trainingWindowStart = updates.trainingWindowStart;
  }
  if (updates.trainingWindowEnd !== undefined) {
    CONFIG.trainingWindowEnd = updates.trainingWindowEnd;
  }
  if (updates.minIdleMinutes !== undefined) {
    CONFIG.minIdleMinutes = updates.minIdleMinutes;
  }
  if (updates.minFrictionSignals !== undefined) {
    CONFIG.minFrictionSignals = updates.minFrictionSignals;
  }
  
  saveState();
  
  return { success: true, config: CONFIG };
}

/**
 * Save state to disk
 */
async function saveState() {
  if (!CONFIG.stateFile) return;
  
  try {
    const stateToSave = {
      enabled: schedulerState.enabled,
      lastTraining: schedulerState.lastTraining,
      history: schedulerState.history,
      queue: schedulerState.queue,
    };
    
    await fs.writeFile(CONFIG.stateFile, JSON.stringify(stateToSave, null, 2), 'utf-8');
  } catch (error) {
    console.error('[TrainingScheduler] Failed to save state:', error);
  }
}

module.exports = {
  initialize,
  enable,
  disable,
  triggerTraining,
  cancelTraining,
  queueTraining,
  getStatus,
  getHistory,
  updateConfig,
  CONFIG,
};




