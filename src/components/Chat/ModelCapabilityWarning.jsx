/**
 * Model Capability Warning
 * 
 * Shows a subtle warning when the user is in a workspace that doesn't match
 * the model's strengths. This helps users understand why responses might
 * be suboptimal and suggests switching to a better model or workspace.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, ArrowRight, Brain, Code, MessageCircle, Sparkles, Lightbulb } from 'lucide-react';
import { useModelAwareness } from '../../services/modelExperience';
import { useAppStore, WORKSPACES } from '../../stores/appStore';

// Workspace to capability mapping
const WORKSPACE_CAPABILITIES = {
  casual: ['generalChat', 'creative', 'reasoning'],
  work: ['generalChat', 'reasoning', 'codeExplanation'],
  code: ['codeGeneration', 'codeFix', 'codeExplanation'],
  nsfw: ['creative', 'roleplay'],
};

// Icons for capabilities
const CAPABILITY_ICONS = {
  codeGeneration: Code,
  codeFix: Code,
  codeExplanation: Code,
  generalChat: MessageCircle,
  creative: Sparkles,
  reasoning: Lightbulb,
  roleplay: Sparkles,
};

export function ModelCapabilityWarning() {
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  const { currentWorkspace, setWorkspace } = useAppStore();
  const {
    isModelLoaded,
    modelFamily,
    capabilities,
    getCapabilityLevel,
  } = useModelAwareness();

  // Check if model is well-suited for current workspace
  const checkCapabilityMatch = () => {
    if (!isModelLoaded || !capabilities) return { match: true };

    const workspaceCaps = WORKSPACE_CAPABILITIES[currentWorkspace] || [];
    const threshold = 0.6; // Minimum capability score to be "good enough"
    
    let totalScore = 0;
    let maxScore = 0;
    let weakCapabilities = [];
    let strongCapabilities = [];

    for (const cap of workspaceCaps) {
      const score = capabilities[cap] || 0.5;
      totalScore += score;
      maxScore += 1;
      
      if (score < threshold) {
        weakCapabilities.push(cap);
      } else {
        strongCapabilities.push(cap);
      }
    }

    const avgScore = maxScore > 0 ? totalScore / maxScore : 0.5;
    const match = avgScore >= threshold && weakCapabilities.length < workspaceCaps.length;

    // Determine best workspace for this model
    let recommendedWorkspace = currentWorkspace;
    if (!match) {
      const primaryStrength = Object.entries(capabilities)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

      if (primaryStrength === 'codeGeneration' || primaryStrength === 'codeFix') {
        recommendedWorkspace = 'code';
      } else if (primaryStrength === 'roleplay' || primaryStrength === 'creative') {
        recommendedWorkspace = capabilities.roleplay > 0.8 ? 'nsfw' : 'casual';
      } else {
        recommendedWorkspace = 'casual';
      }
    }

    return {
      match,
      avgScore,
      weakCapabilities,
      strongCapabilities,
      recommendedWorkspace,
    };
  };

  const capabilityMatch = checkCapabilityMatch();

  // Reset dismissed state when workspace or model changes
  useEffect(() => {
    setDismissed(false);
  }, [currentWorkspace, modelFamily]);

  // Don't show if model matches workspace or already dismissed
  if (!isModelLoaded || capabilityMatch.match || dismissed) {
    return null;
  }

  const weakCaps = capabilityMatch.weakCapabilities;
  const recommendedWs = capabilityMatch.recommendedWorkspace;
  const RecommendedIcon = WORKSPACE_CAPABILITIES[recommendedWs]?.[0] 
    ? CAPABILITY_ICONS[WORKSPACE_CAPABILITIES[recommendedWs][0]] 
    : Brain;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -10, height: 0 }}
        className="mx-4 mb-2"
      >
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg overflow-hidden">
          {/* Main warning bar */}
          <div className="flex items-center gap-3 px-3 py-2">
            <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0" />
            <div className="flex-1 text-xs">
              <span className="text-yellow-500 font-medium">Capability mismatch: </span>
              <span className="text-text-secondary">
                This model may not be optimal for {WORKSPACES[currentWorkspace]?.name} workspace
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {recommendedWs !== currentWorkspace && (
                <button
                  onClick={() => setWorkspace(recommendedWs)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500 text-[10px] font-medium transition-colors"
                >
                  <span>Switch to {WORKSPACES[recommendedWs]?.name}</span>
                  <ArrowRight size={10} />
                </button>
              )}
              
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-[10px] text-text-muted hover:text-text-secondary underline"
              >
                {showDetails ? 'Hide' : 'Details'}
              </button>
              
              <button
                onClick={() => setDismissed(true)}
                className="p-1 rounded hover:bg-forge-hover text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Details panel */}
          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-yellow-500/20 px-3 py-2 bg-forge-bg/30"
              >
                <div className="grid grid-cols-2 gap-3 text-[10px]">
                  {/* Weak capabilities */}
                  <div>
                    <h4 className="text-text-muted uppercase tracking-wide mb-1">Limited in</h4>
                    <div className="space-y-1">
                      {weakCaps.map(cap => {
                        const Icon = CAPABILITY_ICONS[cap] || Brain;
                        const level = getCapabilityLevel(cap);
                        return (
                          <div key={cap} className="flex items-center gap-1.5 text-yellow-500/80">
                            <Icon size={10} />
                            <span className="capitalize">{cap.replace(/([A-Z])/g, ' $1').trim()}</span>
                            <span className="text-text-muted">({level})</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Model strengths */}
                  <div>
                    <h4 className="text-text-muted uppercase tracking-wide mb-1">Model excels at</h4>
                    <div className="space-y-1">
                      {Object.entries(capabilities)
                        .filter(([, v]) => v >= 0.7)
                        .slice(0, 3)
                        .map(([cap, value]) => {
                          const Icon = CAPABILITY_ICONS[cap] || Brain;
                          return (
                            <div key={cap} className="flex items-center gap-1.5 text-green-500/80">
                              <Icon size={10} />
                              <span className="capitalize">{cap.replace(/([A-Z])/g, ' $1').trim()}</span>
                              <span className="text-text-muted">({Math.round(value * 100)}%)</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default ModelCapabilityWarning;












