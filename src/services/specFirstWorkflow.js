/**
 * Spec-First Workflow
 * 
 * Ensures the AI defines expectations BEFORE implementing changes:
 * 1. STATE THE GOAL - What should exist after the change?
 * 2. DEFINE SUCCESS CRITERIA - How do we know it works?
 * 3. IDENTIFY RISKS - What could break?
 * 4. ONLY THEN propose the implementation
 * 
 * This produces more reliable, testable changes.
 */

// ============================================================================
// System Prompts
// ============================================================================

export const SPEC_FIRST_SYSTEM_PROMPT = `
## Spec-First Development Protocol

Before implementing ANY code change, you MUST follow this protocol:

### Step 1: STATE THE GOAL
Clearly describe what behavior should exist after this change.
- What problem are we solving?
- What should the user experience be?
- What should the code accomplish?

### Step 2: DEFINE SUCCESS CRITERIA
How will we know the change works correctly?
- List specific, testable assertions
- If tests exist: which tests should pass?
- If no tests: what checks can verify correctness?
- What edge cases should be handled?

### Step 3: IDENTIFY RISKS
What could break or go wrong?
- List potential failure modes
- Identify affected areas of the codebase
- Note any backwards compatibility concerns

### Step 4: PROPOSE IMPLEMENTATION
Only after completing steps 1-3, propose the actual code changes.
- Use propose_edit tool for each change
- Include clear rationale for each modification
- Reference the success criteria

## Response Format

Structure your responses like this:

## Goal
[Clear statement of desired outcome]

## Success Criteria
- [ ] Criterion 1: [Specific, testable condition]
- [ ] Criterion 2: [Specific, testable condition]
- [ ] ...

## Risks & Mitigations
- Risk: [Description] → Mitigation: [How to handle]
- Risk: [Description] → Mitigation: [How to handle]

## Implementation Plan
1. [First change]
2. [Second change]
...

## Proposed Changes
[Use propose_edit tool for each change]
`;

export const QUICK_FIX_PROMPT = `
For quick fixes (typos, simple bugs), you may use a condensed format:

## Quick Fix
**Issue**: [What's wrong]
**Fix**: [What change fixes it]
**Verify**: [How to confirm it works]

Then propose the edit.
`;

// ============================================================================
// Spec Structure
// ============================================================================

export class Spec {
  constructor(data = {}) {
    this.id = data.id || `spec_${Date.now()}`;
    this.goal = data.goal || '';
    this.criteria = data.criteria || [];
    this.risks = data.risks || [];
    this.implementation = data.implementation || [];
    this.status = data.status || 'draft'; // draft, approved, implementing, complete
    this.createdAt = data.createdAt || Date.now();
    this.approvedAt = null;
    this.completedAt = null;
    this.results = null;
  }

  /**
   * Add a success criterion
   */
  addCriterion(description, testMethod = null) {
    this.criteria.push({
      id: `crit_${this.criteria.length + 1}`,
      description,
      testMethod,
      status: 'pending', // pending, passed, failed
      result: null
    });
    return this;
  }

  /**
   * Add a risk
   */
  addRisk(description, mitigation, severity = 'medium') {
    this.risks.push({
      id: `risk_${this.risks.length + 1}`,
      description,
      mitigation,
      severity, // low, medium, high
      occurred: false
    });
    return this;
  }

  /**
   * Add an implementation step
   */
  addStep(description, file = null, type = 'code') {
    this.implementation.push({
      id: `step_${this.implementation.length + 1}`,
      description,
      file,
      type, // code, test, docs, config
      status: 'pending' // pending, in_progress, done, skipped
    });
    return this;
  }

  /**
   * Approve the spec
   */
  approve() {
    this.status = 'approved';
    this.approvedAt = Date.now();
    return this;
  }

