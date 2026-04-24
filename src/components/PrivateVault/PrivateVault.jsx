import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Lock, Shield, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function PrivateVault({ onClose, onPanic }) {
  const setWorkspace = useAppStore((state) => state.setWorkspace);
  const lockNsfw = useAppStore((state) => state.lockNsfw);

  const handlePanic = () => {
    lockNsfw?.();
    onPanic?.();
    onClose?.();
  };

  const handleOpenVault = async () => {
    await setWorkspace?.('nsfw');
    onClose?.();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={(event) => event.target === event.currentTarget && onClose?.()}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          className="w-full max-w-xl overflow-hidden rounded-2xl border border-rose-500/20 bg-forge-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-forge-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-workspace-nsfw/15">
                <Shield size={18} className="text-workspace-nsfw" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Vault Access</h2>
                <p className="text-xs text-text-muted">Legacy vault UI disabled</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-forge-hover hover:text-text-secondary"
              aria-label="Close vault dialog"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-4">
              <AlertTriangle size={18} className="mt-0.5 text-amber-400" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  This screen was retired for security reasons.
                </p>
                <p className="text-xs leading-5 text-text-secondary">
                  The older implementation stored sensitive vault data in insecure local browser storage.
                  Use the current vault flow instead so private content stays behind the app&apos;s protected workspace controls.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-forge-border bg-forge-bg/40 p-4">
              <div className="flex items-start gap-3">
                <Lock size={16} className="mt-0.5 text-workspace-nsfw" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-text-primary">Current safe path</p>
                  <p className="text-xs leading-5 text-text-muted">
                    Enter the vault through the protected workspace flow. If the vault is locked,
                    opening it will take you to the lock screen instead of exposing cached content here.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-forge-border bg-forge-bg px-5 py-4">
            <button
              type="button"
              onClick={handlePanic}
              className="btn btn-secondary text-xs"
            >
              Lock Vault
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onClose?.()}
                className="btn btn-secondary text-xs"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleOpenVault}
                className="btn bg-workspace-nsfw text-white hover:bg-workspace-nsfw/90 text-xs"
              >
                Open Vault
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default PrivateVault;
