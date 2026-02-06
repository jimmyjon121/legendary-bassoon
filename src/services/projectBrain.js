/**
 * Project Brain
 * 
 * Maintains a living understanding of the codebase:
 * - Entry points (main files)
 * - Module dependency graph
 * - State stores (Zustand, Redux, etc.)
 * - API surface (exported functions/components)
 * - IPC handlers (for Electron)
 * - Critical flows (user-defined)
 * - Coding conventions
 * - Known gotchas
 * 
 * This is more useful than semantic search alone - it's structured knowledge.
 */

import { api } from '../utils/electronAPI';

// ============================================================================
// Project Brain Class
// ============================================================================

export class ProjectBrain {
  constructor(projectRoot = '') {
    this.projectRoot = projectRoot;
    this.manifest = {
      entrypoints: [],        // Main entry files
      modules: {},            // Module dependency graph
      stateStores: [],        // State management (Zustand, Redux, etc.)
      apiSurface: [],         // Exported functions/components
      ipcHandlers: [],        // Electron IPC surface
      criticalFlows: [],      // User-defined important paths
      conventions: [],        // Detected/user-added conventions
      gotchas: [],            // Known issues/quirks
      techStack: [],          // Detected technologies
      scripts: {},            // Available npm scripts
    };
    this.analyzedAt = null;
    this.analyzing = false;
  }

  /**
   * Analyze the project and build the brain
   */
  async analyze(tree, options = {}) {
    if (this.analyzing) return this.manifest;
    
    this.analyzing = true;
    console.log('[ProjectBrain] Starting analysis...');
    
    try {
      // Detect tech stack from package.json
      await this.detectTechStack();
      
      // Find entry points
      this.findEntrypoints(tree);
      
      // Analyze module structure
      if (options.analyzeModules !== false) {
        await this.analyzeModules(tree);
      }
      
      // Find state stores
      this.findStateStores(tree);
      
      // Find IPC handlers (Electron)
      this.findIPCHandlers(tree);
      
      // Detect conventions
      this.detectConventions(tree);
      
      this.analyzedAt = Date.now();
      console.log('[ProjectBrain] Analysis complete');
      
    } finally {
      this.analyzing = false;
    }
    
    return this.manifest;
  }

  /**
   * Detect tech stack from package.json
   */
  async detectTechStack() {
    try {
      const pkgContent = await api.readFile(`${this.projectRoot}/package.json`);
      const pkg = JSON.parse(pkgContent || '{}');
      
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const stack = [];
      
      // Frontend frameworks
      if (deps.react) stack.push({ name: 'React', version: deps.react, type: 'framework' });
      if (deps.vue) stack.push({ name: 'Vue', version: deps.vue, type: 'framework' });
      if (deps.svelte) stack.push({ name: 'Svelte', version: deps.svelte, type: 'framework' });
      if (deps.angular) stack.push({ name: 'Angular', version: deps.angular, type: 'framework' });
      
      // Build tools
      if (deps.vite) stack.push({ name: 'Vite', version: deps.vite, type: 'build' });
      if (deps.webpack) stack.push({ name: 'Webpack', version: deps.webpack, type: 'build' });
      if (deps.esbuild) stack.push({ name: 'esbuild', version: deps.esbuild, type: 'build' });
      
      // State management
      if (deps.zustand) stack.push({ name: 'Zustand', version: deps.zustand, type: 'state' });
      if (deps.redux) stack.push({ name: 'Redux', version: deps.redux, type: 'state' });
      if (deps.mobx) stack.push({ name: 'MobX', version: deps.mobx, type: 'state' });
      if (deps.recoil) stack.push({ name: 'Recoil', version: deps.recoil, type: 'state' });
      
      // Styling
      if (deps.tailwindcss) stack.push({ name: 'Tailwind CSS', version: deps.tailwindcss, type: 'styling' });
      if (deps['styled-components']) stack.push({ name: 'Styled Components', version: deps['styled-components'], type: 'styling' });
      
      // Desktop
      if (deps.electron) stack.push({ name: 'Electron', version: deps.electron, type: 'platform' });
      if (deps.tauri) stack.push({ name: 'Tauri', version: deps.tauri, type: 'platform' });
      
      // Language
      if (deps.typescript) stack.push({ name: 'TypeScript', version: deps.typescript, type: 'language' });
      
      // Testing
      if (deps.jest) stack.push({ name: 'Jest', version: deps.jest, type: 'testing' });
      if (deps.vitest) stack.push({ name: 'Vitest', version: deps.vitest, type: 'testing' });
      if (deps.playwright) stack.push({ name: 'Playwright', version: deps.playwright, type: 'testing' });
      
      this.manifest.techStack = stack;
      this.manifest.scripts = pkg.scripts || {};
      
    } catch (error) {
      console.warn('[ProjectBrain] Could not read package.json:', error.message);
    }
  }

