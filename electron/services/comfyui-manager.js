/**
 * ComfyUI Manager - Handles installation, startup, and model management
 * Provides fully offline, unrestricted image generation capability
 * NO CONTENT FILTERS - Adult/NSFW friendly
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { promisify } = require('util');
const { pipeline } = require('stream');
const { createWriteStream, createReadStream } = require('fs');
// unzipper is optional - if not installed, zip extraction falls back to 7z/tar commands
let Extract = null;
try {
  Extract = require('unzipper').Extract;
} catch (_) {
  // unzipper not installed - will use command-line extraction instead
}

const streamPipeline = promisify(pipeline);
const execAsync = promisify(exec);

// Configuration
const COMFYUI_RELEASE_URL = 'https://github.com/comfyanonymous/ComfyUI/releases/download/latest/ComfyUI_windows_portable_nvidia.7z';
const COMFYUI_RELEASE_CPU = 'https://github.com/comfyanonymous/ComfyUI/releases/download/latest/ComfyUI_windows_portable.7z';

// Open-source models - ALL hosted on HuggingFace (free, no login, no API keys)
const UNRESTRICTED_MODELS = {
  sd15: [
    {
      id: 'dreamshaper_8',
      name: 'DreamShaper 8',
      description: 'Dreamy artistic style, versatile, great for most prompts',
      downloadUrl: 'https://huggingface.co/jzli/DreamShaper-8/resolve/main/dreamshaper_8.safetensors',
      filename: 'dreamshaper_8.safetensors',
      size: '2.1 GB',
      nsfw: true,
      type: 'checkpoint'
    },
    {
      id: 'realisticVisionV60',
      name: 'Realistic Vision 6.0',
      description: 'Photorealistic images, people, landscapes',
      downloadUrl: 'https://huggingface.co/Cristiants/comfyui/resolve/main/checkpoints/realistic-vision-v60-b1.safetensors',
      filename: 'realistic_vision_v60.safetensors',
      size: '2.1 GB',
      nsfw: true,
      type: 'checkpoint'
    },
    {
      id: 'sd_v15',
      name: 'Stable Diffusion 1.5',
      description: 'The original classic - huge community, works with all LoRAs',
      downloadUrl: 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors',
      filename: 'sd_v1-5-pruned-emaonly.safetensors',
      size: '4.27 GB',
      nsfw: true,
      type: 'checkpoint'
    }
  ],
  sdxl: [
    {
      id: 'sdxl_base',
      name: 'SDXL 1.0 Base',
      description: 'Official SDXL base model - highest quality, needs 8GB+ VRAM',
      downloadUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
      filename: 'sd_xl_base_1.0.safetensors',
      size: '6.94 GB',
      nsfw: true,
      type: 'checkpoint',
      requirements: { vram: 8192 }
    }
  ],
  flux: [
    {
      id: 'flux1_dev',
      name: 'Flux.1 Dev',
      description: 'Cutting-edge image quality - needs 16GB+ VRAM',
      downloadUrl: 'https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors',
      filename: 'flux1-dev.safetensors',
      size: '24 GB',
      nsfw: true,
      type: 'unet',
      requirements: {
        vram: 16384,
        extraFiles: ['ae.safetensors', 't5xxl_fp16.safetensors', 'clip_l.safetensors']
      }
    }
  ],
  vae: [
    {
      id: 'sdxl_vae',
      name: 'SDXL VAE',
      description: 'Optimized VAE for SDXL models',
      downloadUrl: 'https://huggingface.co/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors',
      filename: 'sdxl_vae.safetensors',
      size: '335 MB',
      type: 'vae'
    }
  ]
};

class ComfyUIManager {
  constructor() {
    this.comfyPath = null;
    this.comfyProcess = null;
    this.isRunning = false;
    this.port = 8188;
    this.installDir = path.join(os.homedir(), 'DevForge', 'ComfyUI');
    this.modelsDir = null;
    this.outputDir = null;
    this.downloadProgress = new Map();
    this.eventCallback = null;
  }

  /**
   * Set event callback for progress updates
   */
  onEvent(callback) {
    this.eventCallback = callback;
  }

  emit(event, data) {
    if (this.eventCallback) {
      this.eventCallback(event, data);
    }
  }

  /**
   * Get installation status
   */
  async getStatus() {
    const installed = await this.isInstalled();
    const running = await this.checkRunning();
    const models = installed ? await this.getInstalledModels() : [];
    
    return {
      installed,
      running,
      port: this.port,
      path: this.comfyPath,
      models,
      modelsDir: this.modelsDir,
      outputDir: this.outputDir,
      availableModels: UNRESTRICTED_MODELS,
      downloadProgress: Object.fromEntries(this.downloadProgress)
    };
  }

  /**
   * Check if ComfyUI is installed
   */
  async isInstalled() {
    // Check default paths including common download locations
    const possiblePaths = [
      this.installDir,
      path.join(os.homedir(), 'ComfyUI'),
      path.join(os.homedir(), 'Downloads', 'ComfyUI'),
      path.join(os.homedir(), 'Downloads', 'ComfyUI_windows_portable'),
      path.join(os.homedir(), 'Downloads', 'devforge', 'ComfyUI', 'ComfyUI_windows_portable'),
      path.join(os.homedir(), 'Downloads', 'devforge', 'ComfyUI'),
      'C:\\ComfyUI',
      'C:\\AI\\ComfyUI',
      path.join(os.homedir(), 'Documents', 'ComfyUI'),
    ];

    for (const p of possiblePaths) {
      const mainPy = path.join(p, 'main.py');
      const runBat = path.join(p, 'run_nvidia_gpu.bat');
      const runCmd = path.join(p, 'run_cpu.bat');
      
      if (fs.existsSync(mainPy) || fs.existsSync(runBat) || fs.existsSync(runCmd)) {
        this.comfyPath = p;
        this.modelsDir = path.join(p, 'models');
        this.outputDir = path.join(p, 'output');
        return true;
      }
    }

    return false;
  }

  /**
   * Check if ComfyUI is running
   */
  async checkRunning() {
    try {
      const response = await this.makeRequest(`http://localhost:${this.port}/system_stats`, { timeout: 2000 });
      this.isRunning = !!response;
      return this.isRunning;
    } catch {
      this.isRunning = false;
      return false;
    }
  }

  /**
   * Install ComfyUI (downloads portable version)
   */
  async install(options = {}) {
    const { useGPU = true, progressCallback } = options;
    
    this.emit('install:start', { message: 'Starting ComfyUI installation...' });
    
    try {
      // Create install directory
      if (!fs.existsSync(this.installDir)) {
        fs.mkdirSync(this.installDir, { recursive: true });
      }

      // For Windows, we'll guide the user to download the portable version
      // For now, create the directory structure and provide instructions
      
      this.emit('install:progress', { 
        message: 'Creating directory structure...',
        percent: 10 
      });

      // Create model directories
      const dirs = [
        'models/checkpoints',
        'models/loras',
        'models/vae',
        'models/controlnet',
        'models/embeddings',
        'models/upscale_models',
        'models/clip',
        'models/unet',
        'output',
        'input',
        'custom_nodes'
      ];

      for (const dir of dirs) {
        const fullPath = path.join(this.installDir, dir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      }

      this.emit('install:progress', { 
        message: 'Directories created. Please download ComfyUI portable...',
        percent: 100,
        requiresManualDownload: true,
        downloadUrl: useGPU ? COMFYUI_RELEASE_URL : COMFYUI_RELEASE_CPU,
        installPath: this.installDir
      });

      this.comfyPath = this.installDir;
      this.modelsDir = path.join(this.installDir, 'models');
      this.outputDir = path.join(this.installDir, 'output');

      return {
        success: true,
        path: this.installDir,
        requiresManualDownload: true,
        instructions: [
          '1. Download ComfyUI portable from the GitHub releases page',
          '2. Extract to: ' + this.installDir,
          '3. Download an image model (see Model Hub)',
          '4. Run DevForge - it will auto-detect ComfyUI'
        ]
      };
    } catch (error) {
      this.emit('install:error', { error: error.message });
      throw error;
    }
  }

  /**
   * Download a model file
   */
  async downloadModel(model, progressCallback) {
    const modelId = model.id || model.name;
    this.emit('download:start', { modelId, model });
    
    // Try to detect installation if modelsDir is not set
    if (!this.modelsDir) {
      await this.isInstalled();
    }
    
    if (!this.modelsDir) {
      // Create default models directory
      this.modelsDir = path.join(this.installDir, 'models');
    }

    // Determine target directory based on model type
    let targetDir;
    switch (model.type) {
      case 'checkpoint':
        targetDir = path.join(this.modelsDir, 'checkpoints');
        break;
      case 'lora':
        targetDir = path.join(this.modelsDir, 'loras');
        break;
      case 'vae':
        targetDir = path.join(this.modelsDir, 'vae');
        break;
      case 'unet':
        targetDir = path.join(this.modelsDir, 'unet');
        break;
      case 'clip':
        targetDir = path.join(this.modelsDir, 'clip');
        break;
      default:
        targetDir = path.join(this.modelsDir, 'checkpoints');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, model.filename);

    // Check if already exists
    if (fs.existsSync(targetPath)) {
      this.emit('download:exists', { modelId, path: targetPath });
      return { success: true, path: targetPath, alreadyExists: true };
    }

    // Download with progress
    try {
      await this.downloadFile(model.downloadUrl, targetPath, (progress) => {
        this.downloadProgress.set(modelId, progress);
        this.emit('download:progress', { modelId, ...progress });
        if (progressCallback) progressCallback(progress);
      });

      this.downloadProgress.delete(modelId);
      this.emit('download:complete', { modelId, path: targetPath });
      
      return { success: true, path: targetPath };
    } catch (error) {
      this.downloadProgress.delete(modelId);
      this.emit('download:error', { modelId, error: error.message });
      throw error;
    }
  }

  /**
   * Download file with progress tracking
   */
  async downloadFile(url, targetPath, progressCallback, _redirectCount = 0) {
    const MAX_REDIRECTS = 10;
    
    return new Promise((resolve, reject) => {
      if (_redirectCount > MAX_REDIRECTS) {
        reject(new Error('Too many redirects - download URL may be invalid'));
        return;
      }

      const file = createWriteStream(targetPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, {
        headers: { 'User-Agent': 'DevForge/1.0' },
        timeout: 30000,
      }, (response) => {
        // Handle redirects (HuggingFace uses 301/302/307/308)
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          file.close();
          try { fs.unlinkSync(targetPath); } catch {}
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect with no location header'));
            return;
          }
          const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).href;
          return this.downloadFile(absoluteUrl, targetPath, progressCallback, _redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }

        // Auth errors
        if (response.statusCode === 401 || response.statusCode === 403) {
          file.close();
          try { fs.unlinkSync(targetPath); } catch {}
          reject(new Error(`Download blocked (HTTP ${response.statusCode}). This model may require authentication.`));
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(targetPath); } catch {}
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastProgress = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percent = totalSize ? Math.round((downloadedSize / totalSize) * 100) : 0;
          
          if (percent > lastProgress) {
            lastProgress = percent;
            const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(1);
            const totalMB = totalSize ? (totalSize / 1024 / 1024).toFixed(0) : '?';
            progressCallback({
              percent,
              downloaded: downloadedSize,
              total: totalSize,
              message: `${downloadedMB} MB / ${totalMB} MB`,
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(targetPath);
        });

        file.on('error', (err) => {
          file.close();
          try { fs.unlinkSync(targetPath); } catch {}
          reject(err);
        });
      });

      request.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(targetPath); } catch {}
        if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
          reject(new Error('No internet connection. Connect to the internet to download models.'));
        } else {
          reject(new Error(`Download error: ${err.message}`));
        }
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Get list of installed models
   */
  async getInstalledModels() {
    if (!this.modelsDir || !fs.existsSync(this.modelsDir)) {
      return [];
    }

    const models = [];
    const checkpointsDir = path.join(this.modelsDir, 'checkpoints');
    const lorasDir = path.join(this.modelsDir, 'loras');
    const vaeDir = path.join(this.modelsDir, 'vae');

    // Scan checkpoints
    if (fs.existsSync(checkpointsDir)) {
      const files = fs.readdirSync(checkpointsDir);
      for (const file of files) {
        if (file.endsWith('.safetensors') || file.endsWith('.ckpt')) {
          const stats = fs.statSync(path.join(checkpointsDir, file));
          models.push({
            name: file,
            type: 'checkpoint',
            path: path.join(checkpointsDir, file),
            size: stats.size,
            modelType: this.detectModelType(file)
          });
        }
      }
    }

    // Scan LoRAs
    if (fs.existsSync(lorasDir)) {
      const files = fs.readdirSync(lorasDir);
      for (const file of files) {
        if (file.endsWith('.safetensors')) {
          const stats = fs.statSync(path.join(lorasDir, file));
          models.push({
            name: file,
            type: 'lora',
            path: path.join(lorasDir, file),
            size: stats.size
          });
        }
      }
    }

    // Scan VAE
    if (fs.existsSync(vaeDir)) {
      const files = fs.readdirSync(vaeDir);
      for (const file of files) {
        if (file.endsWith('.safetensors')) {
          const stats = fs.statSync(path.join(vaeDir, file));
          models.push({
            name: file,
            type: 'vae',
            path: path.join(vaeDir, file),
            size: stats.size
          });
        }
      }
    }

    return models;
  }

  /**
   * Detect model architecture from filename
   */
  detectModelType(filename) {
    const name = filename.toLowerCase();
    if (name.includes('flux')) return 'flux';
    if (name.includes('sd3') || name.includes('sd_3')) return 'sd3';
    if (name.includes('sdxl') || name.includes('xl') || name.includes('pony')) return 'sdxl';
    return 'sd15';
  }

  /**
   * Start ComfyUI backend
   */
  async start() {
    if (this.isRunning) {
      return { success: true, message: 'Already running' };
    }

    if (!this.comfyPath) {
      const installed = await this.isInstalled();
      if (!installed) {
        throw new Error('ComfyUI not installed. Install it first via the Model Hub.');
      }
    }

    this.emit('backend:starting', { path: this.comfyPath });

    // Find the right startup script/command
    const isWindows = process.platform === 'win32';
    let startCommand;

    if (isWindows) {
      // Try different Windows startup options
      const runNvidia = path.join(this.comfyPath, 'run_nvidia_gpu.bat');
      const runCpu = path.join(this.comfyPath, 'run_cpu.bat');
      const pythonMain = path.join(this.comfyPath, 'python_embeded', 'python.exe');
      
      if (fs.existsSync(runNvidia)) {
        startCommand = { cmd: runNvidia, args: [], shell: true };
      } else if (fs.existsSync(runCpu)) {
        startCommand = { cmd: runCpu, args: [], shell: true };
      } else if (fs.existsSync(pythonMain)) {
        startCommand = { 
          cmd: pythonMain, 
          args: [path.join(this.comfyPath, 'main.py'), '--listen', '127.0.0.1', '--port', String(this.port)],
          shell: false 
        };
      } else {
        // Try system Python
        startCommand = { 
          cmd: 'python', 
          args: [path.join(this.comfyPath, 'main.py'), '--listen', '127.0.0.1', '--port', String(this.port)],
          shell: true 
        };
      }
    } else {
      // Linux/Mac
      startCommand = { 
        cmd: 'python3', 
        args: [path.join(this.comfyPath, 'main.py'), '--listen', '127.0.0.1', '--port', String(this.port)],
        shell: false 
      };
    }

    return new Promise((resolve, reject) => {
      try {
        const opts = {
          cwd: this.comfyPath,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          shell: startCommand.shell
        };

        this.comfyProcess = spawn(startCommand.cmd, startCommand.args, opts);
        this.comfyProcess.unref();

        // Wait for it to start
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds max
        
        const checkInterval = setInterval(async () => {
          attempts++;
          
          const running = await this.checkRunning();
          if (running) {
            clearInterval(checkInterval);
            this.emit('backend:started', { port: this.port });
            resolve({ success: true, port: this.port });
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            this.emit('backend:error', { error: 'Startup timeout' });
            reject(new Error('ComfyUI failed to start within 30 seconds'));
          }
        }, 1000);

      } catch (error) {
        this.emit('backend:error', { error: error.message });
        reject(error);
      }
    });
  }

  /**
   * Stop ComfyUI backend
   */
  async stop() {
    if (!this.isRunning) {
      return { success: true };
    }

    try {
      // Send interrupt to ComfyUI
      await this.makeRequest(`http://localhost:${this.port}/interrupt`, { 
        method: 'POST',
        timeout: 2000 
      });
    } catch {
      // Ignore - might not respond
    }

    // Kill any running ComfyUI processes
    if (process.platform === 'win32') {
      try {
        await execAsync('taskkill /F /IM "python.exe" /FI "WINDOWTITLE eq ComfyUI*"');
      } catch {
        // Process might not exist
      }
    }

    this.isRunning = false;
    this.comfyProcess = null;
    this.emit('backend:stopped', {});
    
    return { success: true };
  }

  /**
   * Make HTTP request
   */
  makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);
      
      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 5000
      };

      const req = protocol.request(reqOptions, (res) => {
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
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  /**
   * Get available NSFW-friendly models for download
   */
  getAvailableModels() {
    return UNRESTRICTED_MODELS;
  }

  /**
   * Get setup instructions
   */
  getSetupInstructions() {
    return {
      title: 'Image Generation Setup',
      description: 'DevForge uses ComfyUI for local, offline, unrestricted image generation.',
      steps: [
        {
          step: 1,
          title: 'Install ComfyUI',
          description: 'Download the portable version of ComfyUI',
          action: 'install',
          links: {
            nvidia: COMFYUI_RELEASE_URL,
            cpu: COMFYUI_RELEASE_CPU
          }
        },
        {
          step: 2,
          title: 'Download a Model',
          description: 'Get an image generation model. We recommend starting with a SDXL model for quality.',
          action: 'downloadModel',
          recommended: UNRESTRICTED_MODELS.sdxl[0]
        },
        {
          step: 3,
          title: 'Start Generating',
          description: 'ComfyUI will auto-start when you generate images. Full NSFW support, no filters.',
          action: 'generate'
        }
      ],
      notes: [
        '✓ Completely offline - no internet required after setup',
        '✓ No content filters or restrictions',
        '✓ Your images stay on your machine',
        '✓ Supports SD 1.5, SDXL, Flux, and more'
      ]
    };
  }
}

// Singleton
let comfyManagerInstance = null;

function getComfyUIManager() {
  if (!comfyManagerInstance) {
    comfyManagerInstance = new ComfyUIManager();
  }
  return comfyManagerInstance;
}

module.exports = {
  ComfyUIManager,
  getComfyUIManager,
  UNRESTRICTED_MODELS
};
