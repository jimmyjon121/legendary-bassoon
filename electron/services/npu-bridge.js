/**
 * NPU Bridge Service
 * Bridge to OpenVINO for Intel NPU acceleration
 * 
 * This service detects OpenVINO installation and NPU availability,
 * and provides a bridge to the OpenVINO inference server when available.
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

class NpuBridge {
  constructor() {
    this.openvinoInstalled = false;
    this.npuAvailable = false;
    this.openvinoPath = null;
    this.pythonExecutable = 'python';
    this.serverProcess = null;
    this.serverEndpoint = 'http://localhost:8081';
    this.devices = [];
  }

  /**
   * Check if OpenVINO is installed
   */
  async checkOpenVinoInstallation() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        resolve({ installed: false, reason: 'Not Windows' });
        return;
      }

      // First, prefer the bundled DevForge virtualenv if it exists
      try {
        const projectRoot = path.join(__dirname, '..', '..');
        const envPath = path.join(projectRoot, 'openvino-env');
        const envPython = path.join(envPath, 'Scripts', 'python.exe');
        const openvinoPackageDir = path.join(
          envPath,
          'Lib',
          'site-packages',
          'openvino'
        );

        if (fs.existsSync(envPython) && fs.existsSync(openvinoPackageDir)) {
          this.openvinoPath = envPath;
          this.openvinoInstalled = true;
          this.pythonExecutable = envPython;

          resolve({
            installed: true,
            path: envPath,
            version: this.extractVersionFromEnv(envPath) || 'env'
          });
          return;
        }
      } catch (e) {
        // If the local env check fails, fall back to global detection
      }

      // Check common global OpenVINO installation paths
      const possiblePaths = [
        'C:\\Program Files (x86)\\Intel\\openvino_2024',
        'C:\\Program Files (x86)\\Intel\\openvino_2023',
        'C:\\Program Files\\Intel\\openvino_2024',
        'C:\\Program Files\\Intel\\openvino_2023',
        process.env.INTEL_OPENVINO_DIR,
        process.env.OPENVINO_DIR
      ].filter(Boolean);

      for (const basePath of possiblePaths) {
        const setupvarsPath = path.join(basePath, 'setupvars.bat');
        if (fs.existsSync(setupvarsPath)) {
          this.openvinoPath = basePath;
          this.openvinoInstalled = true;
          this.pythonExecutable = 'python';
          resolve({ 
            installed: true, 
            path: basePath,
            version: this.extractVersion(basePath)
          });
          return;
        }
      }

      // Try to find via PATH
      exec('where openvino', { timeout: 5000 }, (error, stdout) => {
        if (!error && stdout.trim()) {
          const openvinoExe = stdout.trim().split('\n')[0];
          this.openvinoPath = path.dirname(path.dirname(openvinoExe));
          this.openvinoInstalled = true;
          this.pythonExecutable = 'python';
          resolve({ installed: true, path: this.openvinoPath });
        } else {
          resolve({ installed: false, reason: 'OpenVINO not found' });
        }
      });
    });
  }

  /**
   * Extract OpenVINO version from path
   */
  extractVersion(basePath) {
    const match = basePath.match(/openvino_(\d+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Extract OpenVINO version from the bundled virtualenv (if present)
   */
  extractVersionFromEnv(envPath) {
    try {
      const sitePackages = path.join(envPath, 'Lib', 'site-packages');
      const entries = fs.readdirSync(sitePackages);
      const distInfo = entries.find((name) =>
        name.toLowerCase().startsWith('openvino-') &&
        name.toLowerCase().endsWith('.dist-info')
      );
      if (!distInfo) return null;
      const metaPath = path.join(sitePackages, distInfo, 'METADATA');
      if (!fs.existsSync(metaPath)) return null;
      const metadata = fs.readFileSync(metaPath, 'utf-8');
      const versionLine = metadata
        .split('\n')
        .find((line) => line.startsWith('Version:'));
      return versionLine ? versionLine.split(':')[1].trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Query available OpenVINO devices
   */
  async queryDevices() {
    if (!this.openvinoInstalled) {
      await this.checkOpenVinoInstallation();
    }

    if (!this.openvinoInstalled) {
      return { devices: [], error: 'OpenVINO not installed' };
    }

    return new Promise((resolve) => {
      // Use Python to query devices (OpenVINO Python API)
      const pythonScript = `
import sys
try:
    from openvino import Core
    core = Core()
    devices = core.available_devices
    for device in devices:
        props = {}
        try:
            props['full_name'] = core.get_property(device, 'FULL_DEVICE_NAME')
        except:
            props['full_name'] = device
        print(f"{device}|{props['full_name']}")
except ImportError:
    print("ERROR|OpenVINO Python not installed")
except Exception as e:
    print(f"ERROR|{str(e)}")
`;

      const pythonCmd = this.pythonExecutable || 'python';

      const python = spawn(pythonCmd, ['-c', pythonScript], {
        timeout: 10000,
        windowsHide: true
      });

      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (data) => {
        output += data.toString();
      });

      python.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0 || output.includes('ERROR|')) {
          resolve({ 
            devices: [], 
            error: output.includes('ERROR|') 
              ? output.split('ERROR|')[1]?.trim() 
              : errorOutput || 'Failed to query devices'
          });
          return;
        }

        const devices = output.trim().split('\n')
          .filter(line => line.includes('|'))
          .map(line => {
            const [id, name] = line.split('|');
            return { id: id.trim(), name: name.trim() };
          });

        this.devices = devices;
        this.npuAvailable = devices.some(d => d.id === 'NPU');

        resolve({ devices, npuAvailable: this.npuAvailable });
      });

      python.on('error', (error) => {
        resolve({ devices: [], error: `Python not available: ${error.message}` });
      });
    });
  }

  /**
   * Check if NPU is available
   */
  async checkNpuAvailable() {
    const result = await this.queryDevices();
    return {
      available: result.npuAvailable || false,
      devices: result.devices || [],
      error: result.error
    };
  }

  /**
   * Get full status of OpenVINO/NPU setup
   */
  async getStatus() {
    const installation = await this.checkOpenVinoInstallation();
    
    if (!installation.installed) {
      return {
        openvinoInstalled: false,
        npuAvailable: false,
        serverRunning: false,
        error: installation.reason,
        setupRequired: true
      };
    }

    const devices = await this.queryDevices();

    return {
      openvinoInstalled: true,
      openvinoPath: this.openvinoPath,
      openvinoVersion: installation.version,
      npuAvailable: devices.npuAvailable || false,
      devices: devices.devices || [],
      serverRunning: await this.checkServerHealth(),
      setupRequired: false
    };
  }

  /**
   * Check if OpenVINO inference server is running
   */
  async checkServerHealth() {
    return new Promise((resolve) => {
      // Use /status endpoint which doesn't require model to be loaded
      const req = http.get(`${this.serverEndpoint}/status`, { timeout: 2000 }, (res) => {
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
   * Configure a model for NPU inference
   */
  async configureModel(modelPath, options = {}) {
    const configPath = path.join(__dirname, '../../scripts/openvino-model.json');
    
    const config = {
      model_path: modelPath,
      tokenizer: options.tokenizer || modelPath,
      device: options.device || 'NPU',
      precision: options.precision || 'fp16'
    };
    
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[NpuBridge] Model configured:', config);
      return { success: true, config };
    } catch (error) {
      console.error('[NpuBridge] Failed to configure model:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Auto-configure a suitable model for NPU inference
   * This will find or download a small, efficient model optimized for NPU
   */
  async autoConfigureModel(options = {}) {
    console.log('[NpuBridge] Auto-configuring NPU model...');
    
    const configPath = path.join(__dirname, '../../scripts/openvino-model.json');
    
    // Check if already configured with a valid model
    try {
      if (fs.existsSync(configPath)) {
        const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (existing.model_path && existing.model_path.trim() !== '') {
          console.log('[NpuBridge] Model already configured:', existing.model_path);
          
          // Update auto_start setting if requested
          if (options.enableAutoStart !== undefined) {
            existing.auto_start = options.enableAutoStart;
            fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
          }
          
          return { configured: true, model: existing.model_path, existing: true };
        }
      }
    } catch (e) {
      // Config doesn't exist or is invalid, continue with auto-config
    }

    // List of small, efficient models that work well on NPU
    // These are HuggingFace model IDs that optimum-intel can auto-convert
    const recommendedModels = [
      // Tiny models for quick testing
      'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      'microsoft/phi-2',
      'Qwen/Qwen2-0.5B-Instruct',
      // Small efficient models
      'stabilityai/stablelm-2-zephyr-1_6b',
      'HuggingFaceTB/SmolLM-360M-Instruct',
    ];

    // For now, configure with a recommended model
    // The model will be downloaded on first use by optimum-intel
    const selectedModel = recommendedModels[0]; // TinyLlama is a good default
    
    const config = {
      model_path: selectedModel,
      tokenizer: selectedModel,
      device: 'NPU',
      precision: 'fp16',
      auto_start: options.enableAutoStart !== false // Enable auto-start by default
    };
    
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[NpuBridge] Auto-configured model:', selectedModel);
      return { 
        configured: true, 
        model: selectedModel, 
        existing: false,
        autoStart: config.auto_start,
        note: 'Model will be downloaded and converted on first inference request'
      };
    } catch (error) {
      console.error('[NpuBridge] Failed to auto-configure model:', error);
      return { configured: false, error: error.message };
    }
  }

  /**
   * Set whether NPU server should auto-start on app launch
   */
  async setAutoStart(enabled) {
    const configPath = path.join(__dirname, '../../scripts/openvino-model.json');
    
    try {
      let config = { auto_start: enabled };
      
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.auto_start = enabled;
      }
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('[NpuBridge] Auto-start set to:', enabled);
      return { success: true, autoStart: enabled };
    } catch (error) {
      console.error('[NpuBridge] Failed to set auto-start:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Load a model via the API (if server is running)
   */
  async loadModel(modelPath, options = {}) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model_path: modelPath,
        tokenizer: options.tokenizer || modelPath,
        device: options.device || 'NPU',
        precision: options.precision || 'fp16'
      });

      const req = http.request(`${this.serverEndpoint}/models/load`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 120000 // 2 minutes for model loading
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ success: res.statusCode === 200, data: JSON.parse(data) });
          } catch {
            resolve({ success: false, error: data });
          }
        });
      });

      req.on('error', (error) => resolve({ success: false, error: error.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Model load timeout' });
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Start the OpenVINO inference server
   * Note: This requires the Python server script to be set up
   */
  async startServer(options = {}) {
    console.log('[NpuBridge] startServer called');
    
    if (this.serverProcess) {
      console.log('[NpuBridge] Server already running');
      return { success: true, message: 'Server already running' };
    }

    // Ensure OpenVINO installation is checked first (sets pythonExecutable)
    if (!this.openvinoInstalled) {
      console.log('[NpuBridge] Checking OpenVINO installation first...');
      await this.checkOpenVinoInstallation();
    }

    let serverScript = options.scriptPath || null;

    // Prefer scripts/start-npu-server.py if present, fall back to legacy path
    const candidates = [
      path.join(__dirname, '../../scripts/start-npu-server.py'),
      path.join(__dirname, '../../python/openvino-server.py'),
    ];

    if (!serverScript) {
      serverScript = candidates.find((p) => fs.existsSync(p)) || candidates[0];
    }

    console.log('[NpuBridge] Server script:', serverScript);
    console.log('[NpuBridge] Script exists:', fs.existsSync(serverScript));

    if (!fs.existsSync(serverScript)) {
      console.error('[NpuBridge] Server script not found');
      return { 
        success: false, 
        error: 'OpenVINO server script not found. Please set up the Python server first.',
        setupRequired: true
      };
    }

    const pythonCmd = this.pythonExecutable || 'python';
    console.log('[NpuBridge] Using Python:', pythonCmd);
    console.log('[NpuBridge] Python exists:', fs.existsSync(pythonCmd));

    return new Promise((resolve) => {
      console.log('[NpuBridge] Spawning server process...');
      
      // Use PYTHONUNBUFFERED to ensure output is not buffered
      // windowsHide: true prevents console window flash on Windows
      this.serverProcess = spawn(pythonCmd, ['-u', serverScript], {
        env: {
          ...process.env,
          OPENVINO_DEVICE: options.device || 'NPU',
          PYTHONUNBUFFERED: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let started = false;
      let allOutput = '';
      let allErrors = '';

      const checkStarted = (output) => {
        // Check for various uvicorn/fastapi startup messages
        return output.includes('Running on') || 
               output.includes('Uvicorn running') || 
               output.includes('Application startup complete') ||
               output.includes('Started server process') ||
               output.includes('[DevForge][NPU] Starting OpenVINO server');
      };

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        allOutput += output;
        console.log('[OpenVINO Server stdout]', output.trim());
        
        if (checkStarted(output) && !started) {
          started = true;
          console.log('[NpuBridge] Server started successfully');
          resolve({ success: true, pid: this.serverProcess.pid });
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        const errOutput = data.toString();
        allErrors += errOutput;
        console.log('[OpenVINO Server stderr]', errOutput.trim());
        
        // uvicorn logs to stderr, check for startup there too
        if (checkStarted(errOutput) && !started) {
          started = true;
          console.log('[NpuBridge] Server started (detected from stderr)');
          resolve({ success: true, pid: this.serverProcess.pid });
        }
      });

      this.serverProcess.on('error', (error) => {
        console.error('[NpuBridge] Process spawn error:', error);
        resolve({ success: false, error: error.message });
      });

      this.serverProcess.on('exit', (code) => {
        console.log('[NpuBridge] Server process exited with code:', code);
        this.serverProcess = null;
        if (!started) {
          const errorMsg = allErrors || allOutput || `Server exited with code ${code}`;
          resolve({ success: false, error: errorMsg.substring(0, 500) });
        }
      });

      // Timeout
      setTimeout(() => {
        if (!started) {
          console.error('[NpuBridge] Server start timeout. Output:', allOutput.substring(0, 300));
          console.error('[NpuBridge] Errors:', allErrors.substring(0, 300));
          this.stopServer();
          resolve({ success: false, error: 'Server start timeout - check if all dependencies are installed' });
        }
      }, 30000);
    });
  }

  /**
   * Stop the OpenVINO inference server
   */
  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    return { success: true };
  }

  /**
   * Get installation instructions
   */
  getSetupInstructions() {
    return {
      title: 'OpenVINO NPU Setup',
      steps: [
        {
          step: 1,
          title: 'Download OpenVINO',
          description: 'Download the OpenVINO toolkit from Intel',
          url: 'https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/download.html'
        },
        {
          step: 2,
          title: 'Install OpenVINO',
          description: 'Run the installer and follow the prompts. Make sure to select NPU support.'
        },
        {
          step: 3,
          title: 'Install Python bindings',
          description: 'Run: pip install openvino',
          command: 'pip install openvino'
        },
        {
          step: 4,
          title: 'Verify NPU detection',
          description: 'Restart DevForge and check Hardware settings'
        }
      ],
      requirements: [
        'Windows 11 22H2 or later',
        'Intel Core Ultra processor with NPU',
        'Latest Intel NPU drivers',
        'Python 3.8 or later'
      ],
      driverUrl: 'https://www.intel.com/content/www/us/en/download/794734/intel-npu-driver-windows.html'
    };
  }
}

// Singleton instance
let npuBridgeInstance = null;

function getNpuBridge() {
  if (!npuBridgeInstance) {
    npuBridgeInstance = new NpuBridge();
  }
  return npuBridgeInstance;
}

module.exports = {
  NpuBridge,
  getNpuBridge
};