  /**
   * Start implementation
   */
  startImplementation() {
    if (this.status !== 'approved') {
      throw new Error('Spec must be approved before implementation');
    }
    this.status = 'implementing';
    return this;
  }

  /**
   * Mark a criterion as passed/failed
   */
  setCriterionResult(criterionId, passed, result = null) {
    const criterion = this.criteria.find(c => c.id === criterionId);
    if (criterion) {
      criterion.status = passed ? 'passed' : 'failed';
      criterion.result = result;
    }
    return this;
  }

  /**
   * Mark a step as done
   */
  completeStep(stepId, result = null) {
    const step = this.implementation.find(s => s.id === stepId);
    if (step) {
      step.status = 'done';
      step.result = result;
    }
    return this;
  }

  /**
   * Complete the spec
   */
  complete(results) {
    this.status = 'complete';
    this.completedAt = Date.now();
    this.results = results;
    return this;
  }

  /**
   * Check if all criteria passed
   */
  allCriteriaPassed() {
    return this.criteria.every(c => c.status === 'passed');
  }

  /**
   * Get progress percentage
   */
  getProgress() {
    const total = this.implementation.length;
    if (total === 0) return 0;
    const done = this.implementation.filter(s => s.status === 'done').length;
    return Math.round((done / total) * 100);
  }

  /**
   * Export to markdown
   */
  toMarkdown() {
    let md = `# ${this.goal || 'Untitled Spec'}\n\n`;
    
    md += `## Success Criteria\n`;
    for (const c of this.criteria) {
      const icon = c.status === 'passed' ? '✅' : c.status === 'failed' ? '❌' : '⬜';
      md += `- ${icon} ${c.description}\n`;
    }
    md += '\n';
    
    md += `## Risks\n`;
    for (const r of this.risks) {
      md += `- **${r.severity.toUpperCase()}**: ${r.description}\n`;
      md += `  - Mitigation: ${r.mitigation}\n`;
    }
    md += '\n';
    
    md += `## Implementation\n`;
    for (const s of this.implementation) {
      const icon = s.status === 'done' ? '✅' : s.status === 'in_progress' ? '🔄' : '⬜';
      md += `${icon} ${s.description}`;
      if (s.file) md += ` (${s.file})`;
      md += '\n';
    }
    
    return md;
  }

  /**
   * Export to JSON
   */
  toJSON() {
    return {
      id: this.id,
      goal: this.goal,
      criteria: this.criteria,
      risks: this.risks,
      implementation: this.implementation,
      status: this.status,
      createdAt: this.createdAt,
      approvedAt: this.approvedAt,
      completedAt: this.completedAt,
      progress: this.getProgress()
    };
  }
}

// ============================================================================
// Spec Parser
// ============================================================================

/**
 * Parse a spec from AI response markdown
 */
export function parseSpecFromResponse(response) {
  const spec = new Spec();
  
  // Extract goal
  const goalMatch = response.match(/##\s*Goal\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (goalMatch) {
    spec.goal = goalMatch[1].trim();
  }
  
  // Extract success criteria
  const criteriaMatch = response.match(/##\s*Success Criteria\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (criteriaMatch) {
    const criteriaLines = criteriaMatch[1].match(/[-*]\s*\[?\s*[x ]?\s*\]?\s*(.+)/gi) || [];
    for (const line of criteriaLines) {
      const cleaned = line.replace(/^[-*]\s*\[?\s*[x ]?\s*\]?\s*/, '').trim();
      if (cleaned) spec.addCriterion(cleaned);
    }
  }
  
  // Extract risks
  const risksMatch = response.match(/##\s*Risks?\s*(?:&|and)?\s*Mitigations?\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (risksMatch) {
    const riskLines = risksMatch[1].match(/[-*]\s*(?:Risk:?\s*)?(.+?)(?:→|->|:)\s*(?:Mitigation:?\s*)?(.+)/gi) || [];
    for (const line of riskLines) {
      const match = line.match(/[-*]\s*(?:Risk:?\s*)?(.+?)(?:→|->|:)\s*(?:Mitigation:?\s*)?(.+)/i);
      if (match) {
        spec.addRisk(match[1].trim(), match[2].trim());
      }
    }
  }
  
  // Extract implementation steps
  const implMatch = response.match(/##\s*Implementation\s*(?:Plan)?\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (implMatch) {
    const stepLines = implMatch[1].match(/\d+\.\s*(.+)/gi) || [];
    for (const line of stepLines) {
      const cleaned = line.replace(/^\d+\.\s*/, '').trim();
      if (cleaned) spec.addStep(cleaned);
    }
  }
  
  return spec;
}

