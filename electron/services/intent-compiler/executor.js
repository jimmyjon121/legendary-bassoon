/**
 * Intent Compiler Executor
 * 
 * Executes compiled action plans step by step.
 * Records all actions to the Unified Ledger with evidence.
 */

const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const { STEP_STATUS, RUN_STATUS, validatePlan, estimatePlanComplexity } = require('./schema');
const ledgerService = require('../ledger/ledger-service');

// Execution context shared across steps
class ExecutionContext {
  constructor(runId, plan, options = {}) {
    this.runId = runId;
    this.plan = plan;
    this.projectRoot = options.projectRoot || process.cwd();
    this.variables = {};
    this.checkpoints = {};
    this.stepOutputs = [];
    this.status = RUN_STATUS.PENDING;
    this.currentStepIndex = 0;
    this.events = [];
  }
  
  setVariable(name, value) {
    this.variables[name] = value;
  }
  
  getVariable(name) {
    return this.variables[name];
  }
  
  resolveVariables(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\$\{(\w+)\}/g, (_, name) => this.variables[name] || '');
  }
  
  addEvent(event) {
    this.events.push({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Execute a single step
 */
async function executeStep(step, context, stepIndex) {
  const startTime = Date.now();
  
  context.addEvent({
    type: 'step_start',
    stepIndex,
    stepType: step.type,
  });
  
  // Record step start to ledger
  ledgerService.addRunStep({
    runId: context.runId,
    idx: stepIndex,
    stepType: step.type,
    input: step.params,
  });
  
  try {
    let output;
    
    switch (step.type) {
      case 'edit_file':
        output = await executeEditFile(step.params, context);
        break;
      case 'create_file':
        output = await executeCreateFile(step.params, context);
        break;
      case 'delete_file':
        output = await executeDeleteFile(step.params, context);
        break;
      case 'run_command':
        output = await executeRunCommand(step.params, context);
        break;
      case 'search_docs':
        output = await executeSearchDocs(step.params, context);
        break;
      case 'search_codebase':
        output = await executeSearchCodebase(step.params, context);
        break;
      case 'checkpoint':
        output = await executeCheckpoint(step.params, context);
        break;
      case 'verify':
        output = await executeVerify(step.params, context);
        break;
      case 'llm_generate':
        output = await executeLLMGenerate(step.params, context);
        break;
      case 'ask_clarification':
        // This pauses execution and returns a special marker
        return {
          status: 'paused',
          question: step.params.question,
          options: step.params.options,
        };
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
    
    const duration = Date.now() - startTime;
    
    context.stepOutputs[stepIndex] = {
      status: STEP_STATUS.COMPLETED,
      output,
      duration,
    };
    
    context.addEvent({
      type: 'step_complete',
      stepIndex,
      duration,
      output: typeof output === 'string' ? output.slice(0, 500) : output,
    });
    
    return {
      status: STEP_STATUS.COMPLETED,
      output,
      duration,
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    context.stepOutputs[stepIndex] = {
      status: STEP_STATUS.FAILED,
      error: error.message,
      duration,
    };
    
    context.addEvent({
      type: 'step_failed',
      stepIndex,
      error: error.message,
      duration,
    });
    
    return {
      status: STEP_STATUS.FAILED,
      error: error.message,
      duration,
    };
  }
}

// ============================================
// Step Executors
// ============================================

async function executeEditFile(params, context) {
  const filePath = path.resolve(context.projectRoot, params.path);
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  
  let newContent;
  
  switch (params.operation) {
    case 'replace':
      if (params.search !== undefined) {
        // Search and replace
        newContent = content.replace(params.search, params.replace || '');
      } else {
        // Line-based replace
        const before = lines.slice(0, params.startLine - 1);
        const after = lines.slice(params.endLine || params.startLine);
        newContent = [...before, params.content, ...after].join('\n');
      }
      break;
      
    case 'insert': {
      const insertBefore = lines.slice(0, params.startLine - 1);
      const insertAfter = lines.slice(params.startLine - 1);
      newContent = [...insertBefore, params.content, ...insertAfter].join('\n');
      break;
    }
      
    case 'delete': {
      const deleteBefore = lines.slice(0, params.startLine - 1);
      const deleteAfter = lines.slice(params.endLine || params.startLine);
      newContent = [...deleteBefore, ...deleteAfter].join('\n');
      break;
    }
      
    case 'append':
      newContent = content + '\n' + params.content;
      break;
      
    default:
      throw new Error(`Unknown edit operation: ${params.operation}`);
  }
  
  // Store original for rollback
  if (!context.checkpoints[params.path]) {
    context.checkpoints[params.path] = { original: content };
  }
  
  await fs.writeFile(filePath, newContent, 'utf-8');
  
  // Create evidence
  ledgerService.createFileLinesEvidence({
    eventId: context.runId,
    filePath: params.path,
    startLine: params.startLine,
    endLine: params.endLine,
    content: newContent.slice(0, 1000),
  });
  
  return { modified: params.path, operation: params.operation };
}

async function executeCreateFile(params, context) {
  const filePath = path.resolve(context.projectRoot, params.path);
  const dir = path.dirname(filePath);
  
  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });
  
  await fs.writeFile(filePath, params.content, 'utf-8');
  
  return { created: params.path };
}

async function executeDeleteFile(params, context) {
  const filePath = path.resolve(context.projectRoot, params.path);
  
  // Store content for rollback
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    context.checkpoints[params.path] = { deleted: true, content };
  } catch (e) {
    // File doesn't exist, that's fine
  }
  
  await fs.unlink(filePath);
  
  return { deleted: params.path };
}

async function executeRunCommand(params, context) {
  const cwd = params.cwd 
    ? path.resolve(context.projectRoot, params.cwd) 
    : context.projectRoot;
  
  const timeout = params.timeout || 30000;
  
  try {
    const { stdout, stderr } = await execAsync(params.command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
    });
    
    // Create evidence
    ledgerService.createToolOutputEvidence({
      eventId: context.runId,
      toolName: 'shell',
      command: params.command,
      stdout,
      stderr,
      exitCode: 0,
    });
    
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    if (params.expectSuccess) {
      throw error;
    }
    
    ledgerService.createToolOutputEvidence({
      eventId: context.runId,
      toolName: 'shell',
      command: params.command,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
    });
    
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
    };
  }
}

