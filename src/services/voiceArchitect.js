/**
 * Voice Architect Service
 * 
 * Converts voice descriptions into architecture diagrams and component structures.
 * Integrates with Whisper for transcription and LLM for interpretation.
 */

// Architecture elements
const ARCHITECTURE_ELEMENTS = {
  component: {
    name: 'Component',
    icon: '📦',
    patterns: ['component', 'widget', 'element', 'piece', 'part']
  },
  service: {
    name: 'Service',
    icon: '⚙️',
    patterns: ['service', 'api', 'backend', 'server', 'endpoint']
  },
  database: {
    name: 'Database',
    icon: '🗄️',
    patterns: ['database', 'db', 'storage', 'store', 'table']
  },
  user: {
    name: 'User/Actor',
    icon: '👤',
    patterns: ['user', 'admin', 'customer', 'client', 'actor']
  },
  external: {
    name: 'External System',
    icon: '🌐',
    patterns: ['external', 'third party', '3rd party', 'integration', 'webhook']
  },
  queue: {
    name: 'Message Queue',
    icon: '📬',
    patterns: ['queue', 'message', 'event', 'pub sub', 'kafka', 'rabbitmq']
  },
  cache: {
    name: 'Cache',
    icon: '⚡',
    patterns: ['cache', 'redis', 'memcache', 'memory']
  },
  gateway: {
    name: 'Gateway/Proxy',
    icon: '🚪',
    patterns: ['gateway', 'proxy', 'load balancer', 'nginx', 'router']
  }
};

// Relationship types
const RELATIONSHIPS = {
  calls: { label: 'calls', arrow: '-->' },
  stores: { label: 'stores', arrow: '-->' },
  reads: { label: 'reads', arrow: '-->' },
  publishes: { label: 'publishes', arrow: '-.->'},
  subscribes: { label: 'subscribes', arrow: '-.->' },
  contains: { label: 'contains', arrow: '--*' }
};

class VoiceArchitect {
  constructor() {
    this.currentSession = null;
    this.architecture = null;
    this.isRecording = false;
    this.listeners = new Set();
    this.transcriptions = [];
  }

  /**
   * Start a new voice architecture session
   */
  startSession(name = 'New Architecture') {
    this.currentSession = {
      id: `arch_${Date.now()}`,
      name,
      startedAt: Date.now(),
      transcriptions: [],
      elements: [],
      relationships: [],
      mermaidCode: ''
    };
    this.notifyListeners();
    return this.currentSession;
  }

  /**
   * Process transcribed text
   */
  processTranscription(text) {
    if (!this.currentSession) {
      this.startSession();
    }

    // Store transcription
    this.currentSession.transcriptions.push({
      text,
      timestamp: Date.now()
    });

    // Parse for architecture elements
    const parsed = this.parseDescription(text);
    
    // Merge into current architecture
    this.mergeElements(parsed.elements);
    this.mergeRelationships(parsed.relationships);

    // Generate Mermaid diagram
    this.currentSession.mermaidCode = this.generateMermaid();

    this.notifyListeners();
    return this.currentSession;
  }

