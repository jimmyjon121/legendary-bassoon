import React from 'react';
import { Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { shallow } from 'zustand/shallow';

export function AgentStatus() {
  const { sendMessage } = useAppStore((state) => ({
    sendMessage: state.sendMessage,
  }), shallow);

  const handleSuggestImprovements = () => {
    const code = window.getSelection()?.toString() || '';
    const prompt =
      "VIBE CODING: Please review the current file's code and suggest clear improvements.\n\n" +
      (code ? `Selected code:\n\n${code}\n\n` : '') +
      'Respond with a short bullet list of changes, then the improved code.';
    sendMessage(prompt);
  };

  return (
    <div className="flex items-center justify-between px-3 py-2 border border-dashed border-workspace-code/40 rounded-lg bg-forge-bg/60 text-[11px]">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-workspace-code" />
        <div>
          <div className="text-text-primary font-medium">Vibe Agent</div>
          <div className="text-text-muted">
            Ask the model to riff on your current file or selection.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSuggestImprovements}
        className="px-2 py-1 rounded bg-workspace-code/20 text-workspace-code hover:bg-workspace-code/30 text-[11px]"
      >
        Suggest improvements
      </button>
    </div>
  );
}

export default AgentStatus;

















