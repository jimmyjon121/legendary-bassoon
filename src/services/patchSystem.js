/**
 * Patch System
 * 
 * Manages structured, atomic code patches:
 * - Create patches with before/after/rationale
 * - Calculate blast radius (impact analysis)
 * - Generate unified diffs
 * - Apply/reject with undo support
 * - Patch stacks for partial application
 */

// ============================================================================
// Types & Constants
// ============================================================================

const PATCH_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  REJECTED: 'rejected',
  FAILED: 'failed'
};

const OPERATION = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  RENAME: 'rename'
};

const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// ============================================================================
// Patch System Class
// ============================================================================

export class PatchSystem {
  constructor() {
    this.patches = [];
    this.appliedStack = [];  // For undo
    this.sessionId = `patches_${Date.now()}`;
  }

  /**
   * Create a new patch
   */
  createPatch({
    path,
    operation,
    startLine,
    endLine,
    oldContent,
    newContent,
    newPath,
    rationale,
    metadata = {}
  }) {
    // Validate required fields
    if (!path) throw new Error('path is required');
    if (!operation) throw new Error('operation is required');
    if (!rationale) throw new Error('rationale is required');
    
    if (operation === OPERATION.UPDATE || operation === OPERATION.CREATE) {
      if (newContent === undefined) throw new Error('newContent is required for update/create');
    }
    
    if (operation === OPERATION.RENAME && !newPath) {
      throw new Error('newPath is required for rename');
    }

    const patch = {
      id: `patch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      path,
      operation,
      range: operation === OPERATION.UPDATE ? { start: startLine, end: endLine } : null,
      oldContent: oldContent || null,
      newContent: newContent || null,
      newPath: newPath || null,
      rationale,
      status: PATCH_STATUS.PENDING,
      createdAt: Date.now(),
      blastRadius: null,
      diff: null,
      metadata
    };

    // Calculate blast radius
    patch.blastRadius = this.calculateBlastRadius(patch);
    
    // Generate diff if we have old and new content
    if (oldContent !== null && newContent !== null) {
      patch.diff = this.generateDiff(oldContent, newContent, path);
    }

    this.patches.push(patch);
    return patch;
  }

  /**
   * Calculate the blast radius (impact) of a patch
   */
  calculateBlastRadius(patch) {
    const impactedFiles = [];
    let riskLevel = RISK_LEVEL.LOW;
    let reason = '';

    const { path, operation, oldContent, newContent, range } = patch;
    const fileName = path.split(/[\\/]/).pop();
    const ext = (path.split('.').pop() || '').toLowerCase();

    // High-risk file patterns
    const highRiskPatterns = [
      /package\.json$/i,
      /tsconfig\.json$/i,
      /\.env/i,
      /config\./i,
      /index\.(js|ts|jsx|tsx)$/i,
      /main\.(js|ts)$/i,
      /app\.(js|ts|jsx|tsx)$/i
    ];

    // Check if this is a high-risk file
    const isHighRisk = highRiskPatterns.some(p => p.test(path));
    if (isHighRisk) {
      riskLevel = RISK_LEVEL.HIGH;
      reason = 'Modifying configuration or entry point file';
    }

    // Operation-based risk
    if (operation === OPERATION.DELETE) {
      riskLevel = RISK_LEVEL.HIGH;
      reason = 'Deleting file - may break imports';
    } else if (operation === OPERATION.RENAME) {
      riskLevel = RISK_LEVEL.MEDIUM;
      reason = 'Renaming file - imports may need updating';
    }

    // Size-based risk
    if (newContent) {
      const lines = newContent.split('\n').length;
      const oldLines = oldContent ? oldContent.split('\n').length : 0;
      const diff = Math.abs(lines - oldLines);
      
      if (diff > 50) {
        riskLevel = Math.max(riskLevel === RISK_LEVEL.LOW ? 0 : 1, 2) === 2 
          ? RISK_LEVEL.MEDIUM 
          : riskLevel;
        reason = reason || `Large change: ${diff} lines affected`;
      }
    }

    // Check for export changes (could affect other files)
    if (newContent && oldContent) {
      const oldExports = (oldContent.match(/export\s+(default\s+)?(function|const|class|let|var|interface|type)\s+(\w+)/g) || []);
      const newExports = (newContent.match(/export\s+(default\s+)?(function|const|class|let|var|interface|type)\s+(\w+)/g) || []);
      
      const removedExports = oldExports.filter(e => !newExports.includes(e));
      if (removedExports.length > 0) {
        riskLevel = RISK_LEVEL.HIGH;
        reason = `Removing exports: ${removedExports.length} export(s) removed`;
      }
    }

    return {
      riskLevel,
      reason,
      impactedFiles,
      linesAffected: range ? (range.end - range.start + 1) : (newContent?.split('\n').length || 0),
      isBreakingChange: riskLevel === RISK_LEVEL.HIGH || riskLevel === RISK_LEVEL.CRITICAL
    };
  }

  /**
   * Generate a unified diff between old and new content
   */
  generateDiff(oldContent, newContent, filePath) {
    const oldLines = (oldContent || '').split('\n');
    const newLines = (newContent || '').split('\n');
    const hunks = [];
    
    let i = 0, j = 0;
    let currentHunk = null;

    const startHunk = (oldStart, newStart) => {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart,
        newStart,
        oldLines: 0,
        newLines: 0,
        lines: []
      };
    };

    const addToHunk = (type, content, oldLineNum, newLineNum) => {
      if (!currentHunk) startHunk(oldLineNum, newLineNum);
      currentHunk.lines.push({ type, content, oldLine: oldLineNum, newLine: newLineNum });
      if (type === 'removed' || type === 'context') currentHunk.oldLines++;
      if (type === 'added' || type === 'context') currentHunk.newLines++;
    };

    while (i < oldLines.length || j < newLines.length) {
      const oldLine = oldLines[i];
      const newLine = newLines[j];

      if (oldLine === newLine) {
        // Context line
        if (currentHunk && currentHunk.lines.length > 0) {
          addToHunk('context', oldLine, i + 1, j + 1);
        }
        i++;
        j++;
      } else if (i < oldLines.length && (j >= newLines.length || oldLine !== newLines[j])) {
        // Line removed
        addToHunk('removed', oldLine, i + 1, null);
        i++;
      } else {
        // Line added
        addToHunk('added', newLine, null, j + 1);
        j++;
      }
    }

    if (currentHunk && currentHunk.lines.length > 0) {
      hunks.push(currentHunk);
    }

    return {
      filePath,
      hunks,
      stats: {
        additions: hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'added').length, 0),
        deletions: hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'removed').length, 0)
      }
    };
  }

  /**
   * Format diff as unified diff string
   */
  formatDiffString(diff) {
    if (!diff) return '';
    
    const lines = [`--- a/${diff.filePath}`, `+++ b/${diff.filePath}`];
    
    for (const hunk of diff.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        lines.push(`${prefix}${line.content}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Get a patch by ID
   */
  getPatch(patchId) {
    return this.patches.find(p => p.id === patchId) || null;
  }

  /**
   * Get all patches
   */
  getAllPatches() {
    return [...this.patches];
  }

  /**
   * Get pending patches
   */
  getPendingPatches() {
    return this.patches.filter(p => p.status === PATCH_STATUS.PENDING);
  }

  /**
   * Apply a patch
   */
  async applyPatch(patchId) {
    const patch = this.getPatch(patchId);
    if (!patch) throw new Error(`Patch not found: ${patchId}`);
    if (patch.status !== PATCH_STATUS.PENDING) {
      throw new Error(`Patch is not pending: ${patch.status}`);
    }

    try {
      const result = await window.electronAPI.toolApplyPatch(
        await this.getProjectRoot(),
        {
          path: patch.path,
          operation: patch.operation,
          startLine: patch.range?.start,
          endLine: patch.range?.end,
          oldContent: patch.oldContent,
          newContent: patch.newContent,
          newPath: patch.newPath
        }
      );

      if (result.error) {
        patch.status = PATCH_STATUS.FAILED;
        patch.error = result.error;
        throw new Error(result.error);
      }

      patch.status = PATCH_STATUS.APPLIED;
      patch.appliedAt = Date.now();
      patch.result = result;
      
      // Add to undo stack
      this.appliedStack.push(patch);

      return { success: true, patch, result };
    } catch (error) {
      patch.status = PATCH_STATUS.FAILED;
      patch.error = error.message;
      return { success: false, patch, error: error.message };
    }
  }

  /**
   * Reject a patch
   */
  rejectPatch(patchId, reason = '') {
    const patch = this.getPatch(patchId);
    if (!patch) throw new Error(`Patch not found: ${patchId}`);
    
    patch.status = PATCH_STATUS.REJECTED;
    patch.rejectedAt = Date.now();
    patch.rejectionReason = reason;
    
    return patch;
  }

  /**
   * Undo the last applied patch
   */
  async undoLastPatch() {
    const patch = this.appliedStack.pop();
    if (!patch) return null;

    // Create a reverse patch
    const reversePatch = this.createPatch({
      path: patch.newPath || patch.path,
      operation: patch.operation === OPERATION.CREATE ? OPERATION.DELETE :
                 patch.operation === OPERATION.DELETE ? OPERATION.CREATE :
                 patch.operation === OPERATION.RENAME ? OPERATION.RENAME :
                 OPERATION.UPDATE,
      startLine: patch.range?.start,
      endLine: patch.range?.end,
      oldContent: patch.newContent,
      newContent: patch.oldContent,
      newPath: patch.operation === OPERATION.RENAME ? patch.path : null,
      rationale: `Undo: ${patch.rationale}`,
      metadata: { isUndo: true, originalPatchId: patch.id }
    });

    await this.applyPatch(reversePatch.id);
    return patch;
  }

  /**
   * Apply multiple patches as a batch
   */
  async applyBatch(patchIds) {
    const results = [];
    
    for (const id of patchIds) {
      const result = await this.applyPatch(id);
      results.push(result);
      
      // Stop on first failure
      if (!result.success) {
        break;
      }
    }
    
    return {
      success: results.every(r => r.success),
      results,
      applied: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    };
  }

  /**
   * Create a checkpoint (snapshot of current patch state)
   */
  createCheckpoint(label = '') {
    return {
      id: `checkpoint_${Date.now()}`,
      label,
      createdAt: Date.now(),
      patchCount: this.patches.length,
      appliedCount: this.patches.filter(p => p.status === PATCH_STATUS.APPLIED).length,
      patches: this.patches.map(p => ({
        id: p.id,
        path: p.path,
        operation: p.operation,
        status: p.status
      }))
    };
  }

  /**
   * Get patch statistics
   */
  getStats() {
    return {
      total: this.patches.length,
      pending: this.patches.filter(p => p.status === PATCH_STATUS.PENDING).length,
      applied: this.patches.filter(p => p.status === PATCH_STATUS.APPLIED).length,
      rejected: this.patches.filter(p => p.status === PATCH_STATUS.REJECTED).length,
      failed: this.patches.filter(p => p.status === PATCH_STATUS.FAILED).length,
      undoStackSize: this.appliedStack.length
    };
  }

  /**
   * Get project root (placeholder - should be wired to editor store)
   */
  async getProjectRoot() {
    // This should come from the editor store
    const settings = await window.electronAPI.getSettings('codeWorkspace');
    return settings?.rootPath || '';
  }

  /**
   * Clear all patches
   */
  clear() {
    this.patches = [];
    this.appliedStack = [];
  }

  /**
   * Export patches for review/sharing
   */
  export() {
    return {
      sessionId: this.sessionId,
      exportedAt: Date.now(),
      stats: this.getStats(),
      patches: this.patches.map(p => ({
        id: p.id,
        path: p.path,
        operation: p.operation,
        status: p.status,
        rationale: p.rationale,
        blastRadius: p.blastRadius,
        diff: p.diff ? this.formatDiffString(p.diff) : null,
        createdAt: p.createdAt
      }))
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultSystem = null;

export function getPatchSystem() {
  if (!defaultSystem) {
    defaultSystem = new PatchSystem();
  }
  return defaultSystem;
}

export function createPatchSystem() {
  return new PatchSystem();
}

export function resetPatchSystem() {
  defaultSystem = new PatchSystem();
  return defaultSystem;
}

// ============================================================================
// Export Constants
// ============================================================================

export { PATCH_STATUS, OPERATION, RISK_LEVEL };

export default {
  PatchSystem,
  getPatchSystem,
  createPatchSystem,
  resetPatchSystem,
  PATCH_STATUS,
  OPERATION,
  RISK_LEVEL
};
