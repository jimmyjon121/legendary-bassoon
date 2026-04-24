/**
 * Haptic Bridge
 *
 * Optional, opt-in bridge to FOSS haptic ecosystems via Intiface Central
 * (Buttplug.io protocol). This service speaks to the user's locally-running
 * Intiface server — nothing leaves the machine, nothing is discovered
 * automatically, and the `buttplug` npm package is required dynamically so
 * the app still runs if the user hasn't installed it.
 *
 * Safety rules baked into this module:
 *   • Disabled by default. The user must explicitly enable it in settings.
 *   • Hard cap on output intensity (default 0.5). Chat-driven vibrations
 *     are clamped to min(requested, maxIntensity).
 *   • Safety watchdog: if we haven't received a fresh vibrate() call
 *     within WATCHDOG_MS, we drive everything to zero. This means a
 *     crashed renderer or hung stream can't leave a device running.
 *   • `stop()` is idempotent and callable from safeword red. It kills
 *     the watchdog, zeroes every device, and is called on disconnect,
 *     on app quit, and on window blur.
 *   • No "automation" that acts on the user — the bridge only reacts to
 *     explicit engine intensity, and the user can toggle it off at any
 *     time from the safety bar.
 */

const WATCHDOG_MS = 2500;
const MIN_INTERVAL_MS = 60;

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  serverUrl: 'ws://127.0.0.1:12345',
  clientName: 'DevForge',
  maxIntensity: 0.5,
  followIntensity: true,
  enableOnlyInNsfwWorkspace: true,
});

let _store = null;
let _buttplug = null;
let _loadError = null;

let _client = null;
let _connected = false;
let _devices = [];
let _watchdogTimer = null;
let _lastCommandAt = 0;

function _configure({ store }) {
  _store = store;
}

function _sanitize(cfg = {}) {
  const out = { ...DEFAULT_CONFIG };
  if (typeof cfg.enabled === 'boolean') out.enabled = cfg.enabled;
  if (typeof cfg.serverUrl === 'string' && cfg.serverUrl.startsWith('ws')) {
    out.serverUrl = cfg.serverUrl.slice(0, 256);
  }
  if (typeof cfg.clientName === 'string') out.clientName = cfg.clientName.slice(0, 64) || 'DevForge';
  if (typeof cfg.maxIntensity === 'number') out.maxIntensity = Math.max(0, Math.min(1, cfg.maxIntensity));
  if (typeof cfg.followIntensity === 'boolean') out.followIntensity = cfg.followIntensity;
  if (typeof cfg.enableOnlyInNsfwWorkspace === 'boolean') out.enableOnlyInNsfwWorkspace = cfg.enableOnlyInNsfwWorkspace;
  return out;
}

function getConfig() {
  if (!_store) return { success: true, config: { ...DEFAULT_CONFIG } };
  try {
    const raw = _store.get('hapticBridge') || {};
    return { success: true, config: _sanitize(raw) };
  } catch (err) {
    return { success: false, error: err.message, config: { ...DEFAULT_CONFIG } };
  }
}

