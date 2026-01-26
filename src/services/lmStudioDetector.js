import { api } from '../utils/electronAPI';

/**
 * LM Studio Model Detector
 * Finds models downloaded in LM Studio and makes them available in DevForge
 */

/**
 * Parse model info from raw model data
 */
function enrichModelInfo(model) {
  const filename = model.filename || model.name;
  const name = filename.replace(/\.[^.]+$/, ''); // Remove extension
  
  // Try to extract quantization
  const quantMatch = name.match(/[._-](Q\d+_K_[MSL]|Q\d+_[01]|F16|F32|INT8|INT4)/i);
  const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';
  
  // Try to extract size (7b, 13b, 70b, etc.)
  const sizeMatch = name.match(/(\d+)[bB]/);
  const size = sizeMatch ? `${sizeMatch[1]}B` : 'Unknown';
  
  // Format file size
  const fileSizeGB = model.size ? (model.size / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : 'Unknown';
  
  return {
    ...model,
    quantization,
    size,
    fileSizeGB,
    source: 'lm-studio',
  };
}

/**
 * Detect LM Studio installation and find all downloaded models
 * Uses IPC to scan from the main process (has file system access)
 */
export async function detectLMStudioModels() {
  try {
    const result = await api.scanLMStudioModels();
    
    if (!result || !result.models) {
      return {
        found: false,
        models: [],
        searchedPaths: result?.searchedPaths || [],
      };
    }
    
    const enrichedModels = result.models.map(enrichModelInfo);
    
    return {
      found: enrichedModels.length > 0,
      models: enrichedModels,
      searchedPaths: result.searchedPaths,
    };
  } catch (error) {
    console.error('Failed to detect LM Studio models:', error);
    return {
      found: false,
      models: [],
      searchedPaths: [],
      error: error.message,
    };
  }
}

/**
 * Get LM Studio API endpoint (if running)
 */
export async function checkLMStudioAPI() {
  const endpoints = [
    'http://localhost:1234/v1/models',
    'http://127.0.0.1:1234/v1/models',
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          running: true,
          endpoint: endpoint.replace('/v1/models', ''),
          models: data.data || [],
        };
      }
    } catch {
      // Not running on this endpoint
    }
  }
  
  return { running: false };
}

/**
 * Import an LM Studio model to Ollama (creates a Modelfile and registers it)
 * Uses IPC to call Ollama CLI from the main process (avoids CORS/fetch issues)
 */
export async function importToOllama(modelPath, modelName) {
  try {
    // Use the existing IPC handler that runs ollama create via CLI
    const result = await window.electronAPI?.createOllamaModelFromFile({
      name: modelName,
      path: modelPath,
    });

    if (!result) {
      return { success: false, error: 'Electron API not available' };
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  detectLMStudioModels,
  checkLMStudioAPI,
  importToOllama,
};