async function executeSearchDocs(params, context) {
  // This would integrate with RAG service
  // For now, return placeholder
  const ragService = require('../rag-service');
  
  try {
    const results = await ragService.search(params.query, {
      limit: params.limit || 5,
    });
    
    // Store results in variable if specified
    if (params.outputVar) {
      context.setVariable(params.outputVar, results);
    }
    
    return { results };
  } catch (error) {
    return { results: [], error: error.message };
  }
}

async function executeSearchCodebase(params, context) {
  const glob = require('glob');
  const { promisify } = require('util');
  const globAsync = promisify(glob);
  
  const pattern = params.glob || '**/*';
  const files = await globAsync(pattern, {
    cwd: context.projectRoot,
    nodir: true,
    ignore: ['node_modules/**', '.git/**'],
  });
  
  const results = [];
  
  for (const file of files.slice(0, 50)) { // Limit to 50 files
    try {
      const content = await fs.readFile(path.join(context.projectRoot, file), 'utf-8');
      
      if (params.type === 'text' && content.includes(params.query)) {
        const lines = content.split('\n');
        const matchingLines = lines
          .map((line, idx) => ({ line, num: idx + 1 }))
          .filter(({ line }) => line.includes(params.query));
        
        results.push({
          file,
          matches: matchingLines.slice(0, 5),
        });
      } else if (params.type === 'filename' && file.includes(params.query)) {
        results.push({ file });
      }
    } catch (e) {
      // Skip unreadable files
    }
  }
  
  return { results: results.slice(0, 20) };
}

async function executeCheckpoint(params, context) {
  context.checkpoints[params.label] = {
    timestamp: new Date().toISOString(),
    stepIndex: context.currentStepIndex,
    autoRollback: params.autoRollbackOnFailure,
    state: JSON.stringify(context.variables),
  };
  
  return { checkpoint: params.label };
}

