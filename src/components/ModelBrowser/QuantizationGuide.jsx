/**
 * QuantizationGuide Component
 * 
 * Educational modal explaining quantization options.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { X, Info, Zap, HardDrive, Star, CheckCircle } from 'lucide-react';

export function QuantizationGuide({ guide, onClose }) {
  const entries = Object.entries(guide).sort((a, b) => {
    // Sort by quality (descending)
    return (b[1].quality || 0) - (a[1].quality || 0);
  });

  const recommended = ['Q4_K_M', 'Q5_K_M'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-2xl bg-forge-surface rounded-xl border border-forge-border shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-forge-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Info size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Quantization Guide</h2>
              <p className="text-xs text-text-muted">Understanding GGUF model sizes and quality</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-forge-hover text-text-muted"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {/* Introduction */}
          <div className="mb-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <h3 className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-2">
              <Info size={14} />
              What is Quantization?
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Quantization reduces model size by using lower precision numbers. 
              This makes models smaller and faster to run, with some trade-off in quality. 
              For most users, <strong className="text-green-400">Q4_K_M</strong> or{' '}
              <strong className="text-blue-400">Q5_K_M</strong> offer the best balance.
            </p>
          </div>

          {/* Legend */}
          <div className="mb-4 flex items-center gap-6 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Star size={12} className="text-yellow-400" />
              Quality (1-5)
            </span>
            <span className="flex items-center gap-1">
              <HardDrive size={12} className="text-blue-400" />
              Size (relative)
            </span>
            <span className="flex items-center gap-1">
              <Zap size={12} className="text-green-400" />
              Speed (1-5)
            </span>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-forge-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-forge-bg">
                  <th className="px-4 py-2 text-left text-xs font-medium text-text-muted">Quantization</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-text-muted">Quality</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-text-muted">Size</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-text-muted">Speed</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-text-muted">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forge-border">
                {entries.map(([name, info]) => {
                  const isRecommended = recommended.includes(name);
                  
                  return (
                    <tr 
                      key={name}
                      className={`${isRecommended ? 'bg-green-500/5' : 'hover:bg-forge-hover/50'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-mono ${isRecommended ? 'text-green-400 font-medium' : 'text-text-primary'}`}>
                            {name}
                          </span>
                          {isRecommended && (
                            <CheckCircle size={12} className="text-green-400" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <QualityBar value={info.quality || 0} max={5} color="yellow" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <QualityBar value={info.size || 0} max={8} color="blue" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <QualityBar value={info.speed || 0} max={5} color="green" />
                      </td>
                      <td className="px-4 py-3 text-xs text-text-secondary">
                        {info.description}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Recommendations */}
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
              <h4 className="text-sm font-medium text-green-400 mb-2">Best for Most Users</h4>
              <p className="text-xs text-text-secondary">
                <strong className="text-text-primary">Q4_K_M</strong> - Excellent balance of quality, 
                size, and speed. Works great on 8GB VRAM GPUs for 7B models.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
              <h4 className="text-sm font-medium text-blue-400 mb-2">Best Quality (Affordable)</h4>
              <p className="text-xs text-text-secondary">
                <strong className="text-text-primary">Q5_K_M</strong> - Higher quality with 
                slightly larger size. Great if you have extra VRAM/RAM.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
              <h4 className="text-sm font-medium text-cyan-400 mb-2">For Limited Hardware</h4>
              <p className="text-xs text-text-secondary">
                <strong className="text-text-primary">Q3_K_M</strong> or <strong>Q4_K_S</strong> - 
                Smaller files that fit on less powerful hardware.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-forge-bg border border-forge-border">
              <h4 className="text-sm font-medium text-purple-400 mb-2">Maximum Quality</h4>
              <p className="text-xs text-text-secondary">
                <strong className="text-text-primary">Q8_0</strong> or <strong>Q6_K</strong> - 
                Near-original quality but requires significant resources.
              </p>
            </div>
          </div>

          {/* VRAM Guide */}
          <div className="mt-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <h4 className="text-sm font-medium text-yellow-400 mb-2">Quick VRAM Guide</h4>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-text-primary font-medium">4-6 GB VRAM</p>
                <p className="text-text-muted">7B models (Q4_K_M)</p>
              </div>
              <div>
                <p className="text-text-primary font-medium">8-12 GB VRAM</p>
                <p className="text-text-muted">7B (Q5_K_M) or 13B (Q4_K_M)</p>
              </div>
              <div>
                <p className="text-text-primary font-medium">16+ GB VRAM</p>
                <p className="text-text-muted">34B (Q4_K_M) or 13B (Q8_0)</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function QualityBar({ value, max, color }) {
  const percentage = (value / max) * 100;
  const colorClass = {
    yellow: 'bg-yellow-400',
    blue: 'bg-blue-400',
    green: 'bg-green-400',
  }[color] || 'bg-gray-400';

  return (
    <div className="flex items-center gap-1">
      <div className="w-16 h-1.5 bg-forge-bg rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClass} rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-[10px] text-text-muted w-4">{value.toFixed(1)}</span>
    </div>
  );
}

export default QuantizationGuide;












