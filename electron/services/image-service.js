/**
 * Image Generation Service
 * Provides a unified interface for image generation with multiple backends
 * Supports: ComfyUI, Automatic1111, Fooocus, and built-in simple generation
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');

// Supported backends with their default configurations
const BACKENDS = {
  comfyui: {
    name: 'ComfyUI',
    defaultPort: 8188,
    healthEndpoint: '/system_stats',
    modelsEndpoint: '/object_info/CheckpointLoaderSimple',
    generateEndpoint: '/prompt',
    historyEndpoint: '/history',
    installUrl: 'https://github.com/comfyanonymous/ComfyUI',
  },
  automatic1111: {
    name: 'Automatic1111',
    defaultPort: 7860,
    healthEndpoint: '/sdapi/v1/sd-models',
    modelsEndpoint: '/sdapi/v1/sd-models',
    generateEndpoint: '/sdapi/v1/txt2img',
    installUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
  },
  fooocus: {
    name: 'Fooocus',
    defaultPort: 7865,
    healthEndpoint: '/v1/generation/text-to-image',
    generateEndpoint: '/v1/generation/text-to-image',
    installUrl: 'https://github.com/lllyasviel/Fooocus',
  }
};

// Model presets for different architectures
const MODEL_PRESETS = {
  'sd15': {
    name: 'Stable Diffusion 1.5',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 20,
    defaultCfg: 7,
    samplers: ['euler_ancestral', 'euler', 'dpm++_2m', 'ddim'],
  },
  'sdxl': {
    name: 'Stable Diffusion XL',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 25,
    defaultCfg: 7,
    samplers: ['euler_ancestral', 'dpm++_2m_karras', 'dpm++_sde_karras'],
  },
  'flux': {
    name: 'Flux',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 20,
    defaultCfg: 1,
    samplers: ['euler'],
  },
  'sd3': {
    name: 'Stable Diffusion 3',
    defaultWidth: 1024,
    defaultHeight: 1024,
    defaultSteps: 28,
    defaultCfg: 4.5,
    samplers: ['euler', 'dpm++_2m'],
  }
};

class ImageService {
  constructor() {
    this.activeBackend = null;
    this.endpoint = 'http://localhost:8188';
    this.backendProcess = null;
    this.isInitialized = false;
    this.availableModels = [];
    this.activeJobs = new Map();
    this.outputDir = null;
  }

  /**
   * Initialize the image service
   */
  async initialize(config = {}) {
    this.endpoint = config.endpoint || 'http://localhost:8188';
    this.outputDir = config.outputDir || path.join(os.homedir(), 'Documents', 'DevForge', 'images');
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Try to detect running backend
    const status = await this.detectBackend();
    this.isInitialized = true;
    
    return status;
  }

  /**
   * Detect which backend is running
   */
  async detectBackend() {
    for (const [backendId, backend] of Object.entries(BACKENDS)) {
      const ports = [backend.defaultPort, 8188, 7860, 7865];
      
      for (const port of ports) {
        const endpoint = `http://localhost:${port}`;
        const isRunning = await this.checkHealth(endpoint, backend.healthEndpoint);
        
        if (isRunning) {
          this.activeBackend = backendId;
          this.endpoint = endpoint;
          console.log(`[ImageService] Detected ${backend.name} at ${endpoint}`);
          
          // Load available models
          await this.loadModels();
          
          return {
            running: true,
            backend: backendId,
            backendName: backend.name,
            endpoint: endpoint,
            models: this.availableModels
          };
        }
      }
    }

    return {
      running: false,
      backend: null,
      error: 'No image generation backend detected'
    };
  }

  /**
   * Check if a backend is healthy
   */
  async checkHealth(endpoint, healthPath) {
    return new Promise((resolve) => {
      const url = `${endpoint}${healthPath}`;
      const protocol = url.startsWith('https') ? https : http;
      
      const req = protocol.get(url, { timeout: 3000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Load available models from the backend
   */
  async loadModels() {
    if (!this.activeBackend) {
      this.availableModels = [];
      return [];
    }

    try {
      const backend = BACKENDS[this.activeBackend];
      const response = await this.makeRequest(`${this.endpoint}${backend.modelsEndpoint}`);
      
      if (this.activeBackend === 'comfyui') {
        // ComfyUI returns models in a specific format
        const models = response?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        this.availableModels = Array.isArray(models) ? models : [];
      } else if (this.activeBackend === 'automatic1111') {
        // A1111 returns an array of model objects
        this.availableModels = (response || []).map(m => m.model_name || m.title);
      } else {
        this.availableModels = [];
      }

      // Detect model types based on names
      this.availableModels = this.availableModels.map(model => ({
        name: model,
        type: this.detectModelType(model),
        preset: MODEL_PRESETS[this.detectModelType(model)] || MODEL_PRESETS.sd15
      }));

      return this.availableModels;
    } catch (error) {
      console.error('[ImageService] Failed to load models:', error);
      this.availableModels = [];
      return [];
    }
  }

  /**
   * Detect model type from filename
   */
  detectModelType(modelName) {
    const name = modelName.toLowerCase();
    
    if (name.includes('flux')) return 'flux';
    if (name.includes('sd3') || name.includes('sd_3')) return 'sd3';
    if (name.includes('sdxl') || name.includes('xl')) return 'sdxl';
    return 'sd15';
  }

  /**
   * Generate an image
   */
  async generate(params) {
    if (!this.activeBackend) {
      const status = await this.detectBackend();
      if (!status.running) {
        throw new Error('No image generation backend available. Please start ComfyUI or another backend.');
      }
    }

    const {
      prompt,
      negativePrompt = '',
      model,
      width = 512,
      height = 512,
      steps = 20,
      cfg = 7,
      sampler = 'euler_ancestral',
      seed = -1,
      batchSize = 1
    } = params;

    const actualSeed = seed === -1 ? Math.floor(Math.random() * 2147483647) : seed;

    if (this.activeBackend === 'comfyui') {
      return await this.generateComfyUI({
        prompt, negativePrompt, model, width, height, steps, cfg, sampler, seed: actualSeed, batchSize
      });
    } else if (this.activeBackend === 'automatic1111') {
      return await this.generateA1111({
        prompt, negativePrompt, model, width, height, steps, cfg, sampler, seed: actualSeed, batchSize
      });
    }

    throw new Error(`Unsupported backend: ${this.activeBackend}`);
  }

  /**
   * Generate using ComfyUI
   */
  async generateComfyUI(params) {
    const workflow = this.buildComfyUIWorkflow(params);
    
    const response = await this.makeRequest(`${this.endpoint}/prompt`, {
      method: 'POST',
      body: { prompt: workflow }
    });

    if (!response?.prompt_id) {
      throw new Error('Failed to submit generation request');
    }

    const promptId = response.prompt_id;
    this.activeJobs.set(promptId, { status: 'running', params });

    // Poll for completion
    const result = await this.pollComfyUIResult(promptId);
    this.activeJobs.delete(promptId);

    return result;
  }

  /**
   * Build ComfyUI workflow for different model types
   */
  buildComfyUIWorkflow(params) {
    const { prompt, negativePrompt, model, width, height, steps, cfg, sampler, seed, batchSize } = params;
    const modelType = this.detectModelType(model || '');

    // Standard SD 1.5 / SDXL workflow
    if (modelType === 'sd15' || modelType === 'sdxl') {
      return {
        "3": {
          "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler,
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
          "inputs": { "ckpt_name": model || "model.safetensors" },
          "class_type": "CheckpointLoaderSimple"
        },
        "5": {
          "inputs": { "width": width, "height": height, "batch_size": batchSize },
          "class_type": "EmptyLatentImage"
        },
        "6": {
          "inputs": { "text": prompt, "clip": ["4", 1] },
          "class_type": "CLIPTextEncode"
        },
        "7": {
          "inputs": { "text": negativePrompt || "bad quality, blurry", "clip": ["4", 1] },
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

    // Flux workflow (simplified - requires Flux nodes)
    if (modelType === 'flux') {
      return {
        "6": {
          "inputs": {
            "text": prompt,
            "clip": ["11", 0]
          },
          "class_type": "CLIPTextEncode"
        },
        "8": {
          "inputs": {
            "samples": ["13", 0],
            "vae": ["10", 0]
          },
          "class_type": "VAEDecode"
        },
        "9": {
          "inputs": {
            "filename_prefix": "DevForge_Flux",
            "images": ["8", 0]
          },
          "class_type": "SaveImage"
        },
        "10": {
          "inputs": {
            "vae_name": "ae.safetensors"
          },
          "class_type": "VAELoader"
        },
        "11": {
          "inputs": {
            "clip_name1": "t5xxl_fp16.safetensors",
            "clip_name2": "clip_l.safetensors",
            "type": "flux"
          },
          "class_type": "DualCLIPLoader"
        },
        "12": {
          "inputs": {
            "unet_name": model || "flux1-dev.safetensors",
            "weight_dtype": "default"
          },
          "class_type": "UNETLoader"
        },
        "13": {
          "inputs": {
            "noise": ["25", 0],
            "guider": ["22", 0],
            "sampler": ["16", 0],
            "sigmas": ["17", 0],
            "latent_image": ["27", 0]
          },
          "class_type": "SamplerCustomAdvanced"
        },
        "16": {
          "inputs": { "sampler_name": "euler" },
          "class_type": "KSamplerSelect"
        },
        "17": {
          "inputs": {
            "scheduler": "simple",
            "steps": steps,
            "denoise": 1,
            "model": ["12", 0]
          },
          "class_type": "BasicScheduler"
        },
        "22": {
          "inputs": {
            "model": ["12", 0],
            "conditioning": ["6", 0]
          },
          "class_type": "BasicGuider"
        },
        "25": {
          "inputs": { "noise_seed": seed },
          "class_type": "RandomNoise"
        },
        "27": {
          "inputs": { "width": width, "height": height, "batch_size": batchSize },
          "class_type": "EmptySD3LatentImage"
        }
      };
    }

    // Default to SD 1.5 workflow
    return this.buildComfyUIWorkflow({ ...params, model: model });
  }

  /**
   * Poll ComfyUI for generation result
   */
  async pollComfyUIResult(promptId, maxWaitMs = 300000) {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const history = await this.makeRequest(`${this.endpoint}/history/${promptId}`);
        
        if (history && history[promptId]) {
          const result = history[promptId];
          
          if (result.status?.completed) {
            // Extract output images
            const outputs = result.outputs || {};
            const images = [];
            
            for (const nodeOutput of Object.values(outputs)) {
              if (nodeOutput.images) {
                for (const img of nodeOutput.images) {
                  images.push({
                    filename: img.filename,
                    subfolder: img.subfolder || '',
                    type: img.type || 'output',
                    url: `${this.endpoint}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`
                  });
                }
              }
            }

            return {
              success: true,
              promptId,
              images,
              executionTime: Date.now() - startTime
            };
          }

          if (result.status?.status_str === 'error') {
            throw new Error(result.status.messages?.[0] || 'Generation failed');
          }
        }
      } catch (error) {
        if (error.message !== 'Generation failed') {
          console.error('[ImageService] Poll error:', error.message);
        } else {
          throw error;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Generation timed out');
  }

  /**
   * Generate using Automatic1111
   */
  async generateA1111(params) {
    const { prompt, negativePrompt, model, width, height, steps, cfg, sampler, seed, batchSize } = params;

    const payload = {
      prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
      cfg_scale: cfg,
      sampler_name: this.mapSamplerToA1111(sampler),
      seed,
      batch_size: batchSize,
      override_settings: model ? { sd_model_checkpoint: model } : undefined
    };

    const response = await this.makeRequest(`${this.endpoint}/sdapi/v1/txt2img`, {
      method: 'POST',
      body: payload,
      timeout: 300000
    });

    if (!response?.images?.length) {
      throw new Error('No images generated');
    }

    // Save images to disk and return URLs
    const images = [];
    for (let i = 0; i < response.images.length; i++) {
      const base64Data = response.images[i];
      const filename = `devforge_${Date.now()}_${i}.png`;
      const filepath = path.join(this.outputDir, filename);
      
      fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
      
      images.push({
        filename,
        filepath,
        url: `file://${filepath}`
      });
    }

    return {
      success: true,
      images,
      info: response.info ? JSON.parse(response.info) : null
    };
  }

  /**
   * Map sampler names between backends
   */
  mapSamplerToA1111(sampler) {
    const mapping = {
      'euler_ancestral': 'Euler a',
      'euler': 'Euler',
      'dpm++_2m': 'DPM++ 2M',
      'dpm++_2m_karras': 'DPM++ 2M Karras',
      'dpm++_sde_karras': 'DPM++ SDE Karras',
      'ddim': 'DDIM'
    };
    return mapping[sampler] || sampler;
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
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        timeout: options.timeout || 30000
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
   * Get current status
   */
  async getStatus() {
    const health = this.activeBackend 
      ? await this.checkHealth(this.endpoint, BACKENDS[this.activeBackend].healthEndpoint)
      : false;

    return {
      initialized: this.isInitialized,
      running: health,
      backend: this.activeBackend,
      backendName: this.activeBackend ? BACKENDS[this.activeBackend].name : null,
      endpoint: this.endpoint,
      models: this.availableModels,
      activeJobs: this.activeJobs.size,
      outputDir: this.outputDir
    };
  }

  /**
   * Get available models with their presets
   */
  getModels() {
    return this.availableModels;
  }

  /**
   * Get model presets
   */
  getModelPresets() {
    return MODEL_PRESETS;
  }

  /**
   * Cancel a running job
   */
  async cancelJob(promptId) {
    if (this.activeBackend === 'comfyui') {
      try {
        await this.makeRequest(`${this.endpoint}/interrupt`, { method: 'POST' });
        this.activeJobs.delete(promptId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: 'Cancel not supported for this backend' };
  }

  /**
   * Get setup instructions for backends
   */
  getSetupInstructions() {
    return {
      comfyui: {
        name: 'ComfyUI',
        description: 'Powerful node-based image generation',
        steps: [
          'Download ComfyUI from GitHub',
          'Extract to a folder (e.g., C:\\ComfyUI)',
          'Download a model (SD 1.5, SDXL, or Flux) and place in models/checkpoints',
          'Run run_nvidia_gpu.bat (or run_cpu.bat)',
          'DevForge will auto-detect when running'
        ],
        downloadUrl: 'https://github.com/comfyanonymous/ComfyUI/releases',
        modelsUrl: 'https://civitai.com/'
      },
      automatic1111: {
        name: 'Automatic1111 WebUI',
        description: 'Popular Stable Diffusion interface',
        steps: [
          'Download from GitHub',
          'Run webui-user.bat',
          'Add --api flag for DevForge integration',
          'Download models to models/Stable-diffusion'
        ],
        downloadUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui'
      }
    };
  }
}

// Singleton instance
let imageServiceInstance = null;

function getImageService() {
  if (!imageServiceInstance) {
    imageServiceInstance = new ImageService();
  }
  return imageServiceInstance;
}

module.exports = {
  ImageService,
  getImageService,
  MODEL_PRESETS,
  BACKENDS
};
