  /**
   * Find entry points in the project
   */
  findEntrypoints(tree) {
    const entryPatterns = [
      /^index\.(js|ts|jsx|tsx)$/,
      /^main\.(js|ts|jsx|tsx)$/,
      /^app\.(js|ts|jsx|tsx)$/,
      /^_app\.(js|ts|jsx|tsx)$/,
      /^entry\.(js|ts|jsx|tsx)$/,
    ];
    
    const entrypoints = [];
    
    const walk = (nodes, parentPath = '') => {
      for (const node of nodes || []) {
        const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
        
        if (node.type === 'file') {
          // Check if it's an entry point
          if (entryPatterns.some(p => p.test(node.name))) {
            entrypoints.push({
              path: node.path || nodePath,
              name: node.name,
              type: this.inferEntryType(node.name, parentPath)
            });
          }
        } else if (node.type === 'dir') {
          // Only go into src, app, pages directories
          const dirName = node.name.toLowerCase();
          if (['src', 'app', 'pages', 'electron', 'renderer'].includes(dirName)) {
            walk(node.children, nodePath);
          }
        }
      }
    };
    
    walk(tree);
    this.manifest.entrypoints = entrypoints;
  }

  /**
   * Infer entry point type
   */
  inferEntryType(fileName, parentPath) {
    if (parentPath.includes('electron') || parentPath.includes('main')) return 'electron-main';
    if (parentPath.includes('renderer')) return 'electron-renderer';
    if (parentPath.includes('pages')) return 'page';
    if (parentPath.includes('api')) return 'api';
    if (fileName.startsWith('_app')) return 'app-wrapper';
    return 'main';
  }

  /**
   * Analyze module structure
   */
  async analyzeModules(tree) {
    // Find key directories
    const keyDirs = ['components', 'services', 'stores', 'utils', 'hooks', 'lib', 'api'];
    const modules = {};
    
    const walk = (nodes, parentPath = '') => {
      for (const node of nodes || []) {
        const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
        const dirName = node.name?.toLowerCase();
        
        if (node.type === 'dir') {
          if (keyDirs.includes(dirName)) {
            modules[dirName] = {
              path: node.path || nodePath,
              files: this.countFiles(node.children),
              description: this.getModuleDescription(dirName)
            };
          }
          walk(node.children, nodePath);
        }
      }
    };
    
    walk(tree);
    this.manifest.modules = modules;
  }

  /**
   * Count files in a tree
   */
  countFiles(nodes) {
    let count = 0;
    const walk = (nodeList) => {
      for (const node of nodeList || []) {
        if (node.type === 'file') count++;
        else if (node.type === 'dir') walk(node.children);
      }
    };
    walk(nodes);
    return count;
  }

  /**
   * Get module description
   */
  getModuleDescription(dirName) {
    const descriptions = {
      components: 'React/UI components',
      services: 'Business logic and external API calls',
      stores: 'State management (Zustand/Redux stores)',
      utils: 'Utility functions and helpers',
      hooks: 'Custom React hooks',
      lib: 'Third-party library wrappers',
      api: 'API routes and handlers'
    };
    return descriptions[dirName] || 'Module';
  }

