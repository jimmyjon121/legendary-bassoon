import { api, hasMethod } from '../../utils/electronAPI';
import { useEditorStore } from '../../stores/editorStore';

/**
 * SafetyProtocol - lightweight safety guardrails for autonomous runs.
 *
 * This implementation is resilient:
 * - If git IPC is available, it records branch metadata.
 * - If git IPC is unavailable, it degrades gracefully instead of aborting.
 */
class SafetyProtocol {
  constructor() {
    this.activeSession = null;
    this.originalBranch = null;
    this.sandboxBranch = null;
    this.checkpoints = [];
  }

  getProjectRoot() {
    try {
      return useEditorStore.getState()?.rootPath || '';
    } catch {
      return '';
    }
  }

  supportsGit() {
    return hasMethod('git:status');
  }

  createSession(taskName, options = {}) {
    const timestamp = Date.now();
    const slug = String(taskName || 'task')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task';

    this.sandboxBranch = `night-shift/${slug}-${timestamp}`;
    this.activeSession = {
      startTime: timestamp,
      taskName,
      originalBranch: this.originalBranch || 'unknown',
      sandboxBranch: this.sandboxBranch,
      mode: options.mode || 'degraded',
      projectRoot: options.projectRoot || this.getProjectRoot(),
    };
    return this.activeSession;
  }

  getBaselineFiles(projectRoot = '') {
    const root = String(projectRoot || this.getProjectRoot() || '').replace(/\\/g, '/');
    const editorState = useEditorStore.getState?.() || {};
    const openFiles = Object.keys(editorState.openFiles || {});
    const candidates = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

    for (const filePath of openFiles) {
      const normalized = String(filePath || '').replace(/\\/g, '/');
      if (!normalized) continue;
      if (root && normalized.startsWith(root)) {
        const relative = normalized.slice(root.length).replace(/^\/+/, '');
        if (relative) candidates.push(relative);
      } else {
        candidates.push(normalized);
      }
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  /**
   * Initialize a safety session.
   * Never hard-fails: it returns a degraded session if git integration is missing.
   */
  async engageSafetyProtocol(taskName) {
    try {
      const projectRoot = this.getProjectRoot();
      this.checkpoints = [];

      if (this.supportsGit()) {
        const status = await api.getGitStatus(projectRoot);
        const hasGitStatus = !!status && !status.error;
        this.originalBranch = status?.current || status?.branch || 'unknown';
        const session = this.createSession(taskName, {
          mode: hasGitStatus ? 'git' : 'degraded',
          projectRoot,
        });
        const baselineCheckpoint = await this.createCheckpoint(
          'session_start',
          this.getBaselineFiles(projectRoot)
        );

        return {
          success: true,
          degraded: !hasGitStatus,
          session,
          checkpointId: baselineCheckpoint,
          message: hasGitStatus
            ? `Safety protocol engaged on branch ${session.sandboxBranch}`
            : 'Git status unavailable; running in degraded safety mode.',
        };
      }

      const session = this.createSession(taskName, {
        mode: 'degraded',
        projectRoot,
      });
      const baselineCheckpoint = await this.createCheckpoint(
        'session_start',
        this.getBaselineFiles(projectRoot)
      );
      return {
        success: true,
        degraded: true,
        session,
        checkpointId: baselineCheckpoint,
        message: 'Git integration unavailable; running in degraded safety mode.',
      };
    } catch (error) {
      const session = this.createSession(taskName, { mode: 'degraded' });
      return {
        success: true,
        degraded: true,
        session,
        message: `Safety protocol degraded: ${error?.message || 'unknown error'}`,
      };
    }
  }

  /**
   * Create a logical checkpoint.
   * In degraded mode this is an in-memory marker.
   */
  async createCheckpoint(message, files = null) {
    if (!this.activeSession) return null;
    const projectRoot = this.activeSession.projectRoot || this.getProjectRoot();
    const fileList = Array.isArray(files) ? files : this.getBaselineFiles(projectRoot);
    const result = await api.toolCreateCheckpoint(projectRoot, fileList, message);
    const checkpointId = result?.ok ? result.checkpointId : null;
    if (!checkpointId) return null;
    this.checkpoints.push({
      hash: checkpointId,
      message,
      timestamp: Date.now(),
      mode: this.activeSession.mode,
      filesCount: Array.isArray(fileList) ? fileList.length : 0,
    });
    if (this.checkpoints.length > 60) {
      this.checkpoints.splice(0, this.checkpoints.length - 60);
    }
    return checkpointId;
  }

  async rollback(checkpointId = null) {
    const target = checkpointId
      || this.checkpoints[this.checkpoints.length - 1]?.hash
      || null;
    if (!target) return false;
    const result = await api.toolRollbackCheckpoint(target);
    return Boolean(result?.ok || result?.success);
  }

  async disengageSafetyProtocol() {
    if (!this.activeSession) return null;
    const report = {
      branch: this.sandboxBranch,
      checkpoints: this.checkpoints.length,
      duration: Date.now() - this.activeSession.startTime,
      mode: this.activeSession.mode,
    };
    this.activeSession = null;
    return report;
  }

  async mergeToMain() {
    return false;
  }
}

export const safetyProtocol = new SafetyProtocol();
export default safetyProtocol;
