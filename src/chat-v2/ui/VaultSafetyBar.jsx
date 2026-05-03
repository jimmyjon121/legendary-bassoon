/**
 * VaultSafetyBar
 *
 * Floating, unobtrusive indicator visible only in the Vault workspace.
 * Shows current safeword state and surfaces the aftercare suggestion when
 * the engine fires a 'vault-safety' event. The bar never sends anything to
 * the model on its own; it just reflects engine state and exposes buttons
 * that trigger the engine's aftercare/safeword helpers.
 */

import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { Heart, ShieldAlert, ShieldCheck, ShieldHalf, Film, Users, Library } from 'lucide-react';
import { isVaultWorkspace } from '../../core/types';

const SceneDirector = lazy(() =>
  import('../../components/PrivateVault/SceneDirector').then((m) => ({ default: m.SceneDirector || m.default }))
);

const EnsembleCast = lazy(() =>
  import('../../components/PrivateVault/EnsembleCast').then((m) => ({ default: m.EnsembleCast || m.default }))
);

const WorldbuildingStudio = lazy(() =>
  import('../../components/PrivateVault/WorldbuildingStudio').then((m) => ({ default: m.WorldbuildingStudio || m.default }))
);

const styles = {
  wrap: {
    position: 'absolute',
    top: 10,
    right: 14,
    zIndex: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 999,
    background: 'rgba(15, 23, 42, 0.78)',
    border: '1px solid rgba(244, 114, 182, 0.35)',
    backdropFilter: 'blur(10px)',
    fontSize: 12,
    color: '#fbcfe8',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    userSelect: 'none',
  },
  dot: (color) => ({
    width: 8,
    height: 8,
    borderRadius: 999,
    background: color,
    boxShadow: `0 0 8px ${color}`,
  }),
  button: {
    appearance: 'none',
    border: '1px solid rgba(244, 114, 182, 0.4)',
    background: 'rgba(244, 114, 182, 0.12)',
    color: '#fbcfe8',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },
  toast: {
    position: 'absolute',
    top: 48,
    right: 14,
    zIndex: 41,
    maxWidth: 320,
    padding: '10px 12px',
    borderRadius: 12,
    background: 'rgba(30, 10, 30, 0.92)',
    border: '1px solid rgba(244, 114, 182, 0.4)',
    color: '#fce7f3',
    fontSize: 12,
    lineHeight: 1.5,
  },
  toastActions: {
    marginTop: 8,
    display: 'flex',
    gap: 6,
    justifyContent: 'flex-end',
  },
};

export function VaultSafetyBar({ engine, workspace }) {
  const [yellowClamp, setYellowClamp] = useState(false);
  const [aftercareActive, setAftercareActive] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [showDirector, setShowDirector] = useState(false);
  const [showEnsemble, setShowEnsemble] = useState(false);
  const [showLore, setShowLore] = useState(false);

  const refreshFromEngine = useCallback(() => {
    if (!engine) return;
    setYellowClamp(Boolean(engine.yellowClampActive));
    setAftercareActive(Boolean(engine.aftercareMode));
  }, [engine]);

  useEffect(() => {
    refreshFromEngine();
    if (!engine) return undefined;
    const unsub = engine.subscribe(() => refreshFromEngine());
    return unsub;
  }, [engine, refreshFromEngine]);

  useEffect(() => {
    const onSafety = (event) => {
      const detail = event?.detail || {};
      if (detail.type === 'aftercare-suggest') {
        setSuggestion({
          text: "It's been quiet for a while after an intense turn. Would you like aftercare?",
          reason: detail.reason,
        });
      }
      if (detail.type === 'hard-stop') {
        setSuggestion({ text: 'Red safeword received. Scene stopped. Engaging aftercare...', reason: 'red' });
      }
      if (detail.type === 'aftercare-engaged') {
        setSuggestion(null);
      }
      refreshFromEngine();
    };
    window.addEventListener('vault-safety', onSafety);
    return () => window.removeEventListener('vault-safety', onSafety);
  }, [refreshFromEngine]);

  if (!isVaultWorkspace(workspace)) return null;

  const statusColor = aftercareActive ? '#38bdf8'
    : yellowClamp ? '#facc15'
    : '#34d399';
  const StatusIcon = aftercareActive ? Heart
    : yellowClamp ? ShieldHalf
    : ShieldCheck;
  const label = aftercareActive ? 'Aftercare'
    : yellowClamp ? 'Soft limit'
    : 'Scene open';

  return (
    <>
      <div style={styles.wrap} title="Type red/yellow/green in the chat to steer the scene. Red stops instantly and starts aftercare.">
        <span style={styles.dot(statusColor)} />
        <StatusIcon size={14} color={statusColor} />
        <span>{label}</span>
        {yellowClamp && (
          <button
            type="button"
            style={styles.button}
            onClick={() => {
              if (!engine) return;
              engine.yellowClampActive = false;
              refreshFromEngine();
            }}
          >Release</button>
        )}
        <button
          type="button"
          style={styles.button}
          title="Open the Scene Director to plan a scene beat by beat"
          onClick={() => setShowDirector(true)}
        >
          <Film size={12} style={{ marginRight: 4 }} />
          Direct
        </button>
        <button
          type="button"
          style={styles.button}
          title="Cast multiple characters and run them in parallel"
          onClick={() => setShowEnsemble(true)}
        >
          <Users size={12} style={{ marginRight: 4 }} />
          Cast
        </button>
        <button
          type="button"
          style={styles.button}
          title="Open the encrypted worldbuilding lorebook"
          onClick={() => setShowLore(true)}
        >
          <Library size={12} style={{ marginRight: 4 }} />
          Lore
        </button>
        <button
          type="button"
          style={styles.button}
          title="Stop the scene and start aftercare now"
          onClick={() => {
            if (!engine) return;
            if (engine.state?.isGenerating) engine.stop();
            engine.engageAftercare('manual').catch(() => {});
          }}
        >
          <ShieldAlert size={12} style={{ marginRight: 4 }} />
          Aftercare
        </button>
      </div>
      {showDirector && (
        <Suspense fallback={null}>
          <SceneDirector engine={engine} onClose={() => setShowDirector(false)} />
        </Suspense>
      )}
      {showEnsemble && (
        <Suspense fallback={null}>
          <EnsembleCast engine={engine} onClose={() => setShowEnsemble(false)} />
        </Suspense>
      )}
      {showLore && (
        <Suspense fallback={null}>
          <WorldbuildingStudio engine={engine} onClose={() => setShowLore(false)} />
        </Suspense>
      )}
      {suggestion && (
        <div style={styles.toast} role="alert">
          {suggestion.text}
          <div style={styles.toastActions}>
            <button
              type="button"
              style={styles.button}
              onClick={() => setSuggestion(null)}
            >Dismiss</button>
            <button
              type="button"
              style={{ ...styles.button, background: 'rgba(59, 130, 246, 0.25)' }}
              onClick={() => {
                setSuggestion(null);
                if (engine) engine.engageAftercare('suggestion-accepted').catch(() => {});
              }}
            >Begin aftercare</button>
          </div>
        </div>
      )}
    </>
  );
}

export default VaultSafetyBar;