  /**
   * Find state stores
   */
  findStateStores(tree) {
    const storePatterns = [
      /store\.(js|ts|jsx|tsx)$/i,
      /Store\.(js|ts|jsx|tsx)$/i,
      /\.store\.(js|ts|jsx|tsx)$/i,
      /slice\.(js|ts)$/i,
      /Slice\.(js|ts)$/i,
    ];
    
    const stores = [];
    
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.type === 'file') {
          if (storePatterns.some(p => p.test(node.name))) {
            stores.push({
              path: node.path,
              name: node.name.replace(/\.(js|ts|jsx|tsx)$/, ''),
              type: this.inferStoreType(node.name)
            });
          }
        } else if (node.type === 'dir') {
          walk(node.children);
        }
      }
    };
    
    walk(tree);
    this.manifest.stateStores = stores;
  }

  /**
   * Infer store type
   */
  inferStoreType(fileName) {
    if (fileName.toLowerCase().includes('slice')) return 'redux-slice';
    if (fileName.toLowerCase().includes('store')) return 'zustand';
    return 'unknown';
  }

  /**
   * Find IPC handlers (Electron)
   */
  findIPCHandlers(tree) {
    const ipcPatterns = [
      /ipc.*handler/i,
      /handler.*ipc/i,
      /preload/i,
    ];
    
    const handlers = [];
    
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.type === 'file') {
          if (ipcPatterns.some(p => p.test(node.name))) {
            handlers.push({
              path: node.path,
              name: node.name,
              type: node.name.toLowerCase().includes('preload') ? 'preload' : 'handler'
            });
          }
        } else if (node.type === 'dir') {
          walk(node.children);
        }
      }
    };
    
    walk(tree);
    this.manifest.ipcHandlers = handlers;
  }

  /**
   * Detect coding conventions
   */
  detectConventions(tree) {
    const conventions = [];
    
    // Check for config files
    const configPatterns = {
      '.eslintrc': 'ESLint code style',
      '.prettierrc': 'Prettier formatting',
      'tsconfig.json': 'TypeScript strict mode',
      '.editorconfig': 'Editor config',
    };
    
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.type === 'file') {
          for (const [pattern, description] of Object.entries(configPatterns)) {
            if (node.name.includes(pattern)) {
              conventions.push({
                rule: description,
                source: node.name,
                automatic: true
              });
            }
          }
        } else if (node.type === 'dir') {
          walk(node.children);
        }
      }
    };
    
    walk(tree);
    
    // Add tech-stack-based conventions
    const hasReact = this.manifest.techStack.some(t => t.name === 'React');
    const hasTypeScript = this.manifest.techStack.some(t => t.name === 'TypeScript');
    const hasTailwind = this.manifest.techStack.some(t => t.name === 'Tailwind CSS');
    
    if (hasReact) {
      conventions.push({ rule: 'Use functional components with hooks', source: 'react', automatic: true });
    }
    if (hasTypeScript) {
      conventions.push({ rule: 'Add types to all function parameters and returns', source: 'typescript', automatic: true });
    }
    if (hasTailwind) {
      conventions.push({ rule: 'Use Tailwind utility classes for styling', source: 'tailwindcss', automatic: true });
    }
    
    this.manifest.conventions = conventions;
  }

  /**
   * Add a gotcha (known issue)
   */
  addGotcha(description, filePath = null, context = '') {
    this.manifest.gotchas.push({
      id: `gotcha_${Date.now()}`,
      description,
      filePath,
      context,
      addedAt: Date.now()
    });
    return this;
  }

  /**
   * Add a convention
   */
  addConvention(rule, examples = []) {
    this.manifest.conventions.push({
      rule,
      examples,
      automatic: false,
      addedAt: Date.now()
    });
    return this;
  }

  /**
   * Add a critical flow
   */
  addCriticalFlow(name, files, description = '') {
    this.manifest.criticalFlows.push({
      id: `flow_${Date.now()}`,
      name,
      files,
      description,
      addedAt: Date.now()
    });
    return this;
  }

  /**
   * Get context for a specific file
   */
  getContextFor(filePath) {
    const context = {
      relatedModules: [],
      conventions: [],
      gotchas: [],
      criticalFlows: []
    };
    
    // Find related modules
    for (const [name, mod] of Object.entries(this.manifest.modules)) {
      if (filePath.includes(mod.path)) {
        context.relatedModules.push({ name, ...mod });
      }
    }
    
    // Find relevant gotchas
    context.gotchas = this.manifest.gotchas.filter(g => 
      !g.filePath || filePath.includes(g.filePath)
    );
    
    // Find critical flows involving this file
    context.criticalFlows = this.manifest.criticalFlows.filter(f =>
      f.files.some(file => filePath.includes(file) || file.includes(filePath))
    );
    
    // All conventions apply
    context.conventions = this.manifest.conventions;
    
    return context;
  }

  /**
   * Serialize to prompt context
   */
  toPromptContext() {
    const sections = [];
    
    // Tech stack
    if (this.manifest.techStack.length > 0) {
      sections.push(`## Tech Stack
${this.manifest.techStack.map(t => `- ${t.name} (${t.type})`).join('\n')}`);
    }
    
    // Entry points
    if (this.manifest.entrypoints.length > 0) {
      sections.push(`## Entry Points
${this.manifest.entrypoints.map(e => `- ${e.path} (${e.type})`).join('\n')}`);
    }
    
    // Modules
    if (Object.keys(this.manifest.modules).length > 0) {
      sections.push(`## Key Modules
${Object.entries(this.manifest.modules).map(([name, m]) => `- ${name}/: ${m.description} (${m.files} files)`).join('\n')}`);
    }
    
    // State stores
    if (this.manifest.stateStores.length > 0) {
      sections.push(`## State Stores
${this.manifest.stateStores.map(s => `- ${s.path}`).join('\n')}`);
    }
    
    // Conventions
    if (this.manifest.conventions.length > 0) {
      sections.push(`## Coding Conventions
${this.manifest.conventions.map(c => `- ${c.rule}`).join('\n')}`);
    }
    
    // Gotchas
    if (this.manifest.gotchas.length > 0) {
      sections.push(`## Known Gotchas
${this.manifest.gotchas.map(g => `- ${g.description}${g.filePath ? ` (${g.filePath})` : ''}`).join('\n')}`);
    }
    
    return sections.join('\n\n');
  }

  /**
   * Export manifest
   */
  export() {
    return {
      projectRoot: this.projectRoot,
      analyzedAt: this.analyzedAt,
      ...this.manifest
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let brain = null;

export function getProjectBrain(projectRoot) {
  if (!brain || (projectRoot && brain.projectRoot !== projectRoot)) {
    brain = new ProjectBrain(projectRoot);
  }
  return brain;
}

export function createProjectBrain(projectRoot) {
  return new ProjectBrain(projectRoot);
}

// ============================================================================
// Export
// ============================================================================

export default {
  ProjectBrain,
  getProjectBrain,
  createProjectBrain
};
