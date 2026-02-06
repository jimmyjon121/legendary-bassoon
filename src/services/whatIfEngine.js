/**
 * What-If Simulation Engine
 * 
 * Simulates code changes before actually applying them, showing
 * predicted outcomes, impact analysis, and potential issues.
 */

import { calculateBlastRadius, createPatch, generateDiff } from './patchSystem';

// Simulation status
const SIMULATION_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Impact levels
const IMPACT_LEVEL = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Analysis types
const ANALYSIS_TYPES = {
  IMPACT: 'impact',
  TESTS: 'tests',
  TYPES: 'types',
  BUNDLE: 'bundle',
  PERFORMANCE: 'performance',
  SECURITY: 'security'
};

class WhatIfEngine {
  constructor() {
    this.simulations = new Map(); // id -> simulation
    this.virtualFS = new Map();   // path -> content (virtual changes)
    this.listeners = new Set();
    this.currentSimulation = null;
  }

  /**
   * Create a new simulation for proposed changes
   */
  async createSimulation(changes, options = {}) {
    const {
      name = 'Unnamed Simulation',
      description = '',
      analyzeTests = true,
      analyzeTypes = true,
      analyzeBundle = true,
      analyzePerformance = false,
      analyzeSecurity = true
    } = options;

    const simulationId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const simulation = {
      id: simulationId,
      name,
      description,
      status: SIMULATION_STATUS.PENDING,
      createdAt: Date.now(),
      changes: this.normalizeChanges(changes),
      options: { analyzeTests, analyzeTypes, analyzeBundle, analyzePerformance, analyzeSecurity },
      
      // Results (populated during simulation)
      results: {
        impact: null,
        tests: null,
        types: null,
        bundle: null,
        performance: null,
        security: null
      },
      
      // Summary
      summary: null,
      risks: [],
      recommendations: [],
      
      // Virtual branch state
      virtualBranch: {
        files: new Map(),
        patches: []
      }
    };

    this.simulations.set(simulationId, simulation);
    this.currentSimulation = simulation;
    
    return simulation;
  }

  /**
   * Normalize changes to a standard format
   */
  normalizeChanges(changes) {
    if (!Array.isArray(changes)) {
      changes = [changes];
    }

    return changes.map(change => {
      if (typeof change === 'string') {
        // Assume it's a description, will need AI to generate patches
        return { type: 'description', content: change };
      }
      
      return {
        type: change.type || 'patch',
        file: change.file || change.path,
        before: change.before || change.original,
        after: change.after || change.modified,
        description: change.description || ''
      };
    });
  }

  /**
   * Run the simulation
   */
  async runSimulation(simulationId, projectFiles = {}) {
    const simulation = this.simulations.get(simulationId);
    if (!simulation) {
      throw new Error(`Simulation not found: ${simulationId}`);
    }

    simulation.status = SIMULATION_STATUS.RUNNING;
    simulation.startedAt = Date.now();
    this.notifyListeners();

    try {
      // Step 1: Create virtual branch with changes
      await this.createVirtualBranch(simulation, projectFiles);

      // Step 2: Run all analyses in parallel
      const analyses = [];
      
      // Impact analysis (always run)
      analyses.push(this.analyzeImpact(simulation, projectFiles));

      if (simulation.options.analyzeTests) {
        analyses.push(this.analyzeTests(simulation));
      }
      
      if (simulation.options.analyzeTypes) {
        analyses.push(this.analyzeTypes(simulation));
      }
      
      if (simulation.options.analyzeBundle) {
        analyses.push(this.analyzeBundle(simulation));
      }
      
      if (simulation.options.analyzePerformance) {
        analyses.push(this.analyzePerformance(simulation));
      }
      
      if (simulation.options.analyzeSecurity) {
        analyses.push(this.analyzeSecurity(simulation));
      }

      await Promise.all(analyses);

      // Step 3: Generate summary
      simulation.summary = this.generateSummary(simulation);
      
      simulation.status = SIMULATION_STATUS.COMPLETED;
      simulation.completedAt = Date.now();
      
    } catch (error) {
      simulation.status = SIMULATION_STATUS.FAILED;
      simulation.error = error.message;
      console.error('Simulation failed:', error);
    }

    this.notifyListeners();
    return simulation;
  }

