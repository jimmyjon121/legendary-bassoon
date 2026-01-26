/**
 * LMA Dataset Builder
 * 
 * Converts friction signals from the ledger into training datasets
 * for QLoRA adapter fine-tuning.
 */

const ledgerService = require('../ledger/ledger-service');

// Friction signal weights for training prioritization
const FRICTION_WEIGHTS = {
  regenerate: 1.0,    // User regenerated = high friction, important signal
  edit: 0.7,          // User edited = medium friction, content issue
  abandon: 0.5,       // User abandoned = context may be wrong
  revert: 0.9,        // User reverted = strong negative signal
  slow_response: 0.3, // Implicit: long pause before accepting
};

// Minimum friction score to include in dataset
const MIN_FRICTION_SCORE = 0.4;

/**
 * Build a training dataset from friction signals
 */
async function buildDataset(options = {}) {
  const {
    workspace = null,
    minSeverity = MIN_FRICTION_SCORE,
    maxSamples = 1000,
    includePositive = true, // Include accepted responses as positive examples
    since = null,           // Only signals after this date
  } = options;
  
  // Get friction signals from ledger
  const signals = ledgerService.getFrictionSignals({
    minSeverity,
    since,
    limit: maxSamples * 2, // Get extra to filter
  });
  
  const dataset = [];
  const seenPrompts = new Set();
  
  for (const signal of signals) {
    // Skip if we've seen this prompt (avoid duplicates)
    const promptHash = hashPrompt(signal.payload?.prompt);
    if (seenPrompts.has(promptHash)) continue;
    seenPrompts.add(promptHash);
    
    // Skip if wrong workspace
    if (workspace && signal.workspace !== workspace) continue;
    
    // Build training example based on friction type
    const example = buildTrainingExample(signal);
    if (example) {
      dataset.push(example);
    }
    
    if (dataset.length >= maxSamples) break;
  }
  
  // Optionally add positive examples (accepted without friction)
  if (includePositive) {
    const acceptedEvents = ledgerService.listEvents({
      types: ['user_action_accept'],
      limit: Math.floor(maxSamples * 0.3), // 30% positive examples
      order: 'desc',
    });
    
    for (const event of acceptedEvents) {
      const promptHash = hashPrompt(event.payload?.prompt);
      if (seenPrompts.has(promptHash)) continue;
      
      const positiveExample = {
        prompt: event.payload?.prompt || '',
        completion: event.payload?.response || '',
        weight: 0.5, // Lower weight for positive examples
        type: 'positive',
        workspace: event.workspace,
        timestamp: event.ts,
      };
      
      if (positiveExample.prompt && positiveExample.completion) {
        dataset.push(positiveExample);
        seenPrompts.add(promptHash);
      }
    }
  }
  
  return {
    samples: dataset,
    stats: {
      total: dataset.length,
      friction: dataset.filter(d => d.type !== 'positive').length,
      positive: dataset.filter(d => d.type === 'positive').length,
      avgWeight: dataset.reduce((sum, d) => sum + d.weight, 0) / dataset.length,
    },
  };
}

/**
 * Build a training example from a friction signal
 */
