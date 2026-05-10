const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const ALPHA_READINESS_SCHEMA_VERSION = 'anvil.alphaReadiness.v1';

function normalizeStatus(checks) {
  const hasNeedsSetup = checks.some((check) => check.status === 'needs_setup');
  const hasDegraded = checks.some((check) => check.status === 'degraded');
  if (hasNeedsSetup) return 'needs_setup';
  if (hasDegraded) return 'degraded';
  return 'ready';
}

function okCheck(id, label, message, action = null, extra = {}) {
  return { id, label, status: 'ready', message, action, ...extra };
}

function needsSetupCheck(id, label, message, action = null, extra = {}) {
  return { id, label, status: 'needs_setup', message, action, ...extra };
}

function degradedCheck(id, label, message, action = null, extra = {}) {
  return { id, label, status: 'degraded', message, action, ...extra };
}

function safeGet(store, key, fallback = null) {
  try {
    if (!store || typeof store.get !== 'function') return fallback;
    const value = store.get(key);
    return value === undefined || value === null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function readPackageMetadata(packageJsonPath) {
  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(raw);
    return {
      name: pkg.name || 'devforge',
      version: pkg.version || '0.0.0',
      productName: pkg.build?.productName || 'Anvil',
      description: pkg.description || '',
    };
  } catch (error) {
    return {
      name: 'devforge',
      version: '0.0.0',
      productName: 'Anvil',
      description: '',
      error: error.message,
    };
  }
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: options.timeout || 1500,
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, data: body ? JSON.parse(body) : null });
        } catch (_) {
          resolve({ status: response.statusCode, data: body });
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Request timeout'));
    });
    request.end();
  });
}

function checkDatabase(db) {
  if (!db) {
    return needsSetupCheck(
      'storage',
      'Storage',
      'Local app storage has not initialized yet.',
      'Restart Anvil if this does not clear.'
    );
  }
  try {
    if (typeof db.exec === 'function') {
      db.exec('SELECT 1 AS ready');
    }
    return okCheck('storage', 'Storage', 'Local database is ready.');
  } catch (error) {
    return degradedCheck(
      'storage',
      'Storage',
      `Local database responded with an error: ${error.message}`,
      'Restart Anvil before using paid-alpha workflows.'
    );
  }
}

function checkModel(store) {
  const endpoint = safeGet(store, 'llmEndpoint', 'http://127.0.0.1:11434');
  const currentModel = String(safeGet(store, 'currentModel', '') || '').trim();
  if (!currentModel) {
    return needsSetupCheck(
      'selected_model',
      'Selected Model',
      'No chat model is selected.',
      'Open the model picker and choose a local model.',
      { endpoint }
    );
  }
  return okCheck(
    'selected_model',
    'Selected Model',
    `Using ${path.basename(currentModel)}.`,
    null,
    { endpoint, model: currentModel }
  );
}

async function checkLocalModelRuntime(store, fetchJson) {
  const endpoint = safeGet(store, 'llmEndpoint', 'http://127.0.0.1:11434');
  const currentModel = String(safeGet(store, 'currentModel', '') || '').trim();
  try {
    const response = await fetchJson(`${endpoint}/api/tags`, { timeout: 1500 });
    const models = Array.isArray(response?.data?.models) ? response.data.models : [];
    if (response?.status !== 200) {
      return needsSetupCheck(
        'local_model_runtime',
        'Local Model Runtime',
        `Ollama responded with HTTP ${response?.status || 'unknown'}.`,
        'Restart Ollama, then refresh alpha readiness.',
        { endpoint }
      );
    }
    if (models.length === 0) {
      return needsSetupCheck(
        'local_model_runtime',
        'Local Model Runtime',
        'Ollama is running but no local models are installed.',
        'Install or import a local chat model from the model hub.',
        { endpoint, modelCount: 0 }
      );
    }
    const modelNames = models.map((model) => String(model.name || model.model || '').trim()).filter(Boolean);
    const selectedModelAvailable = currentModel
      ? modelNames.some((modelName) => modelName === currentModel || modelName.startsWith(`${currentModel}:`))
      : false;
    if (currentModel && !selectedModelAvailable) {
      return degradedCheck(
        'local_model_runtime',
        'Local Model Runtime',
        `Ollama is running with ${models.length} model${models.length === 1 ? '' : 's'}, but the selected model is not listed.`,
        'Choose an installed local model from the model picker.',
        { endpoint, modelCount: models.length }
      );
    }
    return okCheck(
      'local_model_runtime',
      'Local Model Runtime',
      `Ollama is reachable with ${models.length} local model${models.length === 1 ? '' : 's'}.`,
      null,
      { endpoint, modelCount: models.length }
    );
  } catch (error) {
    return needsSetupCheck(
      'local_model_runtime',
      'Local Model Runtime',
      `Ollama is unavailable at ${endpoint}.`,
      'Start Ollama, then refresh alpha readiness.',
      { endpoint, error: error.message }
    );
  }
}

