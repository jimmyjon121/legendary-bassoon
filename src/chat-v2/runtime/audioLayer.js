/**
 * Audio Layer (renderer-side controller)
 *
 * Bridges the ChatV2Engine stream to local audio output:
 *   • Watches engine.state.streamingContent for newly-completed sentences,
 *     segments them, and speaks each one once.
 *   • Uses Web Speech API as the zero-config default; falls back to Piper
 *     via IPC when engine === 'piper'.
 *   • Manages a crossfaded ambience loop whose target volume follows
 *     engine.sceneIntensity.
 *   • Listens to 'vault-safety' hard-stop and aftercare-engaged events and
 *     kills audio immediately on red safeword.
 *
 * The controller is idempotent: attach() returns a detach() function and
 * holds all mutable state in a local closure. Only one attachment per
 * engine at a time.
 */

import { isVaultWorkspace, WORKSPACE_IDS } from '../../core/types';

const DEFAULT_AMBIENCE_FADE_MS = 1200;

const attached = new WeakMap();

async function getConfig() {
  try {
    const res = await window.electronAPI?.audioGetConfig?.();
    return res?.success ? res.config : null;
  } catch (_) { return null; }
}

function pickWebSpeechVoice(voiceHint) {
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;
    if (!voiceHint) return voices.find((v) => v.default) || voices[0];
    const match = voices.find((v) => v.name?.toLowerCase().includes(String(voiceHint).toLowerCase()));
    return match || voices[0];
  } catch (_) { return null; }
}

function speakWebSpeech(text, { voiceHint, volume = 0.8, onEnd } = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd?.();
    return () => {};
  }
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickWebSpeechVoice(voiceHint);
  if (voice) utter.voice = voice;
  utter.volume = Math.max(0, Math.min(1, volume));
  utter.onend = () => onEnd?.();
  utter.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utter);
  return () => {
    try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
  };
}

async function speakPiper(text, { voice, volume = 0.8, onEnd } = {}) {
  try {
    const res = await window.electronAPI?.audioSynthesize?.({ text, voice });
    if (!res?.success || !res.wavPath) { onEnd?.(); return () => {}; }
    const url = `file://${res.wavPath.replace(/\\/g, '/')}`;
    const el = new Audio(url);
    el.volume = volume;
    el.addEventListener('ended', () => onEnd?.());
    el.addEventListener('error', () => onEnd?.());
    el.play().catch(() => onEnd?.());
    return () => { try { el.pause(); el.src = ''; } catch (_) { /* ignore */ } };
  } catch (_) {
    onEnd?.();
    return () => {};
  }
}

function createAmbienceController() {
  let current = null;
  let currentUrl = null;
  let targetVolume = 0;

  const setVolume = (vol, fadeMs = DEFAULT_AMBIENCE_FADE_MS) => {
    targetVolume = Math.max(0, Math.min(1, vol));
    if (!current) return;
    const startVol = current.volume || 0;
    const start = performance.now();
    const step = (t) => {
      if (!current) return;
      const k = Math.min(1, (t - start) / fadeMs);
      current.volume = startVol + (targetVolume - startVol) * k;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const load = async (wavPath, volume) => {
    const url = `file://${wavPath.replace(/\\/g, '/')}`;
    if (currentUrl === url && current) {
      setVolume(volume);
      return;
    }
    const next = new Audio(url);
    next.loop = true;
    next.volume = 0;
    try { await next.play(); } catch (_) { return; }

    if (current) {
      const fadingOut = current;
      const fadeStart = performance.now();
      const startVol = fadingOut.volume || 0;
      const tick = (t) => {
        const k = Math.min(1, (t - fadeStart) / DEFAULT_AMBIENCE_FADE_MS);
        fadingOut.volume = startVol * (1 - k);
        if (k < 1) requestAnimationFrame(tick);
        else { try { fadingOut.pause(); fadingOut.src = ''; } catch (_) { /* ignore */ } }
      };
      requestAnimationFrame(tick);
    }

    current = next;
    currentUrl = url;
    setVolume(volume);
  };

  const stop = () => {
    if (!current) return;
    const fading = current;
    const startVol = fading.volume || 0;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 400);
      fading.volume = startVol * (1 - k);
      if (k < 1) requestAnimationFrame(tick);
      else { try { fading.pause(); fading.src = ''; } catch (_) { /* ignore */ } }
    };
    requestAnimationFrame(tick);
    current = null;
    currentUrl = null;
    targetVolume = 0;
  };

  return { load, setVolume, stop };
}

