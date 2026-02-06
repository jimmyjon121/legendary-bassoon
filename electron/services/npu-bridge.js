/**
 * NPU Bridge Service
 * Bridge to OpenVINO for Intel NPU acceleration
 * 
 * This service detects OpenVINO installation and NPU availability,
 * and provides a bridge to the OpenVINO inference server when available.
 *
 * PERFORMANCE: Installation check and device query are cached for the
 * entire app session (they don't change at runtime). Server health is
 * cached for a short TTL.
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

    // === Caches ===
    // Installation result is stable for the entire session.
    this._installationResult = null;
    // Device list is stable for the entire session (hardware doesn't change).
    this._devicesResult = null;
    // Full status cache (short-lived, includes server health).
    this._statusCache = { at: 0, value: null };
    // Server health cache (short-lived, separate from full status).
    this._serverHealthCache = { at: 0, value: false };
  }

  // ------------------------------------------------------------------
  // Installation detection (session-cached)
  // ------------------------------------------------------------------

  /**
   * Check if OpenVINO is installed.
   * Result is cached permanently for the app session.
   */
  async checkOpenVinoInstallation() {
    if (this._installationResult) {
      return this._installationResult;
    }

    const result = await this._doCheckOpenVinoInstallation();
    this._installationResult = result;
    return result;
  }

  /** @private */
  async _doCheckOpenVinoInstallation() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') {
        resolve({ installed: false, reason: 'Not Windows' });
        return;
      }

      // 1. Prefer the bundled DevForge virtualenv
      try {
        const projectRoot = path.join(__dirname, '..', '..');
        const envPath = path.join(projectRoot, 'openvino-env');
        const envPython = path.join(envPath, 'Scripts', 'python.exe');
        const openvinoPackageDir = path.join(envPath, 'Lib', 'site-packages', 'openvino');

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
      } catch {
        // Fall through to other detection methods
      }

      // 2. Check common global installation paths
      const possiblePaths = [
        'C:\\Program Files (x86)\\Intel\\openvino_2024',
        'C:\\Program Files (x86)\\Intel\\openvino_2023',
        'C:\\Program Files\\Intel\\openvino_2024',
        'C:\\Program Files\\Intel\\openvino_2023',
        process.env.INTEL_OPENVINO_DIR,
        process.env.OPENVINO_DIR
      ].filter(Boolean);

      for (const basePath of possiblePaths) {
        try {
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
        } catch {
          // Continue
        }
      }

      // 3. Try to find via PATH (last resort — spawns a shell process)
      exec('where openvino', { timeout: 5000, windowsHide: true }, (error, stdout) => {
        if (!error && stdout.trim()) {
          const openvinoExe = stdout.trim().split('\n')[0];
          this.openvinoPath = path.dirname(path.dirname(openvinoExe));
          this.openvinoInstalled = true;
          this.pythonExecutable = 'python';
          resolve({ installed: true, path: this.openvinoPath });
        } else {
          // Not installed — this is perfectly fine
          resolve({ installed: false, reason: 'OpenVINO not found' });
        }
      });
    });
  }

  /**
   * Extract OpenVINO version from path
   */
  extractVersion(basePath) {
    try {
      const match = basePath.match(/openvino_(\d+)/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Extract OpenVINO version from the bundled virtualenv
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
      const versionLine = metadata.split('\n').find((line) => line.startsWith('Version:'));
      return versionLine ? versionLine.split(':')[1].trim() : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Device query (session-cached)
  // ------------------------------------------------------------------

  /**
   * Query available OpenVINO devices.
   * Result is cached permanently for the app session (hardware doesn't change).
   */
  async queryDevices() {
    if (this._devicesResult) {
      return this._devicesResult;
    }

    // Ensure installation is detected first
    if (!this._installationResult) {
      await this.checkOpenVinoInstallation();
    }

    if (!this.openvinoInstalled) {
      const result = { devices: [], error: 'OpenVINO not installed' };
      this._devicesResult = result;
      return result;
    }

    const result = await this._doQueryDevices();
    this._devicesResult = result;
    return result;
  }

  /** @private */
  _doQueryDevices() {
    return new Promise((resolve) => {
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

      let python;
      try {
        python = spawn(pythonCmd, ['-c', pythonScript], {
          timeout: 15000,
          windowsHide: true,
        });
      } catch (spawnError) {
        console.warn('[NpuBridge] Failed to spawn Python for device query:', spawnError.message);
        resolve({ devices: [], error: `Python not available: ${spawnError.message}` });
        return;
      }

      let output = '';
      let errorOutput = '';

      python.stdout.on('data', (data) => { output += data.toString(); });
      python.stderr.on('data', (data) => { errorOutput += data.toString(); });

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
        console.warn('[NpuBridge] Python spawn error:', error.message);
        resolve({ devices: [], error: `Python not available: ${error.message}` });
      });
    });
  }

  /**
   * Check if NPU is available (convenience wrapper)
   */
  async checkNpuAvailable() {
    const result = await this.queryDevices();
    return {
      available: result.npuAvailable || false,
      devices: result.devices || [],
      error: result.error
    };
  }

  // ------------------------------------------------------------------
  // Full status (cached with short TTL — includes server health)
  // ------------------------------------------------------------------

  /**
   * Get full status of OpenVINO/NPU setup.
   * Cached for 10 seconds to avoid expensive re-checks.
   */
  async getStatus() {
    const now = Date.now();
    if (this._statusCache?.value && (now - this._statusCache.at) < 10000) {
      return this._statusCache.value;
    }

    const installation = await this.checkOpenVinoInstallation();

    if (!installation.installed) {
      const value = {
        openvinoInstalled: false,
        npuAvailable: false,
        serverRunning: false,
        error: installation.reason,
        setupRequired: true
      };
      this._statusCache = { at: now, value };
      return value;
    }

    const devices = await this.queryDevices();
    const serverRunning = await this.checkServerHealth();

    const value = {
      openvinoInstalled: true,
      openvinoPath: this.openvinoPath,
      openvinoVersion: installation.version,
      npuAvailable: devices.npuAvailable || false,
      devices: devices.devices || [],
      serverRunning,
      setupRequired: false
    };
    this._statusCache = { at: now, value };
    return value;
  }

  /**
   * Invalidate status cache (e.g. after starting/stopping server)
   */
  invalidateStatusCache() {
    this._statusCache = { at: 0, value: null };
    this._serverHealthCache = { at: 0, value: false };
  }

  // ------------------------------------------------------------------
  // Server health (cached with short TTL)
  // ------------------------------------------------------------------

  /**
   * Check if OpenVINO inference server is running.
   * Cached for 5 seconds.
   */
  async checkServerHealth() {
    const now = Date.now();
    if (now - this._serverHealthCache.at < 5000) {
      return this._serverHealthCache.value;
    }

    const healthy = await this._doCheckServerHealth();
    this._serverHealthCache = { at: now, value: healthy };
    return healthy;
  }

  /** @private */
  _doCheckServerHealth() {
    return new Promise((resolve) => {
      try {
        const req = http.get(`${this.serverEndpoint}/status`, { timeout: 2000 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      } catch {
        resolve(false);
      }
    });
  }

  // ------------------------------------------------------------------
  // Model configuration
  // ------------------------------------------------------------------

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

          if (options.enableAutoStart !== undefined) {
            existing.auto_start = options.enableAutoStart;
            fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
          }

          return { configured: true, model: existing.model_path, existing: true };
        }
      }
    } catch {
      // Config doesn't exist or is invalid, continue with auto-config
    }

    const recommendedModels = [
      'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      'microsoft/phi-2',
      'Qwen/Qwen2-0.5B-Instruct',
      'stabilityai/stablelm-2-zephyr-1_6b',
      'HuggingFaceTB/SmolLM-360M-Instruct',
    ];

    const selectedModel = recommendedModels[0];
    const config = {
      model_path: selectedModel,
      tokenizer: selectedModel,
      device: 'NPU',
      precision: 'fp16',
      auto_start: options.enableAutoStart !== false
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

  // ------------------------------------------------------------------
  // Model loading (via running server API)
  // ------------------------------------------------------------------

  async loadModel(modelPath, options = {}) {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        model_path: modelPath,
        tokenizer: options.tokenizer || modelPath,
        device: options.device || 'NPU',
        precision: options.precision || 'fp16'
      });

      try {
        const req = http.request(`${this.serverEndpoint}/models/load`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: 120000
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
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }

  // ------------------------------------------------------------------
  // Server lifecycle
  // ------------------------------------------------------------------

  /**
   * Start the OpenVINO inference server
   */
  async startServer(options = {}) {
    console.log('[NpuBridge] startServer called');

    if (this.serverProcess) {
      console.log('[NpuBridge] Server already running');
      return { success: true, message: 'Server already running' };
    }

    // Ensure installation is detected (sets pythonExecutable)
    if (!this._installationResult) {
      await this.checkOpenVinoInstallation();
    }

    if (!this.openvinoInstalled) {
      return {
        success: false,
        error: 'OpenVINO is not installed.',
        setupRequired: true
      };
    }

    let serverScript = options.scriptPath || null;

    const candidates = [
      path.join(__dirname, '../../scripts/start-npu-server.py'),
      path.join(__dirname, '../../python/openvino-server.py'),
    ];

    if (!serverScript) {
      serverScript = candidates.find((p) => fs.existsSync(p)) || candidates[0];
    }

    console.log('[NpuBridge] Server script:', serverScript);

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

    return new Promise((resolve) => {
      console.log('[NpuBridge] Spawning server process...');

      try {
        this.serverProcess = spawn(pythonCmd, ['-u', serverScript], {
          env: {
            ...process.env,
            OPENVINO_DEVICE: options.device || 'NPU',
            PYTHONUNBUFFERED: '1'
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (spawnError) {
        console.error('[NpuBridge] Failed to spawn server process:', spawnError.message);
        resolve({ success: false, error: spawnError.message });
        return;
      }

      let started = false;
      let allOutput = '';
      let allErrors = '';

      const checkStarted = (output) => {
        return output.includes('Running on') ||
               output.includes('Uvicorn running') ||
               output.includes('Application startup complete') ||
               output.includes('Started server process') ||
               output.includes('[DevForge][NPU] Starting OpenVINO server');
      };

      const onStarted = () => {
        if (started) return;
        started = true;
        console.log('[NpuBridge] Server started successfully');
        this.invalidateStatusCache();
        resolve({ success: true, pid: this.serverProcess?.pid });
      };

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        allOutput += output;
        console.log('[OpenVINO Server stdout]', output.trim());
        if (checkStarted(output)) onStarted();
      });

      this.serverProcess.stderr.on('data', (data) => {
        const errOutput = data.toString();
        allErrors += errOutput;
        // uvicorn logs to stderr
        console.log('[OpenVINO Server stderr]', errOutput.trim());
        if (checkStarted(errOutput)) onStarted();
      });

      this.serverProcess.on('error', (error) => {
        console.error('[NpuBridge] Process spawn error:', error);
        this.serverProcess = null;
        if (!started) resolve({ success: false, error: error.message });
      });

      this.serverProcess.on('exit', (code) => {
        console.log('[NpuBridge] Server process exited with code:', code);
        this.serverProcess = null;
        this.invalidateStatusCache();
        if (!started) {
          const errorMsg = allErrors || allOutput || `Server exited with code ${code}`;
          resolve({ success: false, error: errorMsg.substring(0, 500) });
        }
      });

      // Timeout
      setTimeout(() => {
        if (!started) {
          console.error('[NpuBridge] Server start timeout');
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
      try {
        this.serverProcess.kill();
      } catch {
        // Already dead
      }
      this.serverProcess = null;
    }
    this.invalidateStatusCache();
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Setup instructions
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Cache management
  // ------------------------------------------------------------------

  /**
   * Clear all caches (useful after driver updates or fresh setup)
   */
  clearAllCaches() {
    this._installationResult = null;
    this._devicesResult = null;
    this._statusCache = { at: 0, value: null };
    this._serverHealthCache = { at: 0, value: false };
    this.openvinoInstalled = false;
    this.npuAvailable = false;
    this.openvinoPath = null;
    this.devices = [];
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
