import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Play } from 'lucide-react';

const DEFAULT_STEPS = [
  { id: 'gather', label: 'Gather context' },
  { id: 'draft', label: 'Draft plan' },
  { id: 'execute', label: 'Execute changes' },
  { id: 'review', label: 'Self-review + polish' },
];

export function PlanExecutionFlow({ planSummary, onComplete }) {
  const [steps, setSteps] = useState(DEFAULT_STEPS);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setSteps(
      DEFAULT_STEPS.map((step, index) => ({
        ...step,
        description:
          index === 0
            ? 'Load project map, dependencies, ownership.'
            : index === 1
              ? 'Synthesize multi-step approach with risk callouts.'
              : index === 2
                ? 'Apply code changes with guard rails.'
                : 'Generate summary, diffs, and rollback point.',
      })),
    );
  }, [planSummary]);

  useEffect(() => {
    if (activeIndex >= steps.length) {
      onComplete?.();
    }
  }, [activeIndex, steps.length, onComplete]);

  return (
    <div className="border border-forge-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-text-primary font-semibold text-sm">
        <Play size={14} className="text-workspace-code" />
        Execution Plan
      </div>
      <div className="space-y-2">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isComplete = index < activeIndex;
          return (
            <div
              key={step.id}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${
                isActive
                  ? 'border-workspace-code/50 bg-workspace-code/5'
                  : isComplete
                    ? 'border-emerald-400/40 bg-emerald-400/5'
                    : 'border-forge-border'
              }`}
            >
              {isComplete ? (
                <CheckCircle2 size={16} className="text-emerald-400 mt-0.5" />
              ) : isActive ? (
                <Loader2 size={16} className="text-workspace-code animate-spin mt-0.5" />
              ) : (
                <span className="text-[11px] text-text-muted mt-0.5">{index + 1}</span>
              )}
              <div className="flex-1">
                <div className="text-xs text-text-primary font-semibold">{step.label}</div>
                <p className="text-[11px] text-text-secondary">{step.description}</p>
              </div>
              {isActive && (
                <button
                  type="button"
                  className="text-[11px] text-workspace-code underline"
                  onClick={() => setActiveIndex((idx) => idx + 1)}
                >
                  Advance
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PlanExecutionFlow;