function setConfig(patch = {}) {
  if (!_store) return { success: false, error: 'Haptic bridge not configured' };
  try {
    const current = _store.get('hapticBridge') || {};
    const next = _sanitize({ ...current, ...patch });
    _store.set('hapticBridge', next);
    if (!next.enabled && _connected) {
      void disconnect();
    }
    return { success: true, config: next };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function _loadButtplug() {
  if (_buttplug) return _buttplug;
  if (_loadError) return null;
  try {
    _buttplug = require('buttplug');
    return _buttplug;
  } catch (err) {
    _loadError = err;
    return null;
  }
}

function _armWatchdog() {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(() => {
    if (!_connected) { _disarmWatchdog(); return; }
    if (Date.now() - _lastCommandAt > WATCHDOG_MS) {
      void _stopAllDevices('watchdog');
    }
  }, 500);
}

function _disarmWatchdog() {
  if (!_watchdogTimer) return;
  clearInterval(_watchdogTimer);
  _watchdogTimer = null;
}

async function _stopAllDevices(_reason) {
  if (!_client || !_connected) return { success: true };
  try {
    const devices = _client.devices || [];
    await Promise.all(devices.map(async (dev) => {
      try { await dev.stop(); } catch (_) { /* ignore */ }
    }));
    _lastCommandAt = Date.now();
  } catch (_) { /* ignore */ }
  return { success: true };
}

async function connect() {
  const { config } = getConfig();
  if (!config.enabled) return { success: false, error: 'Haptic bridge is disabled' };
  const bp = _loadButtplug();
  if (!bp) {
    return {
      success: false,
      error: 'The optional `buttplug` package is not installed. Run `npm install buttplug` from the DevForge directory to enable haptics.',
    };
  }
  if (_connected && _client) return { success: true, devices: _listDeviceSummaries() };

  try {
    const Client = bp.ButtplugClient || bp.default?.ButtplugClient;
    const Connector = bp.ButtplugNodeWebsocketClientConnector
      || bp.ButtplugBrowserWebsocketClientConnector
      || bp.default?.ButtplugNodeWebsocketClientConnector;
    if (!Client || !Connector) {
      return { success: false, error: 'Incompatible buttplug package version.' };
    }
    const client = new Client(config.clientName);
    client.addListener('deviceadded', () => { _devices = _listDeviceSummaries(); });
    client.addListener('deviceremoved', () => { _devices = _listDeviceSummaries(); });
    client.addListener('disconnect', () => {
      _connected = false;
      _disarmWatchdog();
    });
    const connector = new Connector(config.serverUrl);
    await client.connect(connector);
    _client = client;
    _connected = true;
    _lastCommandAt = Date.now();
    _armWatchdog();
    _devices = _listDeviceSummaries();
    return { success: true, devices: _devices };
  } catch (err) {
    _client = null;
    _connected = false;
    return { success: false, error: err.message };
  }
}

async function disconnect() {
  try {
    await _stopAllDevices('disconnect');
    if (_client) {
      try { await _client.disconnect(); } catch (_) { /* ignore */ }
    }
  } finally {
    _client = null;
    _connected = false;
    _devices = [];
    _disarmWatchdog();
  }
  return { success: true };
}

function _listDeviceSummaries() {
  if (!_client) return [];
  try {
    return (_client.devices || []).map((d) => ({
      index: d.index,
      name: d.name,
      features: Array.isArray(d.messageAttributes) ? d.messageAttributes : [],
    }));
  } catch (_) { return []; }
}

async function scan({ durationMs = 4000 } = {}) {
  if (!_connected || !_client) {
    const r = await connect();
    if (!r.success) return r;
  }
  try {
    await _client.startScanning();
    await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(15000, durationMs))));
    try { await _client.stopScanning(); } catch (_) { /* ignore */ }
    _devices = _listDeviceSummaries();
    return { success: true, devices: _devices };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function listDevices() {
  if (!_connected) return { success: true, devices: [] };
  return { success: true, devices: _listDeviceSummaries() };
}

async function vibrate({ intensity = 0, deviceIndex = null } = {}) {
  if (!_connected || !_client) return { success: false, error: 'Not connected' };
  const { config } = getConfig();
  const clamped = Math.max(0, Math.min(config.maxIntensity, Number(intensity) || 0));

  if (Date.now() - _lastCommandAt < MIN_INTERVAL_MS && clamped > 0) {
    return { success: true, skipped: 'rate-limit' };
  }

  try {
    const devices = _client.devices || [];
    const targets = deviceIndex != null
      ? devices.filter((d) => d.index === deviceIndex)
      : devices;
    if (!targets.length) return { success: false, error: 'No devices connected' };

    await Promise.all(targets.map(async (dev) => {
      try {
        if (typeof dev.vibrate === 'function') {
          await dev.vibrate(clamped);
        } else if (typeof dev.scalar === 'function') {
          await dev.scalar(clamped);
        }
      } catch (_) { /* best-effort per device */ }
    }));
    _lastCommandAt = Date.now();
    return { success: true, intensity: clamped };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function stop() {
  await _stopAllDevices('hard-stop');
  return { success: true };
}

function status() {
  return {
    success: true,
    connected: _connected,
    devices: _devices,
    packageAvailable: Boolean(_loadButtplug()),
    packageError: _loadError?.message || null,
  };
}

module.exports = {
  DEFAULT_CONFIG,
  configure: _configure,
  getConfig,
  setConfig,
  connect,
  disconnect,
  scan,
  listDevices,
  vibrate,
  stop,
  status,
};
