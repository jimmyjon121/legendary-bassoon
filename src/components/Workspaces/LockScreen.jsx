import { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, ArrowLeft, Shield } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { motion } from 'framer-motion';

const REMEMBER_OPTIONS = [
  { value: 0, label: "Don't remember" },
  { value: 1000 * 60 * 60, label: 'Remember for 1 hour' },
  { value: 1000 * 60 * 60 * 24, label: 'Remember for 1 day' },
  { value: 1000 * 60 * 60 * 24 * 7, label: 'Remember for 7 days' },
  { value: 1000 * 60 * 60 * 24 * 30, label: 'Remember for 30 days' },
  { value: 1000 * 60 * 60 * 24 * 90, label: 'Remember for 90 days (max)' },
];

export function LockScreen() {
  const unlockNsfw = useAppStore((s) => s.unlockNsfw);
  const setNsfwPassword = useAppStore((s) => s.setNsfwPassword);
  const checkNsfwPasswordExists = useAppStore((s) => s.checkNsfwPasswordExists);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMs, setRememberMs] = useState(1000 * 60 * 60 * 24 * 7);
  const [rememberWarning, setRememberWarning] = useState(null);

  useEffect(() => {
    checkNsfwPasswordExists().then((hasPassword) => {
      setIsFirstTime(!hasPassword);
    });
  }, [checkNsfwPasswordExists]);

  const persistRemember = async (pwd) => {
    setRememberWarning(null);
    if (!rememberMs || rememberMs <= 0) {
      try { await window.electronAPI?.forgetNsfwPassword?.(); } catch (_) { /* noop */ }
      return;
    }
    try {
      const res = await window.electronAPI?.rememberNsfwPassword?.(pwd, rememberMs);
      if (!res?.success) {
        setRememberWarning(res?.error || 'Could not remember password on this OS');
      }
    } catch (err) {
      setRememberWarning(err?.message || 'Could not remember password');
    }
  };

  const handleUnlock = async (event) => {
    event.preventDefault();
    setError('');

    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    if (isFirstTime) {
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
      if (result?.success) {
        await persistRemember(password);
      }
      setIsLoading(false);

      if (!result.success) {
        setError(result.error || 'Failed to set password');
      }
      return;
    }

    setIsLoading(true);
    const result = await unlockNsfw(password);
    if (result?.success) {
      await persistRemember(password);
    }
    setIsLoading(false);

    if (!result.success) {
      setError(result.error || 'Invalid password');
    }
  };

  return (
    <div className="h-screen w-screen bg-forge-bg flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(236, 72, 153, 0.3) 0%, transparent 60%)',
        }}
      />

      <button
        onClick={() => setWorkspace('casual')}
        className="absolute top-6 left-6 flex items-center gap-2 text-text-muted hover:text-text-secondary transition-colors"
      >
        <ArrowLeft size={18} />
        <span className="text-sm">Back</span>
      </button>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-4"
      >
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-workspace-nsfw/20 border border-workspace-nsfw/30 flex items-center justify-center">
            <Shield size={40} className="text-workspace-nsfw" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Vault Access</h1>
          <p className="text-sm text-text-secondary">
            {isFirstTime ? 'Create a password for the vault' : 'Enter your password to continue'}
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <div className="relative">
              <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
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
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setError('');
                  }}
                  placeholder="Confirm password"
                  className="input pl-11 pr-11"
                  disabled={isLoading}
                />
              </div>
            )}

            {error && <p className="text-sm text-status-error mt-2">{error}</p>}
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1" htmlFor="remember-duration">
              Auto-unlock
            </label>
            <select
              id="remember-duration"
              value={rememberMs}
              onChange={(e) => setRememberMs(Number(e.target.value))}
              disabled={isLoading}
              className="input w-full"
            >
              {REMEMBER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-text-muted mt-1.5">
              Stored encrypted with your OS user key. Only this Windows account on this machine can decrypt it.
            </p>
            {rememberWarning && (
              <p className="text-[11px] text-amber-400 mt-1">{rememberWarning}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full btn bg-workspace-nsfw hover:bg-workspace-nsfw/90 text-white disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : (isFirstTime ? 'Create & Enter' : 'Enter Vault')}
          </button>
        </form>

        <div className="mt-8 p-4 rounded-lg bg-forge-surface border border-forge-border">
          <div className="flex gap-3">
            <Lock size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-text-secondary">
                Content in this area stays on this device and remains locked behind your password.
              </p>
              <ul className="text-xs text-text-muted mt-2 space-y-1">
                <li>- Encrypted local storage</li>
                <li>- Separate from standard workspaces</li>
                <li>- Manual lock always available</li>
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
