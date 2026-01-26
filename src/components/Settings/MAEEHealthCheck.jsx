import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  RefreshCw, 
  Brain,
  FileCode,
  Cpu,
  Sliders,
  Database,
  Zap,
  Info
} from 'lucide-react';
import { api, isElectron } from '../../utils/electronAPI';
import { useModelExperience } from '../../services/modelExperience';

const COMPONENT_ICONS = {
  coreEngine: Brain,
  templateManager: FileCode,
  modelInspector: Cpu,
  autoTuner: Sliders,
  orchestrator: Zap,
  profileCache: Database,
  currentProfile: Activity,
};

const STATUS_COLORS = {
  healthy: 'text-green-400',
  loaded: 'text-green-400',
  unavailable: 'text-yellow-400',
  error: 'text-red-400',
  degraded: 'text-yellow-400',
  limited: 'text-orange-400',
  none: 'text-text-muted',
};

const STATUS_BG = {
  healthy: 'bg-green-500/20',
  loaded: 'bg-green-500/20',
  unavailable: 'bg-yellow-500/20',
  error: 'bg-red-500/20',
  degraded: 'bg-yellow-500/20',
  limited: 'bg-orange-500/20',
  none: 'bg-forge-bg',
};

export function MAEEHealthCheck() {
  const [healthData, setHealthData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const { profile, modelFamily, primaryStrength, backendHealth } = useModelExperience();

  // Run health check on mount
  useEffect(() => {
    runHealthCheck();
  }, []);

  const runHealthCheck = async () => {
    if (!isElectron()) {
      setHealthData({
        overall: 'unavailable',
        components: {},
        recommendations: ['Not running in Electron environment'],
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.runMAEEHealthCheck?.();
      setHealthData(result);
      setLastCheck(new Date());
    } catch (error) {
      console.error('Health check failed:', error);
      setHealthData({
        overall: 'error',
        components: {},
        recommendations: [`Health check failed: ${error.message}`],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getOverallIcon = () => {
    if (!healthData) return AlertCircle;
    switch (healthData.overall) {
      case 'healthy': return CheckCircle;
      case 'degraded': return AlertCircle;
      case 'limited': return AlertCircle;
      case 'error': return XCircle;
      default: return AlertCircle;
    }
  };

  const OverallIcon = getOverallIcon();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-accent-primary" />
          <h3 className="text-sm font-medium text-text-primary">MAEE Health Check</h3>
        </div>
        <button
          onClick={runHealthCheck}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forge-bg hover:bg-forge-hover text-text-secondary text-xs transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          {isLoading ? 'Checking...' : 'Run Check'}
        </button>
      </div>

      {/* Overall Status */}
      {healthData && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-lg border ${
            healthData.overall === 'healthy' 
              ? 'border-green-500/30 bg-green-500/10' 
              : healthData.overall === 'error'
              ? 'border-red-500/30 bg-red-500/10'
              : 'border-yellow-500/30 bg-yellow-500/10'
          }`}
        >
          <div className="flex items-center gap-3">
            <OverallIcon size={24} className={STATUS_COLORS[healthData.overall] || 'text-text-muted'} />
            <div>
              <p className="text-sm font-medium text-text-primary capitalize">
                System {healthData.overall}
              </p>
              <p className="text-xs text-text-muted">
                {lastCheck ? `Last check: ${lastCheck.toLocaleTimeString()}` : 'Never checked'}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Components Grid */}
      {healthData?.components && (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(healthData.components).map(([key, component]) => {
            const Icon = COMPONENT_ICONS[key] || Activity;
            const statusColor = STATUS_COLORS[component.status] || 'text-text-muted';
            const statusBg = STATUS_BG[component.status] || 'bg-forge-bg';
            
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`p-3 rounded-lg border border-forge-border ${statusBg}`}
              >
                <div className="flex items-start gap-2">
                  <Icon size={14} className={statusColor} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">
                      {component.name}
                    </p>
                    <p className={`text-[10px] capitalize ${statusColor}`}>
                      {component.status}
                    </p>
                    {component.details && (
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(component.details).slice(0, 2).map(([k, v]) => (
                          <p key={k} className="text-[9px] text-text-muted truncate">
                            {k}: {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v).substring(0, 20)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Current Profile Summary */}
      {profile && (
        <div className="p-3 rounded-lg border border-forge-border bg-forge-bg/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={12} className="text-accent-primary" />
            <span className="text-xs font-medium text-text-primary">Current Model Profile</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-text-muted">Family:</span>{' '}
              <span className="text-text-primary capitalize">{modelFamily}</span>
            </div>
            <div>
              <span className="text-text-muted">Strength:</span>{' '}
              <span className="text-text-primary capitalize">{primaryStrength?.replace(/([A-Z])/g, ' $1').trim()}</span>
            </div>
            <div>
              <span className="text-text-muted">Template:</span>{' '}
              <span className="text-purple-400">{profile.template?.detected || 'auto'}</span>
            </div>
            <div>
              <span className="text-text-muted">Temperature:</span>{' '}
              <span className="text-accent-primary font-mono">{profile.inference?.temperature?.toFixed(2) || '0.40'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {healthData?.recommendations?.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Info size={12} className="text-text-muted" />
            <span className="text-xs text-text-muted">Recommendations</span>
          </div>
          {healthData.recommendations.map((rec) => (
            <div key={rec} className="flex items-start gap-2 p-2 rounded bg-forge-bg text-[11px] text-text-secondary">
              <AlertCircle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <span>{rec}</span>
            </div>
          ))}
        </div>
      )}

      {/* Backend Health from Store */}
      {backendHealth.lastCheck && (
        <div className="text-[10px] text-text-muted text-center">
          Backend last seen: {new Date(backendHealth.lastCheck).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export default MAEEHealthCheck;