  /**
   * Create a virtual branch with the proposed changes
   */
  async createVirtualBranch(simulation, projectFiles) {
    const virtualFiles = new Map(Object.entries(projectFiles));
    
    for (const change of simulation.changes) {
      if (change.type === 'patch' && change.file) {
        const originalContent = virtualFiles.get(change.file) || '';
        let newContent = originalContent;
        
        if (change.before && change.after) {
          // Apply patch
          newContent = originalContent.replace(change.before, change.after);
        } else if (change.after) {
          // Replace entire file
          newContent = change.after;
        }
        
        virtualFiles.set(change.file, newContent);
        
        // Store patch info
        simulation.virtualBranch.patches.push({
          file: change.file,
          original: originalContent,
          modified: newContent,
          diff: generateDiff(change.file, originalContent, newContent)
        });
      }
    }
    
    simulation.virtualBranch.files = virtualFiles;
  }

  /**
   * Analyze impact of changes
   */
  async analyzeImpact(simulation, projectFiles) {
    const impactResult = {
      type: ANALYSIS_TYPES.IMPACT,
      affectedFiles: [],
      dependencyChain: [],
      riskLevel: IMPACT_LEVEL.NONE,
      details: {}
    };

    for (const patch of simulation.virtualBranch.patches) {
      // Calculate blast radius for each change
      const blastRadius = calculateBlastRadius(patch.file, projectFiles);
      
      impactResult.affectedFiles.push({
        file: patch.file,
        directChanges: true,
        ...blastRadius
      });
      
      // Add dependent files
      if (blastRadius.dependents) {
        blastRadius.dependents.forEach(dep => {
          if (!impactResult.affectedFiles.find(f => f.file === dep)) {
            impactResult.affectedFiles.push({
              file: dep,
              directChanges: false,
              impactType: 'dependent'
            });
          }
        });
      }
    }

    // Calculate overall risk level
    const totalAffected = impactResult.affectedFiles.length;
    if (totalAffected > 20) {
      impactResult.riskLevel = IMPACT_LEVEL.CRITICAL;
    } else if (totalAffected > 10) {
      impactResult.riskLevel = IMPACT_LEVEL.HIGH;
    } else if (totalAffected > 5) {
      impactResult.riskLevel = IMPACT_LEVEL.MEDIUM;
    } else if (totalAffected > 0) {
      impactResult.riskLevel = IMPACT_LEVEL.LOW;
    }

    simulation.results.impact = impactResult;
    return impactResult;
  }

  /**
   * Simulate test results
   */
  async analyzeTests(simulation) {
    const testResult = {
      type: ANALYSIS_TYPES.TESTS,
      predicted: {
        passing: 0,
        failing: 0,
        skipped: 0,
        needsUpdate: 0
      },
      details: [],
      confidence: 0.7 // ML confidence in prediction
    };

    // Analyze each changed file for test implications
    for (const patch of simulation.virtualBranch.patches) {
      const file = patch.file;
      
      // Check if it's a test file being changed
      if (/\.(test|spec)\.(js|ts|jsx|tsx)$/.test(file)) {
        testResult.details.push({
          file,
          type: 'test_file_modified',
          impact: 'Tests in this file may need review'
        });
        testResult.predicted.needsUpdate++;
      }
      
      // Check if changed file has corresponding tests
      const testFile = file.replace(/\.(js|ts|jsx|tsx)$/, '.test.$1');
      if (simulation.virtualBranch.files.has(testFile)) {
        testResult.details.push({
          file,
          testFile,
          type: 'has_tests',
          impact: 'Related tests should be verified'
        });
      } else {
        testResult.details.push({
          file,
          type: 'no_tests',
          impact: 'No tests found for this file',
          recommendation: 'Consider adding tests'
        });
      }

      // Detect breaking changes
      const breakingPatterns = [
        /export\s+(default\s+)?function\s+\w+\s*\([^)]*\)/g,  // Function signature change
        /export\s+(const|let)\s+\w+\s*=/g,                    // Export change
        /interface\s+\w+/g,                                    // Interface change
        /type\s+\w+\s*=/g                                      // Type change
      ];

      for (const pattern of breakingPatterns) {
        const originalMatches = (patch.original.match(pattern) || []).sort();
        const modifiedMatches = (patch.modified.match(pattern) || []).sort();
        
        if (JSON.stringify(originalMatches) !== JSON.stringify(modifiedMatches)) {
          testResult.details.push({
            file,
            type: 'potential_breaking_change',
            impact: 'API signature may have changed',
            pattern: pattern.source
          });
          testResult.predicted.failing++;
        }
      }
    }

    // Estimate passing tests (simplified)
    testResult.predicted.passing = Math.max(0, 100 - testResult.predicted.failing - testResult.predicted.needsUpdate);