function segmentNewSentences(fullText, lastOffset) {
  if (!fullText || fullText.length <= lastOffset) return { sentences: [], offset: lastOffset };
  const pending = fullText.slice(lastOffset);
  const matches = [...pending.matchAll(/[^.!?\n]+[.!?]+/g)];
  if (!matches.length) return { sentences: [], offset: lastOffset };
  const lastMatch = matches[matches.length - 1];
  const consumed = lastMatch.index + lastMatch[0].length;
  const sentences = matches.map((m) => m[0].trim()).filter((s) => s.length >= 3);
  return { sentences, offset: lastOffset + consumed };
}

function chooseMood(intensity, workspace) {
  if (!isVaultWorkspace(workspace)) return 'neutral';
  if (intensity > 0.75) return 'intense';
  if (intensity > 0.45) return 'warm';
  if (intensity > 0.2) return 'soft';
  return 'quiet';
}

export function attachAudioLayer(engine, { workspace = WORKSPACE_IDS.VAULT } = {}) {
  if (!engine) return () => {};
  if (attached.has(engine)) return attached.get(engine);

  let config = null;
  let stopped = false;
  let sentenceOffset = 0;
  let speakingStop = null;
  const queue = [];
  let draining = false;
  const ambience = createAmbienceController();

  const reset = () => {
    sentenceOffset = 0;
    queue.length = 0;
    if (speakingStop) { try { speakingStop(); } catch (_) { /* ignore */ } speakingStop = null; }
    try { window.speechSynthesis?.cancel(); } catch (_) { /* ignore */ }
  };

  const drain = async () => {
    if (draining || stopped) return;
    draining = true;
    while (queue.length && !stopped) {
      const text = queue.shift();
      if (!text) continue;
      await new Promise((resolve) => {
        const onEnd = () => { speakingStop = null; resolve(); };
        if (config?.engine === 'piper') {
          speakPiper(text, {
            voice: config.piperVoice,
            volume: config.volume,
            onEnd,
          }).then((s) => { speakingStop = s; });
        } else {
          speakingStop = speakWebSpeech(text, {
            voiceHint: config?.piperVoice,
            volume: config?.volume ?? 0.8,
            onEnd,
          });
        }
      });
    }
    draining = false;
  };

  const enqueueSentences = (text) => {
    if (!text) return;
    const { sentences, offset } = segmentNewSentences(text, sentenceOffset);
    if (!sentences.length) return;
    sentenceOffset = offset;
    for (const s of sentences) queue.push(s);
    drain();
  };

  const updateAmbience = async () => {
    if (!config?.enabled) return;
    const intensity = engine.sceneIntensity || 0;
    if (intensity < (config.intensityThreshold ?? 0.4)) {
      ambience.setVolume(0);
      return;
    }
    const mood = chooseMood(intensity, workspace);
    const res = await window.electronAPI?.audioAmbience?.({ mood, intensity });
    if (res?.success && res.loopPath) {
      ambience.load(res.loopPath, Math.min(1, intensity) * (config.volume ?? 0.8) * 0.6);
    }
  };

  let lastStreaming = '';
  let lastGenerating = false;
  const unsubEngine = engine.subscribe((state) => {
    if (stopped) return;
    if (!config?.enabled) return;
    const streaming = state.streamingContent || '';
    if (streaming !== lastStreaming) {
      lastStreaming = streaming;
      enqueueSentences(streaming);
    }
    if (state.isGenerating && !lastGenerating) {
      sentenceOffset = 0;
      updateAmbience();
    }
    if (!state.isGenerating && lastGenerating) {
      const remainder = (state.streamingContent || '').slice(sentenceOffset).trim();
      if (remainder.length >= 3) queue.push(remainder);
      sentenceOffset = 0;
      lastStreaming = '';
      drain();
      updateAmbience();
    }
    lastGenerating = state.isGenerating;
  });

  const onSafety = (event) => {
    const detail = event?.detail || {};
    if (detail.type === 'hard-stop' || detail.type === 'aftercare-engaged') {
      reset();
      ambience.stop();
      try { window.electronAPI?.audioStop?.(); } catch (_) { /* ignore */ }
    }
  };
  window.addEventListener('vault-safety', onSafety);

  const refreshInterval = setInterval(async () => {
    if (stopped) return;
    config = await getConfig();
    if (!config?.enabled) {
      reset();
      ambience.stop();
    } else {
      updateAmbience();
    }
  }, 8000);

  getConfig().then((c) => { config = c; if (c?.enabled) updateAmbience(); });

  const detach = () => {
    stopped = true;
    try { unsubEngine?.(); } catch (_) { /* ignore */ }
    window.removeEventListener('vault-safety', onSafety);
    clearInterval(refreshInterval);
    reset();
    ambience.stop();
    try { window.electronAPI?.audioStop?.(); } catch (_) { /* ignore */ }
    attached.delete(engine);
  };

  attached.set(engine, detach);
  return detach;
}

export default attachAudioLayer;
