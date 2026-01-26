import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Play, 
  Plus, 
  Trash2, 
  GripVertical,
  FileCode,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Wand2,
  Copy,
  Send,
  RefreshCw,
  AlertCircle,
  Layers,
  Target,
  Zap,
  Edit3,
  Save,
  X
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useEditorStore } from '../../stores/editorStore';

// Plan step status types
const STEP_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress', 
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export function PlanBuilder({ onExecutePlan, currentFile, initialPlan, onPlanConsumed }) {
  const [plan, setPlan] = useState({
    id: null,
    title: '',
    description: '',
    steps: [],
    status: 'draft', // draft, ready, executing, completed
    createdAt: null,
    context: {
      files: [],
      requirements: ''
    }
  });

  // Handle incoming plan from Chat conversation
  React.useEffect(() => {
    if (initialPlan && initialPlan.steps?.length > 0) {
      setPlan(initialPlan);
      setShowPlanInput(false);
      // Auto-expand first step
      setExpandedSteps(new Set([initialPlan.steps[0]?.id || 1]));
      
      if (onPlanConsumed) {
        onPlanConsumed();
      }
    }
  }, [initialPlan, onPlanConsumed]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState(new Set());
  const [editingStep, setEditingStep] = useState(null);
  const [planPrompt, setPlanPrompt] = useState('');
  const [showPlanInput, setShowPlanInput] = useState(true);
  
  const { currentModel, sendMessage } = useAppStore();
  const { openFiles, activeFilePath } = useEditorStore();
  
  // Generate plan from AI
  const generatePlan = async () => {
    if (!planPrompt.trim() || !currentModel) return;
    
    setIsGenerating(true);
    setShowPlanInput(false);
    
    try {
      // Get context from open files
      const fileContext = Object.entries(openFiles)
        .slice(0, 3) // Limit to 3 files for context
        .map(([path, data]) => {
          const fileName = path.split(/[/\\]/).pop();
          const preview = data.content?.slice(0, 500) || '';
          return `File: ${fileName}\n${preview}${data.content?.length > 500 ? '...' : ''}`;
        })
        .join('\n\n');
      
      const systemPrompt = `You are a software architect creating an implementation plan. 
Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation):
{
  "title": "Brief plan title",
  "description": "One sentence overview",
  "steps": [
    {
      "id": 1,
      "title": "Step title",
      "description": "What this step accomplishes",
      "type": "create|modify|delete|refactor|test",
      "targetFiles": ["path/to/file.js"],
      "changes": "Specific changes to make",
      "dependencies": [],
      "estimatedLines": 50
    }
  ]
}

Keep steps atomic and specific. Include file paths. Be thorough but practical.`;

      const userPrompt = `Create a detailed implementation plan for:

${planPrompt}

${fileContext ? `\nContext from open files:\n${fileContext}` : ''}
${currentFile ? `\nCurrently viewing: ${currentFile}` : ''}

Respond with ONLY the JSON plan, no other text.`;

      // Use Ollama directly for plan generation
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: currentModel,
          prompt: `${systemPrompt}\n\nUser: ${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.3, // Lower temp for structured output
            num_predict: 2000
          }
        })
      });
      
      const data = await response.json();
      const responseText = data.response || '';
      
      // Try to parse JSON from response
      let planData;
      try {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          planData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found');
        }
      } catch (e) {
        console.error('Failed to parse plan:', e);
        // Create a fallback plan structure
        planData = {
          title: 'Implementation Plan',
          description: planPrompt,
          steps: [
            {
              id: 1,
              title: 'Analyze requirements',
              description: 'Review the request and identify needed changes',
              type: 'refactor',
              targetFiles: currentFile ? [currentFile] : [],
              changes: planPrompt,
              dependencies: [],
              estimatedLines: 0
            }
          ]
        };
      }
      
      // Set the plan with generated data
      setPlan({
        id: Date.now().toString(),
        title: planData.title || 'New Plan',
        description: planData.description || '',
        steps: (planData.steps || []).map((step, idx) => ({
          ...step,
          id: step.id || idx + 1,
          status: STEP_STATUS.PENDING,
          targetFiles: step.targetFiles || [],
          dependencies: step.dependencies || []
        })),
        status: 'draft',
        createdAt: new Date().toISOString(),
        context: {
          files: Object.keys(openFiles),
          requirements: planPrompt
        }
      });
      
      // Auto-expand first step
      setExpandedSteps(new Set([1]));
      
    } catch (error) {
      console.error('Plan generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Add a new step manually
  const addStep = () => {
    const newStep = {
      id: plan.steps.length + 1,
      title: 'New Step',
      description: '',
      type: 'modify',
      targetFiles: currentFile ? [currentFile] : [],
      changes: '',
      dependencies: [],
      estimatedLines: 0,
      status: STEP_STATUS.PENDING
    };
    
    setPlan(prev => ({
      ...prev,
      steps: [...prev.steps, newStep]
    }));
    setEditingStep(newStep.id);
    setExpandedSteps(prev => new Set([...prev, newStep.id]));
  };
  
  // Update a step
  const updateStep = (stepId, updates) => {
    setPlan(prev => ({
      ...prev,
      steps: prev.steps.map(step => 
        step.id === stepId ? { ...step, ...updates } : step
      )
    }));
  };
  
  // Delete a step
  const deleteStep = (stepId) => {
    setPlan(prev => ({
      ...prev,
      steps: prev.steps.filter(step => step.id !== stepId)
    }));
  };
  
  // Toggle step expansion
  const toggleStep = (stepId) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };
  
  // Mark plan as ready for execution
  const finalizePlan = () => {
    setPlan(prev => ({ ...prev, status: 'ready' }));
  };
  
  // Execute plan with agent
  const executePlan = () => {
    if (onExecutePlan && plan.steps.length > 0) {
      setPlan(prev => ({ ...prev, status: 'executing' }));
      onExecutePlan(plan);
    }
  };
  
  // Reset plan
  const resetPlan = () => {
    setPlan({
      id: null,
      title: '',
      description: '',
      steps: [],
      status: 'draft',
      createdAt: null,
      context: { files: [], requirements: '' }
    });
    setPlanPrompt('');
    setShowPlanInput(true);
    setExpandedSteps(new Set());
  };
  
  // Copy plan as markdown
  const copyPlanAsMarkdown = () => {
    const md = `# ${plan.title}

${plan.description}

## Steps

${plan.steps.map((step, idx) => `
### ${idx + 1}. ${step.title}

${step.description}

- **Type:** ${step.type}
- **Files:** ${step.targetFiles.join(', ') || 'None specified'}
- **Changes:** ${step.changes}
`).join('\n')}
`;
    navigator.clipboard.writeText(md);
  };
  
  // Get step type icon
  const getStepTypeIcon = (type) => {
    switch (type) {
      case 'create': return <Plus size={12} className="text-green-400" />;
      case 'modify': return <Edit3 size={12} className="text-blue-400" />;
      case 'delete': return <Trash2 size={12} className="text-red-400" />;
      case 'refactor': return <RefreshCw size={12} className="text-purple-400" />;
      case 'test': return <Target size={12} className="text-yellow-400" />;
      default: return <FileCode size={12} className="text-text-muted" />;
    }
  };
  
  // Get status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case STEP_STATUS.COMPLETED:
        return <CheckCircle2 size={14} className="text-green-400" />;
      case STEP_STATUS.IN_PROGRESS:
        return <RefreshCw size={14} className="text-blue-400 animate-spin" />;
      case STEP_STATUS.FAILED:
        return <AlertCircle size={14} className="text-red-400" />;
      default:
        return <Circle size={14} className="text-text-muted" />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border/30 bg-forge-surface/50">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-purple-400" />
          <span className="text-sm font-medium text-text-primary">Plan Builder</span>
          {plan.status !== 'draft' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              plan.status === 'ready' ? 'bg-green-500/20 text-green-400' :
              plan.status === 'executing' ? 'bg-blue-500/20 text-blue-400' :
              'bg-purple-500/20 text-purple-400'
            }`}>
              {plan.status}
            </span>
          )}
        </div>
        {plan.steps.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={copyPlanAsMarkdown}
              className="p-1 rounded hover:bg-forge-bg/50 text-text-muted hover:text-text-primary"
              title="Copy as Markdown"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={resetPlan}
              className="p-1 rounded hover:bg-forge-bg/50 text-text-muted hover:text-red-400"
              title="Reset Plan"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      
      {/* Plan Input */}
      {showPlanInput && (
        <div className="p-3 border-b border-forge-border/20">
          <div className="space-y-2">
            <label className="text-xs text-text-muted">What do you want to build?</label>
            <textarea
              value={planPrompt}
              onChange={(e) => setPlanPrompt(e.target.value)}
              placeholder="Describe the feature, refactor, or changes you want to make..."
              className="w-full px-3 py-2 text-sm bg-forge-bg/60 border border-forge-border/30 rounded-lg resize-none focus:outline-none focus:border-purple-500/50 text-text-primary placeholder-text-muted min-h-[80px]"
              disabled={isGenerating}
            />
            <button
              onClick={generatePlan}
              disabled={!planPrompt.trim() || isGenerating || !currentModel}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Generating plan...
                </>
              ) : (
                <>
                  <Wand2 size={14} />
                  Generate Plan
                </>
              )}
            </button>
          </div>
        </div>
      )}
      
      {/* Plan Content */}
      {plan.steps.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          {/* Plan Title & Description */}
          <div className="p-3 border-b border-forge-border/20">
            <h3 className="text-sm font-medium text-text-primary mb-1">{plan.title}</h3>
            <p className="text-xs text-text-muted">{plan.description}</p>
            <div className="flex items-center gap-2 mt-2 text-[10px] text-text-muted">
              <span>{plan.steps.length} steps</span>
              <span>•</span>
              <span>~{plan.steps.reduce((acc, s) => acc + (s.estimatedLines || 0), 0)} lines</span>
            </div>
          </div>
          
          {/* Steps */}
          <div className="p-2 space-y-2">
            {plan.steps.map((step, idx) => (
              <div 
                key={step.id}
                className={`rounded-lg border transition-colors ${
                  expandedSteps.has(step.id) 
                    ? 'border-purple-500/30 bg-purple-500/5' 
                    : 'border-forge-border/30 bg-forge-bg/30'
                }`}
              >
                {/* Step Header */}
                <div 
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                  onClick={() => toggleStep(step.id)}
                >
                  <button className="text-text-muted hover:text-text-primary">
                    {expandedSteps.has(step.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {getStatusIcon(step.status)}
                  <span className="text-xs text-text-muted w-5">{idx + 1}.</span>
                  <span className="flex-1 text-sm text-text-primary truncate">{step.title}</span>
                  {getStepTypeIcon(step.type)}
                </div>
                
                {/* Step Details (Expanded) */}
                {expandedSteps.has(step.id) && (
                  <div className="px-3 pb-3 pt-1 space-y-3 border-t border-forge-border/20">
                    {editingStep === step.id ? (
                      // Edit mode
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={step.title}
                          onChange={(e) => updateStep(step.id, { title: e.target.value })}
                          className="w-full px-2 py-1 text-sm bg-forge-bg/60 border border-forge-border/30 rounded focus:outline-none focus:border-purple-500/50 text-text-primary"
                          placeholder="Step title"
                        />
                        <textarea
                          value={step.description}
                          onChange={(e) => updateStep(step.id, { description: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-forge-bg/60 border border-forge-border/30 rounded resize-none focus:outline-none focus:border-purple-500/50 text-text-primary min-h-[60px]"
                          placeholder="Step description"
                        />
                        <textarea
                          value={step.changes}
                          onChange={(e) => updateStep(step.id, { changes: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-forge-bg/60 border border-forge-border/30 rounded resize-none focus:outline-none focus:border-purple-500/50 text-text-primary min-h-[40px]"
                          placeholder="Specific changes to make"
                        />
                        <div className="flex gap-2">
                          <select
                            value={step.type}
                            onChange={(e) => updateStep(step.id, { type: e.target.value })}
                            className="px-2 py-1 text-xs bg-forge-bg/60 border border-forge-border/30 rounded focus:outline-none text-text-primary"
                          >
                            <option value="create">Create</option>
                            <option value="modify">Modify</option>
                            <option value="delete">Delete</option>
                            <option value="refactor">Refactor</option>
                            <option value="test">Test</option>
                          </select>
                          <button
                            onClick={() => setEditingStep(null)}
                            className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30"
                          >
                            <Save size={12} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <>
                        <p className="text-xs text-text-secondary">{step.description}</p>
                        
                        {step.changes && (
                          <div className="text-xs">
                            <span className="text-text-muted">Changes: </span>
                            <span className="text-text-secondary">{step.changes}</span>
                          </div>
                        )}
                        
                        {step.targetFiles?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {step.targetFiles.map((file, i) => (
                              <span 
                                key={i}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-forge-bg/50 text-[10px] text-text-muted"
                              >
                                <FileCode size={10} />
                                {file.split(/[/\\]/).pop()}
                              </span>
                            ))}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => setEditingStep(step.id)}
                            className="text-[10px] text-text-muted hover:text-purple-400"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteStep(step.id)}
                            className="text-[10px] text-text-muted hover:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            
            {/* Add Step Button */}
            <button
              onClick={addStep}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-forge-border/30 text-text-muted hover:text-purple-400 hover:border-purple-500/30 transition-colors text-xs"
            >
              <Plus size={14} />
              Add Step
            </button>
          </div>
        </div>
      )}
      
      {/* Empty State */}
      {!showPlanInput && plan.steps.length === 0 && !isGenerating && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Layers size={32} className="mx-auto text-text-muted mb-2" />
            <p className="text-sm text-text-muted">No plan generated yet</p>
            <button
              onClick={() => setShowPlanInput(true)}
              className="mt-2 text-xs text-purple-400 hover:underline"
            >
              Start planning
            </button>
          </div>
        </div>
      )}
      
      {/* Action Bar */}
      {plan.steps.length > 0 && (
        <div className="p-3 border-t border-forge-border/30 bg-forge-surface/30 space-y-2">
          {plan.status === 'draft' && (
            <button
              onClick={finalizePlan}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors text-sm font-medium"
            >
              <CheckCircle2 size={14} />
              Finalize Plan
            </button>
          )}
          
          {plan.status === 'ready' && (
            <button
              onClick={executePlan}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-workspace-code text-white hover:bg-workspace-code/80 transition-colors text-sm font-medium"
            >
              <Play size={14} />
              Execute with Agent
            </button>
          )}
          
          {plan.status === 'executing' && (
            <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-blue-400">
              <RefreshCw size={14} className="animate-spin" />
              Executing plan...
            </div>
          )}
          
          <button
            onClick={() => setShowPlanInput(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-forge-border/30 text-text-muted hover:text-purple-400 hover:border-purple-500/30 transition-colors text-xs"
          >
            <Wand2 size={12} />
            Refine with AI
          </button>
        </div>
      )}
    </div>
  );
}

export default PlanBuilder;