    simulation.results.tests = testResult;
    return testResult;
  }

  /**
   * Analyze type safety
   */
  async analyzeTypes(simulation) {
    const typeResult = {
      type: ANALYSIS_TYPES.TYPES,
      errors: [],
      warnings: [],
      status: 'safe'
    };

    for (const patch of simulation.virtualBranch.patches) {
      const content = patch.modified;
      
      // Check for common type issues
      const typePatterns = [
        { pattern: /:\s*any\b/g, severity: 'warning', message: 'Using "any" type reduces type safety' },
        { pattern: /as\s+any\b/g, severity: 'warning', message: 'Type assertion to "any"' },
        { pattern: /\/\/\s*@ts-ignore/g, severity: 'warning', message: 'TypeScript error ignored' },
        { pattern: /\/\/\s*@ts-expect-error/g, severity: 'info', message: 'Expected TypeScript error' },
        { pattern: /!\./g, severity: 'warning', message: 'Non-null assertion used' }
      ];

      for (const { pattern, severity, message } of typePatterns) {
        const matches = content.match(pattern);
        if (matches) {
          const entry = {
            file: patch.file,
            severity,
            message,
            count: matches.length
          };
          
          if (severity === 'error') {
            typeResult.errors.push(entry);
          } else {
            typeResult.warnings.push(entry);
          }
        }
      }

      // Check for type consistency in changes
      if (patch.original && patch.modified) {
        // Look for removed type annotations
        const originalTypes = (patch.original.match(/:\s*\w+(\[\])?(\s*\|\s*\w+)*/g) || []).length;
        const modifiedTypes = (patch.modified.match(/:\s*\w+(\[\])?(\s*\|\s*\w+)*/g) || []).length;
        
        if (modifiedTypes < originalTypes) {
          typeResult.warnings.push({
            file: patch.file,
            severity: 'warning',
            message: 'Type annotations may have been removed',
            detail: `${originalTypes} -> ${modifiedTypes} type annotations`
          });
        }
      }
    }

    // Determine overall status
    if (typeResult.errors.length > 0) {
      typeResult.status = 'error';
    } else if (typeResult.warnings.length > 0) {
      typeResult.status = 'warning';
    }

    simulation.results.types = typeResult;
    return typeResult;
  }

  /**
   * Estimate bundle size impact
   */
  async analyzeBundle(simulation) {
    const bundleResult = {
      type: ANALYSIS_TYPES.BUNDLE,
      estimatedChange: 0,
      changePercentage: 0,
      details: [],
      status: 'neutral'
    };

    for (const patch of simulation.virtualBranch.patches) {
      const originalSize = new Blob([patch.original]).size;
      const modifiedSize = new Blob([patch.modified]).size;
      const diff = modifiedSize - originalSize;
      
      bundleResult.estimatedChange += diff;
      
      // Check for new imports
      const originalImports = (patch.original.match(/import\s+.*from\s+['"][^'"]+['"]/g) || []);
      const modifiedImports = (patch.modified.match(/import\s+.*from\s+['"][^'"]+['"]/g) || []);
      
      const newImports = modifiedImports.filter(i => !originalImports.includes(i));
      
      if (newImports.length > 0) {
        bundleResult.details.push({
          file: patch.file,
          type: 'new_imports',
          imports: newImports,
          potentialImpact: 'May increase bundle size'
        });
      }

      // Check for large dependencies
      const heavyDeps = ['moment', 'lodash', 'jquery', 'rxjs'];
      for (const dep of heavyDeps) {
        if (newImports.some(i => i.includes(dep))) {
          bundleResult.details.push({
            file: patch.file,
            type: 'heavy_dependency',
            dependency: dep,
            warning: `"${dep}" is a heavy dependency. Consider a lighter alternative.`
          });
        }
      }
    }

    // Format results
    const changeKB = (bundleResult.estimatedChange / 1024).toFixed(2);
    bundleResult.changeFormatted = bundleResult.estimatedChange >= 0 ? `+${changeKB}kb` : `${changeKB}kb`;
    
    // Determine status
    if (bundleResult.estimatedChange > 50000) { // 50kb
      bundleResult.status = 'warning';
    } else if (bundleResult.estimatedChange < -10000) { // -10kb
      bundleResult.status = 'good';
    }

    simulation.results.bundle = bundleResult;
    return bundleResult;
  }

  /**
   * Analyze performance implications
   */
  async analyzePerformance(simulation) {
    const perfResult = {
      type: ANALYSIS_TYPES.PERFORMANCE,
      concerns: [],
      improvements: [],
      status: 'neutral'
    };

    const perfPatterns = [
      // Concerns
      { pattern: /for\s*\([^)]+\)\s*{[^}]*for\s*\([^)]+\)/gs, type: 'concern', message: 'Nested loops detected (O(n²) complexity)' },
      { pattern: /\.forEach\([^)]+\)\s*{[^}]*\.forEach/gs, type: 'concern', message: 'Nested forEach calls' },
      { pattern: /JSON\.parse\(JSON\.stringify/g, type: 'concern', message: 'Deep clone via JSON (slow for large objects)' },
      { pattern: /new RegExp\(/g, type: 'concern', message: 'Dynamic RegExp in loop may be slow' },
      { pattern: /document\.querySelector.*loop|for.*document\.querySelector/gis, type: 'concern', message: 'DOM queries in loop' },
      
      // Improvements
      { pattern: /useMemo|useCallback|React\.memo/g, type: 'improvement', message: 'Memoization used' },
      { pattern: /\.filter\([^)]+\)\.map\(/g, type: 'concern', message: 'Consider combining filter+map into reduce' },
    ];

    for (const patch of simulation.virtualBranch.patches) {
      for (const { pattern, type, message } of perfPatterns) {
        if (pattern.test(patch.modified)) {
          const entry = { file: patch.file, message };
          
          if (type === 'concern') {
            perfResult.concerns.push(entry);
          } else {
            perfResult.improvements.push(entry);
          }
        }
      }
    }

    // Determine status
    if (perfResult.concerns.length > perfResult.improvements.length) {
      perfResult.status = 'warning';
    } else if (perfResult.improvements.length > 0) {
      perfResult.status = 'good';
    }

    simulation.results.performance = perfResult;
    return perfResult;
  }

  /**
   * Analyze security implications
   */
  async analyzeSecurity(simulation) {
    const securityResult = {
      type: ANALYSIS_TYPES.SECURITY,
      vulnerabilities: [],
      warnings: [],
      status: 'safe'
    };

    const securityPatterns = [
      // Critical
      { pattern: /eval\s*\(/g, severity: 'critical', message: 'eval() is dangerous and can execute arbitrary code' },
      { pattern: /innerHTML\s*=/g, severity: 'high', message: 'innerHTML can lead to XSS vulnerabilities' },
      { pattern: /dangerouslySetInnerHTML/g, severity: 'high', message: 'dangerouslySetInnerHTML can lead to XSS' },
      { pattern: /document\.write/g, severity: 'high', message: 'document.write can be exploited' },
      
      // High
      { pattern: /exec\s*\(/g, severity: 'high', message: 'exec() can run arbitrary commands' },
      { pattern: /child_process/g, severity: 'high', message: 'child_process can execute system commands' },
      { pattern: /new Function\s*\(/g, severity: 'high', message: 'new Function() can execute arbitrary code' },
      
      // Medium
      { pattern: /localStorage\.(set|get)Item.*password/gi, severity: 'medium', message: 'Sensitive data in localStorage' },
      { pattern: /console\.(log|info|debug).*password/gi, severity: 'medium', message: 'Logging sensitive data' },
      { pattern: /\bpassword\s*[:=]\s*['"][^'"]+['"]/g, severity: 'medium', message: 'Hardcoded password detected' },
      { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi, severity: 'medium', message: 'Hardcoded API key detected' },
      
      // Low
      { pattern: /http:\/\//g, severity: 'low', message: 'Non-HTTPS URL detected' },
      { pattern: /target\s*=\s*['"]_blank['"](?![^>]*rel\s*=)/g, severity: 'low', message: 'target="_blank" without rel="noopener"' },
    ];

    for (const patch of simulation.virtualBranch.patches) {
      for (const { pattern, severity, message } of securityPatterns) {
        const matches = patch.modified.match(pattern);
        if (matches) {
          const entry = {
            file: patch.file,
            severity,
            message,
            count: matches.length,
            samples: matches.slice(0, 3)
          };
          
          if (severity === 'critical' || severity === 'high') {
            securityResult.vulnerabilities.push(entry);
          } else {
            securityResult.warnings.push(entry);
          }
        }
      }
    }

    // Determine status
    if (securityResult.vulnerabilities.some(v => v.severity === 'critical')) {
      securityResult.status = 'critical';
    } else if (securityResult.vulnerabilities.length > 0) {
      securityResult.status = 'unsafe';
    } else if (securityResult.warnings.length > 0) {
      securityResult.status = 'warning';
    }

    simulation.results.security = securityResult;
    return securityResult;
  }

  /**
   * Generate summary of simulation results
   */
  generateSummary(simulation) {
    const { results } = simulation;
    const summary = {
      overallRisk: IMPACT_LEVEL.NONE,
      canProceed: true,
      blockers: [],
      warnings: [],
      positives: []
    };

    // Evaluate each analysis result
    if (results.impact) {
      if (results.impact.riskLevel === IMPACT_LEVEL.CRITICAL) {
        summary.blockers.push(`High impact: ${results.impact.affectedFiles.length} files affected`);
        summary.overallRisk = IMPACT_LEVEL.CRITICAL;
      } else if (results.impact.riskLevel === IMPACT_LEVEL.HIGH) {
        summary.warnings.push(`${results.impact.affectedFiles.length} files will be affected`);
        if (summary.overallRisk !== IMPACT_LEVEL.CRITICAL) {
          summary.overallRisk = IMPACT_LEVEL.HIGH;
        }
      }
    }

    if (results.tests) {
      if (results.tests.predicted.failing > 0) {
        summary.warnings.push(`${results.tests.predicted.failing} tests may fail`);
      }
      if (results.tests.predicted.needsUpdate > 0) {
        summary.warnings.push(`${results.tests.predicted.needsUpdate} tests may need updates`);
      }
    }

    if (results.types) {
      if (results.types.status === 'error') {
        summary.blockers.push('Type errors detected');
        summary.overallRisk = IMPACT_LEVEL.HIGH;
      } else if (results.types.warnings.length > 0) {
        summary.warnings.push(`${results.types.warnings.length} type warnings`);
      }
    }

    if (results.security) {
      if (results.security.status === 'critical') {
        summary.blockers.push('Critical security vulnerabilities detected');
        summary.overallRisk = IMPACT_LEVEL.CRITICAL;
      } else if (results.security.status === 'unsafe') {
        summary.blockers.push(`${results.security.vulnerabilities.length} security issues found`);
        summary.overallRisk = IMPACT_LEVEL.HIGH;
      }
    }

    if (results.bundle) {
      if (results.bundle.status === 'good') {
        summary.positives.push(`Bundle size reduced by ${Math.abs(results.bundle.estimatedChange / 1024).toFixed(1)}kb`);
      } else if (results.bundle.estimatedChange > 100000) {
        summary.warnings.push(`Bundle size may increase by ${(results.bundle.estimatedChange / 1024).toFixed(1)}kb`);
      }
    }

    if (results.performance) {
      if (results.performance.concerns.length > 0) {
        summary.warnings.push(`${results.performance.concerns.length} performance concerns`);
      }
      if (results.performance.improvements.length > 0) {
        summary.positives.push('Performance optimizations detected');
      }
    }

    // Final decision
    summary.canProceed = summary.blockers.length === 0;

    return summary;
  }

  /**
   * Apply the simulated changes for real
   */
  async applySimulation(simulationId) {
    const simulation = this.simulations.get(simulationId);
    if (!simulation || simulation.status !== SIMULATION_STATUS.COMPLETED) {
      throw new Error('Simulation not ready to apply');
    }

    const patches = [];
    
    for (const patch of simulation.virtualBranch.patches) {
      patches.push({
        file: patch.file,
        original: patch.original,
        modified: patch.modified
      });
    }

    return { patches, simulation };
  }

  /**
   * Discard a simulation
   */
  discardSimulation(simulationId) {
    const simulation = this.simulations.get(simulationId);
    if (simulation) {
      this.simulations.delete(simulationId);
      if (this.currentSimulation?.id === simulationId) {
        this.currentSimulation = null;
      }
      this.notifyListeners();
    }
  }

  /**
   * Get a simulation by ID
   */
  getSimulation(simulationId) {
    return this.simulations.get(simulationId);
  }

  /**
   * Get current simulation
   */
  getCurrentSimulation() {
    return this.currentSimulation;
  }

  /**
   * Get all simulations
   */
  getAllSimulations() {
    return Array.from(this.simulations.values());
  }

  /**
   * Add a state change listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners() {
    const state = {
      current: this.currentSimulation,
      all: this.getAllSimulations()
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('What-if listener error:', error);
      }
    });
  }
}

// Singleton instance
let instance = null;

export function getWhatIfEngine() {
  if (!instance) {
    instance = new WhatIfEngine();
  }
  return instance;
}

export function createWhatIfEngine() {
  return new WhatIfEngine();
}

export { SIMULATION_STATUS, IMPACT_LEVEL, ANALYSIS_TYPES };
export default WhatIfEngine;
