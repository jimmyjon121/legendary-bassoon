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
  // Starter model - small, fast, great quality (all URLs are HuggingFace - free, no login)
  starterModel: {
    name: 'DreamShaper 8',
    url: 'https://huggingface.co/jzli/DreamShaper-8/resolve/main/dreamshaper_8.safetensors',
    filename: 'dreamshaper_8.safetensors',
    size: '2.1 GB',
    description: 'Dreamy artistic style, versatile, great for most prompts',
  },
  // Alternative models - ALL hosted on HuggingFace (free, no auth, no API keys)
  alternativeModels: [
    {
      name: 'Stable Diffusion 1.5',
      url: 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors',
      filename: 'sd_v1-5-pruned-emaonly.safetensors',
      size: '4.27 GB',
      description: 'The original classic - great all-rounder, huge community support'
    },
    {
      name: 'Realistic Vision 6.0',
      url: 'https://huggingface.co/Cristiants/comfyui/resolve/main/checkpoints/realistic-vision-v60-b1.safetensors',
      filename: 'realistic_vision_v60.safetensors',
      size: '2.1 GB',
      description: 'Photorealistic images, people, landscapes'
    },
    {
      name: 'Realistic Vision 4.0',
      url: 'https://huggingface.co/fofr/comfyui/resolve/main/checkpoints/Realistic_Vision_V4.0.safetensors',
      filename: 'realistic_vision_v40.safetensors',
      size: '4.27 GB',
      description: 'Photorealistic, versatile, excellent detail'
    },
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
   * Quick pre-flight check: can PyTorch see the CUDA GPU?
   * Returns true if GPU mode should work, false if we should use --cpu.
   */
  async _checkGpuAvailable() {
    if (!this.pythonExe || this.pythonExe === 'python') return true; // can't check, assume yes
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync(this.pythonExe, [
        '-s', '-c',
        'import torch; print("OK" if torch.cuda.is_available() else "NO")'
      ], { timeout: 30000, windowsHide: true, encoding: 'utf-8' });
      const available = out.trim().endsWith('OK');
      console.log(`[ImageBackend] GPU pre-check: CUDA available = ${available}`);
      return available;
    } catch (err) {
      console.warn('[ImageBackend] GPU pre-check failed:', err.message);
      return false; // safer to assume no GPU
    }
  }

  /**
   * Start the backend (hidden, no console window).
   * Checks GPU availability first. If GPU is available, starts in GPU mode.
   * If GPU crashes during startup, automatically retries with --cpu.
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

    this.startupPromise = (async () => {
      // If we already know CPU-only is needed, skip the GPU attempt
      if (this._forceCpu) {
        return this._doStart({ cpu: true });
      }

      // Pre-flight GPU check
      const gpuOk = await this._checkGpuAvailable();
      if (!gpuOk) {
        console.warn('[ImageBackend] GPU not available (CUDA check failed), using CPU mode');
        this.emit('backend:starting', {
          message: 'GPU not available — starting in CPU mode...',
          progress: 0
        });
        this._forceCpu = true;
        return this._doStart({ cpu: true });
      }

      try {
        return await this._doStart({ cpu: false });
      } catch (gpuError) {
        // If the process crashed (segfault / access violation), fall back to CPU
        const isCrash = gpuError.message?.includes('exited') || gpuError.message?.includes('crashed');
        if (isCrash) {
          console.warn('[ImageBackend] GPU mode crashed, retrying with --cpu...');
          this.emit('backend:starting', {
            message: 'GPU mode failed — retrying with CPU (slower but works)...',
            progress: 0
          });
          this._forceCpu = true;
          return await this._doStart({ cpu: true });
        }
        throw gpuError;
      }
    })();

    try {
      const result = await this.startupPromise;
      return result;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStart({ cpu = false } = {}) {
    // Ensure we have valid paths
    if (!this.isInstalled()) {
      throw new Error('ComfyUI not found. Please run setup first.');
    }

    const modeLabel = cpu ? 'CPU' : 'GPU';
    this.emit('backend:starting', { message: `Starting image backend (${modeLabel})...`, path: this.comfyDir });

    return new Promise((resolve, reject) => {
      // Build command arguments
      const args = ['-s', this.mainPy, '--listen', '127.0.0.1', '--port', String(CONFIG.port)];
      
      // Add windows standalone flag if using embedded python
      if (this.pythonExe !== 'python' && existsSync(path.join(this.comfyDir, 'python_embeded'))) {
        args.push('--windows-standalone-build');
      }

      // CPU fallback mode
      if (cpu) {
        args.push('--cpu');
      }

      // Determine working directory
      const cwd = path.dirname(this.mainPy);
      
      console.log(`[ImageBackend] Starting: ${this.pythonExe} ${args.join(' ')}`);
      console.log(`[ImageBackend] Working dir: ${cwd}`);

      // Capture stdout/stderr so we can diagnose failures.
      // We still hide the console window on Windows.
      let capturedOutput = '';
      let capturedErrors = '';
      let processExited = false;
      let exitCode = null;

      try {
        this.process = spawn(this.pythonExe, args, {
          cwd: cwd,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES || '0',
          }
        });
      } catch (spawnError) {
        console.error('[ImageBackend] Failed to spawn process:', spawnError.message);
        this.emit('backend:error', { error: `Failed to start: ${spawnError.message}` });
        reject(new Error(`Failed to spawn ComfyUI: ${spawnError.message}`));
        return;
      }

      // Capture output for diagnostics (keep last 2000 chars)
      this.process.stdout?.on('data', (data) => {
        const text = data.toString();
        capturedOutput += text;
        if (capturedOutput.length > 2000) capturedOutput = capturedOutput.slice(-2000);
        // Log key lines
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && (trimmed.includes('Error') || trimmed.includes('error') || trimmed.includes('Starting') || trimmed.includes('ready') || trimmed.includes('http'))) {
            console.log('[ComfyUI]', trimmed);
          }
        }
      });

      this.process.stderr?.on('data', (data) => {
        const text = data.toString();
        capturedErrors += text;
        if (capturedErrors.length > 2000) capturedErrors = capturedErrors.slice(-2000);
        // Log errors
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            console.log('[ComfyUI stderr]', trimmed);
          }
        }
      });

      this.process.on('error', (err) => {
        console.error('[ImageBackend] Process error:', err);
        this.emit('backend:error', { error: err.message });
        processExited = true;
      });

      this.process.on('exit', (code, signal) => {
        processExited = true;
        exitCode = code;
        console.log(`[ImageBackend] Process exited: code=${code}, signal=${signal}`);
        this.process = null;
      });

      // Unref so the parent process can exit if needed
      this.process.unref();

      // Wait for ComfyUI to be ready (poll /system_stats)
      let attempts = 0;
      const maxAttempts = 120; // 120 seconds max (first load can be very slow)
      let settled = false;

      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(result);
      };

      const checkReady = async () => {
        if (settled) return;
        attempts++;

        // If the process crashed, fail immediately instead of waiting
        if (processExited) {
          const diagnosis = capturedErrors || capturedOutput || `Process exited with code ${exitCode}`;
          const shortDiag = diagnosis.length > 500 ? '...' + diagnosis.slice(-500) : diagnosis;
          console.error('[ImageBackend] Process died during startup. Output:', shortDiag);
          this.emit('backend:error', { error: `ComfyUI crashed during startup: ${shortDiag.split('\n').pop()}` });
          finish(new Error(
            `ComfyUI process exited (code ${exitCode}) before becoming ready.\n\n` +
            `Last output:\n${shortDiag}\n\n` +
            'Check that your GPU drivers are up to date and no other program is using port 8188.'
          ));
          return;
        }
        
        if (await this.checkRunning()) {
          console.log(`[ImageBackend] ComfyUI is ready after ${attempts}s`);
          this.emit('backend:ready', { message: 'Image backend ready!', port: CONFIG.port });
          finish(null, { success: true, port: CONFIG.port });
          return;
        }

        if (attempts >= maxAttempts) {
          const diagnosis = capturedErrors || capturedOutput || 'No output captured';
          const shortDiag = diagnosis.length > 500 ? '...' + diagnosis.slice(-500) : diagnosis;
          console.error('[ImageBackend] Startup timeout. Last output:', shortDiag);
          this.emit('backend:error', { error: `Startup timeout after ${maxAttempts}s` });
          // Kill the hung process
          try { if (this.process) this.process.kill(); } catch {}
          this.process = null;
          finish(new Error(
            `ComfyUI did not respond on port ${CONFIG.port} after ${maxAttempts} seconds.\n\n` +
            `Last output:\n${shortDiag}\n\n` +
            'Possible causes:\n' +
            '- Missing GPU drivers (install latest NVIDIA/AMD drivers)\n' +
            '- Port 8188 is in use by another program\n' +
            '- ComfyUI dependencies are missing (try reinstalling)\n' +
            '- Not enough VRAM or RAM for the selected model'
          ));
          return;
        }

        // Emit progress every 5 seconds
        if (attempts % 5 === 0) {
          this.emit('backend:starting', { message: `Starting ComfyUI... ${attempts}s`, progress: Math.min(Math.round((attempts / maxAttempts) * 100), 95) });
        }

        setTimeout(checkReady, 1000);
      };

      // Give ComfyUI a moment to initialize before first poll
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
   * Handles redirects (HuggingFace uses them), auth errors, and network failures gracefully.
   */
  downloadFile(url, destPath, onProgress, _redirectCount = 0) {
    const MAX_REDIRECTS = 10;
    
    return new Promise((resolve, reject) => {
      if (_redirectCount > MAX_REDIRECTS) {
        reject(new Error('Too many redirects - download URL may be invalid'));
        return;
      }

      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, {
        headers: { 'User-Agent': 'DevForge/1.0' },
        timeout: 30000, // 30s connection timeout
      }, (response) => {
        // Handle redirects (HuggingFace and others use 301/302/307/308)
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect with no location header'));
            return;
          }
          // Handle relative redirects
          const absoluteUrl = redirectUrl.startsWith('http') 
            ? redirectUrl 
            : new URL(redirectUrl, url).href;
          return this.downloadFile(absoluteUrl, destPath, onProgress, _redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }

        // Auth errors
        if (response.statusCode === 401 || response.statusCode === 403) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(
            `Download blocked (HTTP ${response.statusCode}). This model source may require authentication. ` +
            'All default models in DevForge use free HuggingFace downloads that require no login.'
          ));
          return;
        }

        // Other HTTP errors
        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(`Download failed: HTTP ${response.statusCode} - The download URL may be outdated or the server is temporarily unavailable.`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastPercent = 0;
        let lastProgressTime = Date.now();

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percent = totalSize ? Math.round((downloadedSize / totalSize) * 100) : 0;
          
          // Throttle progress updates to every 1% or every 500ms
          const now = Date.now();
          if ((percent > lastPercent || now - lastProgressTime > 500) && onProgress) {
            lastPercent = percent;
            lastProgressTime = now;
            const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(1);
            const totalMB = totalSize ? (totalSize / 1024 / 1024).toFixed(0) : '?';
            onProgress({ 
              percent, 
              downloaded: downloadedSize, 
              total: totalSize,
              message: `${downloadedMB} MB / ${totalMB} MB`
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          // Verify the file was actually written (not an empty/error page)
          try {
            const fileSize = statSync(destPath).size;
            if (fileSize < 1024 * 1024) { // Less than 1MB - probably an error page, not a model
              fs.unlinkSync(destPath);
              reject(new Error('Downloaded file is too small - the URL may be incorrect or the server returned an error page.'));
              return;
            }
          } catch {}
          resolve(destPath);
        });

        file.on('error', (err) => {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          reject(new Error(`File write error: ${err.message}`));
        });
      });

      request.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
          reject(new Error('No internet connection. Connect to the internet to download models (only needed once - after that, everything works offline).'));
        } else if (err.code === 'ECONNREFUSED') {
          reject(new Error('Connection refused. The download server may be temporarily down. Try again in a few minutes.'));
        } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
          reject(new Error('Download timed out. Check your internet connection and try again.'));
        } else {
          reject(new Error(`Download error: ${err.message}`));
        }
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error('Connection timed out. Check your internet connection and try again.'));
      });
    });
  }

  /**
   * Extract 7z archive (uses system 7-zip, searches common install locations)
   */
  async extractArchive(archivePath, destDir) {
    const sevenZipPath = this._find7Zip();
    
    if (sevenZipPath) {
      this.emit('install:extract', { message: 'Extracting files (this may take a few minutes)...', percent: 10 });
      
      return new Promise((resolve, reject) => {
        const proc = spawn(sevenZipPath, ['x', archivePath, `-o${destDir}`, '-y', '-bsp1'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        // Parse progress from stdout (7z outputs percentage with -bsp1)
        let lastPercent = 0;
        proc.stdout?.on('data', (data) => {
          const match = data.toString().match(/(\d+)%/);
          if (match) {
            const percent = parseInt(match[1], 10);
            if (percent > lastPercent) {
              lastPercent = percent;
              this.emit('install:extract', { message: `Extracting... ${percent}%`, percent });
            }
          }
        });

        proc.on('close', (code) => {
          if (code === 0) {
            this.emit('install:extract', { message: 'Extraction complete!', percent: 100 });
            resolve();
          } else {
            reject(new Error(`7-Zip extraction failed (exit code ${code}). The archive may be corrupted - try deleting it and running setup again.`));
          }
        });

        proc.on('error', (err) => {
          reject(new Error(`Failed to run 7-Zip: ${err.message}`));
        });
      });
    }

    // No 7-Zip found - provide a helpful error
    throw new Error(
      '7-Zip is required for first-time setup to extract ComfyUI.\n\n' +
      'Install it free from: https://7-zip.org/\n\n' +
      'After installing 7-Zip, click "One-Click Setup" again - DevForge will find it automatically.'
    );
  }

  /**
   * Find 7-Zip executable on the system
   */
  _find7Zip() {
    // Common install locations on Windows
    const searchPaths = [
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe',
      path.join(os.homedir(), 'AppData', 'Local', '7-Zip', '7z.exe'),
      path.join(os.homedir(), 'scoop', 'apps', '7zip', 'current', '7z.exe'),
      // Chocolatey installs
      'C:\\ProgramData\\chocolatey\\bin\\7z.exe',
      // WinGet/portable
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', '7-Zip', '7z.exe'),
    ];

    // Check PATH first (in case 7z is available globally)
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, '7z.exe');
      if (existsSync(candidate)) return candidate;
    }

    // Check known install locations
    for (const szPath of searchPaths) {
      if (existsSync(szPath)) return szPath;
    }

    // Also check all drive letters (D:\, E:\, etc.)
    for (const drive of ['D', 'E', 'F']) {
      const p = `${drive}:\\Program Files\\7-Zip\\7z.exe`;
      if (existsSync(p)) return p;
    }

    return null;
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
