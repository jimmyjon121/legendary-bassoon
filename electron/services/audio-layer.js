/**
 * Audio Layer
 *
 * Local, offline-first audio synthesis for the chat stream. Produces
 * spoken-sentence WAV chunks (Piper) and ambient mood loops (MusicGen
 * or pre-generated loops). All binaries are user-provided; nothing is
 * downloaded automatically.
 *
 * Design notes:
 *   • The renderer does sentence segmentation on the live token stream
 *     and pushes each sentence here via `audio:synthesize`. Doing it in
 *     the renderer keeps latency low and lets the Web Speech API act as
 *     a zero-config fallback.
 *   • This service only owns the external binaries (Piper for TTS, a
 *     MusicGen wrapper for ambience) because those require child_process
 *     access, and the generated WAV files. Playback happens in the
 *     renderer.
 *   • Safeword red MUST stop both queues immediately. `stop()` kills the
 *     current synthesis child and clears pending work. The chat engine
 *     calls this via IPC on red detection.
 *
 * Config lives in electron-store under `audioLayer`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  engine: 'web-speech',
  piperBinary: '',
  piperVoice: '',
  musicgenEnabled: false,
  musicgenBinary: '',
  musicgenModel: '',
  ambienceDir: '',
  intensityThreshold: 0.4,
  volume: 0.8,
  ducking: true,
});

let _store = null;
let _userDataPath = null;

function _configure({ store, userDataPath }) {
  _store = store;
  _userDataPath = userDataPath;
}

function _sanitizeConfig(cfg = {}) {
  const out = { ...DEFAULT_CONFIG };
  if (typeof cfg.enabled === 'boolean') out.enabled = cfg.enabled;
  if (['web-speech', 'piper', 'off'].includes(cfg.engine)) out.engine = cfg.engine;
  if (typeof cfg.piperBinary === 'string') out.piperBinary = cfg.piperBinary.slice(0, 1024);
  if (typeof cfg.piperVoice === 'string') out.piperVoice = cfg.piperVoice.slice(0, 1024);
  if (typeof cfg.musicgenEnabled === 'boolean') out.musicgenEnabled = cfg.musicgenEnabled;
  if (typeof cfg.musicgenBinary === 'string') out.musicgenBinary = cfg.musicgenBinary.slice(0, 1024);
  if (typeof cfg.musicgenModel === 'string') out.musicgenModel = cfg.musicgenModel.slice(0, 1024);
  if (typeof cfg.ambienceDir === 'string') out.ambienceDir = cfg.ambienceDir.slice(0, 1024);
  if (typeof cfg.intensityThreshold === 'number') {
    out.intensityThreshold = Math.max(0, Math.min(1, cfg.intensityThreshold));
  }
  if (typeof cfg.volume === 'number') out.volume = Math.max(0, Math.min(1, cfg.volume));
  if (typeof cfg.ducking === 'boolean') out.ducking = cfg.ducking;
  return out;
}

function getConfig() {
  if (!_store) return { success: true, config: { ...DEFAULT_CONFIG } };
  try {
    const raw = _store.get('audioLayer') || {};
    return { success: true, config: _sanitizeConfig(raw) };
  } catch (err) {
    return { success: false, error: err.message, config: { ...DEFAULT_CONFIG } };
  }
}

function setConfig(patch = {}) {
  if (!_store) return { success: false, error: 'Audio layer not configured' };
  try {
    const current = _store.get('audioLayer') || {};
    const next = _sanitizeConfig({ ...current, ...patch });
    _store.set('audioLayer', next);
    return { success: true, config: next };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function _audioTempDir() {
  const base = _userDataPath || os.tmpdir();
  const dir = path.join(base, 'audio-cache');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
  return dir;
}

// ─── Piper TTS ───────────────────────────────────────────────────────────
// Piper is a fast offline neural TTS (rhasspy/piper). We invoke it as a
// subprocess and stream stdin text → stdout WAV. The model file (.onnx)
// is supplied via config.piperVoice.

let _activeSynth = null;
const _queuedSpeak = [];

function _killActive() {
  if (!_activeSynth) return;
  try { _activeSynth.kill('SIGKILL'); } catch (_) { /* ignore */ }
  _activeSynth = null;
}

