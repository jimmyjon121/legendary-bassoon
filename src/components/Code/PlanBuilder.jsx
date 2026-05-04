import React, { useState, useEffect, useRef } from 'react';
import {
  Play, 
  Plus, 
  Trash2, 
  FileCode,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Wand2,
  Copy,
  RefreshCw,
  AlertCircle,
  Layers,
  Target,
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

const STEP_TYPES = new Set(['create', 'modify', 'delete', 'refactor', 'test']);

function resolveModelName(modelValue) {
  if (!modelValue) return '';
  if (typeof modelValue === 'string') return modelValue;
  if (typeof modelValue?.name === 'string') return modelValue.name;
  if (typeof modelValue?.id === 'string') return modelValue.id;
  if (typeof modelValue?.model === 'string') return modelValue.model;
  return String(modelValue || '').trim();
}

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
      const inferredTask =
        initialPlan?.context?.requirements ||
        initialPlan?.description ||
        initialPlan?.title ||
        '';

      const enhanced = normalizeAndEnhancePlan(
        {
          title: initialPlan.title || 'Implementation Plan',
          description: initialPlan.description || inferredTask,
          steps: initialPlan.steps || [],
        },
        inferredTask || 'Implement requested changes'
      );

      const hydratedSteps = (enhanced.steps || []).map((step, index) => ({
        ...step,
        id: step.id || index + 1,
        status: ['pending', 'in_progress', 'completed', 'failed'].includes(step.status)
          ? step.status
          : STEP_STATUS.PENDING,
        targetFiles: Array.isArray(step.targetFiles) ? step.targetFiles : [],
        dependencies: Array.isArray(step.dependencies) ? step.dependencies : [],
      }));

      setPlan({
        ...initialPlan,
        title: enhanced.title,
        description: enhanced.description,
        steps: hydratedSteps,
        status: initialPlan.status || 'draft',
        context: {
          files: Array.isArray(initialPlan?.context?.files)
            ? initialPlan.context.files
            : [],
          requirements: inferredTask || '',
        },
      });
      setPlanPrompt((prev) => prev || inferredTask);
      setShowPlanInput(false);
      // Auto-expand first step
      setExpandedSteps(new Set([hydratedSteps[0]?.id || 1]));
      
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
  const [generationError, setGenerationError] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const generationAbortRef = useRef(null);
  const generationSeqRef = useRef(0);
  const generationTickerRef = useRef(null);
  
  const currentModel = useAppStore((s) => s.currentModel);
  const currentModelName = resolveModelName(currentModel);
  const { openFiles } = useEditorStore();

  useEffect(() => {
    return () => {
      if (generationAbortRef.current) {
        generationAbortRef.current.abort();
      }
      if (generationTickerRef.current) {
        clearInterval(generationTickerRef.current);
        generationTickerRef.current = null;
      }
      generationSeqRef.current += 1;
    };
  }, []);

  const stopProgressTicker = () => {
    if (generationTickerRef.current) {
      clearInterval(generationTickerRef.current);
      generationTickerRef.current = null;
    }
  };

  const startProgressTicker = () => {
    stopProgressTicker();
    setGenerationProgress(6);
    generationTickerRef.current = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 94) return prev;
        const delta = prev < 30 ? 4.2 : prev < 65 ? 2.6 : 1.3;
        return Math.min(94, prev + delta);
      });
    }, 420);
  };

  const completeProgressTicker = () => {
    stopProgressTicker();
    setGenerationProgress(100);
  };

  const getProgressLabel = (progress) => {
    if (progress < 18) return 'Analyzing request';
    if (progress < 40) return 'Collecting workspace context';
    if (progress < 68) return 'Drafting implementation steps';
    if (progress < 90) return 'Validating plan structure';
    return 'Finalizing plan';
  };

  const withTimeout = async (promise, ms, onTimeout) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (typeof onTimeout === 'function') onTimeout();
        reject(new Error(`Plan generation timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const extractLikelyJsonObject = (text) => {
    const source = String(text || '').trim();
    if (!source) return null;

    if (source.startsWith('{') && source.endsWith('}')) {
      return source;
    }

    const start = source.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, i + 1);
        }
      }
    }
    return null;
  };

  const parsePlanFromText = (responseText) => {
    if (!responseText || !responseText.trim()) {
      throw new Error('Model returned an empty response');
    }

    try {
      return JSON.parse(responseText);
    } catch {
      const extracted = extractLikelyJsonObject(responseText);
      if (!extracted) {
        throw new Error('Model did not return valid JSON');
      }
      try {
        return JSON.parse(extracted);
      } catch {
        throw new Error('Failed to parse JSON plan');
      }
    }
  };

  const normalizeStepType = (type) => {
    const value = String(type || '').toLowerCase();
    return STEP_TYPES.has(value) ? value : 'modify';
  };

  const pickTargetFiles = () => {
    const selected = [];
    if (currentFile) selected.push(currentFile);
    for (const path of Object.keys(openFiles || {})) {
      if (!selected.includes(path)) selected.push(path);
      if (selected.length >= 3) break;
    }
    if (selected.length === 0) {
      return ['src/components/Code/CodeWorkbench.jsx', 'src/components/Code/PlanBuilder.jsx'];
    }
    return selected.map((p) => String(p).replace(/\\/g, '/'));
  };

  const buildDeterministicPlan = (promptText) => {
    const targets = pickTargetFiles();
    return {
      title: 'Implementation Plan',
      description: `Build plan for: ${promptText}`,
      steps: [
        {
          id: 1,
          title: 'Define requirements and acceptance criteria',
          description: 'Clarify scope, constraints, and measurable success outcomes.',
          type: 'refactor',
          targetFiles: [],
          changes: promptText,
          dependencies: [],
          estimatedLines: 25
        },
        {
          id: 2,
          title: 'Design architecture and task breakdown',
          description: 'Map components/services, data flow, and implementation order.',
          type: 'refactor',
          targetFiles: [targets[0]].filter(Boolean),
          changes: 'Document modules, interfaces, and dependencies.',
          dependencies: [1],
          estimatedLines: 60
        },
        {
          id: 3,
          title: 'Implement core functionality',
          description: 'Build the primary logic and backend integration path.',
          type: 'modify',
          targetFiles: [targets[0], targets[1]].filter(Boolean),
          changes: 'Implement feature behavior and error handling for the main flow.',
          dependencies: [2],
          estimatedLines: 140
        },
        {
          id: 4,
          title: 'Implement UI and interaction flow',
          description: 'Create or update UI states, loading/errors, and user actions.',
          type: 'modify',
          targetFiles: [targets[1], targets[2]].filter(Boolean),
          changes: 'Wire UI to core logic and ensure responsive interaction.',
          dependencies: [3],
          estimatedLines: 110
        },
        {
          id: 5,
          title: 'Integrate settings, persistence, and guardrails',
          description: 'Persist key settings/state and add validation/safety checks.',
          type: 'modify',
          targetFiles: targets,
          changes: 'Add robust defaults, failure handling, and compatibility checks.',
          dependencies: [3, 4],
          estimatedLines: 85
        },
        {
          id: 6,
          title: 'Test, verify, and polish',
          description: 'Run validation, fix defects, and finalize user-facing behavior.',
          type: 'test',
          targetFiles: targets,
          changes: 'Add test coverage and perform end-to-end validation.',
          dependencies: [5],
          estimatedLines: 80
        }
      ]
    };
  };

  const normalizeAndEnhancePlan = (planData, promptText) => {
    const rawSteps = Array.isArray(planData?.steps) ? planData.steps : [];

    const cleanedSteps = rawSteps
      .map((step, index) => {
        const targetFiles = Array.isArray(step?.targetFiles)
          ? step.targetFiles
          : typeof step?.targetFiles === 'string'
            ? [step.targetFiles]
            : [];

        const dependencies = Array.isArray(step?.dependencies)
          ? step.dependencies
              .map((dep) => Number(dep))
              .filter((dep) => Number.isFinite(dep) && dep > 0)
          : [];

        const estimated = Number(step?.estimatedLines);

        return {
          id: index + 1,
          title: String(step?.title || '').trim() || `Step ${index + 1}`,
          description:
            String(step?.description || '').trim() ||
            'Implement this step with clear deliverables and acceptance criteria.',
          type: normalizeStepType(step?.type),
          targetFiles: targetFiles.map((f) => String(f).trim()).filter(Boolean).slice(0, 4),
          changes: String(step?.changes || step?.description || '').trim(),
          dependencies,
          estimatedLines: Number.isFinite(estimated) ? Math.max(0, estimated) : 0
        };
      })
      .filter((step) => step.title && step.description);

    const genericTitles = cleanedSteps.filter((step) =>
      /(analyze requirements|step \d+|todo|tbd)/i.test(step.title)
    ).length;

    const needsEnhancement =
      cleanedSteps.length < 4 ||
      (cleanedSteps.length <= 5 && genericTitles >= Math.ceil(cleanedSteps.length / 2));

    if (needsEnhancement) {
      return buildDeterministicPlan(promptText);
    }

    return {
      title: String(planData?.title || '').trim() || 'Implementation Plan',
      description: String(planData?.description || '').trim() || promptText,
      steps: cleanedSteps
    };
  };

  const fallbackPlan = (promptText) => buildDeterministicPlan(promptText);
  
  // Generate plan from AI
  const generatePlan = async () => {
    if (!planPrompt.trim() || !currentModelName) return;

    // Cancel any previous in-flight request
    if (generationAbortRef.current) {
      generationAbortRef.current.abort();
      generationAbortRef.current = null;
    }

    const generationId = generationSeqRef.current + 1;
    generationSeqRef.current = generationId;

    setGenerationError('');
    setIsGenerating(true);
    startProgressTicker();
    
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
      
      const systemPrompt = `You are a senior software architect creating implementation plans.
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

Rules:
- Return 5 to 8 concrete steps.
- Each step must be actionable and implementation-oriented.
- Include realistic target file paths when possible.
- Use dependencies to show order.
- Never return a single-step plan.`;

      const userPrompt = `Create a detailed implementation plan for:

${planPrompt}

${fileContext ? `\nContext from open files:\n${fileContext}` : ''}
${currentFile ? `\nCurrently viewing: ${currentFile}` : ''}

Respond with ONLY the JSON plan, no other text.`;

      const llmPayload = {
        model: currentModelName,
        prompt: `${systemPrompt}\n\nUser: ${userPrompt}`,
        format: 'json',
        stream: false,
        timeout: 240000,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_predict: 1800
        }
      };

      let responseText = '';
      if (window.electronAPI?.sendToLLM) {
        const data = await withTimeout(
          window.electronAPI.sendToLLM(llmPayload),
          45000
        );
        responseText = data?.response || data?.message?.content || '';
      } else {
        const controller = new AbortController();
        generationAbortRef.current = controller;
        const response = await withTimeout(
          fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(llmPayload),
            signal: controller.signal
          }),
          45000,
          () => controller.abort()
        );

        if (!response.ok) {
          throw new Error(`Ollama returned ${response.status}`);
        }
        const data = await response.json();
        responseText = data?.response || '';
      }

      if (generationId !== generationSeqRef.current) return;

      let planData;
      try {
        const parsed = parsePlanFromText(responseText);
        planData = normalizeAndEnhancePlan(parsed, planPrompt);
      } catch (parseError) {
        console.warn('Plan parse failed, using fallback:', parseError.message);
        planData = fallbackPlan(planPrompt);
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
      setShowPlanInput(false);
      completeProgressTicker();
      
    } catch (error) {
      console.error('Plan generation failed:', error);
      if (generationId !== generationSeqRef.current) return;
      const errMessage = String(error?.message || 'Unknown error');
      setGenerationError(errMessage);
      // Still provide a usable plan so the user isn't blocked.
      const planData = fallbackPlan(planPrompt);
      setPlan({
        id: Date.now().toString(),
        title: planData.title,
        description: planData.description,
        steps: planData.steps.map((step) => ({
          ...step,
          status: STEP_STATUS.PENDING
        })),
        status: 'draft',
        createdAt: new Date().toISOString(),
        context: {
          files: Object.keys(openFiles),
          requirements: planPrompt
        }
      });
      setExpandedSteps(new Set([1]));
      setShowPlanInput(false);
      completeProgressTicker();
    } finally {
      if (generationId === generationSeqRef.current) {
        stopProgressTicker();
        setIsGenerating(false);
        generationAbortRef.current = null;
      }
    }
  };

  const cancelGeneration = () => {
    if (generationAbortRef.current) {
      generationAbortRef.current.abort();
      generationAbortRef.current = null;
    }
    generationSeqRef.current += 1;
    setIsGenerating(false);
    stopProgressTicker();
    setGenerationProgress(0);
    setGenerationError('Generation canceled.');
    setShowPlanInput(true);
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
    setGenerationError('');
    if (generationAbortRef.current) {
      generationAbortRef.current.abort();
      generationAbortRef.current = null;
    }
    generationSeqRef.current += 1;
    setIsGenerating(false);
    stopProgressTicker();
    setGenerationProgress(0);
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
              disabled={!planPrompt.trim() || isGenerating || !currentModelName}
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
            {isGenerating && (
              <>
                <div className="rounded-lg border border-purple-500/25 bg-purple-500/10 px-3 py-2">
                  <div className="flex items-center justify-between text-[11px] text-purple-200">
                    <span>{getProgressLabel(generationProgress)}</span>
                    <span>{Math.max(6, Math.round(generationProgress))}%</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-forge-bg/60 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-blue-400 transition-all duration-300 ease-out"
                      style={{ width: `${Math.max(6, generationProgress)}%` }}
                    />
                  </div>
                </div>
                <button
                  onClick={cancelGeneration}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors text-xs"
                >
                  <X size={12} />
                  Cancel
                </button>
              </>
            )}
            {generationError && (
              <div className="px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300">
                Plan generator issue: {generationError}
              </div>
            )}
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
              <span>|</span>
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
            onClick={() => {
              setShowPlanInput(true);
              setGenerationError('');
              setPlanPrompt((prev) => prev || plan.context?.requirements || plan.description || '');
            }}
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
