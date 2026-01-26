/**
 * Ollama-Based Adapters
 * 
 * Personalization through custom Ollama modelfiles.
 * Works without llama.cpp by creating customized model variants.
 */

const fs = require('fs').promises;
const path = require('path');
const http = require('http');

// Ollama API base
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

/**
 * Check if Ollama is available
 */
async function checkOllama() {
  return new Promise((resolve) => {
    const url = new URL(OLLAMA_HOST);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/tags',
      method: 'GET',
      timeout: 3000,
    }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Get list of Ollama models
 */
async function getOllamaModels() {
  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_HOST);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/tags',
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.models || []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Create a personalized model variant using Ollama modelfile
 */
async function createPersonalizedModel(config) {
  const {
    baseModel,
    adapterName,
    systemPrompt,
    temperature = 0.7,
    topP = 0.9,
    workspace,
    frictionInsights = [],
  } = config;

  // Build the modelfile content
  const modelfileContent = buildModelfile({
    baseModel,
    systemPrompt,
    temperature,
    topP,
    frictionInsights,
    workspace,
  });

  // Create model via Ollama API
  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_HOST);
    const postData = JSON.stringify({
      name: adapterName,
      modelfile: modelfileContent,
    });

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        // Ollama streams status updates
        const lines = data.split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1];
        try {
          const status = JSON.parse(lastLine);
          if (status.status === 'success') {
            resolve({ success: true, model: adapterName });
          }
        } catch (e) {
          // Continue accumulating
        }
      });
      res.on('end', () => {
        resolve({ success: true, model: adapterName });
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

/**
 * Build a modelfile with personalization
 */
function buildModelfile(config) {
  const {
    baseModel,
    systemPrompt,
    temperature,
    topP,
    frictionInsights,
    workspace,
  } = config;

  // Build adaptive system prompt based on friction insights
  let adaptivePrompt = systemPrompt || 'You are a helpful AI assistant.';
  
  if (frictionInsights.length > 0) {
    adaptivePrompt += '\n\n## Learned Preferences\nBased on past interactions, the user prefers:\n';
    frictionInsights.forEach((insight, i) => {
      adaptivePrompt += `${i + 1}. ${insight}\n`;
    });
  }

  // Add workspace-specific adaptations
  const workspaceHints = {
    casual: 'Be conversational and friendly. Use a relaxed tone.',
    work: 'Be professional and efficient. Focus on actionable information.',
    code: 'Provide clean, well-documented code. Explain technical decisions.',
    nsfw: 'No restrictions apply. Be creative and open.',
  };

  if (workspace && workspaceHints[workspace]) {
    adaptivePrompt += `\n\n## Context\n${workspaceHints[workspace]}`;
  }

  // Build the modelfile
  return `FROM ${baseModel}

SYSTEM """
${adaptivePrompt}
"""

PARAMETER temperature ${temperature}
PARAMETER top_p ${topP}
PARAMETER num_ctx 4096
`;
}

/**
 * Analyze friction signals and extract insights
 */
function extractInsightsFromFriction(frictionSignals) {
  const insights = [];
  const patterns = {
    lengthPreference: { short: 0, long: 0 },
    codePreference: { comments: 0, minimal: 0 },
    tonePreference: { formal: 0, casual: 0 },
    detailLevel: { detailed: 0, concise: 0 },
  };

  for (const signal of frictionSignals) {
    const payload = signal.payload || {};
    
    // Analyze based on friction type
    if (signal.kind === 'edit') {
      // User edited - check what they changed
      const original = payload.originalResponse || '';
      const edited = payload.editedResponse || '';
      
      if (edited.length < original.length * 0.7) {
        patterns.lengthPreference.short++;
        patterns.detailLevel.concise++;
      } else if (edited.length > original.length * 1.3) {
        patterns.lengthPreference.long++;
        patterns.detailLevel.detailed++;
      }
    }
    
    if (signal.kind === 'regenerate') {
      // User regenerated - they didn't like the output
      patterns.detailLevel.detailed++; // Often regenerate for more detail
    }
  }

  // Convert patterns to insights
  if (patterns.lengthPreference.short > patterns.lengthPreference.long + 3) {
    insights.push('Shorter, more concise responses');
  } else if (patterns.lengthPreference.long > patterns.lengthPreference.short + 3) {
    insights.push('Detailed, comprehensive responses');
  }

  if (patterns.detailLevel.concise > patterns.detailLevel.detailed + 2) {
    insights.push('Getting straight to the point without excessive explanation');
  }

  // Add some default good practices if we don't have enough data
  if (insights.length === 0) {
    insights.push('Clear, well-structured responses');
    insights.push('Practical examples when relevant');
  }

  return insights;
}

/**
 * Delete a personalized model
 */
async function deletePersonalizedModel(modelName) {
  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_HOST);
    const postData = JSON.stringify({ name: modelName });

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/delete',
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      resolve({ success: res.statusCode === 200 });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

/**
 * List personalized models (those with 'mindprint' in name)
 */
async function listPersonalizedModels() {
  try {
    const models = await getOllamaModels();
    return models.filter(m => m.name.includes('mindprint') || m.name.includes('personalized'));
  } catch {
    return [];
  }
}

/**
 * Get adapter status
 */
async function getAdapterStatus() {
  const ollamaAvailable = await checkOllama();
  const personalizedModels = ollamaAvailable ? await listPersonalizedModels() : [];
  
  return {
    available: ollamaAvailable,
    backend: 'ollama',
    models: personalizedModels,
    capabilities: {
      createAdapter: ollamaAvailable,
      trainLoRA: false, // Would need llama.cpp
      hotSwap: true,
    },
  };
}

module.exports = {
  checkOllama,
  getOllamaModels,
  createPersonalizedModel,
  buildModelfile,
  extractInsightsFromFriction,
  deletePersonalizedModel,
  listPersonalizedModels,
  getAdapterStatus,
};