async function executeVerify(params, context) {
  switch (params.type) {
    case 'file_exists': {
      const filePath = path.resolve(context.projectRoot, params.path);
      try {
        await fs.access(filePath);
        return { verified: true };
      } catch {
        throw new Error(params.message || `File does not exist: ${params.path}`);
      }
    }
    
    case 'file_contains': {
      const filePath = path.resolve(context.projectRoot, params.path);
      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.includes(params.pattern)) {
        throw new Error(params.message || `File ${params.path} does not contain: ${params.pattern}`);
      }
      return { verified: true, found: true };
    }
    
    case 'command_succeeds': {
      const { exitCode } = await executeRunCommand({ command: params.command }, context);
      if (exitCode !== 0) {
        throw new Error(params.message || `Command failed: ${params.command}`);
      }
      return { verified: true };
    }
    
    case 'expression': {
      // Evaluate JS expression in context
      const fn = new Function('ctx', `return ${params.expression}`);
      const result = fn(context.variables);
      if (!result) {
        throw new Error(params.message || `Expression evaluated to false: ${params.expression}`);
      }
      return { verified: true, result };
    }
    
    default:
      throw new Error(`Unknown verify type: ${params.type}`);
  }
}

async function executeLLMGenerate(params, context) {
  // This would integrate with the LLM service
  // For now, placeholder that would call Ollama
  return {
    generated: true,
    note: 'LLM generation step - would call model',
    prompt: params.prompt.slice(0, 100),
  };
}

// ============================================
// Main Executor
// ============================================

/**
 * Execute a full plan
 */
async function executePlan(plan, options = {}) {
  // Validate first
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return {
      success: false,
      status: RUN_STATUS.FAILED,
      errors: validation.errors,
    };
  }
  
  // Create run in ledger
  const { id: runId } = ledgerService.createRun({
    intent: plan.intent,
    planIR: plan,
  });
  
  const context = new ExecutionContext(runId, plan, options);
  context.status = RUN_STATUS.RUNNING;
  
  ledgerService.updateRun(runId, { status: 'running' });
  
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      context.currentStepIndex = i;
      const step = plan.steps[i];
      
      const result = await executeStep(step, context, i);
      
      if (result.status === 'paused') {
        // Execution paused for user input
        context.status = RUN_STATUS.PAUSED;
        ledgerService.updateRun(runId, { status: 'paused' });
        
        return {
          success: false,
          status: RUN_STATUS.PAUSED,
          runId,
          pausedAt: i,
          question: result.question,
          options: result.options,
          context: {
            stepOutputs: context.stepOutputs,
            events: context.events,
          },
        };
      }
      
      if (result.status === STEP_STATUS.FAILED) {
        // Check for auto-rollback checkpoint
        const lastCheckpoint = Object.entries(context.checkpoints)
          .filter(([_, cp]) => cp.autoRollback && cp.stepIndex < i)
          .sort((a, b) => b[1].stepIndex - a[1].stepIndex)[0];
        
        if (lastCheckpoint) {
          // Would implement rollback here
          context.status = RUN_STATUS.ROLLED_BACK;
        } else {
          context.status = RUN_STATUS.FAILED;
        }
        
        ledgerService.updateRun(runId, { 
          status: context.status,
          summary: `Failed at step ${i}: ${result.error}`,
        });
        
        return {
          success: false,
          status: context.status,
          runId,
          failedAt: i,
          error: result.error,
          context: {
            stepOutputs: context.stepOutputs,
            events: context.events,
          },
        };
      }
    }
    
    // All steps completed
    context.status = RUN_STATUS.COMPLETED;
    ledgerService.updateRun(runId, { 
      status: 'completed',
      summary: `Completed ${plan.steps.length} steps successfully`,
    });
    
    return {
      success: true,
      status: RUN_STATUS.COMPLETED,
      runId,
      context: {
        stepOutputs: context.stepOutputs,
        events: context.events,
        variables: context.variables,
      },
    };
    
  } catch (error) {
    context.status = RUN_STATUS.FAILED;
    ledgerService.updateRun(runId, { 
      status: 'failed',
      summary: `Unexpected error: ${error.message}`,
    });
    
    return {
      success: false,
      status: RUN_STATUS.FAILED,
      runId,
      error: error.message,
      context: {
        stepOutputs: context.stepOutputs,
        events: context.events,
      },
    };
  }
}

/**
 * Resume a paused plan
 */
async function resumePlan(runId, answer, options = {}) {
  // Would load context from ledger and continue
  // Placeholder for now
  return {
    success: false,
    error: 'Resume not yet implemented',
  };
}

/**
 * Cancel a running plan
 */
async function cancelPlan(runId) {
  ledgerService.updateRun(runId, { status: 'cancelled' });
  return { success: true };
}

module.exports = {
  ExecutionContext,
  executeStep,
  executePlan,
  resumePlan,
  cancelPlan,
};




