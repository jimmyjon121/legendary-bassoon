import React, { useMemo, useState } from 'react';
import { Sparkles, ArrowRight, X } from 'lucide-react';
import { PlanExecutionFlow } from './PlanExecutionFlow';

const STEPS = ['describe', 'clarify', 'options', 'plan', 'execute'];

export function PlanningWorkflow({ isOpen, onClose, context }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [description, setDescription] = useState('');
  const [selectedOption, setSelectedOption] = useState(null);

  const summary = useMemo(
    () => ({
      description,
      selection: selectedOption,
      context,
    }),
    [description, selectedOption, context],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur flex items-center justify-center">
      <div className="w-[720px] max-h-[85vh] bg-forge-bg border border-forge-border rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-forge-border">
          <div className="flex items-center gap-2 text-text-primary font-semibold">
            <Sparkles size={18} className="text-workspace-code" />
            Planning Workflow
          </div>
          <button type="button" className="text-text-muted hover:text-text-primary" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center gap-1 px-5 py-3 border-b border-forge-border text-[11px] text-text-muted">
          {STEPS.map((step, index) => (
            <React.Fragment key={step}>
              <button
                type="button"
                disabled={index > stepIndex}
                className={`uppercase tracking-wide ${index === stepIndex ? 'text-workspace-code' : ''}`}
                onClick={() => setStepIndex(index)}
              >
                {step}
              </button>
              {index < STEPS.length - 1 && <ArrowRight size={12} />}
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {stepIndex === 0 && (
            <div className="space-y-3">
              <label className="text-sm text-text-primary font-semibold">Describe what you want</label>
              <textarea
                className="w-full min-h-[140px] px-4 py-3 border border-forge-border rounded-xl bg-forge-elevated text-sm"
                placeholder="Example: Build a split-pane IDE with autonomous coding agent..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}
          {stepIndex === 1 && (
            <p className="text-sm text-text-secondary">
              The agent will ask clarifying questions inside the Agent Panel. Keep an eye on the Clarify view to answer
              anything blocking execution.
            </p>
          )}
          {stepIndex === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">Pick an approach. You can always remix later.</p>
              <div className="grid grid-cols-2 gap-3">
                {['Foundations-first', 'Feature-sprint', 'Polish + R&D'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedOption(option)}
                    className={`border rounded-xl px-4 py-3 text-left ${
                      selectedOption === option ? 'border-workspace-code text-workspace-code' : 'border-forge-border'
                    }`}
                  >
                    <div className="text-sm font-semibold">{option}</div>
                    <p className="text-[11px] text-text-muted">
                      {option === 'Foundations-first' && 'Stabilize architecture, create scaffolding.'}
                      {option === 'Feature-sprint' && 'Deliver the marquee flow with end-to-end polish.'}
                      {option === 'Polish + R&D' && 'Tune UX, docs, DX, and explore moonshots.'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {stepIndex >= 3 && (
            <PlanExecutionFlow
              planSummary={summary}
              onComplete={() => {
                setStepIndex(4);
              }}
            />
          )}
        </div>
        <div className="px-5 py-4 border-t border-forge-border flex justify-between items-center">
          <span className="text-xs text-text-muted">
            Step {stepIndex + 1} / {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                className="px-3 py-1.5 text-xs rounded border border-forge-border text-text-muted hover:text-text-primary"
              >
                Back
              </button>
            )}
            {stepIndex < STEPS.length - 1 && (
              <button
                type="button"
                onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
                className="px-3 py-1.5 text-xs rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30"
              >
                Next
              </button>
            )}
            {stepIndex === STEPS.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setStepIndex(0);
                  setSelectedOption(null);
                  setDescription('');
                }}
                className="px-3 py-1.5 text-xs rounded bg-workspace-code text-white hover:opacity-90"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlanningWorkflow;













