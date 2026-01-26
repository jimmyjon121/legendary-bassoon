/**
 * Intent Compiler Schema
 * 
 * Defines the Intermediate Representation (IR) for compiled action plans.
 * Plans are arrays of steps that can be validated, previewed, and executed.
 */

// Step types and their schemas
const STEP_TYPES = {
  // File operations
  edit_file: {
    description: 'Edit a file at specific lines or replace content',
    params: {
      path: { type: 'string', required: true, description: 'File path relative to project root' },
      operation: { type: 'enum', values: ['replace', 'insert', 'delete', 'append'], required: true },
      startLine: { type: 'number', description: 'Start line for replace/delete (1-indexed)' },
      endLine: { type: 'number', description: 'End line for replace/delete (1-indexed)' },
      content: { type: 'string', description: 'New content to insert/append/replace with' },
      search: { type: 'string', description: 'Text to search and replace' },
      replace: { type: 'string', description: 'Replacement text' },
    },
    canRollback: true,
  },
  
  create_file: {
    description: 'Create a new file with content',
    params: {
      path: { type: 'string', required: true, description: 'File path to create' },
      content: { type: 'string', required: true, description: 'File content' },
    },
    canRollback: true,
  },
  
  delete_file: {
    description: 'Delete a file',
    params: {
      path: { type: 'string', required: true, description: 'File path to delete' },
    },
    canRollback: true,
  },
  
  // Command execution
  run_command: {
    description: 'Execute a shell command',
    params: {
      command: { type: 'string', required: true, description: 'Command to execute' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      expectSuccess: { type: 'boolean', description: 'Fail step if exit code !== 0' },
    },
    canRollback: false,
  },
  
  // Search operations
  search_docs: {
    description: 'Search indexed documents/RAG',
    params: {
      query: { type: 'string', required: true, description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default: 5)' },
      workspace: { type: 'string', description: 'Limit to workspace' },
    },
    canRollback: false,
  },
  
  search_codebase: {
    description: 'Search codebase for files or symbols',
    params: {
      query: { type: 'string', required: true, description: 'Search pattern/query' },
      type: { type: 'enum', values: ['text', 'filename', 'symbol'], required: true },
      glob: { type: 'string', description: 'File glob pattern' },
    },
    canRollback: false,
  },
  
  // User interaction
  ask_clarification: {
    description: 'Pause execution to ask user for clarification',
    params: {
      question: { type: 'string', required: true, description: 'Question to ask' },
      options: { type: 'array', description: 'Optional predefined answers' },
      default: { type: 'string', description: 'Default answer if user skips' },
    },
    canRollback: false,
    pausesExecution: true,
  },
  
  // Control flow
  checkpoint: {
    description: 'Create a checkpoint for potential rollback',
    params: {
      label: { type: 'string', required: true, description: 'Checkpoint label' },
      autoRollbackOnFailure: { type: 'boolean', description: 'Auto-rollback if later steps fail' },
    },
    canRollback: false,
  },
  
  conditional: {
    description: 'Conditional execution based on previous step output',
    params: {
      condition: { type: 'string', required: true, description: 'JS expression to evaluate' },
      ifTrue: { type: 'object', description: 'Step to execute if true' },
      ifFalse: { type: 'object', description: 'Step to execute if false' },
    },
    canRollback: false,
  },
  
  // LLM operations
  llm_generate: {
    description: 'Generate text using the LLM',
    params: {
      prompt: { type: 'string', required: true, description: 'Prompt to send' },
      systemPrompt: { type: 'string', description: 'System prompt override' },
      model: { type: 'string', description: 'Model override' },
      outputVar: { type: 'string', description: 'Variable name to store output' },
    },
    canRollback: false,
  },
  
  // Verification
  verify: {
    description: 'Verify a condition is met',
    params: {
      type: { type: 'enum', values: ['file_exists', 'file_contains', 'command_succeeds', 'expression'], required: true },
      path: { type: 'string', description: 'File path for file checks' },
      pattern: { type: 'string', description: 'Pattern to search for' },
      command: { type: 'string', description: 'Command for command_succeeds' },
      expression: { type: 'string', description: 'JS expression for expression type' },
      message: { type: 'string', description: 'Error message if verification fails' },
    },
    canRollback: false,
  },
};

// Run status enum
const RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  ROLLED_BACK: 'rolled_back',
};

// Step status enum
const STEP_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  ROLLED_BACK: 'rolled_back',
};

/**
 * Validate a single step
 */
