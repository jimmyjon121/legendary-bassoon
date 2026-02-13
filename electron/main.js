const electron = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execSync, spawn, spawnSync } = require('child_process');

const isElectronMainProcess = Boolean(
  electron &&
  typeof electron === 'object' &&
  electron.app &&
  electron.BrowserWindow
);

if (!isElectronMainProcess) {
  if (process.env.ELECTRON_RUN_AS_NODE && typeof electron === 'string') {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    const rerun = spawnSync(electron, process.argv.slice(1), {
      env: cleanEnv,
      stdio: 'inherit',
    });
    process.exit(Number.isInteger(rerun.status) ? rerun.status : 1);
  }

  console.error('[FATAL] DevForge main process launched without Electron context.');
  console.error('[FATAL] Start with `electron .` and unset ELECTRON_RUN_AS_NODE.');
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, globalShortcut, dialog, Menu } = electron;

// ─────────────────────────────────────────────────────────────────────────────
// LITE MODE: Memory optimizations for lightweight operation
// ─────────────────────────────────────────────────────────────────────────────
// Limit V8 heap size to reduce memory footprint (default is ~1.4GB, we use 512MB)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
// NOTE:
// Disabling GPU compositing makes animations and transitions noticeably choppy.
// Only disable it when explicitly running in "lite mode".
if (process.env.LITE_MODE === 'true') {
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
// Reduce renderer process priority when backgrounded
app.commandLine.appendSwitch('disable-renderer-backgrounding', 'false');
// Enable memory pressure notifications
app.commandLine.appendSwitch('enable-features', 'MemoryPressureBasedSourceBufferGC');

// These modules are loaded AFTER dependency check to avoid missing module errors
let Store = null;
let setupIpcHandlers = null;
let saveDatabase = null;
let startupManager = null;

// Setup logging (use sync initially since we log before app is ready)
const logPath = path.join(app.getPath('userData'), 'devforge.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

function normalizeLogSymbols(input) {
  return String(input || '')
    .replace(/âœ“|✓|✅/g, '[OK]')
    .replace(/âœ—|✗|❌/g, '[FAIL]')
    .replace(/âš |⚠️?|⚠/g, '[WARN]')
    .replace(/â„¹|ℹ️?|ℹ/g, '[INFO]')
    .replace(/ðŸ”„|🔄/g, '[RETRY]')
    .replace(/â€“|–/g, '-');
}

function log(message, level = 'INFO') {
  const normalizedMessage = normalizeLogSymbols(message);
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${normalizedMessage}\n`;
  logStream.write(logMessage);
  if (process.env.NODE_ENV !== 'production') {
    console.log(logMessage.trim());
  }
}

log('DevForge starting...');

// ─────────────────────────────────────────────────────────────────────────────
// SELF-HEALING: Ensure all npm dependencies are installed before anything else
// This runs synchronously at the very start so the app never fails due to
// missing node_modules. Works for both dev and production builds.
// ─────────────────────────────────────────────────────────────────────────────
function ensureDependenciesSync() {
  const projectRoot = path.resolve(__dirname, '..');
  const pkgPath = path.join(projectRoot, 'package.json');
  const nodeModulesPath = path.join(projectRoot, 'node_modules');

  // In production builds, node_modules is bundled, so skip this check
  // (electron-builder includes node_modules in the asar)
  if (app.isPackaged) {
    log('Running packaged app – skipping dependency check');
    return;
  }

  log('Checking npm dependencies...');

  // Helper to get npm command that works on Windows without PowerShell issues
  const getNpmCmd = () => {
    if (process.platform === 'win32') {
      const possiblePaths = [
        'C:\\Program Files\\nodejs\\npm.cmd',
        'C:\\Program Files (x86)\\nodejs\\npm.cmd',
        path.join(process.env.APPDATA || '', 'npm', 'npm.cmd'),
        path.join(process.env.ProgramFiles || '', 'nodejs', 'npm.cmd'),
      ];
      return possiblePaths.find(p => fs.existsSync(p)) || 'npm';
    }
    return 'npm';
  };

  const npmCmd = getNpmCmd();

  // If node_modules doesn't exist at all, run full install
  if (!fs.existsSync(nodeModulesPath)) {
    log('node_modules missing – running npm install...');
    try {
      execSync(`"${npmCmd}" install`, { cwd: projectRoot, stdio: 'inherit', shell: true });
      log('✓ npm install complete');
    } catch (err) {
      log(`⚠ npm install failed: ${err.message}`, 'ERROR');
    }
    return;
  }

  // Read package.json and verify each dependency folder exists
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (err) {
    log(`⚠ Could not read package.json: ${err.message}`, 'WARN');
    return;
  }

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  const missing = [];
  for (const dep of Object.keys(allDeps)) {
    // Scoped packages like @monaco-editor/react live in @monaco-editor folder
    const depFolder = dep.startsWith('@')
      ? path.join(nodeModulesPath, ...dep.split('/'))
      : path.join(nodeModulesPath, dep);

    if (!fs.existsSync(depFolder)) {
      missing.push(dep);
    }
  }

  if (missing.length === 0) {
    log('✓ All npm dependencies present');
    return;
  }

  log(`Missing ${missing.length} dependencies: ${missing.join(', ')}`);
  log('Running npm install to restore missing packages...');

  try {
    execSync(`"${npmCmd}" install`, { cwd: projectRoot, stdio: 'inherit', shell: true });
    log('✓ npm install complete');
  } catch (err) {
    log(`⚠ npm install failed: ${err.message}`, 'ERROR');
  }
}

// Run dependency check immediately (before app.whenReady)
ensureDependenciesSync();

// NOW load modules that depend on npm packages (after deps are installed)
let setupLedgerHandlers = null;

function loadDependentModules() {
  log('Loading dependent modules...');
  try {
    Store = require('electron-store');
    const ipcHandlers = require('./ipc-handlers');
    setupIpcHandlers = ipcHandlers.setupIpcHandlers;
    saveDatabase = ipcHandlers.saveDatabase;
    setupLedgerHandlers = ipcHandlers.setupLedgerHandlers;
    startupManager = require('./services/startup-manager');
    log('✓ All modules loaded');
  } catch (err) {
    log(`⚠ Failed to load modules: ${err.message}`, 'ERROR');
    log(`Stack: ${err.stack}`, 'ERROR');
  }
}

loadDependentModules();

// ─────────────────────────────────────────────────────────────────────────────
// SELF-HEALING: Auto-start Vite dev server if not running (dev mode only)
// ─────────────────────────────────────────────────────────────────────────────
const DEV_PORT = 5173;
let viteProcess = null;
let viteDevServerUrl = `http://localhost:${DEV_PORT}`;

// Kill any process using a specific port (Windows/Mac/Linux)
async function killProcessOnPort(port) {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        // Windows: Find PID using netstat and kill it
        const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { 
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Parse PIDs from netstat output
        const lines = result.trim().split('\n');
        const pids = new Set();
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            pids.add(pid);
          }
        }
        
        // Kill each PID
        for (const pid of pids) {
          try {
            log(`Killing stale process on port ${port} (PID: ${pid})`);
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } catch (e) {
            // Process may have already exited
          }
        }
        
        // Wait a moment for port to be released
        setTimeout(resolve, 500);
      } else {
        // Mac/Linux: Use lsof and kill
        try {
          const result = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' });
          const pids = result.trim().split('\n').filter(p => p);
          for (const pid of pids) {
            log(`Killing stale process on port ${port} (PID: ${pid})`);
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          }
        } catch (e) {
          // No process found
        }
        setTimeout(resolve, 500);
      }
    } catch (e) {
      // No process found on port, that's fine
      resolve();
    }
  });
}