function checkPolicy(currentWorkspace) {
  const isVault = currentWorkspace === 'nsfw' || currentWorkspace === 'vault';
  if (isVault) {
    return okCheck(
      'policy',
      'Vault Policy',
      'Vault workspace is active; private metadata is minimized.',
      null,
      { policyMode: 'vault' }
    );
  }
  return okCheck(
    'policy',
    'Privacy Policy',
    'Default local-first policy is active.',
    null,
    { policyMode: 'default' }
  );
}

function checkDevForgeHandoff(devforgeHandoff, projectPath) {
  try {
    const status = devforgeHandoff?.getStatus?.(projectPath || '') || null;
    if (!status?.launcherAvailable) {
      return degradedCheck(
        'devforge_handoff',
        'DevForge IDE',
        'Full IDE handoff is optional for paid alpha, but no DevForge launcher was found.',
        'Set DEVFORGE_IDE_BINARY or DEVFORGE_IDE_CHECKOUT.',
        {
          launcherAvailable: false,
          checkoutRoot: status?.checkoutRoot || null,
          detectedUrlProtocol: status?.detectedUrlProtocol || null,
        }
      );
    }
    return okCheck(
      'devforge_handoff',
      'DevForge IDE',
      'Full IDE handoff is configured.',
      null,
      {
        launcherAvailable: true,
        launcher: status.launcher,
        checkoutRoot: status.checkoutRoot,
        detectedUrlProtocol: status.detectedUrlProtocol,
      }
    );
  } catch (error) {
    return degradedCheck(
      'devforge_handoff',
      'DevForge IDE',
      `Full IDE handoff check failed: ${error.message}`,
      'Open Settings and verify DevForge handoff paths.'
    );
  }
}

function checkAppMetadata(metadata, isPackaged) {
  if (metadata.error) {
    return degradedCheck(
      'app_metadata',
      'Anvil Build',
      `App metadata could not be read: ${metadata.error}`,
      'Rebuild the app before shipping.'
    );
  }
  return okCheck(
    'app_metadata',
    'Anvil Build',
    `${metadata.productName || 'Anvil'} ${metadata.version}${isPackaged ? ' packaged' : ' dev build'}.`,
    null,
    { version: metadata.version, productName: metadata.productName, isPackaged: Boolean(isPackaged) }
  );
}

function createAlphaReadiness({
  db = null,
  devforgeHandoff = null,
  getAppVersion = null,
  homeDir = os.homedir(),
  isPackaged = false,
  packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json'),
  store = null,
  fetchJson = requestJson,
} = {}) {
  async function getReadiness(payload = {}) {
    const metadata = readPackageMetadata(packageJsonPath);
    if (typeof getAppVersion === 'function') {
      try {
        metadata.version = getAppVersion() || metadata.version;
      } catch (_) {
        // Keep package metadata fallback.
      }
    }

    const projectPath = String(payload.projectPath || '').trim();
    const currentWorkspace = String(payload.currentWorkspace || '').trim();
    const runtimeCheck = await checkLocalModelRuntime(store, fetchJson);
    const checks = [
      checkAppMetadata(metadata, isPackaged),
      runtimeCheck,
      checkModel(store),
      checkPolicy(currentWorkspace),
      checkDevForgeHandoff(devforgeHandoff, projectPath),
      checkDatabase(db),
    ];
    const status = normalizeStatus(checks);

    return {
      schemaVersion: ALPHA_READINESS_SCHEMA_VERSION,
      success: status !== 'needs_setup',
      status,
      product: {
        name: 'Anvil',
        artifact: 'Anvil Hub',
        version: metadata.version,
        paidAlpha: true,
      },
      sharedHome: path.join(homeDir, '.devforge'),
      checks,
      generatedAt: new Date().toISOString(),
    };
  }

  return { getReadiness };
}

module.exports = {
  ALPHA_READINESS_SCHEMA_VERSION,
  createAlphaReadiness,
};