function validateStep(step, index) {
  const errors = [];
  
  if (!step.type) {
    errors.push(`Step ${index}: Missing 'type' field`);
    return errors;
  }
  
  const typeSchema = STEP_TYPES[step.type];
  if (!typeSchema) {
    errors.push(`Step ${index}: Unknown step type '${step.type}'`);
    return errors;
  }
  
  // Check required params
  if (typeSchema.params) {
    for (const [paramName, paramSchema] of Object.entries(typeSchema.params)) {
      if (paramSchema.required && (step.params?.[paramName] === undefined || step.params?.[paramName] === null)) {
        errors.push(`Step ${index} (${step.type}): Missing required param '${paramName}'`);
      }
      
      // Type checking
      if (step.params?.[paramName] !== undefined) {
        const value = step.params[paramName];
        
        if (paramSchema.type === 'string' && typeof value !== 'string') {
          errors.push(`Step ${index} (${step.type}): Param '${paramName}' must be a string`);
        }
        if (paramSchema.type === 'number' && typeof value !== 'number') {
          errors.push(`Step ${index} (${step.type}): Param '${paramName}' must be a number`);
        }
        if (paramSchema.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Step ${index} (${step.type}): Param '${paramName}' must be a boolean`);
        }
        if (paramSchema.type === 'array' && !Array.isArray(value)) {
          errors.push(`Step ${index} (${step.type}): Param '${paramName}' must be an array`);
        }
        if (paramSchema.type === 'enum' && !paramSchema.values.includes(value)) {
          errors.push(`Step ${index} (${step.type}): Param '${paramName}' must be one of: ${paramSchema.values.join(', ')}`);
        }
      }
    }
  }
  
  return errors;
}

/**
 * Validate an entire plan
 */
function validatePlan(plan) {
  const errors = [];
  
  if (!plan) {
    errors.push('Plan is null or undefined');
    return { valid: false, errors };
  }
  
  if (!plan.intent) {
    errors.push('Plan missing "intent" field');
  }
  
  if (!Array.isArray(plan.steps)) {
    errors.push('Plan "steps" must be an array');
    return { valid: false, errors };
  }
  
  if (plan.steps.length === 0) {
    errors.push('Plan has no steps');
    return { valid: false, errors };
  }
  
  // Validate each step
  plan.steps.forEach((step, index) => {
    const stepErrors = validateStep(step, index);
    errors.push(...stepErrors);
  });
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a plan from intent and steps
 */
function createPlan(intent, steps, options = {}) {
  const plan = {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    intent,
    steps,
    created: new Date().toISOString(),
    workspace: options.workspace || null,
    metadata: options.metadata || {},
  };
  
  const validation = validatePlan(plan);
  
  return {
    plan,
    valid: validation.valid,
    errors: validation.errors,
  };
}

/**
 * Estimate complexity/risk of a plan
 */
function estimatePlanComplexity(plan) {
  let complexity = 0;
  let risk = 0;
  const risks = [];
  
  for (const step of plan.steps) {
    // Base complexity
    complexity += 1;
    
    // Type-specific complexity and risk
    switch (step.type) {
      case 'edit_file':
        complexity += 2;
        risk += 0.3;
        risks.push({ step: step.type, reason: 'Modifies existing file' });
        break;
      case 'create_file':
        complexity += 1;
        risk += 0.1;
        break;
      case 'delete_file':
        complexity += 1;
        risk += 0.5;
        risks.push({ step: step.type, reason: 'Deletes file (recoverable via checkpoint)' });
        break;
      case 'run_command':
        complexity += 3;
        risk += 0.4;
        risks.push({ step: step.type, reason: 'Executes shell command' });
        break;
      case 'llm_generate':
        complexity += 2;
        risk += 0.1;
        break;
      case 'ask_clarification':
        complexity += 1;
        break;
      default:
        complexity += 1;
    }
  }
  
  // Normalize
  const normalizedComplexity = Math.min(1, complexity / 20);
  const normalizedRisk = Math.min(1, risk);
  
  return {
    complexity: normalizedComplexity,
    complexityLabel: normalizedComplexity < 0.3 ? 'Low' : normalizedComplexity < 0.7 ? 'Medium' : 'High',
    risk: normalizedRisk,
    riskLabel: normalizedRisk < 0.3 ? 'Low' : normalizedRisk < 0.6 ? 'Medium' : 'High',
    stepCount: plan.steps.length,
    canRollback: plan.steps.every(s => STEP_TYPES[s.type]?.canRollback !== false),
    risks,
  };
}

/**
 * Generate the system prompt for intent compilation
 */
function getCompilerSystemPrompt() {
  const stepDocs = Object.entries(STEP_TYPES).map(([type, schema]) => {
    const params = Object.entries(schema.params || {})
      .map(([name, p]) => `    - ${name}${p.required ? ' (required)' : ''}: ${p.description}`)
      .join('\n');
    return `- ${type}: ${schema.description}\n${params}`;
  }).join('\n\n');
  
  return `You are an intent compiler. Given a user's intent, generate a deterministic plan of executable steps.

## Output Format
Return ONLY valid JSON with this structure:
{
  "intent": "Brief restatement of user intent",
  "reasoning": "Brief explanation of approach",
  "steps": [
    {
      "type": "step_type",
      "description": "What this step does",
      "params": { ... }
    }
  ]
}

## Available Step Types

${stepDocs}

## Rules
1. Break complex tasks into small, atomic steps
2. Add checkpoints before risky operations
3. Use verify steps to confirm success
4. Use ask_clarification if intent is ambiguous
5. Order steps for minimal risk (search → read → modify)
6. Prefer edit_file over full file rewrites
7. Include rollback-friendly operations when possible

## Example
User intent: "Add a console.log to the handleSubmit function in App.jsx"

{
  "intent": "Add console.log to handleSubmit in App.jsx",
  "reasoning": "Need to find the function first, then insert a log statement at the start",
  "steps": [
    {
      "type": "search_codebase",
      "description": "Find handleSubmit function",
      "params": { "query": "handleSubmit", "type": "symbol", "glob": "**/*.jsx" }
    },
    {
      "type": "checkpoint",
      "description": "Before editing",
      "params": { "label": "pre-edit", "autoRollbackOnFailure": true }
    },
    {
      "type": "edit_file",
      "description": "Insert console.log at function start",
      "params": {
        "path": "src/App.jsx",
        "operation": "insert",
        "startLine": 42,
        "content": "  console.log('handleSubmit called');"
      }
    },
    {
      "type": "verify",
      "description": "Confirm edit succeeded",
      "params": {
        "type": "file_contains",
        "path": "src/App.jsx",
        "pattern": "console.log('handleSubmit called')"
      }
    }
  ]
}`;
}

module.exports = {
  STEP_TYPES,
  RUN_STATUS,
  STEP_STATUS,
  validateStep,
  validatePlan,
  createPlan,
  estimatePlanComplexity,
  getCompilerSystemPrompt,
};




