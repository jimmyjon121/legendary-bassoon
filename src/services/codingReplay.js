/**
 * Coding Replay Service
 * 
 * Records coding sessions and generates animated tutorials
 * that show how code was written step by step.
 */

// Keyframe types
const KEYFRAME_TYPES = {
  CREATE_FILE: 'create_file',
  DELETE_FILE: 'delete_file',
  TYPE: 'type',
  DELETE: 'delete',
  SELECT: 'select',
  NAVIGATE: 'navigate',
  EXPLAIN: 'explain',
  HIGHLIGHT: 'highlight',
  RUN_COMMAND: 'run_command',
  PAUSE: 'pause'
};

// Replay status
const REPLAY_STATUS = {
  STOPPED: 'stopped',
  PLAYING: 'playing',
  PAUSED: 'paused',
  RECORDING: 'recording'
};

class CodingReplay {
  constructor() {
    this.sessions = [];
    this.currentSession = null;
    this.status = REPLAY_STATUS.STOPPED;
    this.currentKeyframe = 0;
    this.playbackSpeed = 1.0;
    this.listeners = new Set();
    this.playbackInterval = null;
  }

  /**
   * Start recording a new session
   */
  startRecording(options = {}) {
    if (this.status === REPLAY_STATUS.RECORDING) {
      throw new Error('Already recording');
    }

    this.currentSession = {
      id: `replay_${Date.now()}`,
      title: options.title || `Session ${this.sessions.length + 1}`,
      description: options.description || '',
      author: options.author || 'unknown',
      startedAt: Date.now(),
      keyframes: [],
      files: new Map(), // file -> content snapshots
      metadata: {
        language: options.language || 'javascript',
        difficulty: options.difficulty || 'intermediate',
        tags: options.tags || []
      }
    };

    this.status = REPLAY_STATUS.RECORDING;
    this.notifyListeners();

    return this.currentSession;
  }

  /**
   * Stop recording
   */
  stopRecording() {
    if (this.status !== REPLAY_STATUS.RECORDING) return null;

    this.currentSession.endedAt = Date.now();
    this.currentSession.duration = this.calculateDuration();
    this.currentSession.status = 'completed';

    // Optimize keyframes
    this.optimizeKeyframes();

    this.sessions.push(this.currentSession);
    const session = this.currentSession;

    this.currentSession = null;
    this.status = REPLAY_STATUS.STOPPED;
    this.notifyListeners();

    return session;
  }

  /**
   * Add keyframe to current recording
   */
  addKeyframe(keyframe) {
    if (!this.currentSession || this.status !== REPLAY_STATUS.RECORDING) {
      return null;
    }

    const lastKeyframe = this.currentSession.keyframes[this.currentSession.keyframes.length - 1];
    const timeSinceStart = Date.now() - this.currentSession.startedAt;

    const recorded = {
      id: `kf_${this.currentSession.keyframes.length}`,
      timestamp: timeSinceStart,
      type: keyframe.type,
      file: keyframe.file,
      content: keyframe.content,
      position: keyframe.position, // cursor position
      selection: keyframe.selection,
      narration: keyframe.narration,
      duration: keyframe.duration || this.estimateDuration(keyframe),
      options: keyframe.options || {}
    };

    this.currentSession.keyframes.push(recorded);

    // Store file snapshot
    if (keyframe.file && keyframe.fullContent) {
      this.currentSession.files.set(keyframe.file, keyframe.fullContent);
    }

    this.notifyListeners();
    return recorded;
  }

  /**
   * Add narration to current or specific keyframe
   */
  addNarration(text, keyframeIndex = null) {
    if (!this.currentSession) return;

    if (keyframeIndex !== null) {
      const keyframe = this.currentSession.keyframes[keyframeIndex];
      if (keyframe) {
        keyframe.narration = text;
      }
    } else {
      // Add as explanation keyframe
      this.addKeyframe({
        type: KEYFRAME_TYPES.EXPLAIN,
        content: text,
        duration: this.estimateReadTime(text)
      });
    }
  }

  /**
   * Estimate read time for text
   */
  estimateReadTime(text) {
    const wordsPerMinute = 150;
    const words = text.split(/\s+/).length;
    return Math.max(2000, (words / wordsPerMinute) * 60000);
  }

  /**
   * Estimate duration for keyframe
   */
  estimateDuration(keyframe) {
    switch (keyframe.type) {
      case KEYFRAME_TYPES.TYPE:
        // ~100ms per character
        return (keyframe.content?.length || 0) * 100;
      case KEYFRAME_TYPES.DELETE:
        return (keyframe.content?.length || 0) * 50;
      case KEYFRAME_TYPES.CREATE_FILE:
        return 1000;
      case KEYFRAME_TYPES.NAVIGATE:
        return 500;
      case KEYFRAME_TYPES.HIGHLIGHT:
        return 2000;
      case KEYFRAME_TYPES.RUN_COMMAND:
        return 3000;
      default:
        return 1000;
    }
  }

