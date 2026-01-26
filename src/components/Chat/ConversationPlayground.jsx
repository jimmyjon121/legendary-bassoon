import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Copy, 
  Save, 
  Share,
  Beaker,
  Zap,
  Brain,
  MessageSquare,
  TrendingUp,
  Target,
  Shuffle,
  GitBranch,
  Eye,
  Settings,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../stores/appStore';
import { FluidMessageBubble } from './FluidMessageBubble';

const EXPERIMENT_TYPES = [
  {
    id: 'model-comparison',
    name: 'Model A/B Test',
    description: 'Compare responses from different models',
    icon: GitBranch,
    color: 'text-blue-400',
  },
  {
    id: 'prompt-variations',
    name: 'Prompt Variations',
    description: 'Test different ways to ask the same question',
    icon: MessageSquare,
    color: 'text-green-400',
  },
  {
    id: 'personality-test',
    name: 'Personality Test',
    description: 'Compare different AI personalities',
    icon: Brain,
    color: 'text-purple-400',
  },
  {
    id: 'conversation-simulation',
    name: 'Conversation Simulation',
    description: 'Simulate how a conversation might evolve',
    icon: Play,
    color: 'text-orange-400',
  },
];

const PROMPT_TEMPLATES = [
  { id: 'explain', template: 'Explain {topic} in simple terms', category: 'Educational' },
  { id: 'analyze', template: 'Analyze the pros and cons of {topic}', category: 'Analytical' },
  { id: 'creative', template: 'Write a creative story about {topic}', category: 'Creative' },
  { id: 'debate', template: 'Present both sides of the {topic} debate', category: 'Debate' },
  { id: 'practical', template: 'Give me practical advice about {topic}', category: 'Practical' },
];