// Check if port is available
function isPortFree(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function ensureViteRunning() {
  // Only in dev mode (not packaged)
  if (app.isPackaged) return true;

  const viteUrl = `http://localhost:${DEV_PORT}`;
  
  // Check if a Vite server is already running and responding
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(viteUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok || response.status === 200) {
      viteDevServerUrl = viteUrl;
      log(`✓ Vite dev server already running at ${viteUrl}`);
      return true;
    }
  } catch (e) {
    // Not running or not responding
  }

  log('Vite dev server not running – starting it...');
  
  // Check if port is blocked by a stale process
  const portFree = await isPortFree(DEV_PORT);
  if (!portFree) {
    log(`Port ${DEV_PORT} is blocked – killing stale process...`);
    await killProcessOnPort(DEV_PORT);
    
    // Wait and verify port is now free
    await new Promise(r => setTimeout(r, 1000));
    const nowFree = await isPortFree(DEV_PORT);
    if (!nowFree) {
      log(`⚠ Could not free port ${DEV_PORT}`, 'WARN');
    } else {
      log(`✓ Port ${DEV_PORT} is now free`);
    }
  }
  
  const projectRoot = path.resolve(__dirname, '..');
  
  // On Windows, use the full path to npm.cmd to bypass PowerShell execution policy
  let npmCmd, npmArgs;
  if (process.platform === 'win32') {
    // Try to find npm.cmd in common locations
    const possiblePaths = [
      'C:\\Program Files\\nodejs\\npm.cmd',
      'C:\\Program Files (x86)\\nodejs\\npm.cmd',
      path.join(process.env.APPDATA || '', 'npm', 'npm.cmd'),
      path.join(process.env.ProgramFiles || '', 'nodejs', 'npm.cmd'),
    ];
    
    npmCmd = possiblePaths.find(p => fs.existsSync(p)) || 'npm.cmd';
    npmArgs = ['run', 'dev:vite'];
    log(`Using npm at: ${npmCmd}`);
  } else {
    npmCmd = 'npm';
    npmArgs = ['run', 'dev:vite'];
  }

  viteDevServerUrl = viteUrl;
  log(`Starting Vite on port ${DEV_PORT}`);

  // Start Vite in background
  viteProcess = spawn(npmCmd, npmArgs, {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: false, // Don't use shell to avoid PowerShell issues
    detached: false,
  });

  viteProcess.stdout.on('data', (data) => {
    log(`[vite] ${data.toString().trim()}`);
  });

  viteProcess.stderr.on('data', (data) => {
    log(`[vite] ${data.toString().trim()}`, 'WARN');
  });

  viteProcess.on('error', (err) => {
    log(`Failed to start Vite: ${err.message}`, 'ERROR');
  });

  // Wait for Vite to be ready (poll for up to 30 seconds)
  const maxWait = 30000;
  const pollInterval = 500;
  let waited = 0;

  while (waited < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval));
    waited += pollInterval;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(viteDevServerUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok || response.status === 200) {
        log(`✓ Vite dev server started at ${viteDevServerUrl}`);
        return true;
      }
    } catch (err) {
      // Still starting...
    }
  }

  log('⚠ Vite dev server did not start in time', 'WARN');
  return false;
}

