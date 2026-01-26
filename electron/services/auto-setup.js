const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class AutoSetup {
  constructor() {
    this.setupLog = [];
    this.isSetupRunning = false;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.setupLog.push(logEntry);
    console.log(logEntry);
  }

  async runAutoSetup() {
    if (this.isSetupRunning) {
      return { success: false, error: 'Setup already running', log: this.setupLog };
    }

    this.isSetupRunning = true;
    this.setupLog = [];
    this.log('🚀 Starting automatic setup...');

    try {
      // Step 1: Check and setup Ollama
      const ollamaStatus = await this.setupOllama();

      // Step 2: Check and setup NPU (if available)
      await this.setupNPU();

      // Step 3: Check and setup image backend (optional)
      await this.setupImageBackend();

      // Step 4: Check for models (don't auto-download, let user choose)
      await this.ensureDefaultModel();

      this.log('✅ Auto-setup completed!');
      this.isSetupRunning = false;
      return { 
        success: true, 
        log: this.setupLog,
        ollamaRunning: ollamaStatus.running,
        ollamaInstalled: ollamaStatus.installed
      };
    } catch (error) {
      this.log(`❌ Auto-setup failed: ${error.message}`);
      this.isSetupRunning = false;
      return { success: false, error: error.message, log: this.setupLog };
    }
  }

  async setupOllama() {
    this.log('Checking Ollama...');
    
    try {
      // Try to connect to Ollama (prefer IPv4 loopback)
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        this.log('✓ Ollama is already running');
        return { running: true, installed: true };
      }
    } catch (error) {
      // Ollama not running, try to start it
      this.log('Ollama not responding, attempting to start...');
    }

    // Try to start Ollama
    try {
      const ollamaPath = await this.findOllamaBinary();
      
      if (!ollamaPath) {
        this.log('⚠ Ollama not installed. Download from ollama.com');
        return { running: false, installed: false };
      }

      this.log(`Found Ollama at: ${ollamaPath}`);
      
      // Start Ollama serve in background
      const ollamaProcess = spawn(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      
      ollamaProcess.unref();
      
      // Wait for it to start
      this.log('Starting Ollama service...');
      await this.sleep(3000);
      
      // Verify it's running
      for (let i = 0; i < 5; i++) {
        try {
          const checkResponse = await fetch('http://127.0.0.1:11434/api/tags', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
          });
          
          if (checkResponse.ok) {
            this.log('✓ Ollama started successfully');
            return { running: true, installed: true };
          }
        } catch (e) {
          // Wait and retry
          await this.sleep(1000);
        }
      }
      
      this.log('⚠ Ollama started but not responding yet');
      return { running: false, installed: true };
    } catch (error) {
      this.log(`⚠ Could not auto-start Ollama: ${error.message}`);
      return { running: false, installed: false };
    }
  }

  async setupNPU() {
    this.log('Checking NPU support...');
    
    try {
      // Check if Intel NPU is available
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Check for Intel NPU on Windows
      if (process.platform === 'win32') {
        try {
          // Use PowerShell Get-CimInstance (wmic is deprecated)
          const { stdout } = await execAsync('powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { $_.Name -like \'*Intel(R) AI Boost*\' } | Select-Object -ExpandProperty Name"');
          
          if (stdout.includes('Intel(R) AI Boost')) {
            this.log('✓ Intel NPU detected');
            
            // Check if OpenVINO is set up
            const setupScript = path.join(__dirname, '../../scripts/setup-openvino.ps1');
            if (fs.existsSync(setupScript)) {
              this.log('NPU setup available - will be configured on demand');
            }
          } else {
            this.log('ℹ No Intel NPU detected');
          }
        } catch (error) {
          this.log('ℹ NPU check skipped');
        }
      }
    } catch (error) {
      this.log(`ℹ NPU setup skipped: ${error.message}`);
    }
  }

  async setupImageBackend() {
    this.log('Checking image generation backend...');
    
    try {
      // Try to connect to ComfyUI (if running)
      const response = await fetch('http://localhost:8188/system_stats', {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });

      if (response.ok) {
        this.log('✓ ComfyUI detected and running');
        return;
      }
    } catch (error) {
      this.log('ℹ Image backend not running (optional)');
    }
  }

  async ensureDefaultModel() {
    this.log('Checking for AI models...');
    
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.models && data.models.length > 0) {
          this.log(`✓ Found ${data.models.length} model(s)`);
          return;
        }
        
        // No models, download a small one
        this.log('No models found, downloading llama3.2:3b (recommended)...');
        this.log('This may take a few minutes depending on your connection...');
        
        // Note: We don't actually download here in auto-setup
        // The onboarding wizard will handle this with progress UI
        this.log('ℹ Model download will be offered in onboarding wizard');
      }
    } catch (error) {
      this.log(`ℹ Could not check models: ${error.message}`);
    }
  }

  async findOllamaBinary() {
    const possiblePaths = [];
    
    if (process.platform === 'win32') {
      possiblePaths.push(
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
        'C:\\Program Files\\Ollama\\ollama.exe',
        'C:\\Program Files (x86)\\Ollama\\ollama.exe'
      );
    } else if (process.platform === 'darwin') {
      possiblePaths.push(
        '/usr/local/bin/ollama',
        '/opt/homebrew/bin/ollama',
        path.join(os.homedir(), '.ollama', 'bin', 'ollama')
      );
    } else {
      possiblePaths.push(
        '/usr/local/bin/ollama',
        '/usr/bin/ollama',
        path.join(os.homedir(), '.ollama', 'bin', 'ollama')
      );
    }

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getSetupLog() {
    return this.setupLog;
  }
}

module.exports = new AutoSetup();

