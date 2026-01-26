import React from 'react';
import { GitBranch, CornerDownRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function BranchIndicator({ message }) {
  const {
    currentConversationId,
    currentBranchId,
    branches,
    createBranchFromMessage,
    switchBranch,
  } = useAppStore();

  if (!currentConversationId || message.role !== 'assistant') {
    return null;
  }

  const branchForMessage = branches?.find((b) => b.id === message.branch_id);
  const isOnCurrentBranch =
    branchForMessage && branchForMessage.id === currentBranchId;

  const handleFork = () => {
    createBranchFromMessage(currentConversationId, message.id, null);
  };

  const handleSwitch = () => {
    if (branchForMessage) {
      switchBranch(branchForMessage.id);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-1 px-1">
      {branchForMessage ? (
        <button
          type="button"
          onClick={handleSwitch}
          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${
            isOnCurrentBranch
              ? 'border-workspace-code text-workspace-code bg-workspace-code/10'
              : 'border-forge-border text-text-muted hover:bg-forge-hover'
          }`}
          title="Switch to this branch"
        >
          <GitBranch className="w-3 h-3" />
          <span className="truncate max-w-[120px]">
            {branchForMessage.name || 'Branch'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleFork}
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary"
          title="Fork conversation from this message"
        >
          <GitBranch className="w-3 h-3" />
          <span>Fork from here</span>
        </button>
      )}

      {currentBranchId && !branchForMessage && (
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          <CornerDownRight className="w-3 h-3" />
          <span>Root + Branch</span>
        </span>
      )}
    </div>
  );
}

export default BranchIndicator;