// Derive encryption key from machine-specific data (fallback if no password set)
// This is better than hard-coding but still not ideal - user should set NSFW password
function getDefaultEncryptionKey() {
  const machineId = app.getPath('userData');
  return crypto.createHash('sha256').update(machineId + 'devforge-fallback').digest('hex').substring(0, 32);
}

// Persistent store for app settings (initialized lazily after modules load)
let store = null;
function getStore() {
  if (!store && Store) {
    store = new Store({
      encryptionKey: getDefaultEncryptionKey(),
      defaults: {
        theme: 'dark',
        lastWorkspace: 'casual',
        // Prefer IPv4 loopback to avoid ::1/IPv6 binding issues on Windows
        llmEndpoint: 'http://127.0.0.1:11434',
        imageGenEndpoint: 'http://127.0.0.1:8188',
        windowBounds: { width: 1400, height: 900 },
        hasOnboarded: false
      }
    });
  }
  return store;
}

let mainWindow;
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

// Security: Disable remote module
app.on('remote-require', (event) => event.preventDefault());
app.on('remote-get-builtin', (event) => event.preventDefault());
app.on('remote-get-global', (event) => event.preventDefault());
app.on('remote-get-current-window', (event) => event.preventDefault());
app.on('remote-get-current-web-contents', (event) => event.preventDefault());

