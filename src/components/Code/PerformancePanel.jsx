import React from 'react';
import { Activity } from 'lucide-react';
import { HardwareMonitorCompact } from '../HardwareMonitor/HardwareMonitor';

export function PerformancePanel() {
  return (
    <div className="border border-forge-border rounded-lg bg-forge-bg/70">
      <div className="flex items-center justify-between px-3 py-2 border-b border-forge-border text-[11px] text-text-muted">
        <span className="flex items-center gap-1">
          <Activity size={12} />
          Performance
        </span>
        <span>live</span>
      </div>
      <HardwareMonitorCompact className="p-2" />
    </div>
  );
}

export default PerformancePanel;