export function ConversationPlayground({ isOpen, onClose }) {
  const { availableModels, sendMessage } = useAppStore();
  
  const [activeExperiment, setActiveExperiment] = useState(null);
  const [experimentSetup, setExperimentSetup] = useState({
    type: 'model-comparison',
    prompt: '',
    models: [],
    personalities: [],
    variations: [],
  });
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const handleStartExperiment = async () => {
    setIsRunning(true);
    setResults([]);
    setCurrentStep(0);

    try {
      switch (experimentSetup.type) {
        case 'model-comparison':
          await runModelComparison();
          break;
        case 'prompt-variations':
          await runPromptVariations();
          break;
        case 'personality-test':
          await runPersonalityTest();
          break;
        case 'conversation-simulation':
          await runConversationSimulation();
          break;
      }
    } catch (error) {
      console.error('Experiment failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const runModelComparison = async () => {
    // Simulate model comparison (in real implementation, this would use actual models)
    const selectedModels = experimentSetup.models.slice(0, 3);
    
    for (let i = 0; i < selectedModels.length; i++) {
      setCurrentStep(i + 1);
      
      // Simulate response generation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const mockResponse = generateMockResponse(experimentSetup.prompt, selectedModels[i]);
      
      setResults(prev => [...prev, {
        id: `result-${i}`,
        model: selectedModels[i],
        prompt: experimentSetup.prompt,
        response: mockResponse,
        metrics: generateMockMetrics(),
        timestamp: Date.now(),
      }]);
    }
  };

  const runPromptVariations = async () => {
    const variations = experimentSetup.variations.length > 0 
      ? experimentSetup.variations 
      : generatePromptVariations(experimentSetup.prompt);

    for (let i = 0; i < variations.length; i++) {
      setCurrentStep(i + 1);
      
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const mockResponse = generateMockResponse(variations[i], 'default-model');
      
      setResults(prev => [...prev, {
        id: `variation-${i}`,
        prompt: variations[i],
        response: mockResponse,
        variation: i + 1,
        metrics: generateMockMetrics(),
        timestamp: Date.now(),
      }]);
    }
  };

  const runPersonalityTest = async () => {
    const personalities = ['creative', 'analytical', 'supportive', 'energetic'];
    
    for (let i = 0; i < personalities.length; i++) {
      setCurrentStep(i + 1);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const mockResponse = generatePersonalityResponse(experimentSetup.prompt, personalities[i]);
      
      setResults(prev => [...prev, {
        id: `personality-${i}`,
        personality: personalities[i],
        prompt: experimentSetup.prompt,
        response: mockResponse,
        metrics: generateMockMetrics(),
        timestamp: Date.now(),
      }]);
    }
  };

  const runConversationSimulation = async () => {
    // Simulate conversation evolution
    let currentPrompt = experimentSetup.prompt;
    
    for (let i = 0; i < 5; i++) {
      setCurrentStep(i + 1);
      
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const response = generateMockResponse(currentPrompt, 'simulation-model');
      const followUp = generateFollowUpQuestion(response);
      
      setResults(prev => [...prev, {
        id: `sim-${i}`,
        step: i + 1,
        prompt: currentPrompt,
        response: response,
        followUp: followUp,
        metrics: generateMockMetrics(),
        timestamp: Date.now(),
      }]);
      
      currentPrompt = followUp;
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-6xl h-[90vh] bg-forge-surface border border-forge-border rounded-xl shadow-2xl overflow-hidden flex"
        onClick={e => e.stopPropagation()}
      >
        {/* Setup Panel */}
        <div className="w-80 border-r border-forge-border flex flex-col">
          <div className="p-4 border-b border-forge-border">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Beaker size={20} className="text-workspace-casual" />
              Conversation Lab
            </h2>
            <p className="text-xs text-text-muted mt-1">
              Experiment with different conversation approaches
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Experiment Type */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Experiment Type
              </label>
              <div className="space-y-2">
                {EXPERIMENT_TYPES.map((type) => {
                  const Icon = type.icon;
                  const isSelected = experimentSetup.type === type.id;
                  
                  return (
                    <button
                      key={type.id}
                      onClick={() => setExperimentSetup(prev => ({ ...prev, type: type.id }))}
                      className={`w-full flex items-center gap-2 p-2 rounded border transition-colors ${
                        isSelected
                          ? 'border-workspace-casual bg-workspace-casual/10 text-workspace-casual'
                          : 'border-forge-border hover:border-forge-hover text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Icon size={16} className={type.color} />
                      <div className="text-left flex-1">
                        <div className="text-xs font-medium">{type.name}</div>
                        <div className="text-[10px] text-text-muted">{type.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt Input */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Test Prompt
              </label>
              <textarea
                value={experimentSetup.prompt}
                onChange={(e) => setExperimentSetup(prev => ({ ...prev, prompt: e.target.value }))}
                placeholder="Enter your test prompt here..."
                rows={3}
                className="w-full px-3 py-2 bg-forge-bg border border-forge-border rounded text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-workspace-casual/50"
              />
              
              {/* Quick prompt templates */}
              <div className="mt-2 flex flex-wrap gap-1">
                {PROMPT_TEMPLATES.slice(0, 3).map((template) => (
                  <button
                    key={template.id}
                    onClick={() => setExperimentSetup(prev => ({ 
                      ...prev, 
                      prompt: template.template.replace('{topic}', 'artificial intelligence') 
                    }))}
                    className="px-2 py-1 bg-forge-elevated hover:bg-forge-hover text-text-muted hover:text-text-primary rounded text-[10px] transition-colors"
                  >
                    {template.category}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Selection (for model comparison) */}
            {experimentSetup.type === 'model-comparison' && (
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Models to Compare
                </label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {availableModels.slice(0, 5).map((model) => (
                    <label key={model.name} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={experimentSetup.models.includes(model.name)}
                        onChange={(e) => {
                          const models = e.target.checked
                            ? [...experimentSetup.models, model.name]
                            : experimentSetup.models.filter(m => m !== model.name);
                          setExperimentSetup(prev => ({ ...prev, models }));
                        }}
                        className="w-3 h-3"
                      />
                      <span className="text-text-primary truncate">{model.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-4 border-t border-forge-border">
              <button
                onClick={handleStartExperiment}
                disabled={isRunning || !experimentSetup.prompt.trim()}
                className="w-full px-3 py-2 bg-workspace-casual hover:bg-workspace-casual/90 text-white rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isRunning ? (
                  <>
                    <Pause size={14} />
                    Running... ({currentStep})
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Start Experiment
                  </>
                )}
              </button>
              
              <button
                onClick={() => {
                  setResults([]);
                  setCurrentStep(0);
                }}
                disabled={isRunning}
                className="w-full px-3 py-2 bg-forge-elevated hover:bg-forge-hover text-text-primary rounded text-sm transition-colors disabled:opacity-50"
              >
                <RotateCcw size={14} className="mr-2" />
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b border-forge-border">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-primary">
                Experiment Results
              </h3>
              <div className="flex items-center gap-2">
                {results.length > 0 && (
                  <>
                    <button
                      onClick={() => {
                        // Export results
                        const data = JSON.stringify(results, null, 2);
                        navigator.clipboard.writeText(data);
                      }}
                      className="p-1.5 rounded text-text-muted hover:text-text-primary transition-colors"
                      title="Copy results"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => {
                        // Save experiment
                      }}
                      className="p-1.5 rounded text-text-muted hover:text-text-primary transition-colors"
                      title="Save experiment"
                    >
                      <Save size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded text-text-muted hover:text-text-primary transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            
            {isRunning && (
              <div className="mt-2">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <div className="w-2 h-2 rounded-full bg-workspace-casual animate-pulse" />
                  <span>Running experiment... Step {currentStep}</span>
                </div>
                <div className="mt-1 h-1 bg-forge-border rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-workspace-casual rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(currentStep / getMaxSteps()) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Beaker size={48} className="text-text-muted mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">Ready to Experiment</h3>
                <p className="text-sm text-text-muted max-w-md">
                  Set up your experiment parameters on the left and click "Start Experiment" to begin testing different conversation approaches.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {experimentSetup.type === 'model-comparison' && (
                  <ModelComparisonResults results={results} />
                )}
                {experimentSetup.type === 'prompt-variations' && (
                  <PromptVariationResults results={results} />
                )}
                {experimentSetup.type === 'personality-test' && (
                  <PersonalityTestResults results={results} />
                )}
                {experimentSetup.type === 'conversation-simulation' && (
                  <ConversationSimulationResults results={results} />
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  function getMaxSteps() {
    switch (experimentSetup.type) {
      case 'model-comparison': return experimentSetup.models.length;
      case 'prompt-variations': return experimentSetup.variations.length || 3;
      case 'personality-test': return 4;
      case 'conversation-simulation': return 5;
      default: return 1;
    }
  }
}

// Result components
function ModelComparisonResults({ results }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-primary">Model Comparison Results</h4>
      {results.map((result, index) => (
        <div key={result.id} className="p-3 bg-forge-bg/50 border border-forge-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-sm font-medium text-text-primary">{result.model}</h5>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{result.metrics.responseTime}ms</span>
              <span>•</span>
              <span>{result.metrics.tokens} tokens</span>
              <span>•</span>
              <span className={`${result.metrics.quality > 0.7 ? 'text-green-400' : result.metrics.quality > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                {Math.round(result.metrics.quality * 100)}% quality
              </span>
            </div>
          </div>
          <p className="text-sm text-text-secondary line-clamp-3">{result.response}</p>
        </div>
      ))}
    </div>
  );
}

function PromptVariationResults({ results }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-primary">Prompt Variation Results</h4>
      {results.map((result, index) => (
        <div key={result.id} className="p-3 bg-forge-bg/50 border border-forge-border rounded-lg">
          <div className="mb-2">
            <h5 className="text-xs font-medium text-workspace-casual mb-1">
              Variation {result.variation}: {result.prompt}
            </h5>
            <p className="text-sm text-text-secondary">{result.response}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>Quality: {Math.round(result.metrics.quality * 100)}%</span>
            <span>•</span>
            <span>Clarity: {Math.round(result.metrics.clarity * 100)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonalityTestResults({ results }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-primary">Personality Test Results</h4>
      {results.map((result, index) => (
        <div key={result.id} className="p-3 bg-forge-bg/50 border border-forge-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={14} className="text-workspace-casual" />
            <h5 className="text-sm font-medium text-text-primary capitalize">
              {result.personality} Personality
            </h5>
          </div>
          <p className="text-sm text-text-secondary mb-2">{result.response}</p>
          <div className="text-xs text-text-muted">
            Tone match: {Math.round(result.metrics.toneMatch * 100)}%
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversationSimulationResults({ results }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-primary">Conversation Flow Simulation</h4>
      <div className="space-y-2">
        {results.map((result, index) => (
          <div key={result.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-workspace-casual text-white text-xs flex items-center justify-center">
                {result.step}
              </div>
              {index < results.length - 1 && (
                <div className="w-0.5 h-8 bg-forge-border mt-1" />
              )}
            </div>
            <div className="flex-1 pb-4">
              <div className="p-2 bg-forge-bg/50 border border-forge-border rounded">
                <p className="text-xs text-workspace-casual mb-1">{result.prompt}</p>
                <p className="text-sm text-text-secondary mb-1">{result.response}</p>
                {result.followUp && (
                  <p className="text-xs text-text-muted">Next: {result.followUp}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper functions for mock data generation
function generateMockResponse(prompt, model) {
  const responses = [
    `Based on your question about "${prompt.substring(0, 30)}...", here's my analysis: This is a fascinating topic that touches on several key areas. Let me break this down for you...`,
    `Great question! When it comes to "${prompt.substring(0, 30)}...", there are multiple perspectives to consider. From my understanding...`,
    `I'd be happy to help with "${prompt.substring(0, 30)}...". This is an interesting challenge that requires us to think about...`,
  ];
  
  return responses[Math.floor(Math.random() * responses.length)];
}

function generatePersonalityResponse(prompt, personality) {
  const styles = {
    creative: `Oh, what an inspiring question! "${prompt.substring(0, 30)}..." makes me think of endless possibilities...`,
    analytical: `Let me approach "${prompt.substring(0, 30)}..." systematically. First, we should consider the key factors...`,
    supportive: `I love that you're exploring "${prompt.substring(0, 30)}...". You're asking exactly the right questions...`,
    energetic: `Wow! "${prompt.substring(0, 30)}..." is such an exciting topic! Let's dive right in...`,
  };
  
  return styles[personality] || generateMockResponse(prompt, 'default');
}

function generateFollowUpQuestion(response) {
  const starters = [
    'How does this relate to',
    'What if we considered',
    'Can you elaborate on',
    'What are the implications of',
    'How might this change if',
  ];
  
  const topics = ['practical applications', 'real-world examples', 'potential challenges', 'future developments'];
  
  const starter = starters[Math.floor(Math.random() * starters.length)];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  
  return `${starter} ${topic}?`;
}

function generatePromptVariations(originalPrompt) {
  return [
    originalPrompt,
    `Can you explain ${originalPrompt.toLowerCase()}?`,
    `What are your thoughts on ${originalPrompt.toLowerCase()}?`,
    `Help me understand ${originalPrompt.toLowerCase()} better.`,
  ];
}

function generateMockMetrics() {
  return {
    responseTime: Math.floor(Math.random() * 2000) + 500,
    tokens: Math.floor(Math.random() * 200) + 50,
    quality: Math.random() * 0.4 + 0.6,
    clarity: Math.random() * 0.3 + 0.7,
    toneMatch: Math.random() * 0.3 + 0.7,
    creativity: Math.random(),
    helpfulness: Math.random() * 0.3 + 0.7,
  };
}

export default ConversationPlayground;
