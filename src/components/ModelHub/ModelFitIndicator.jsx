import { Cpu } from 'lucide-react';

function getFitClass(tier = 'fair') {
  if (tier === 'excellent') return 'bg-emerald-500/20 text-emerald-300';
  if (tier === 'strong') return 'bg-green-500/15 text-green-300';
  if (tier === 'good') return 'bg-lime-500/15 text-lime-300';
  if (tier === 'stretch') return 'bg-amber-500/15 text-amber-300';
  return 'bg-neutral-800 text-text-muted';
}

export function ModelFitIndicator({
  score = null,
  tier = 'fair',
  estimatedNeed = null,
  fits = false,
  variant = 'tag',
}) {
  if (variant === 'memory') {
    if (!Number.isFinite(estimatedNeed) || estimatedNeed <= 0) return null;
    return (
      <span className={`flex items-center gap-1 ${fits ? 'text-emerald-300' : 'text-amber-300'}`}>
        <Cpu size={10} /> ~{estimatedNeed.toFixed(1)}GB
      </span>
    );
  }

  if (!Number.isFinite(score)) return null;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${getFitClass(tier)}`}>
      {score}/100 fit
    </span>
  );
}

export default ModelFitIndicator;
