import React, { useState, useEffect, useRef } from 'react';
import { Zap, ZapOff, Info, ChevronDown, Gauge, Leaf, Battery } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Profile icons and colors
const PROFILE_CONFIG = {
  performance: { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Beast Mode' },
  balanced: { icon: Gauge, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Balanced' },
  powersaver: { icon: Leaf, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Eco' },
};

export function PowerModeToggle({ compact = false }) {
  const [loading, setLoading] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [currentConfig, setCurrentConfig] = useState(null);
  const [powerModeStatus, setPowerModeStatus] = useState(null);
  const dropdownRef = useRef(null);

  // Load profiles and current config from IdleManager
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Get IdleManager profiles
        const profileList = await window.electronAPI?.invoke?.('idle:getProfiles');
        if (profileList) setProfiles(profileList);
        
        const config = await window.electronAPI?.invoke?.('idle:getConfig');
        if (config) setCurrentConfig(config);
        
        // Also get PowerMode status for detailed view
        const pmStatus = await window.electronAPI?.getPowerModeStatus?.();
        if (pmStatus) setPowerModeStatus(pmStatus);
      } catch (error) {
        console.error('Failed to load power config:', error);
      }
    };
    loadConfig();

    // Listen for profile changes from main process
    const handleProfileChange = (_, data) => {
      setCurrentConfig(prev => ({
        ...prev,
        profile: data.profile,
        config: data.config
      }));
    };
    
    window.electronAPI?.on?.('power-profile-change', handleProfileChange);
    return () => {
      window.electronAPI?.off?.('power-profile-change', handleProfileChange);
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSetProfile = async (profileId) => {
    setLoading(true);
    setShowDropdown(false);
    try {
      await window.electronAPI?.invoke?.('idle:setProfile', profileId);
      const config = await window.electronAPI?.invoke?.('idle:getConfig');
      if (config) setCurrentConfig(config);

      // Keep the LLM performance system in sync with the system power profile.
      // idle profiles: performance | balanced | powersaver | idle
      // llm profiles:  speed | balanced | efficiency
      const llmProfile =
        profileId === 'performance' ? 'speed' :
        profileId === 'balanced' ? 'balanced' :
        'efficiency';
      await window.electronAPI?.setPerformanceProfile?.(llmProfile);
      
      // Refresh power mode status
      const pmStatus = await window.electronAPI?.getPowerModeStatus?.();
      if (pmStatus) setPowerModeStatus(pmStatus);
    } catch (error) {
      console.error('Failed to set profile:', error);
    } finally {
      setLoading(false);
    }
  };

  // Quick toggle between performance and balanced
  const handleQuickToggle = async () => {
    const nextProfile = currentConfig?.profile === 'performance' ? 'balanced' : 'performance';
    await handleSetProfile(nextProfile);
  };

  const currentProfile = currentConfig?.profile || 'balanced';
  const profileInfo = PROFILE_CONFIG[currentProfile] || PROFILE_CONFIG.balanced;
  const ProfileIcon = profileInfo.icon;

  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        {/* Main button - click to toggle, long press for dropdown */}
        <button
          onClick={handleQuickToggle}
          onContextMenu={(e) => { e.preventDefault(); setShowDropdown(!showDropdown); }}
          disabled={loading}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className={`
            p-2 rounded-lg transition-all duration-200 flex items-center gap-1
            ${profileInfo.bg} ${profileInfo.color}
            ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
          `}
          title={`${profileInfo.label} (right-click for options)`}
        >
          <ProfileIcon size={18} className={loading ? 'animate-pulse' : ''} />
        </button>

        {/* Dropdown menu */}
        <AnimatePresence>
          {showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              className="absolute bottom-full left-0 mb-2 w-44 bg-surface-1 border border-border-subtle rounded-lg shadow-xl z-50 overflow-hidden"
            >
              <div className="p-2 border-b border-border-subtle">
                <p className="text-[10px] text-text-muted uppercase tracking-wide">Power Profile</p>
              </div>
              {profiles.map((profile) => {
                const pConfig = PROFILE_CONFIG[profile.id] || PROFILE_CONFIG.balanced;
                const PIcon = pConfig.icon;
                return (
                  <button
                    key={profile.id}
                    onClick={() => handleSetProfile(profile.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-glass-2 transition-colors ${
                      currentProfile === profile.id ? 'bg-glass-3' : ''
                    }`}
                  >
                    <PIcon size={14} className={pConfig.color} />
                    <div className="flex-1">
                      <p className="text-xs font-medium text-text-primary">{pConfig.label}</p>
                      <p className="text-[10px] text-text-muted">{profile.description}</p>
                    </div>
                    {currentProfile === profile.id && (
                      <div className={`w-1.5 h-1.5 rounded-full ${pConfig.color.replace('text-', 'bg-')}`} />
                    )}
                  </button>
                );
              })}
              {currentConfig?.isIdle && (
                <div className="px-3 py-2 border-t border-border-subtle">
                  <p className="text-[10px] text-text-muted flex items-center gap-1">
                    <Battery size={10} />
                    Auto-idle active
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tooltip */}
        <AnimatePresence>
          {showTooltip && !showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-forge-surface border border-forge-border rounded-lg shadow-xl z-50 whitespace-nowrap"
            >
              <div className="text-xs font-medium text-text-primary mb-1">
                {profileInfo.label}
              </div>
              <div className="text-xs text-text-muted">
                {currentProfile === 'performance' 
                  ? 'Max performance mode' 
                  : currentProfile === 'powersaver'
                  ? 'Energy saving mode'
                  : 'Balanced performance'
                }
              </div>
              <div className="text-[10px] text-text-muted mt-1">Right-click for options</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Full version with profile selector and details
  return (
    <div className="p-4 bg-forge-bg border border-forge-border rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${profileInfo.bg}`}>
            <ProfileIcon size={20} className={profileInfo.color} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">Power Profile</h3>
            <p className="text-xs text-text-muted">
              {profileInfo.label} {currentConfig?.isIdle && '(Auto-idle)'}
            </p>
          </div>
        </div>
      </div>

      {/* Profile selector buttons */}
      <div className="flex gap-2 mb-4">
        {profiles.map((profile) => {
          const pConfig = PROFILE_CONFIG[profile.id] || PROFILE_CONFIG.balanced;
          const PIcon = pConfig.icon;
          const isActive = currentProfile === profile.id;
          return (
            <button
              key={profile.id}
              onClick={() => handleSetProfile(profile.id)}
              disabled={loading}
              className={`
                flex-1 flex flex-col items-center gap-1 p-3 rounded-lg border transition-all
                ${isActive 
                  ? `${pConfig.bg} border-current ${pConfig.color}` 
                  : 'bg-forge-elevated border-forge-border text-text-muted hover:border-forge-hover'
                }
                ${loading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
              `}
            >
              <PIcon size={18} />
              <span className="text-[10px] font-medium">{pConfig.label}</span>
            </button>
          );
        })}
      </div>

      {/* Status details when in performance mode */}
      <AnimatePresence>
        {currentProfile === 'performance' && powerModeStatus?.optimizations && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-4 border-t border-forge-border">
              <div className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                <Info size={12} />
                Active Optimizations
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${powerModeStatus.optimizations.highPriority ? 'bg-status-success' : 'bg-text-muted'}`} />
                  <span className="text-text-muted">High Priority</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${powerModeStatus.optimizations.sleepPrevention ? 'bg-status-success' : 'bg-text-muted'}`} />
                  <span className="text-text-muted">Sleep Prevention</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${powerModeStatus.optimizations.gpuPerformance ? 'bg-status-success' : 'bg-text-muted'}`} />
                  <span className="text-text-muted">GPU Performance</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${powerModeStatus.optimizations.cudaOptimized ? 'bg-status-success' : 'bg-text-muted'}`} />
                  <span className="text-text-muted">CUDA Optimized</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle status indicator */}
      {currentConfig?.isIdle && (
        <div className="mt-3 pt-3 border-t border-forge-border">
          <p className="text-xs text-text-muted flex items-center gap-2">
            <Battery size={12} className="text-green-400" />
            Auto-idle mode active - will restore to {currentConfig.userProfile} on activity
          </p>
        </div>
      )}
    </div>
  );
}

export default PowerModeToggle;