  /**
   * Optimize keyframes (combine rapid typing, etc.)
   */
  optimizeKeyframes() {
    if (!this.currentSession) return;

    const optimized = [];
    let buffer = null;

    for (const keyframe of this.currentSession.keyframes) {
      // Combine consecutive typing
      if (keyframe.type === KEYFRAME_TYPES.TYPE) {
        if (buffer && buffer.type === KEYFRAME_TYPES.TYPE && 
            buffer.file === keyframe.file &&
            keyframe.timestamp - buffer.timestamp < 500) {
          buffer.content += keyframe.content;
          buffer.duration += keyframe.duration;
        } else {
          if (buffer) optimized.push(buffer);
          buffer = { ...keyframe };
        }
      } else {
        if (buffer) {
          optimized.push(buffer);
          buffer = null;
        }
        optimized.push(keyframe);
      }
    }

    if (buffer) optimized.push(buffer);
    this.currentSession.keyframes = optimized;
  }

  /**
   * Calculate total duration
   */
  calculateDuration() {
    if (!this.currentSession) return 0;
    return this.currentSession.keyframes.reduce((total, kf) => total + kf.duration, 0);
  }

  /**
   * Load session for playback
   */
  loadSession(sessionId) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return null;

    this.currentSession = session;
    this.currentKeyframe = 0;
    this.status = REPLAY_STATUS.STOPPED;
    this.notifyListeners();

