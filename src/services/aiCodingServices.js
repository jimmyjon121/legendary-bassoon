/**
 * AI Coding Services - Main Entry Point
 * 
 * This file exports all the AI coding services for easy integration.
 * It provides a unified interface to:
 * 
 * - Tool-enabled LLM conversations
 * - Provenance tracking (grounded responses)
 * - Patch system (reviewable changes)
 * - Project brain (codebase understanding)
 * - Constraint enforcement
 * - AST refactoring
 * - Spec-first workflow
 */

// Core Services
export { 
  CODE_TOOLS, 
  VERIFICATION_TOOLS, 
  AST_REFACTOR_TOOLS,
  ALL_TOOLS,
  isCommandAllowed,
  getToolByName,
  formatToolsForOllama 
} from './codeTools';

export { 
  ToolEnabledLLM, 
  createToolEnabledLLM, 
  getToolEnabledLLM 
} from './toolEnabledLLM';

export { 
  ProvenanceTracker, 
  getProvenanceTracker, 
  createProvenanceTracker,
  resetProvenanceTracker 
} from './provenanceTracker';

export { 
  PatchSystem, 
  getPatchSystem, 
  createPatchSystem,
  PATCH_STATUS, 
  OPERATION, 
  RISK_LEVEL 
} from './patchSystem';

export { 
  ProjectBrain, 
  getProjectBrain, 
  createProjectBrain 
} from './projectBrain';

export { 
  ConstraintManager, 
  getConstraintManager, 
  createConstraintManager,
  DEFAULT_CONSTRAINTS 
} from './constraintSystem';

export { 
  Spec,
  SpecManager,
  getSpecManager,
  parseSpecFromResponse,
  SPEC_FIRST_SYSTEM_PROMPT,
  QUICK_FIX_PROMPT 
} from './specFirstWorkflow';

export { 
  findSymbolOccurrences,
  renameSymbolInContent,
  renameSymbolInProject,
  extractFunction,
  moveToFile,
  addImport 
} from './astRefactor';

export {
  buildCodeIndex,
  searchCodeIndex,
  searchSymbol,
  getIndexedFile,
  getFilesByPattern,
  getCodeIndexSummary,
  hasCodeIndex,
  getIndexedFiles,
  clearCodeIndex
} from './codeIndexer';

// ============================================================================
// Unified AI Session Manager
// ============================================================================

/**
 * Creates a complete AI coding session with all services initialized
 */
export function createAICodingSession(options = {}) {
  const {
    projectRoot,
    model = 'llama3.1',
    enableProvenance = true,
    enablePatches = true,
    enableBrain = true,
    enableConstraints = true
  } = options;

  const session = {
    id: `session_${Date.now()}`,
    startedAt: Date.now(),
    projectRoot,
    model
  };

  // Initialize services
  if (enableProvenance) {
    const { createProvenanceTracker } = require('./provenanceTracker');
    session.provenance = createProvenanceTracker();
  }

  if (enablePatches) {
    const { createPatchSystem } = require('./patchSystem');
    session.patches = createPatchSystem();
  }

  if (enableBrain) {
    const { createProjectBrain } = require('./projectBrain');
    session.brain = createProjectBrain(projectRoot);
  }

  if (enableConstraints) {
    const { createConstraintManager } = require('./constraintSystem');
    session.constraints = createConstraintManager(projectRoot);
  }

  // Create tool-enabled LLM with hooks to the other services
  const { createToolEnabledLLM } = require('./toolEnabledLLM');
  session.llm = createToolEnabledLLM({
    model,
    projectRoot,
    networkPolicy: 'offline',
    maxToolSteps: 24,
    autoRollbackOnFailure: true,
    onToolCall: (toolCall) => {
      console.log('[AI Session] Tool call:', toolCall.function?.name);
    },
    onToolResult: (toolCall, result) => {
      // Track file reads for provenance
      if (result.type === 'file_read' && result.success && session.provenance) {
        session.provenance.recordFileRead(result.path, result.content);
      }
      // Track proposed edits
      if (result.type === 'proposed_edit' && result.success && session.patches) {
        session.patches.createPatch(result.patch);
      }
    }
  });

  // Helper methods
  session.chat = async (message, history = []) => {
    return session.llm.chat(message, history);
  };

  session.getStats = () => ({
    id: session.id,
    duration: Date.now() - session.startedAt,
    provenance: session.provenance?.getProvenanceReport(),
    patches: session.patches?.getStats(),
    brain: session.brain?.export()
  });

  session.end = () => {
    console.log('[AI Session] Ending session:', session.id);
    return session.getStats();
  };

  return session;
}

// ============================================================================
// System Prompt Builder
// ============================================================================

/**
 * Build a comprehensive system prompt for the AI coding assistant
 */
export function buildCodingSystemPrompt(options = {}) {
  const {
    projectBrain,
    constraints,
    specFirst = true
  } = options;

  const sections = [];

  // Base prompt
  sections.push(`You are an expert AI coding assistant with access to tools for exploring and modifying code.

## Core Principles
1. **Grounded Responses**: Only reference code you have actually read using read_file
2. **Reviewable Changes**: Propose all edits through propose_edit for user approval
3. **Verify Your Work**: Use run_lint, run_tests, check_types after changes
4. **Explain Reasoning**: Include rationale with every proposed change`);

  // Spec-first prompt
  if (specFirst) {
    const { SPEC_FIRST_SYSTEM_PROMPT } = require('./specFirstWorkflow');
    sections.push(SPEC_FIRST_SYSTEM_PROMPT);
  }

  // Project context
  if (projectBrain) {
    sections.push(projectBrain.toPromptContext());
  }

  // Constraints
  if (constraints) {
    sections.push(constraints.toPromptContext());
  }

  return sections.join('\n\n');
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  createAICodingSession,
  buildCodingSystemPrompt
};