async function createWindow() {
  log('Creating main window...');
  const bounds = getStore()?.get('windowBounds') || { width: 1400, height: 900 };
  
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 1000,
    minHeight: 700,
    frame: false, // Custom title bar
    show: false, // Don't show until ready (prevents white flash)
    backgroundColor: '#000000', // Pure black to match startup visual
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // Lite mode optimizations
      backgroundThrottling: true, // Throttle when window not focused
      spellcheck: false, // Disable spellcheck for performance
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    // Lite mode: Disable features we don't need
    autoHideMenuBar: true,
  });

  // Show window only when content is ready (prevents white flash)
  // Small delay ensures React has finished first paint
  mainWindow.once('ready-to-show', () => {
    log('Window ready to show');
    setTimeout(() => {
      mainWindow.show();
    }, 50); // 50ms safety buffer for React render
  });

  // Setup IPC handlers before loading the renderer to avoid race conditions
  try {
    if (setupIpcHandlers) {
      await setupIpcHandlers(ipcMain, mainWindow, getStore());
    } else {
      log('⚠ IPC handlers not available', 'WARN');
    }
  } catch (err) {
    log(`Error setting up IPC handlers: ${err.message}`, 'ERROR');
  }

  const devUrl = viteDevServerUrl || 'http://localhost:5173';
  const distPath = path.join(__dirname, '../dist/index.html');
  const shouldUseDevServer = !app.isPackaged && needsDevServer();
  
  // Add webContents error handlers
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log(`Page failed to load: ${errorDescription} (${errorCode}) - URL: ${validatedURL}`, 'ERROR');
  });
  
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log(`Renderer process gone: ${details.reason}`, 'ERROR');
  });
  
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) { // Only log warnings and errors
      log(`[Renderer Console] ${message}`, level === 2 ? 'WARN' : 'ERROR');
    }
  });

  // Load the app
  // In non-packaged runs, only use Vite if `needsDevServer()` says we must
  // (or --dev/DEV_MODE forced it). Otherwise, always load dist/ to avoid
  // accidentally attaching to a stale localhost:5173 session.
  if (shouldUseDevServer) {
    log(`Loading from Vite dev server: ${devUrl}`);
    mainWindow.loadURL(devUrl);
    // Dev tools can be opened manually with F12 or Ctrl+Shift+I
  } else {
    try {
      // Prevent stale file:// cache from holding old split-chunk references.
      await mainWindow.webContents.session.clearCache();
    } catch (cacheErr) {
      log(`Failed to clear renderer cache: ${cacheErr.message}`, 'WARN');
    }
    log('Loading pre-built app from dist/');
    mainWindow.loadFile(distPath);
  }

  // Save window bounds on resize
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      const [width, height] = mainWindow.getSize();
      getStore()?.set('windowBounds', { width, height });
    }
  });

  mainWindow.on('close', () => {
    // Closing the window should end the session on desktop builds.
    isQuitting = true;
  });

  // Setup Unified Ledger handlers
  if (setupLedgerHandlers) {
    const userDataPath = app.getPath('userData');
    setupLedgerHandlers(ipcMain, userDataPath).then(() => {
      log('✓ Ledger handlers initialized');
    }).catch(err => {
      log(`⚠ Ledger handlers failed: ${err.message}`, 'WARN');
    });
  }
  
  log('Main window created successfully');
  
  // Run startup services in background after window is ready
  mainWindow.webContents.once('did-finish-load', async () => {
    if (!startupManager) {
      log('⚠ Startup manager not available', 'WARN');
      mainWindow.webContents.send('auto-setup-complete', {
        success: false,
        error: 'Startup manager not loaded',
        log: []
      });
      return;
    }
    
    // Set up real-time progress callback to send updates to renderer
    startupManager.setProgressCallback((progressEvent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('startup:progress', progressEvent);
      }
    });
    
    log('Starting all services...');
    try {
      const results = await startupManager.startAllServices();
      log('Service startup complete');
      
      // Auto-start image generation backend if configured
      try {
        const { getImageBackendAuto } = require('./services/image-backend-auto');
        const imageBackend = getImageBackendAuto();
        const autoStartResult = await imageBackend.autoStartIfConfigured();
        if (autoStartResult.autoStarted) {
          log(`Image backend auto-started on port ${autoStartResult.port}`);
        } else {
          log(`Image backend not auto-started: ${autoStartResult.reason}`);
        }
      } catch (imgErr) {
        log(`Image backend auto-start check failed: ${imgErr.message}`, 'WARN');
      }
      
      // Send startup status to renderer
      mainWindow.webContents.send('auto-setup-complete', {
        success: true,
        log: startupManager.getLog(),
        services: results
      });
    } catch (error) {
      log(`Service startup error: ${error.message}`, 'ERROR');
      mainWindow.webContents.send('auto-setup-complete', {
        success: false,
        error: error.message,
        log: startupManager.getLog()
      });
    }
  });
}