  /**
   * Parse natural language description for architecture elements
   */
  parseDescription(text) {
    const elements = [];
    const relationships = [];
    const lowerText = text.toLowerCase();

    // Detect elements
    for (const [type, config] of Object.entries(ARCHITECTURE_ELEMENTS)) {
      for (const pattern of config.patterns) {
        const regex = new RegExp(`(a |an |the )?([\\w-]+)\\s+${pattern}`, 'gi');
        const matches = [...text.matchAll(regex)];
        
        matches.forEach(match => {
          const name = match[2] || pattern;
          const id = this.sanitizeId(name);
          
          if (!elements.find(e => e.id === id)) {
            elements.push({
              id,
              name: this.capitalize(name),
              type,
              icon: config.icon
            });
          }
        });

        // Also check for standalone patterns
        if (lowerText.includes(pattern) && !elements.find(e => e.type === type)) {
          const id = this.sanitizeId(pattern);
          elements.push({
            id,
            name: config.name,
            type,
            icon: config.icon
          });
        }
      }
    }

    // Detect relationships
    const relationshipPatterns = [
      { pattern: /(\w+)\s+(?:calls|requests|fetches from|talks to)\s+(\w+)/gi, type: 'calls' },
      { pattern: /(\w+)\s+(?:stores|saves|writes to|persists to)\s+(\w+)/gi, type: 'stores' },
      { pattern: /(\w+)\s+(?:reads|gets|fetches|queries)\s+(?:from\s+)?(\w+)/gi, type: 'reads' },
      { pattern: /(\w+)\s+(?:publishes|emits|sends)\s+(?:to\s+)?(\w+)/gi, type: 'publishes' },
      { pattern: /(\w+)\s+(?:subscribes|listens)\s+(?:to\s+)?(\w+)/gi, type: 'subscribes' },
      { pattern: /(\w+)\s+(?:contains|has|includes)\s+(\w+)/gi, type: 'contains' }
    ];

    for (const { pattern, type } of relationshipPatterns) {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        const from = this.sanitizeId(match[1]);
        const to = this.sanitizeId(match[2]);
        
        // Only add if both elements exist or will exist
        if (from && to && from !== to) {
          relationships.push({ from, to, type });
        }
      });
    }

    return { elements, relationships };
  }

  /**
   * Merge new elements into architecture
   */
  mergeElements(newElements) {
    for (const element of newElements) {
      const existing = this.currentSession.elements.find(e => e.id === element.id);
      if (!existing) {
        this.currentSession.elements.push(element);
      }
    }
  }

  /**
   * Merge new relationships into architecture
   */
  mergeRelationships(newRelationships) {
    for (const rel of newRelationships) {
      const existing = this.currentSession.relationships.find(
        r => r.from === rel.from && r.to === rel.to && r.type === rel.type
      );
      if (!existing) {
        this.currentSession.relationships.push(rel);
      }
    }
  }

  /**
   * Generate Mermaid diagram code
   */
  generateMermaid() {
    if (!this.currentSession) return '';

    const { elements, relationships } = this.currentSession;
    if (elements.length === 0) return '';

    let mermaid = 'flowchart TD\n';

    // Group elements by type
    const grouped = {};
    for (const element of elements) {
      if (!grouped[element.type]) grouped[element.type] = [];
      grouped[element.type].push(element);
    }

    // Add elements
    for (const element of elements) {
      const shape = this.getElementShape(element.type);
      mermaid += `    ${element.id}${shape[0]}${element.icon} ${element.name}${shape[1]}\n`;
    }

    mermaid += '\n';

    // Add relationships
    for (const rel of relationships) {
      const relConfig = RELATIONSHIPS[rel.type] || RELATIONSHIPS.calls;
      mermaid += `    ${rel.from} ${relConfig.arrow}|${relConfig.label}| ${rel.to}\n`;
    }

    // Add subgraphs for groups
    if (Object.keys(grouped).length > 1) {
      mermaid += '\n';
      for (const [type, typeElements] of Object.entries(grouped)) {
        if (typeElements.length > 1) {
          const config = ARCHITECTURE_ELEMENTS[type];
          mermaid += `    subgraph ${type}Group[${config?.name || type}]\n`;
          typeElements.forEach(e => {
            mermaid += `        ${e.id}\n`;
          });
          mermaid += '    end\n';
        }
      }
    }

    return mermaid;
  }

  /**
   * Get Mermaid shape for element type
   */
  getElementShape(type) {
    const shapes = {
      database: ['[(', ')]'],
      external: ['{{', '}}'],
      queue: ['[/', '/]'],
      user: ['([', '])'],
      default: ['[', ']']
    };
    return shapes[type] || shapes.default;
  }

  /**
   * Sanitize ID for Mermaid
   */
  sanitizeId(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 30);
  }

  /**
   * Capitalize first letter
   */
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Add element manually
   */
  addElement(element) {
    if (!this.currentSession) this.startSession();
    
    const id = element.id || this.sanitizeId(element.name);
    const newElement = {
      id,
      name: element.name,
      type: element.type || 'component',
      icon: element.icon || ARCHITECTURE_ELEMENTS[element.type]?.icon || '📦'
    };

    if (!this.currentSession.elements.find(e => e.id === id)) {
      this.currentSession.elements.push(newElement);
      this.currentSession.mermaidCode = this.generateMermaid();
      this.notifyListeners();
    }

    return newElement;
  }

  /**
   * Add relationship manually
   */
  addRelationship(from, to, type = 'calls') {
    if (!this.currentSession) return null;

    const relationship = { from, to, type };
    
    const exists = this.currentSession.relationships.find(
      r => r.from === from && r.to === to
    );

    if (!exists) {
      this.currentSession.relationships.push(relationship);
      this.currentSession.mermaidCode = this.generateMermaid();
      this.notifyListeners();
    }

    return relationship;
  }

  /**
   * Remove element
   */
  removeElement(elementId) {
    if (!this.currentSession) return;

    this.currentSession.elements = this.currentSession.elements.filter(
      e => e.id !== elementId
    );
    this.currentSession.relationships = this.currentSession.relationships.filter(
      r => r.from !== elementId && r.to !== elementId
    );
    this.currentSession.mermaidCode = this.generateMermaid();
    this.notifyListeners();
  }

  /**
   * Remove relationship
   */
  removeRelationship(from, to) {
    if (!this.currentSession) return;

    this.currentSession.relationships = this.currentSession.relationships.filter(
      r => !(r.from === from && r.to === to)
    );
    this.currentSession.mermaidCode = this.generateMermaid();
    this.notifyListeners();
  }

  /**
   * Generate component scaffold from architecture
   */
  generateScaffold() {
    if (!this.currentSession) return null;

    const scaffold = {
      components: [],
      services: [],
      structure: []
    };

    for (const element of this.currentSession.elements) {
      if (element.type === 'component') {
        scaffold.components.push({
          name: element.name,
          file: `src/components/${element.name}.jsx`,
          template: this.generateComponentTemplate(element)
        });
      } else if (element.type === 'service') {
        scaffold.services.push({
          name: element.name,
          file: `src/services/${element.name.toLowerCase()}Service.js`,
          template: this.generateServiceTemplate(element)
        });
      }
    }

    scaffold.structure = this.generateFolderStructure();

    return scaffold;
  }

  /**
   * Generate component template
   */
  generateComponentTemplate(element) {
    const name = element.name.replace(/\s+/g, '');
    return `import React from 'react';

const ${name} = () => {
  return (
    <div className="${name.toLowerCase()}">
      <h2>${element.name}</h2>
      {/* TODO: Implement ${element.name} */}
    </div>
  );
};

export default ${name};
`;
  }

  /**
   * Generate service template
   */
  generateServiceTemplate(element) {
    const name = element.name.toLowerCase();
    return `/**
 * ${element.name} Service
 */

class ${element.name}Service {
  constructor() {
    // Initialize service
  }

  // TODO: Implement ${element.name} methods
}

export const ${name}Service = new ${element.name}Service();
export default ${element.name}Service;
`;
  }

  /**
   * Generate folder structure
   */
  generateFolderStructure() {
    const structure = ['src/'];
    
    const components = this.currentSession?.elements.filter(e => e.type === 'component') || [];
    if (components.length > 0) {
      structure.push('  components/');
      components.forEach(c => {
        structure.push(`    ${c.name.replace(/\s+/g, '')}.jsx`);
      });
    }

    const services = this.currentSession?.elements.filter(e => e.type === 'service') || [];
    if (services.length > 0) {
      structure.push('  services/');
      services.forEach(s => {
        structure.push(`    ${s.name.toLowerCase()}Service.js`);
      });
    }

    return structure;
  }

  /**
   * Get current session
   */
  getSession() {
    return this.currentSession;
  }

  /**
   * Clear session
   */
  clearSession() {
    this.currentSession = null;
    this.notifyListeners();
  }

  /**
   * Export session
   */
  exportSession() {
    return this.currentSession ? { ...this.currentSession } : null;
  }

  /**
   * Import session
   */
  importSession(session) {
    this.currentSession = session;
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
      session: this.currentSession,
      isRecording: this.isRecording
    };
    
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('Voice architect listener error:', error);
      }
    });
  }
}

// Singleton
let instance = null;

export function getVoiceArchitect() {
  if (!instance) {
    instance = new VoiceArchitect();
  }
  return instance;
}

export { ARCHITECTURE_ELEMENTS, RELATIONSHIPS };
export default VoiceArchitect;
