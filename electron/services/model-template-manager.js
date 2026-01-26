/**
 * Model Template Manager
 * 
 * Automatically detects and applies the correct chat template for models.
 * Similar to how LM Studio handles model templates.
 */

const axios = require('axios');

// Known chat templates for different model families
const CHAT_TEMPLATES = {
  // Vicuna format (wizard-vicuna, vicuna, etc.)
  vicuna: {
    template: `A chat between a curious user and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the user's questions.

{{ if .System }}{{ .System }}

{{ end }}{{ range .Messages }}{{ if eq .Role "user" }}USER: {{ .Content }}
{{ else if eq .Role "assistant" }}ASSISTANT: {{ .Content }}
{{ end }}{{ end }}ASSISTANT:`,
    system: 'You are a helpful AI assistant.',
    stop: ['USER:', '</s>'],
  },

  // Llama 2 Chat format
  llama2: {
    template: `{{ if .System }}<s>[INST] <<SYS>>
{{ .System }}
<</SYS>>

{{ end }}{{ range $i, $msg := .Messages }}{{ if eq .Role "user" }}{{ if $i }}[INST] {{ end }}{{ .Content }} [/INST]{{ else if eq .Role "assistant" }} {{ .Content }} </s>{{ end }}{{ end }}`,
    system: 'You are a helpful, respectful and honest assistant.',
    stop: ['[INST]', '</s>'],
  },

  // ChatML format (OpenHermes, Nous-Hermes, etc.)
  chatml: {
    template: `{{ range .Messages }}<|im_start|>{{ .Role }}
{{ .Content }}<|im_end|>
{{ end }}<|im_start|>assistant
`,
    system: 'You are a helpful AI assistant.',
    stop: ['<|im_end|>', '<|im_start|>'],
  },

  // Alpaca/Stanford format
  alpaca: {
    template: `{{ if .System }}### System:
{{ .System }}

{{ end }}{{ range .Messages }}{{ if eq .Role "user" }}### Instruction:
{{ .Content }}

{{ else if eq .Role "assistant" }}### Response:
{{ .Content }}

{{ end }}{{ end }}### Response:
`,
    system: 'Below is an instruction that describes a task. Write a response that appropriately completes the request.',
    stop: ['### Instruction:', '###'],
  },

  // Mistral Instruct format
  mistral: {
    template: `{{ range .Messages }}{{ if eq .Role "user" }}[INST] {{ .Content }} [/INST]{{ else if eq .Role "assistant" }}{{ .Content }}</s>{{ end }}{{ end }}`,
    system: '',
    stop: ['[INST]', '</s>'],
  },

  // Phi format (Microsoft)
  phi: {
    template: `{{ if .System }}<|system|>
{{ .System }}<|end|>
{{ end }}{{ range .Messages }}{{ if eq .Role "user" }}<|user|>
{{ .Content }}<|end|>
{{ else if eq .Role "assistant" }}<|assistant|>
{{ .Content }}<|end|>
{{ end }}{{ end }}<|assistant|>
`,
    system: 'You are a helpful AI assistant.',
    stop: ['<|end|>', '<|user|>'],
  },

  // Simple Human/Assistant format (fallback for uncensored models)
  simple: {
    template: `{{ if .System }}{{ .System }}

{{ end }}{{ range .Messages }}{{ if eq .Role "user" }}Human: {{ .Content }}

{{ else if eq .Role "assistant" }}Assistant: {{ .Content }}

{{ end }}{{ end }}Assistant:`,
    system: 'You are a helpful AI assistant. Answer directly and conversationally.',
    stop: ['Human:', '\n\nHuman'],
  },
};

// Model name patterns to template mapping
const MODEL_TEMPLATE_MAP = {
  // Vicuna family
  'vicuna': 'vicuna',
  'wizard-vicuna': 'vicuna',
  'wizardvicuna': 'vicuna',
  
  // Llama 2 family  
  'llama-2': 'llama2',
  'llama2': 'llama2',
  'codellama': 'llama2',
  
  // ChatML family
  'openhermes': 'chatml',
  'nous-hermes': 'chatml',
  'hermes': 'chatml',
  'dolphin': 'chatml',
  
  // Alpaca family
  'alpaca': 'alpaca',
  'guanaco': 'alpaca',
  
  // Mistral family
  'mistral': 'mistral',
  'mixtral': 'mistral',
  'zephyr': 'mistral',
  
  // Phi family
  'phi': 'phi',
  'phi-2': 'phi',
  'phi-3': 'phi',
  
  // Uncensored/NSFW (use simple format)
  'mlewd': 'simple',
  'xwin': 'simple',
  'uncensored': 'simple',
  'abliterated': 'simple',
  'mythomax': 'vicuna',
};

class ModelTemplateManager {
  constructor(endpoint = 'http://127.0.0.1:11434') {
    this.endpoint = endpoint;
    this.modelCache = new Map();
  }

  /**
   * Detect the appropriate template for a model based on its name
   */
  detectTemplate(modelName) {
    const name = modelName.toLowerCase();
    
    for (const [pattern, templateKey] of Object.entries(MODEL_TEMPLATE_MAP)) {
      if (name.includes(pattern)) {
        return templateKey;
      }
    }
    
    return 'simple'; // Default fallback
  }

  /**
   * Get the current template for a model from Ollama
   */
  async getModelInfo(modelName) {
    try {
      const response = await axios.post(`${this.endpoint}/api/show`, {
        name: modelName
      }, { timeout: 5000 });
      
      return {
        template: response.data.template,
        system: response.data.system,
        parameters: response.data.parameters,
        modelfile: response.data.modelfile,
      };
    } catch (error) {
      console.error('[TemplateManager] Failed to get model info:', error.message);
      return null;
    }
  }

