import React from 'react';
import { motion } from 'framer-motion';

export function ProgressBar({ value, className }) {
  const numeric = typeof value === 'number' ? value : 0;
  const clamped = Math.max(0, Math.min(1, numeric));

  return (
    <div
      className={`h-1.5 w-full rounded-full bg-forge-bg overflow-hidden ${className || ''}`}
    >
      <motion.div
        className="h-full bg-workspace-casual"
        initial={{ width: 0 }}
        animate={{ width: `${clamped * 100}%` }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      />
    </div>
  );
}

export default ProgressBar;

















