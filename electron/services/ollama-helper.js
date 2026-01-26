const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class OllamaHelper {
  constructor({ store, shell, makeRequest }) {
    this.store = store;
    this.shell = shell;
    this.makeRequest = makeRequest;
    this.child = null;
  }

  detectBinary() {
    const custom = this.store?.get('ollamaBinary');
    if (custom && fs.existsSync(custom)) return custom;

    const candidates = [
      custom,
      process.platform === 'win32' && path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      process.platform === 'win32' && path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
      'ollama',
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (candidate === 'ollama') {
          // rely on PATH
          return candidate;
        }
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return 'ollama';
  }

  async getStatus(endpoint) {
    const binary = this.detectBinary();
    const installed = binary === 'ollama' ? true : fs.existsSync(binary);
    let running = false;
    if (this.makeRequest && endpoint) {
      try {
        const res = await this.makeRequest(`${endpoint}/api/version`, { timeout: 2000 });
        running = res.status === 200;
      } catch {
        running = false;
      }
    }
    return { installed, running, binary };
  }

  async install() {
    if (!this.shell) {
      throw new Error('Shell integration not available');
    }
    const url =
      process.platform === 'win32'
        ? 'https://ollama.com/download/windows'
        : 'https://ollama.com/download';
    await this.shell.openExternal(url);
    return { success: true, message: 'Opened Ollama download page' };
  }

  async start() {
    const binary = this.detectBinary();
    const child = spawn(binary, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    this.child = child;
    return { success: true };
  }

  async stop() {
    if (process.platform === 'win32') {
      exec('taskkill /IM ollama.exe /F');
    } else {
      exec('pkill -f "ollama serve"');
    }
    this.child = null;
    return { success: true };
  }

  /**
   * Create an Ollama model from an existing GGUF file by generating
   * a temporary Modelfile and running `ollama create`.
   * This keeps everything local/offline.
   * @param {Object} options
   * @param {string} options.name - Model name
   * @param {string} options.path - Path to model file
   * @param {Function} options.onProgress - Progress callback (optional)
   */
  async createModelFromFile({ name, path: modelPath, onProgress }) {
    if (!name || !modelPath) {
      throw new Error('Model name and path are required');
    }

    const binary = this.detectBinary();

    // Ensure the source file exists
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    // Get file size for progress estimation
    const stats = fs.statSync(modelPath);
    const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(1);

    // Create a temporary Modelfile
    const safeName = name.replace(/[^a-zA-Z0-9_.:-]+/g, '-');
    const tmpDir = path.join(os.tmpdir(), 'devforge-modelfiles');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const modelfilePath = path.join(tmpDir, `${safeName}.Modelfile`);

    const modelfileContent = `FROM ${modelPath}
PARAMETER temperature 0.7
`;

    await fs.promises.writeFile(modelfilePath, modelfileContent, 'utf-8');

    // Notify start
    if (onProgress) {
      onProgress({ stage: 'starting', progress: 0, message: `Creating model ${safeName} (${fileSizeGB} GB)...` });
    }

    return new Promise((resolve) => {
      const child = spawn(binary, ['create', safeName, '-f', modelfilePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      let lastProgress = 0;

      const parseProgress = (line) => {
        // Ollama outputs progress like "transferring model data 45%"
        const percentMatch = line.match(/(\d+)%/);
        if (percentMatch) {
          return parseInt(percentMatch[1], 10);
        }
        // Also check for stage indicators
        if (line.includes('transferring')) return Math.max(lastProgress, 10);
        if (line.includes('creating')) return Math.max(lastProgress, 50);
        if (line.includes('writing')) return Math.max(lastProgress, 80);
        if (line.includes('success')) return 100;
        return lastProgress;
      };

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        
        // Parse and report progress
        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          const progress = parseProgress(line.toLowerCase());
          if (progress > lastProgress) {
            lastProgress = progress;
            if (onProgress) {
              onProgress({
                stage: progress < 50 ? 'transferring' : progress < 90 ? 'creating' : 'finalizing',
                progress,
                message: line.trim() || `Processing... ${progress}%`,
              });
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        if (onProgress) {
          onProgress({ stage: 'error', progress: 0, message: error.message });
        }
        resolve({ success: false, error: error.message });
      });

      child.on('close', (code) => {
        if (code === 0) {
          if (onProgress) {
            onProgress({ stage: 'complete', progress: 100, message: `Model ${safeName} created successfully!` });
          }
          resolve({ success: true, name: safeName, stdout });
        } else {
          const message = stderr || stdout || `ollama create exited with code ${code}`;
          if (onProgress) {
            onProgress({ stage: 'error', progress: 0, message });
          }
          resolve({ success: false, error: message });
        }
      });
    });
  }
}

let helperInstance = null;

function getOllamaHelper({ store, shell, makeRequest }) {
  if (!helperInstance) {
    helperInstance = new OllamaHelper({ store, shell, makeRequest });
  }
  return helperInstance;
}

module.exports = {
  getOllamaHelper,
};