function buildTrainingExample(signal) {
  const payload = signal.payload || {};
  
  // We need the original prompt and either:
  // 1. The edited/corrected version (for edit signals)
  // 2. The regenerated better response (for regenerate signals)
  
  switch (signal.kind) {
    case 'edit':
      // User edited the response - use their edit as the target
      if (!payload.originalResponse || !payload.editedResponse) return null;
      return {
        prompt: payload.prompt || '',
        completion: payload.editedResponse,
        negativeCompletion: payload.originalResponse, // What not to generate
        weight: FRICTION_WEIGHTS.edit * signal.severity,
        type: 'edit',
        workspace: signal.workspace,
        timestamp: signal.ts,
      };
      
    case 'regenerate':
      // User regenerated - if they accepted later, use that as target
      if (!payload.prompt) return null;
      return {
        prompt: payload.prompt,
        completion: payload.acceptedResponse || '', // May be empty if still not accepted
        negativeCompletion: payload.rejectedResponse,
        weight: FRICTION_WEIGHTS.regenerate * signal.severity,
        type: 'regenerate',
        workspace: signal.workspace,
        timestamp: signal.ts,
      };
      
    case 'revert':
      // User reverted changes - strong signal something was wrong
      if (!payload.prompt || !payload.originalResponse) return null;
      return {
        prompt: payload.prompt,
        completion: payload.originalResponse, // They wanted the original
        negativeCompletion: payload.revertedResponse,
        weight: FRICTION_WEIGHTS.revert * signal.severity,
        type: 'revert',
        workspace: signal.workspace,
        timestamp: signal.ts,
      };
      
    case 'abandon':
      // User abandoned the response - weaker signal
      if (!payload.prompt) return null;
      return {
        prompt: payload.prompt,
        completion: '', // No good completion known
        negativeCompletion: payload.abandonedResponse,
        weight: FRICTION_WEIGHTS.abandon * signal.severity,
        type: 'abandon',
        workspace: signal.workspace,
        timestamp: signal.ts,
      };
      
    default:
      return null;
  }
}

/**
 * Simple hash for deduplication
 */
function hashPrompt(prompt) {
  if (!prompt) return '';
  return prompt.slice(0, 100).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Format dataset for llama.cpp training
 */
function formatForLlama(dataset, options = {}) {
  const {
    format = 'alpaca', // 'alpaca' | 'chatml' | 'raw'
    systemPrompt = 'You are a helpful assistant.',
  } = options;
  
  const formatted = [];
  
  for (const sample of dataset.samples) {
    if (!sample.prompt || !sample.completion) continue;
    
    let text;
    
    switch (format) {
      case 'alpaca':
        text = {
          instruction: sample.prompt,
          input: '',
          output: sample.completion,
        };
        break;
        
      case 'chatml':
        text = `<|im_start|>system
${systemPrompt}<|im_end|>
<|im_start|>user
${sample.prompt}<|im_end|>
<|im_start|>assistant
${sample.completion}<|im_end|>`;
        break;
        
      case 'raw':
      default:
        text = {
          prompt: sample.prompt,
          completion: sample.completion,
          weight: sample.weight,
        };
    }
    
    formatted.push({
      text,
      weight: sample.weight,
      type: sample.type,
    });
  }
  
  return formatted;
}

/**
 * Build workspace-specific datasets
 */
async function buildWorkspaceDatasets() {
  const workspaces = ['casual', 'work', 'code', 'nsfw'];
  const datasets = {};
  
  for (const workspace of workspaces) {
    const dataset = await buildDataset({ workspace, maxSamples: 500 });
    if (dataset.samples.length > 0) {
      datasets[workspace] = dataset;
    }
  }
  
  return datasets;
}

/**
 * Build time-of-day specific datasets
 */
async function buildCircadianDatasets() {
  const periods = {
    morning: { start: 6, end: 12 },
    afternoon: { start: 12, end: 18 },
    evening: { start: 18, end: 22 },
    night: { start: 22, end: 6 },
  };
  
  // This would require timestamp analysis of signals
  // Placeholder for now
  return {};
}

/**
 * Estimate training time for a dataset
 */
function estimateTrainingTime(dataset, config = {}) {
  const samples = dataset.samples?.length || 0;
  const epochs = config.epochs || 1;
  const batchSize = config.batchSize || 4;
  
  // Rough estimate: ~1 second per sample per epoch on decent GPU
  const secondsEstimate = (samples * epochs) / batchSize;
  
  return {
    samples,
    epochs,
    estimatedSeconds: secondsEstimate,
    estimatedMinutes: Math.ceil(secondsEstimate / 60),
    formatted: secondsEstimate < 60 
      ? `~${Math.ceil(secondsEstimate)} seconds`
      : `~${Math.ceil(secondsEstimate / 60)} minutes`,
  };
}

module.exports = {
  buildDataset,
  buildTrainingExample,
  formatForLlama,
  buildWorkspaceDatasets,
  buildCircadianDatasets,
  estimateTrainingTime,
  FRICTION_WEIGHTS,
  MIN_FRICTION_SCORE,
};




