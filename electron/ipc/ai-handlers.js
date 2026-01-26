/**
 * AI IPC Handlers
 * 
 * Handles AI-related operations:
 * - LLM streaming and inference
 * - RAG (document search)
 * - Whisper transcription
 * - Ollama management
 */

const http = require('http');
const { getService } = require('../services/lazy-loader');

// Lazy service getters
const getOllamaHelperFactory = () => getService('ollama-helper')?.getOllamaHelper || null;
const getOrchestrator = () => getService('inference-orchestrator')?.getOrchestrator?.() || null;

// RAG service
const ragService = {
  get ingestDocument() { return getService('rag-service')?.ingestDocument; },
  get searchDocuments() { return getService('rag-service')?.searchDocuments; },
  get deleteDocument() { return getService('rag-service')?.deleteDocument; },
  get listDocuments() { return getService('rag-service')?.listDocuments; },
};

// Whisper service
const whisperService = {
  get transcribe() { return getService('whisper-service')?.transcribe; },
};

// Active stream handlers for cleanup
const activeStreams = new Map();

/**
 * Setup AI-related IPC handlers
 */
function setupAIHandlers(ipcMain, mainWindow, store, db) {
  // ─────────────────────────────────────────────────────────────────────────
  // LLM HEALTH CHECK
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('check-llm-health', async () => {
    const endpoint = store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
    
    return new Promise((resolve) => {
      const url = new URL(endpoint);
      const options = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/tags',
        method: 'GET',
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ healthy: true, models: parsed.models || [] });
          } catch {
            resolve({ healthy: true, models: [] });
          }
        });
      });

      req.on('error', (error) => {
        resolve({ healthy: false, error: error.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ healthy: false, error: 'Connection timeout' });
      });

      req.end();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET MODELS
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('get-models', async () => {
    const endpoint = store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
    
    return new Promise((resolve) => {
      const url = new URL(endpoint);
      const options = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/tags',
        method: 'GET',
        timeout: 10000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const models = (parsed.models || []).map(m => m.name);
            resolve(models);
          } catch {
            resolve([]);
          }
        });
      });

      req.on('error', () => resolve([]));
      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });

      req.end();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LLM STREAMING
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.on('stream-llm', (event, { model, prompt, system, options = {} }) => {
    const endpoint = store?.get('llmEndpoint') || 'http://127.0.0.1:11434';
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    const url = new URL(endpoint);
    const postData = JSON.stringify({
      model,
      prompt,
      system,
      stream: true,
      options: {
        ...options,
        num_gpu: options.num_gpu ?? -1, // Default to full GPU
      },
    });

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.done) {
              event.reply('llm-stream', { done: true, streamId });
              activeStreams.delete(streamId);
            } else if (parsed.response) {
              event.reply('llm-stream', { response: parsed.response, streamId });
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      });

      res.on('end', () => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.response) {
              event.reply('llm-stream', { response: parsed.response, streamId });
            }
          } catch (e) {
            // Ignore
          }
        }
        event.reply('llm-stream', { done: true, streamId });
        activeStreams.delete(streamId);
      });
    });

    req.on('error', (error) => {
      event.reply('llm-stream', { error: error.message, streamId });
      activeStreams.delete(streamId);
    });

    // Store for cancellation
    activeStreams.set(streamId, req);
    
    req.write(postData);
    req.end();
    
    // Return stream ID for cancellation
    event.returnValue = streamId;
  });

  ipcMain.handle('cancel-llm-stream', (_, streamId) => {
    const req = activeStreams.get(streamId);
    if (req) {
      req.destroy();
      activeStreams.delete(streamId);
      return { cancelled: true };
    }
    return { cancelled: false };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RAG (Document Search)
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('ingest-document', async (_, workspace, filePath) => {
    try {
      if (!ragService.ingestDocument) {
        return { error: 'RAG service not available' };
      }
      return await ragService.ingestDocument(workspace, filePath);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('search-documents', async (_, workspace, query, limit = 5) => {
    try {
      if (!ragService.searchDocuments) {
        return [];
      }
      return await ragService.searchDocuments(workspace, query, limit);
    } catch (error) {
      console.error('RAG search error:', error);
      return [];
    }
  });

  ipcMain.handle('delete-document', async (_, workspace, documentId) => {
    try {
      if (!ragService.deleteDocument) {
        return { error: 'RAG service not available' };
      }
      return await ragService.deleteDocument(workspace, documentId);
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('list-documents', async (_, workspace) => {
    try {
      if (!ragService.listDocuments) {
        return [];
      }
      return await ragService.listDocuments(workspace);
    } catch (error) {
      return [];
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WHISPER (Speech to Text)
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('transcribe-audio', async (_, audioPath) => {
    try {
      if (!whisperService.transcribe) {
        return { error: 'Whisper service not available' };
      }
      return await whisperService.transcribe(audioPath);
    } catch (error) {
      return { error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // OLLAMA MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────
  
  ipcMain.handle('start-ollama', async () => {
    try {
      const factory = getOllamaHelperFactory();
      if (!factory) {
        return { success: false, error: 'Ollama helper not available' };
      }
      const helper = factory();
      return await helper.start();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('stop-ollama', async () => {
    try {
      const factory = getOllamaHelperFactory();
      if (!factory) {
        return { success: false, error: 'Ollama helper not available' };
      }
      const helper = factory();
      return await helper.stop();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pull-model', async (_, modelName) => {
    try {
      const factory = getOllamaHelperFactory();
      if (!factory) {
        return { success: false, error: 'Ollama helper not available' };
      }
      const helper = factory();
      return await helper.pullModel(modelName);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  console.log('[IPC:AI] Handlers registered');
}

module.exports = {
  setupAIHandlers,
};
