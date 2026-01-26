import React, { useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

export function ClarifyingQuestions({ isOpen, onClose, questions = [], onAnswer }) {
  const [responses, setResponses] = useState({});

  const activeQuestions = useMemo(() => {
    if (questions.length) return questions;
    return [
      {
        id: 'priority',
        question: 'What matters most right now?',
        options: [
          { id: 'speed', label: 'Shipping speed' },
          { id: 'quality', label: 'Code quality' },
          { id: 'learning', label: 'Exploration / learning' },
        ],
      },
    ];
  }, [questions]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-50 flex items-center justify-center">
      <div className="w-[420px] bg-forge-bg border border-forge-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <div className="flex items-center gap-2 text-text-primary font-semibold">
            <Sparkles size={16} className="text-workspace-code" />
            Clarify direction
          </div>
          <button type="button" className="text-text-muted hover:text-text-primary" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-auto">
          {activeQuestions.map((question) => (
            <div key={question.id} className="border border-forge-border rounded-lg p-3">
              <div className="text-sm font-semibold text-text-primary mb-2">{question.question}</div>
              <div className="space-y-2">
                {question.options?.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={question.id}
                      value={option.id}
                      checked={responses[question.id] === option.id}
                      onChange={() =>
                        setResponses((prev) => ({
                          ...prev,
                          [question.id]: option.id,
                        }))
                      }
                      className="accent-workspace-code"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-forge-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-forge-border text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30 disabled:opacity-70"
            disabled={!Object.keys(responses).length}
            onClick={() => {
              const answers = Object.entries(responses).map(([questionId, choice]) => ({
                questionId,
                choice,
              }));
              onAnswer?.(answers);
              onClose();
              setResponses({});
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClarifyingQuestions;













