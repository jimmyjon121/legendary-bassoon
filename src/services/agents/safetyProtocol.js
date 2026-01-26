/**
 * SafetyProtocol - The "Safe Border" for AI Operations
 * 
 * This service ensures that autonomous AI agents operate within strict boundaries.
 * It manages:
 * 1. Git Isolation (Auto-branching)
 * 2. Rollback Capabilities
 * 3. File System Locks
 */

class SafetyProtocol {
  constructor() {
    this.activeSession = null;
    this.originalBranch = null;
    this.sandboxBranch = null;
    this.checkpoints = [];
  }

  /**
   * Initialize a safe session.
   * Creates a new git branch for the AI to work in.
   */
  async engageSafetyProtocol(taskName) {
    try {
      console.log('🛡️ Engaging Safety Protocol...');
      
      // 1. Get current status
      const status = await window.api.git.status();
      this.originalBranch = status.current;

      // 2. Ensure clean state (stash if needed)
      if (status.modified.length > 0) {
        console.log('📦 Stashing current changes...');
        await window.api.git.stash();
      }

      // 3. Create sanitized branch name
      const timestamp = new Date().getTime();
      const sanitizedName = taskName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      this.sandboxBranch = `night-shift/${sanitizedName}-${timestamp}`;

      // 4. Checkout new branch
      console.log(`🌿 Creating sandbox branch: ${this.sandboxBranch}`);
      await window.api.git.checkout(['-b', this.sandboxBranch]);

      this.activeSession = {
        startTime: Date.now(),
        taskName,
        originalBranch: this.originalBranch,
        sandboxBranch: this.sandboxBranch,
      };

      return {
        success: true,
        session: this.activeSession,
        message: `Safety Protocol Engaged. Working in isolated branch: ${this.sandboxBranch}`
      };

    } catch (error) {
      console.error('❌ Safety Protocol Failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a checkpoint (git commit) that we can roll back to.
   */
  async createCheckpoint(message) {
    if (!this.activeSession) return;

    try {
      await window.api.git.add('.');
      await window.api.git.commit(`[AI Checkpoint] ${message}`);
      
      const log = await window.api.git.log();
      const hash = log.latest.hash;
      
      this.checkpoints.push({
        hash,
        message,
        timestamp: Date.now()
      });

      console.log(`📍 Checkpoint created: ${message} (${hash.substring(0, 7)})`);
      return hash;
    } catch (error) {
      console.error('Failed to create checkpoint:', error);
    }
  }

  /**
   * Rollback to a specific checkpoint
   */
  async rollback(hash) {
    if (!this.activeSession) return;

    try {
      console.log(`⏪ Rolling back to ${hash}...`);
      await window.api.git.reset(['--hard', hash]);
      return true;
    } catch (error) {
      console.error('Rollback failed:', error);
      return false;
    }
  }

  /**
   * Terminate the session.
   * If success: Keeps the branch for user review.
   * If failure: Offers to delete the branch and return to original.
   */
  async disengageSafetyProtocol(success = true) {
    if (!this.activeSession) return;

    console.log('🛡️ Disengaging Safety Protocol...');

    try {
      // If we failed badly, we might want to just go back
      if (!success) {
        // Optional: Auto-revert logic here
        // For now, we stay on the branch so the user can debug
      }

      // Notify user
      const report = {
        branch: this.sandboxBranch,
        checkpoints: this.checkpoints.length,
        duration: Date.now() - this.activeSession.startTime,
      };

      this.activeSession = null;
      return report;

    } catch (error) {
      console.error('Error disengaging:', error);
    }
  }

  /**
   * Merge the sandbox branch back into the original branch.
   * ONLY called by explicit user action.
   */
  async mergeToMain() {
    if (!this.sandboxBranch || !this.originalBranch) return;

    try {
      console.log(`🔀 Merging ${this.sandboxBranch} into ${this.originalBranch}...`);
      
      // Checkout original
      await window.api.git.checkout(this.originalBranch);
      
      // Merge
      await window.api.git.mergeFromTo(this.sandboxBranch, this.originalBranch);
      
      // Delete sandbox
      await window.api.git.deleteLocalBranch(this.sandboxBranch);
      
      console.log('✅ Merge complete.');
      return true;
    } catch (error) {
      console.error('Merge failed:', error);
      return false;
    }
  }
}

export const safetyProtocol = new SafetyProtocol();
export default safetyProtocol;