  /**
   * Check if a model needs template fixing
   */
  needsTemplateFix(modelInfo) {
    if (!modelInfo) return true;
    
    // Check if template is just {{ .Prompt }} (no structure)
    const template = modelInfo.template || '';
    if (template.trim() === '{{ .Prompt }}' || template.trim() === '') {
      return true;
    }
    
    return false;
  }

  /**
   * Apply the correct template to a model
   */
  async applyTemplate(modelName) {
    console.log('[TemplateManager] Checking template for:', modelName);
    
    // Check cache
    if (this.modelCache.has(modelName)) {
      return this.modelCache.get(modelName);
    }
    
    // Get current model info
    const modelInfo = await this.getModelInfo(modelName);
    
    if (!this.needsTemplateFix(modelInfo)) {
      console.log('[TemplateManager] Model has valid template, no fix needed');
      this.modelCache.set(modelName, { fixed: false, template: modelInfo.template });
      return { fixed: false };
    }
    
    // Detect appropriate template
    const templateKey = this.detectTemplate(modelName);
    const template = CHAT_TEMPLATES[templateKey];
    
    if (!template) {
      console.warn('[TemplateManager] No template found for:', templateKey);
      return { fixed: false };
    }
    
    console.log('[TemplateManager] Applying template:', templateKey, 'to model:', modelName);
    
    try {
      // Create a new model with the fixed template
      // This creates an alias with the correct template
      const modelfile = `FROM ${modelName}
TEMPLATE """${template.template}"""
SYSTEM """${template.system}"""
PARAMETER temperature 0.4
PARAMETER top_p 0.8
PARAMETER repeat_penalty 1.15
PARAMETER stop ${JSON.stringify(template.stop)}`;

      const fixedModelName = `${modelName}-fixed`;
      
      await axios.post(`${this.endpoint}/api/create`, {
        name: fixedModelName,
        modelfile: modelfile,
      }, { timeout: 60000 });
      
      console.log('[TemplateManager] Created fixed model:', fixedModelName);
      
      this.modelCache.set(modelName, { 
        fixed: true, 
        fixedModelName,
        templateKey,
        template: template.template 
      });
      
      return { 
        fixed: true, 
        fixedModelName,
        templateKey 
      };
    } catch (error) {
      console.error('[TemplateManager] Failed to apply template:', error.message);
      this.modelCache.set(modelName, { fixed: false, error: error.message });
      return { fixed: false, error: error.message };
    }
  }

  /**
   * Get the template to use for formatting prompts manually
   */
  getTemplateConfig(modelName) {
    const templateKey = this.detectTemplate(modelName);
    return CHAT_TEMPLATES[templateKey] || CHAT_TEMPLATES.simple;
  }

  /**
   * Format messages using the appropriate template
   */
  formatPrompt(modelName, messages, systemPrompt = '') {
    const templateKey = this.detectTemplate(modelName);
    const config = CHAT_TEMPLATES[templateKey] || CHAT_TEMPLATES.simple;
    
    let prompt = '';
    
    // Add system
    const system = systemPrompt || config.system;
    if (system && config.template.includes('.System')) {
      // Template expects system, it will be inserted
    }
    
    // Simple string-based formatting (Ollama template format is complex)
    // This is a simplified version for /api/generate with raw:true
    
    if (templateKey === 'vicuna') {
      prompt = 'A chat between a curious user and an artificial intelligence assistant. The assistant gives helpful, detailed, and polite answers to the user\'s questions.\n\n';
      if (system) prompt = system + '\n\n' + prompt;
      for (const msg of messages) {
        if (msg.role === 'user') prompt += `USER: ${msg.content}\n`;
        else if (msg.role === 'assistant') prompt += `ASSISTANT: ${msg.content}\n`;
      }
      prompt += 'ASSISTANT:';
    } else if (templateKey === 'simple') {
      if (system) prompt = system + '\n\n';
      for (const msg of messages) {
        if (msg.role === 'user') prompt += `Human: ${msg.content}\n\n`;
        else if (msg.role === 'assistant') prompt += `Assistant: ${msg.content}\n\n`;
      }
      prompt += 'Assistant:';
    } else if (templateKey === 'chatml') {
      if (system) prompt += `<|im_start|>system\n${system}<|im_end|>\n`;
      for (const msg of messages) {
        prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
      }
      prompt += '<|im_start|>assistant\n';
    } else if (templateKey === 'alpaca') {
      if (system) prompt = `### System:\n${system}\n\n`;
      for (const msg of messages) {
        if (msg.role === 'user') prompt += `### Instruction:\n${msg.content}\n\n`;
        else if (msg.role === 'assistant') prompt += `### Response:\n${msg.content}\n\n`;
      }
      prompt += '### Response:\n';
    } else {
      // Generic fallback
      if (system) prompt = system + '\n\n';
      for (const msg of messages) {
        if (msg.role === 'user') prompt += `User: ${msg.content}\n`;
        else if (msg.role === 'assistant') prompt += `Assistant: ${msg.content}\n`;
      }
      prompt += 'Assistant:';
    }
    
    return { prompt, stop: config.stop };
  }

  /**
   * Clear the cache (e.g., when models change)
   */
  clearCache() {
    this.modelCache.clear();
  }
}

// Singleton instance
let instance = null;

function getModelTemplateManager(endpoint) {
  if (!instance) {
    instance = new ModelTemplateManager(endpoint);
  }
  return instance;
}

module.exports = {
  ModelTemplateManager,
  getModelTemplateManager,
  CHAT_TEMPLATES,
  MODEL_TEMPLATE_MAP,
};