// Register global shortcuts
function registerShortcuts() {
  // Boss key - instantly hide window
  const bossKey = globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow) {
      log('Boss key triggered');
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
  
  if (!bossKey) {
    log('Failed to register boss key shortcut', 'WARN');
  }

  // Panic mode - clear sensitive data and hide
  const panicKey = globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (mainWindow) {
      log('Panic mode triggered');
      mainWindow.webContents.send('panic-mode');
      mainWindow.hide();
    }
  });
  
  if (!panicKey) {
    log('Failed to register panic key shortcut', 'WARN');
  }
  
  log('Global shortcuts registered');
}

// Setup application menu with keyboard shortcuts
function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  
  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.reload();
              log('Reload triggered (Ctrl+R)');
            }
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.reloadIgnoringCache();
              log('Hard reload triggered (Ctrl+Shift+R)');
            }
          }
        },
        {
          label: 'Reload (F5)',
          accelerator: 'F5',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.reload();
              log('Reload triggered (F5)');
            }
          }
        },
        { type: 'separator' },
        ...(!app.isPackaged ? [
          {
            label: 'Toggle Developer Tools',
            accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: () => {
              if (mainWindow) {
                mainWindow.webContents.toggleDevTools();
              }
            }
          },
          {
            label: 'Toggle DevTools (F12)',
            accelerator: 'F12',
            click: () => {
              if (mainWindow) {
                mainWindow.webContents.toggleDevTools();
              }
            }
          },
          { type: 'separator' },
        ] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  log('Application menu with keyboard shortcuts configured');
}

// Check if we need dev server (no build available and not packaged)
function needsDevServer() {
  if (app.isPackaged) return false;
  
  const forceDevMode = process.argv.includes('--dev') || process.env.DEV_MODE === 'true';
  if (forceDevMode) return true;
  
  const distPath = path.join(__dirname, '../dist/index.html');
  const hasBuiltApp = fs.existsSync(distPath);
  return !hasBuiltApp;
}

app.whenReady().then(async () => {
  // Only start Vite dev server if actually needed
  if (needsDevServer()) {
    log('Dev server needed - ensuring Vite is running...');
    await ensureViteRunning();
  } else {
    log('Using pre-built app - no dev server needed');
  }

  setupApplicationMenu();
  await createWindow();
  registerShortcuts();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (needsDevServer()) {
        await ensureViteRunning();
      }
      await createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  log('App quitting, cleaning up...');
  globalShortcut.unregisterAll();
  
  // Stop Vite dev server if we started it
  if (viteProcess && !viteProcess.killed) {
    log('Stopping Vite dev server...');
    try {
      // On Windows, we need to kill the process tree
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${viteProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        viteProcess.kill('SIGTERM');
      }
    } catch (err) {
      // Process may have already exited
    }
  }
  
  // Stop managed services
  try {
    if (startupManager) {
      startupManager.stopAllServices();
    }
  } catch (error) {
    log(`Error stopping services: ${error.message}`, 'ERROR');
  }
  
  // Save database before quitting
  if (saveDatabase) {
    saveDatabase();
  }
  logStream.end();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}\n${error.stack}`, 'ERROR');
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled rejection at: ${promise}, reason: ${reason}`, 'ERROR');
});

// Handle certificate errors for local services
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
