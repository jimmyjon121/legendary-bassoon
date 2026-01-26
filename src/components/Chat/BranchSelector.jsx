import React from 'react';
import { GitBranch } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function BranchSelector() {
  const {
    branches,
    currentBranchId,
    currentConversationId,
    switchBranch,
  } = useAppStore();

  if (!currentConversationId) {
    return null;
  }

  const handleChange = (e) => {
    const value = e.target.value;
    switchBranch(value || null);
  };

  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <GitBranch className="w-3 h-3" />
      <select
        value={currentBranchId || ''}
        onChange={handleChange}
        className="bg-transparent border border-forge-border rounded px-2 py-0.5 text-xs text-text-secondary focus:outline-none focus:border-workspace-code/60"
      >
        <option value="">Main</option>
        {branches?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name || 'Branch'}
          </option>
        ))}
      </select>
    </div>
  );
}

export default BranchSelector;


