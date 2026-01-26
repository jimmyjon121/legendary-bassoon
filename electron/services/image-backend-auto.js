/**
 * Image Backend Auto-Manager
 * 
 * Fully automatic, self-contained image generation backend
 * - Auto-downloads ComfyUI portable on first use
 * - Auto-starts backend when needed (hidden, no console window)
 * - Auto-downloads models
 * - User never sees any manual setup
 * 
 * NO CONTENT FILTERS - Fully unrestricted NSFW-capable
 */

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { app } = require('electron');
const { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const streamPipeline = promisify(pipeline);

// Get app data directory
const getAppDataDir = () => {
  const appData = app?.getPath?.('userData') || path.join(os.homedir(), 'DevForge');
  return path.join(appData, 'ImageBackend');
};

// Get project directory (where devforge is running from)
const getProjectDir = () => {
  // Try to get the actual project directory
  const cwd = process.cwd();
  if (cwd.includes('devforge')) {
    return cwd;
  }
  // Fallback to app path
  return app?.getAppPath?.() || cwd;
};

// Configuration
const CONFIG = {
  port: 8188,
  // Use GitHub releases for ComfyUI portable
  downloadUrls: {
    nvidia: 'https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
    amd: 'https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_amd.7z',
    cpu: 'https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable.7z',
  },
  // Starter model - small, fast, NSFW-capable
  starterModel: {
    name: 'DreamShaper 8',
    url: 'https://civitai.com/api/download/models/128713',
    filename: 'dreamshaper_8.safetensors',
    size: '2.1 GB',
  },
  // Alternative models (smaller/faster options)
  alternativeModels: [
    {
      name: 'Stable Diffusion 1.5',
      url: 'https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors',
      filename: 'sd_v1-5-pruned-emaonly.safetensors',
      size: '4.27 GB',
      description: 'Original SD 1.5 - great all-rounder'
    },
    {
      name: 'Deliberate v2',
      url: 'https://civitai.com/api/download/models/15236',
      filename: 'deliberate_v2.safetensors', 
      size: '2.0 GB',
      description: 'Photorealistic, versatile'
    },
    {
      name: 'ReV Animated',
      url: 'https://civitai.com/api/download/models/46846',
      filename: 'rev_animated.safetensors',
      size: '2.0 GB',
      description: 'Anime/illustration style'
    }
  ]
};

class ImageBackendAuto {
  constructor() {
    this.baseDir = getAppDataDir();
    this.comfyDir = null; // Will be set when found
    this.modelsDir = null;
    this.pythonExe = null;
    this.mainPy = null;
    this.process = null;
    this.isRunning = false;
    this.isInitializing = false;
    this.eventCallback = null;
    this.startupPromise = null;
    
    // Try to find existing installation on construction
    this._detectInstallation();
  }

  /**
   * Detect existing ComfyUI installation in common locations
   */
  _detectInstallation() {
    const projectDir = getProjectDir();
    
    const possiblePaths = [
      // PROJECT FOLDER FIRST - Most likely location for devforge users
      path.join(projectDir, 'ComfyUI', 'ComfyUI_windows_portable'),
      path.join(projectDir, 'ComfyUI'),
      // Standard install location in app data
      path.join(this.baseDir, 'ComfyUI'),
      path.join(this.baseDir, 'ComfyUI_windows_portable'),
      // Common download locations
      path.join(os.homedir(), 'Downloads', 'devforge', 'ComfyUI', 'ComfyUI_windows_portable'),
      path.join(os.homedir(), 'Downloads', 'ComfyUI_windows_portable'),
      path.join(os.homedir(), 'Downloads', 'ComfyUI'),
      path.join(os.homedir(), 'ComfyUI'),
      path.join(os.homedir(), 'ComfyUI_windows_portable'),
      // App data location
      path.join(os.homedir(), 'DevForge', 'ComfyUI'),
      path.join(os.homedir(), 'DevForge', 'ImageBackend', 'ComfyUI'),
      // Common install locations
      'C:\\ComfyUI',
      'C:\\AI\\ComfyUI',
      'D:\\ComfyUI',
      path.join(os.homedir(), 'Documents', 'ComfyUI'),
      // Check process.cwd() as fallback
      path.join(process.cwd(), 'ComfyUI', 'ComfyUI_windows_portable'),
    ];

    for (const basePath of possiblePaths) {
      // Try different internal structures
      const structures = [
        // Portable version structure
        { python: path.join(basePath, 'python_embeded', 'python.exe'), main: path.join(basePath, 'ComfyUI', 'main.py'), models: path.join(basePath, 'ComfyUI', 'models', 'checkpoints') },
        // Direct install structure  
        { python: path.join(basePath, 'python_embeded', 'python.exe'), main: path.join(basePath, 'main.py'), models: path.join(basePath, 'models', 'checkpoints') },
        // System python structure
        { python: 'python', main: path.join(basePath, 'main.py'), models: path.join(basePath, 'models', 'checkpoints') },
      ];

      for (const struct of structures) {
        const pythonExists = struct.python === 'python' || existsSync(struct.python);
        const mainExists = existsSync(struct.main);
        
        if (pythonExists && mainExists) {
          this.comfyDir = basePath;
          this.pythonExe = struct.python;
          this.mainPy = struct.main;
          this.modelsDir = struct.models;
          console.log(`[ImageBackend] Found ComfyUI at: ${basePath}`);
          return true;
        }
      }
    }
    
    // Default to standard location
    this.comfyDir = path.join(this.baseDir, 'ComfyUI');
    this.pythonExe = path.join(this.comfyDir, 'python_embeded', 'python.exe');
    this.mainPy = path.join(this.comfyDir, 'ComfyUI', 'main.py');
    this.modelsDir = path.join(this.comfyDir, 'ComfyUI', 'models', 'checkpoints');
    return false;
  }

  /**
   * Set event callback for progress updates
   */
  onEvent(callback) {
    this.eventCallback = callback;
  }

  emit(event, data) {
    console.log(`[ImageBackend] ${event}:`, data?.message || data?.percent || '');
    if (this.eventCallback) {
      this.eventCallback(event, data);
    }
  }

  /**
   * Get current status
   */
  async getStatus() {
    const installed = this.isInstalled();
    const running = await this.checkRunning();
    const models = installed ? this.getInstalledModels() : [];
    const needsSetup = !installed;
    const needsModel = installed && models.length === 0;

    return {
      installed,
      running,
      ready: installed && running && models.length > 0,
      needsSetup,
      needsModel,
      models,
      modelsDir: this.modelsDir,
      comfyDir: this.comfyDir,
      pythonExe: this.pythonExe,
      mainPy: this.mainPy,
      port: CONFIG.port,
      baseDir: this.baseDir,
      availableModels: this.getAvailableModelsForDownload(),
    };
  }

  /**
   * Get list of models available for download
   */
  getAvailableModelsForDownload() {
    return [
      CONFIG.starterModel,
      ...CONFIG.alternativeModels
    ];
  }

  /**
   * Check if ComfyUI is installed
   */
  isInstalled() {
    // Re-detect in case user installed while app was running
    if (!this.mainPy) {
      this._detectInstallation();
    }
    
    // Safe checks - ensure paths are strings before calling existsSync
    const pythonOk = this.pythonExe === 'python' || (typeof this.pythonExe === 'string' && existsSync(this.pythonExe));
    const mainOk = typeof this.mainPy === 'string' && existsSync(this.mainPy);
    
    return pythonOk && mainOk;
  }

  /**
   * Check if backend is running
   */
  async checkRunning() {
    try {
      const response = await this.httpGet(`http://127.0.0.1:${CONFIG.port}/system_stats`, 2000);
      this.isRunning = !!response;
      return this.isRunning;
    } catch {
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Get installed models
   */
  getInstalledModels() {
    // Ensure models dir is set
    if (!this.modelsDir) {
      this._detectInstallation();
    }
    
    if (!this.modelsDir || !existsSync(this.modelsDir)) {
      // Try alternative model locations only if comfyDir is set
      if (this.comfyDir) {
        const altPaths = [
          path.join(this.comfyDir, 'models', 'checkpoints'),
          path.join(this.comfyDir, 'ComfyUI', 'models', 'checkpoints'),
        ];
        
        for (const p of altPaths) {
          if (existsSync(p)) {
            this.modelsDir = p;
            break;
          }
        }
      }
    }
    
    if (!this.modelsDir || !existsSync(this.modelsDir)) return [];
    
    try {
      return readdirSync(this.modelsDir)
        .filter(f => f.endsWith('.safetensors') || f.endsWith('.ckpt'))
        .map(f => ({
          name: f.replace(/\.(safetensors|ckpt)$/, ''),
          filename: f,
          path: path.join(this.modelsDir, f),
          size: statSync(path.join(this.modelsDir, f)).size,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Auto-start backend on app launch (if previously used)
   * Called from main.js during startup
   */
  async autoStartIfConfigured() {
    try {
      // Check if we should auto-start (if ComfyUI is installed and has models)
      if (!this.isInstalled()) {
        console.log('[ImageBackend] Not installed, skipping auto-start');
        return { autoStarted: false, reason: 'not_installed' };
      }

      const models = this.getInstalledModels();
      if (models.length === 0) {
        console.log('[ImageBackend] No models, skipping auto-start');
        return { autoStarted: false, reason: 'no_models' };
      }

      // Check if already running
      if (await this.checkRunning()) {
        console.log('[ImageBackend] Already running');
        return { autoStarted: false, reason: 'already_running' };
      }

      // Start in background
      console.log('[ImageBackend] Auto-starting backend...');
      await this.start();
      
      return { autoStarted: true, port: CONFIG.port };
    } catch (error) {
      console.error('[ImageBackend] Auto-start failed:', error.message);
      return { autoStarted: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Full auto-setup: Install ComfyUI + Download starter model
   */
  async autoSetup(options = {}) {
    if (this.isInitializing) {
      return { success: false, error: 'Setup already in progress' };
    }

    this.isInitializing = true;
    
    try {
      // Step 1: Install ComfyUI if needed
      if (!this.isInstalled()) {
        this.emit('setup:progress', { step: 'install', message: 'Downloading image generation backend...', percent: 0 });
        await this.installComfyUI(options.gpuType || 'nvidia');
      }

      // Step 2: Download starter model if no models exist
      const models = this.getInstalledModels();
      if (models.length === 0) {
        this.emit('setup:progress', { step: 'model', message: 'Downloading starter model...', percent: 50 });
        await this.downloadStarterModel();
      }

      // Step 3: Start the backend
      this.emit('setup:progress', { step: 'start', message: 'Starting image backend...', percent: 90 });
      await this.start();

      this.emit('setup:complete', { message: 'Image generation ready!' });
      this.isInitializing = false;
      
      return { success: true };
    } catch (error) {
      this.isInitializing = false;
      this.emit('setup:error', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Install ComfyUI portable
   */
  async installComfyUI(gpuType = 'nvidia') {
    // Create directories
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }

    const downloadUrl = CONFIG.downloadUrls[gpuType] || CONFIG.downloadUrls.nvidia;
    const archivePath = path.join(this.baseDir, 'comfyui_portable.7z');

    // Download the archive
    this.emit('install:download', { message: 'Downloading ComfyUI (~1.7GB)...', percent: 0 });
    
    await this.downloadFile(downloadUrl, archivePath, (progress) => {
      this.emit('install:download', { 
        message: `Downloading ComfyUI... ${progress.percent}%`, 
        percent: progress.percent 
      });
    });

    // Extract using 7-zip or built-in extractor
    this.emit('install:extract', { message: 'Extracting files...', percent: 0 });
    await this.extractArchive(archivePath, this.baseDir);

    // Rename extracted folder if needed
    const extractedDir = path.join(this.baseDir, 'ComfyUI_windows_portable');
    if (existsSync(extractedDir) && this.comfyDir && !existsSync(this.comfyDir)) {
      fs.renameSync(extractedDir, this.comfyDir);
    }

    // Update paths after extraction
    this.modelsDir = path.join(this.comfyDir, 'ComfyUI', 'models', 'checkpoints');

    // Clean up archive
    try {
      fs.unlinkSync(archivePath);
    } catch {}

    this.emit('install:complete', { message: 'ComfyUI installed!' });
    return { success: true };
  }

  /**
   * Download starter model
   */
  async downloadStarterModel() {
    // Ensure modelsDir is set
    if (!this.modelsDir) {
      this._detectInstallation();
    }
    
    if (!this.modelsDir) {
      // Create default models directory if not found
      this.modelsDir = path.join(this.baseDir, 'ComfyUI', 'ComfyUI', 'models', 'checkpoints');
    }
    
    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true });
    }

    const modelPath = path.join(this.modelsDir, CONFIG.starterModel.filename);
    
    if (existsSync(modelPath)) {
      return { success: true, alreadyExists: true };
    }

    await this.downloadFile(CONFIG.starterModel.url, modelPath, (progress) => {
      this.emit('model:download', {
        message: `Downloading ${CONFIG.starterModel.name}... ${progress.percent}%`,
        percent: progress.percent,
        model: CONFIG.starterModel.name,
      });
    });

    this.emit('model:complete', { message: 'Model downloaded!', model: CONFIG.starterModel.name });
    return { success: true };
  }

  /**
   * Download any model by URL
   */
  async downloadModel(url, filename, onProgress) {
    // Ensure modelsDir is set
    if (!this.modelsDir) {
      this._detectInstallation();
    }
    
    if (!this.modelsDir) {
      // Create default models directory if not found
      this.modelsDir = path.join(this.baseDir, 'ComfyUI', 'ComfyUI', 'models', 'checkpoints');
    }
    
    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true });
    }

    const modelPath = path.join(this.modelsDir, filename);
    
    if (existsSync(modelPath)) {
      return { success: true, alreadyExists: true, path: modelPath };
    }

    await this.downloadFile(url, modelPath, onProgress);
    return { success: true, path: modelPath };
  }

  /**
   * Start the backend (hidden, no console window)
   */
  async start() {
    // Already running?
    if (await this.checkRunning()) {
      return { success: true, message: 'Already running' };
    }

    // Not installed?
    if (!this.isInstalled()) {
      throw new Error('ComfyUI not installed. Run autoSetup() first.');
    }

    // If we're already starting, wait for that
    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this._doStart();
    
    try {
      const result = await this.startupPromise;
      return result;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStart() {
    // Ensure we have valid paths
    if (!this.isInstalled()) {
      throw new Error('ComfyUI not found. Please run setup first.');
    }

    this.emit('backend:starting', { message: 'Starting image backend...', path: this.comfyDir });

    return new Promise((resolve, reject) => {
      // Build command arguments
      const args = ['-s', this.mainPy, '--listen', '127.0.0.1', '--port', String(CONFIG.port)];
      
      // Add windows standalone flag if using embedded python
      if (this.pythonExe !== 'python' && existsSync(path.join(this.comfyDir, 'python_embeded'))) {
        args.push('--windows-standalone-build');
      }

      // Determine working directory
      const cwd = path.dirname(this.mainPy);
      
      console.log(`[ImageBackend] Starting: ${this.pythonExe} ${args.join(' ')}`);
      console.log(`[ImageBackend] Working dir: ${cwd}`);

      // Start ComfyUI with hidden window
      this.process = spawn(this.pythonExe, args, {
        cwd: cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true, // Hide the console window on Windows
        env: {
          ...process.env,
          // Ensure CUDA/GPU works properly
          CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES || '0',
        }
      });

      this.process.on('error', (err) => {
        console.error('[ImageBackend] Process error:', err);
        this.emit('backend:error', { error: err.message });
      });

      this.process.unref();

      // Wait for it to be ready
      let attempts = 0;
      const maxAttempts = 90; // 90 seconds max (first load can be slow)

      const checkReady = async () => {
        attempts++;
        
        if (await this.checkRunning()) {
          this.emit('backend:ready', { message: 'Image backend ready!', port: CONFIG.port });
          resolve({ success: true, port: CONFIG.port });
          return;
        }

        if (attempts >= maxAttempts) {
          this.emit('backend:error', { error: 'Startup timeout' });
          reject(new Error('Backend startup timeout - check GPU drivers and try again'));
          return;
        }

        // Emit progress
        if (attempts % 5 === 0) {
          this.emit('backend:starting', { message: `Starting... ${attempts}s`, progress: Math.min(attempts, 80) });
        }

        setTimeout(checkReady, 1000);
      };

      // Give it a moment before first check (ComfyUI takes time to load models)
      setTimeout(checkReady, 3000);
    });
  }

  /**
   * Stop the backend
   */
  async stop() {
    if (this.process) {
      try {
        process.kill(this.process.pid);
      } catch {}
      this.process = null;
    }

    // Also try to kill any orphaned processes on Windows
    if (process.platform === 'win32') {
      try {
        const { exec } = require('child_process');
        exec('taskkill /F /IM python.exe /FI "WINDOWTITLE eq *ComfyUI*"', { windowsHide: true });
      } catch {}
    }

    this.isRunning = false;
    this.emit('backend:stopped', {});
    return { success: true };
  }

  /**
   * Ensure backend is running (auto-start if needed)
   */
  async ensureRunning() {
    if (await this.checkRunning()) {
      return { success: true, wasAlreadyRunning: true };
    }

    // Auto-setup if not installed
    if (!this.isInstalled()) {
      return await this.autoSetup();
    }

    // Just start it
    return await this.start();
  }

  /**
   * Generate an image
   */
  async generate(params) {
    // Ensure backend is running
    await this.ensureRunning();

    const {
      prompt,
      negativePrompt = 'bad quality, blurry, distorted',
      width = 512,
      height = 512,
      steps = 20,
      cfg = 7,
      seed = -1,
      model = null,
    } = params;

    const actualSeed = seed === -1 ? Math.floor(Math.random() * 2147483647) : seed;

    // Get available models
    const models = this.getInstalledModels();
    if (models.length === 0) {
      throw new Error('No models installed. Download a model first.');
    }

    const selectedModel = model || models[0].filename;

    // Build ComfyUI workflow
    const workflow = this.buildWorkflow({
      prompt,
      negativePrompt,
      width,
      height,
      steps,
      cfg,
      seed: actualSeed,
      model: selectedModel,
    });

    // Submit to ComfyUI
    const response = await this.httpPost(`http://127.0.0.1:${CONFIG.port}/prompt`, {
      prompt: workflow
    });

    if (!response?.prompt_id) {
      throw new Error('Failed to submit generation request');
    }

    // Poll for result
    const result = await this.pollResult(response.prompt_id);
    return result;
  }

  /**
   * Build ComfyUI workflow for image generation
   */
  buildWorkflow({ prompt, negativePrompt, width, height, steps, cfg, seed, model }) {
    return {
      "3": {
        "inputs": {
          "seed": seed,
          "steps": steps,
          "cfg": cfg,
          "sampler_name": "euler_ancestral",
          "scheduler": "normal",
          "denoise": 1,
          "model": ["4", 0],
          "positive": ["6", 0],
          "negative": ["7", 0],
          "latent_image": ["5", 0]
        },
        "class_type": "KSampler"
      },
      "4": {
        "inputs": { "ckpt_name": model },
        "class_type": "CheckpointLoaderSimple"
      },
      "5": {
        "inputs": { "width": width, "height": height, "batch_size": 1 },
        "class_type": "EmptyLatentImage"
      },
      "6": {
        "inputs": { "text": prompt, "clip": ["4", 1] },
        "class_type": "CLIPTextEncode"
      },
      "7": {
        "inputs": { "text": negativePrompt, "clip": ["4", 1] },
        "class_type": "CLIPTextEncode"
      },
      "8": {
        "inputs": { "samples": ["3", 0], "vae": ["4", 2] },
        "class_type": "VAEDecode"
      },
      "9": {
        "inputs": { "filename_prefix": "DevForge", "images": ["8", 0] },
        "class_type": "SaveImage"
      }
    };
  }

  /**
   * Poll for generation result
   */
  async pollResult(promptId, maxWaitMs = 300000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const history = await this.httpGet(`http://127.0.0.1:${CONFIG.port}/history/${promptId}`);
        
        if (history && history[promptId]) {
          const result = history[promptId];
          
          if (result.status?.completed) {
            const outputs = result.outputs || {};
            const images = [];
            
            for (const nodeOutput of Object.values(outputs)) {
              if (nodeOutput.images) {
                for (const img of nodeOutput.images) {
                  images.push({
                    filename: img.filename,
                    url: `http://127.0.0.1:${CONFIG.port}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`
                  });
                }
              }
            }

            return { success: true, images, promptId };
          }
        }
      } catch {}

      await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error('Generation timeout');
  }

  /**
   * HTTP GET helper
   */
  httpGet(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const req = protocol.get(url, { timeout }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * HTTP POST helper
   */
  httpPost(url, body, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = url.startsWith('https') ? https : http;
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout,
      };

      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Download file with progress
   */
  downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, {
        headers: { 'User-Agent': 'DevForge/1.0' }
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          return this.downloadFile(response.headers.location, destPath, onProgress)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastPercent = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percent = totalSize ? Math.round((downloadedSize / totalSize) * 100) : 0;
          
          if (percent > lastPercent && onProgress) {
            lastPercent = percent;
            onProgress({ percent, downloaded: downloadedSize, total: totalSize });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(destPath);
        });

        file.on('error', (err) => {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
      });

      request.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });
  }

  /**
   * Extract 7z archive (uses system 7-zip or falls back to manual extraction)
   */
  async extractArchive(archivePath, destDir) {
    // Try using 7-zip if available
    const sevenZipPaths = [
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe',
      path.join(os.homedir(), 'AppData', 'Local', '7-Zip', '7z.exe'),
    ];

    for (const szPath of sevenZipPaths) {
      if (existsSync(szPath)) {
        return new Promise((resolve, reject) => {
          const proc = spawn(szPath, ['x', archivePath, `-o${destDir}`, '-y'], {
            stdio: 'ignore',
            windowsHide: true,
          });

          proc.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`7-Zip extraction failed with code ${code}`));
            }
          });

          proc.on('error', reject);
        });
      }
    }

    // If no 7-zip, throw helpful error
    throw new Error(
      '7-Zip is required to extract ComfyUI. Please install 7-Zip from https://7-zip.org/ and try again.'
    );
  }
}

// Singleton
let instance = null;

function getImageBackendAuto() {
  if (!instance) {
    instance = new ImageBackendAuto();
  }
  return instance;
}

module.exports = {
  ImageBackendAuto,
  getImageBackendAuto,
};