async function _runPiper({ binary, voice, text, outPath }) {
  return new Promise((resolve, reject) => {
    if (!binary || !fs.existsSync(binary)) {
      return reject(new Error('Piper binary not configured or missing'));
    }
    if (!voice || !fs.existsSync(voice)) {
      return reject(new Error('Piper voice model not configured or missing'));
    }
    const args = ['-m', voice, '-f', outPath];
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    _activeSynth = child;
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (err) => {
      _activeSynth = null;
      reject(err);
    });
    child.on('close', (code) => {
      _activeSynth = null;
      if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
      else reject(new Error(`Piper exited with code ${code}: ${stderr.slice(0, 400)}`));
    });
    try {
      child.stdin.write(String(text || '').slice(0, 4000));
      child.stdin.end();
    } catch (err) {
      _activeSynth = null;
      reject(err);
    }
  });
}

async function synthesize({ text, voice, speaker } = {}) {
  const { config } = getConfig();
  if (!config.enabled) return { success: false, skipped: 'disabled' };
  if (config.engine !== 'piper') return { success: false, skipped: 'not-piper' };
  const trimmed = String(text || '').trim();
  if (!trimmed) return { success: false, skipped: 'empty' };

  const outName = `piper-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.wav`;
  const outPath = path.join(_audioTempDir(), outName);
  try {
    await _runPiper({
      binary: config.piperBinary,
      voice: voice || config.piperVoice,
      text: trimmed,
      outPath,
    });
    return { success: true, wavPath: outPath, speaker: speaker || 'narrator' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── MusicGen ambience (best-effort; falls back to pre-gen loops) ────────
let _activeMusicgen = null;

function _killMusicgen() {
  if (!_activeMusicgen) return;
  try { _activeMusicgen.kill('SIGKILL'); } catch (_) { /* ignore */ }
  _activeMusicgen = null;
}

function _pickLoop(ambienceDir, mood) {
  if (!ambienceDir || !fs.existsSync(ambienceDir)) return null;
  try {
    const prefix = String(mood || '').toLowerCase();
    const files = fs.readdirSync(ambienceDir).filter((f) => /\.(wav|mp3|ogg)$/i.test(f));
    if (!files.length) return null;
    const matching = prefix ? files.filter((f) => f.toLowerCase().includes(prefix)) : [];
    const pool = matching.length ? matching : files;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return path.join(ambienceDir, pick);
  } catch (_) {
    return null;
  }
}

async function ambience({ mood = 'neutral', intensity = 0 } = {}) {
  const { config } = getConfig();
  if (!config.enabled) return { success: false, skipped: 'disabled' };
  if (intensity < config.intensityThreshold) {
    return { success: true, skipped: 'below-threshold', intensity };
  }
  const loop = _pickLoop(config.ambienceDir, mood);
  if (loop) {
    return { success: true, loopPath: loop, mood, intensity, source: 'library' };
  }

  if (!config.musicgenEnabled) return { success: true, skipped: 'no-ambience-source' };
  if (!config.musicgenBinary || !fs.existsSync(config.musicgenBinary)) {
    return { success: false, error: 'MusicGen binary not configured' };
  }

  const outName = `ambience-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.wav`;
  const outPath = path.join(_audioTempDir(), outName);
  const prompt = `subtle ${mood} ambient loop, low intensity ${Math.round(intensity * 100)} percent, minimal rhythm`;

  return await new Promise((resolve) => {
    const args = ['--model', config.musicgenModel || '', '--prompt', prompt, '--output', outPath, '--duration', '30'];
    try {
      const child = spawn(config.musicgenBinary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      _activeMusicgen = child;
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      child.on('error', (err) => {
        _activeMusicgen = null;
        resolve({ success: false, error: err.message });
      });
      child.on('close', (code) => {
        _activeMusicgen = null;
        if (code === 0 && fs.existsSync(outPath)) {
          resolve({ success: true, loopPath: outPath, mood, intensity, source: 'musicgen' });
        } else {
          resolve({ success: false, error: `MusicGen exit ${code}: ${stderr.slice(0, 300)}` });
        }
      });
    } catch (err) {
      _activeMusicgen = null;
      resolve({ success: false, error: err.message });
    }
  });
}

function stop() {
  _killActive();
  _killMusicgen();
  _queuedSpeak.length = 0;
  return { success: true };
}

function cleanupOldFiles({ maxAgeMs = 30 * 60 * 1000 } = {}) {
  try {
    const dir = _audioTempDir();
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(full);
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
  return { success: true };
}

module.exports = {
  DEFAULT_CONFIG,
  configure: _configure,
  getConfig,
  setConfig,
  synthesize,
  ambience,
  stop,
  cleanupOldFiles,
};