    return session;
  }

  /**
   * Play session
   */
  play() {
    if (!this.currentSession || this.status === REPLAY_STATUS.PLAYING) return;

    this.status = REPLAY_STATUS.PLAYING;
    this.startPlayback();
    this.notifyListeners();
  }

  /**
   * Pause playback
   */
  pause() {
    if (this.status !== REPLAY_STATUS.PLAYING) return;

    this.status = REPLAY_STATUS.PAUSED;
    this.stopPlayback();
    this.notifyListeners();
  }

  /**
   * Stop playback
   */
  stop() {
    this.status = REPLAY_STATUS.STOPPED;
    this.currentKeyframe = 0;
    this.stopPlayback();
    this.notifyListeners();
  }

  /**
   * Seek to specific time/keyframe
   */
  seek(target) {
    if (!this.currentSession) return;

    if (typeof target === 'number') {
      // Seek to time
      let elapsed = 0;
      for (let i = 0; i < this.currentSession.keyframes.length; i++) {
        elapsed += this.currentSession.keyframes[i].duration;
        if (elapsed >= target) {
          this.currentKeyframe = i;
          break;
        }
      }
    } else if (target.keyframe !== undefined) {
      // Seek to keyframe index
      this.currentKeyframe = Math.min(
        target.keyframe,
        this.currentSession.keyframes.length - 1
      );
    }

    this.notifyListeners();
  }

  /**
   * Set playback speed
   */
  setSpeed(speed) {
    this.playbackSpeed = Math.max(0.25, Math.min(4, speed));
    
    // Restart playback if playing
    if (this.status === REPLAY_STATUS.PLAYING) {
      this.stopPlayback();
      this.startPlayback();
    }

    this.notifyListeners();
  }

  /**
   * Start playback loop
   */
  startPlayback() {
    if (this.playbackInterval) return;

    const advanceKeyframe = () => {
      if (this.status !== REPLAY_STATUS.PLAYING) return;
      if (!this.currentSession) return;

      if (this.currentKeyframe >= this.currentSession.keyframes.length) {
        this.stop();
        return;
      }

      const keyframe = this.currentSession.keyframes[this.currentKeyframe];
      this.notifyListeners();

      // Schedule next keyframe
      const nextDelay = keyframe.duration / this.playbackSpeed;
      this.currentKeyframe++;

      this.playbackInterval = setTimeout(advanceKeyframe, nextDelay);
    };

    advanceKeyframe();
  }

  /**
   * Stop playback loop
   */
  stopPlayback() {
    if (this.playbackInterval) {
      clearTimeout(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  /**
   * Get current playback state
   */
  getPlaybackState() {
    if (!this.currentSession) return null;

    const keyframe = this.currentSession.keyframes[this.currentKeyframe];
    const elapsed = this.currentSession.keyframes
      .slice(0, this.currentKeyframe)
      .reduce((sum, kf) => sum + kf.duration, 0);

    return {
      sessionId: this.currentSession.id,
      status: this.status,
      currentKeyframe: this.currentKeyframe,
      totalKeyframes: this.currentSession.keyframes.length,
      elapsed,
      duration: this.currentSession.duration,
      progress: (elapsed / this.currentSession.duration) * 100,
      speed: this.playbackSpeed,
      keyframe
    };
  }

  /**
   * Generate AI narration for keyframes
   */
  async generateNarration(sessionId) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return null;

    // Mock AI narration generation
    for (const keyframe of session.keyframes) {
      if (keyframe.narration) continue;

      switch (keyframe.type) {
        case KEYFRAME_TYPES.CREATE_FILE:
          keyframe.narration = `Creating a new file: ${keyframe.file}`;
          break;
        case KEYFRAME_TYPES.TYPE:
          if (keyframe.content?.includes('function') || keyframe.content?.includes('=>')) {
            keyframe.narration = 'Defining a new function...';
          } else if (keyframe.content?.includes('import')) {
            keyframe.narration = 'Adding necessary imports...';
          }
          break;
        case KEYFRAME_TYPES.RUN_COMMAND:
          keyframe.narration = `Running command: ${keyframe.content}`;
          break;
      }
    }

    return session;
  }

  /**
   * Export session for sharing
   */
  exportSession(sessionId, format = 'json') {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return null;

    switch (format) {
      case 'json':
        return {
          ...session,
          files: Array.from(session.files.entries()),
          exportedAt: Date.now()
        };
      
      case 'markdown':
        return this.exportAsMarkdown(session);
      
      case 'html':
        return this.exportAsHTML(session);
      
      default:
        return session;
    }
  }

  /**
   * Export as markdown tutorial
   */
  exportAsMarkdown(session) {
    let md = `# ${session.title}\n\n`;
    md += `${session.description}\n\n`;
    md += `**Duration:** ${this.formatDuration(session.duration)}\n`;
    md += `**Difficulty:** ${session.metadata.difficulty}\n\n`;
    md += `---\n\n`;

    let step = 1;
    for (const keyframe of session.keyframes) {
      if (keyframe.type === KEYFRAME_TYPES.EXPLAIN) {
        md += `## ${keyframe.content}\n\n`;
      } else if (keyframe.type === KEYFRAME_TYPES.CREATE_FILE) {
        md += `### Step ${step++}: Create ${keyframe.file}\n\n`;
        if (keyframe.narration) md += `${keyframe.narration}\n\n`;
      } else if (keyframe.type === KEYFRAME_TYPES.TYPE && keyframe.content?.length > 20) {
        md += `\`\`\`${session.metadata.language}\n${keyframe.content}\n\`\`\`\n\n`;
        if (keyframe.narration) md += `> ${keyframe.narration}\n\n`;
      }
    }

    return md;
  }

  /**
   * Export as HTML player
   */
  exportAsHTML(session) {
    return `<!DOCTYPE html>
<html>
<head>
  <title>${session.title}</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 20px; }
    .keyframe { margin: 20px 0; padding: 15px; border-left: 3px solid #0066cc; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; overflow-x: auto; }
    .narration { color: #666; font-style: italic; }
  </style>
</head>
<body>
  <h1>${session.title}</h1>
  <p>${session.description}</p>
  <div id="player">
    ${session.keyframes.map(kf => this.keyframeToHTML(kf, session.metadata.language)).join('\n')}
  </div>
</body>
</html>`;
  }

  /**
   * Convert keyframe to HTML
   */
  keyframeToHTML(keyframe, language) {
    let html = `<div class="keyframe" data-type="${keyframe.type}">`;
    
    if (keyframe.narration) {
      html += `<p class="narration">${keyframe.narration}</p>`;
    }
    
    if (keyframe.type === KEYFRAME_TYPES.TYPE && keyframe.content) {
      html += `<pre><code class="language-${language}">${this.escapeHTML(keyframe.content)}</code></pre>`;
    }
    
    html += `</div>`;
    return html;
  }

  /**
   * Escape HTML
   */
  escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Get all sessions
   */
  getSessions() {
    return [...this.sessions];
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.sessions.find(s => s.id === sessionId);
  }

  /**
   * Delete session
   */
  deleteSession(sessionId) {
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
      this.status = REPLAY_STATUS.STOPPED;
    }
    this.notifyListeners();
  }

  /**
   * Add listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify listeners
   */
  notifyListeners() {
    const state = {
      status: this.status,
      playback: this.getPlaybackState(),
      sessions: this.sessions.length
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Coding replay listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getCodingReplay() {
  if (!instance) {
    instance = new CodingReplay();
  }
  return instance;
}

export { KEYFRAME_TYPES, REPLAY_STATUS };
export default CodingReplay;
