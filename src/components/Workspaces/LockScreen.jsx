import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, ArrowLeft, Shield } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion } from 'framer-motion';

export function LockScreen() {
  const { unlockNsfw, setNsfwPassword, checkNsfwPasswordExists, setWorkspace } = useAppStore();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check if password exists
    checkNsfwPasswordExists().then(hasPassword => {
      setIsFirstTime(!hasPassword);
    });
  }, [checkNsfwPasswordExists]);

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    if (isFirstTime) {
      // First time setup
      if (password.length < 4) {
        setError('Password must be at least 4 characters');
        return;
      }
      
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      
      setIsLoading(true);
      const result = await setNsfwPassword(password);
      setIsLoading(false);
      
      if (!result.success) {
        setError(result.error || 'Failed to set password');
      }
    } else {
      // Unlock existing
      setIsLoading(true);
      const result = await unlockNsfw(password);
      setIsLoading(false);
      
      if (!result.success) {
        setError(result.error || 'Invalid password');
      }
    }
  };

  const handleBack = () => {
    setWorkspace('casual');
  };

  return (
    <div className="h-screen w-screen bg-forge-bg flex items-center justify-center relative overflow-hidden">
      {/* Background gradient */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(236, 72, 153, 0.3) 0%, transparent 60%)'
        }}
      />

      {/* Back button */}
      <button
        onClick={handleBack}
        className="absolute top-6 left-6 flex items-center gap-2 text-text-muted hover:text-text-secondary transition-colors"
      >
        <ArrowLeft size={18} />
        <span className="text-sm">Back to Casual</span>
      </button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-4"
      >
        {/* Lock Icon */}
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-workspace-nsfw/20 border border-workspace-nsfw/30 flex items-center justify-center">
            <Shield size={40} className="text-workspace-nsfw" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">
            Private Workspace
          </h1>
          <p className="text-sm text-text-secondary">
            {isFirstTime 
              ? 'Create a password to protect this workspace'
              : 'Enter your password to unlock'
            }
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder={isFirstTime ? 'Create password' : 'Enter password'}
                className="input pl-11 pr-11"
                autoFocus
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            
            {isFirstTime && (
              <div className="relative mt-3">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Confirm password"
                  className="input pl-11 pr-11"
                  disabled={isLoading}
                />
              </div>
            )}
            
            {error && (
              <p className="text-sm text-status-error mt-2">{error}</p>
            )}
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full btn bg-workspace-nsfw hover:bg-workspace-nsfw/90 text-white disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : (isFirstTime ? 'Create & Enter' : 'Unlock')}
          </button>
        </form>

        {/* Info */}
        <div className="mt-8 p-4 rounded-lg bg-forge-surface border border-forge-border">
          <div className="flex gap-3">
            <Lock size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-text-secondary">
                This workspace is encrypted and isolated. Your content here is completely private.
              </p>
              <ul className="text-xs text-text-muted mt-2 space-y-1">
                <li>• AES-256 encryption</li>
                <li>• No cloud sync</li>
                <li>• Boss key: Ctrl+Shift+H</li>
                <li>• Panic mode: Ctrl+Shift+P</li>
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