// ============================================================================
// Spec Manager
// ============================================================================

export class SpecManager {
  constructor() {
    this.specs = new Map();
    this.currentSpecId = null;
  }

  /**
   * Create a new spec
   */
  createSpec(goal = '') {
    const spec = new Spec({ goal });
    this.specs.set(spec.id, spec);
    this.currentSpecId = spec.id;
    return spec;
  }

  /**
   * Get current spec
   */
  getCurrentSpec() {
    return this.currentSpecId ? this.specs.get(this.currentSpecId) : null;
  }

  /**
   * Get spec by ID
   */
  getSpec(id) {
    return this.specs.get(id);
  }

  /**
   * Get all specs
   */
  getAllSpecs() {
    return Array.from(this.specs.values());
  }

  /**
   * Set current spec
   */
  setCurrentSpec(id) {
    if (this.specs.has(id)) {
      this.currentSpecId = id;
      return true;
    }
    return false;
  }

  /**
   * Parse spec from AI response and store it
   */
  parseAndStore(response) {
    const spec = parseSpecFromResponse(response);
    this.specs.set(spec.id, spec);
    this.currentSpecId = spec.id;
    return spec;
  }

  /**
   * Validate that implementation follows the spec
   */
  validateImplementation(spec, patches) {
    const issues = [];
    
    // Check that patches align with implementation steps
    for (const step of spec.implementation) {
      if (step.file) {
        const hasRelatedPatch = patches.some(p => 
          p.path.includes(step.file) || step.file.includes(p.path)
        );
        if (!hasRelatedPatch && step.status !== 'skipped') {
          issues.push({
            type: 'missing_patch',
            step: step.id,
            message: `No patch found for step: ${step.description}`
          });
        }
      }
    }
    
    // Check for unexpected patches
    for (const patch of patches) {
      const hasRelatedStep = spec.implementation.some(s =>
        s.file && (patch.path.includes(s.file) || s.file.includes(patch.path))
      );
      if (!hasRelatedStep) {
        issues.push({
          type: 'unexpected_patch',
          patch: patch.id,
          message: `Patch not in spec: ${patch.path}`
        });
      }
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Generate test plan from spec
   */
  generateTestPlan(spec) {
    const testCases = [];
    
    for (const criterion of spec.criteria) {
      testCases.push({
        name: `Test: ${criterion.description}`,
        description: criterion.description,
        type: 'unit',
        status: 'pending',
        criterionId: criterion.id
      });
    }
    
    // Add risk-related tests
    for (const risk of spec.risks) {
      if (risk.severity === 'high') {
        testCases.push({
          name: `Risk test: ${risk.description}`,
          description: `Verify mitigation: ${risk.mitigation}`,
          type: 'risk',
          status: 'pending',
          riskId: risk.id
        });
      }
    }
    
    return testCases;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let manager = null;

export function getSpecManager() {
  if (!manager) {
    manager = new SpecManager();
  }
  return manager;
}

// ============================================================================
// Export
// ============================================================================

export default {
  SPEC_FIRST_SYSTEM_PROMPT,
  QUICK_FIX_PROMPT,
  Spec,
  SpecManager,
  parseSpecFromResponse,
  getSpecManager
};
