'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import {
  isWebAuthnSupported,
  registerPasskeyWithShare,
} from '../../crypto/passkey';
import api from '../../lib/api';

type SetupPhase = 'checking' | 'ready' | 'registering' | 'success' | 'error' | 'unsupported';

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Unknown Device';
}

// Loading component for Suspense
function LoadingState() {
  return (
    <div className="min-h-screen flex flex-col bg-[#030206] text-[#FFFFFC] items-center justify-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
      <p className="text-[#FFFFFC]/60">Loading...</p>
    </div>
  );
}

// Main content component that uses useSearchParams
function PasskeySetupContent() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<SetupPhase>('checking');
  const [error, setError] = useState<string | null>(null);

  // Get params from URL
  const walletId = searchParams.get('walletId');
  const partyId = searchParams.get('partyId');
  const userShareHex = searchParams.get('userShare');
  const email = searchParams.get('email') || 'CC Bot User';
  const returnUrl = searchParams.get('returnUrl');

  useEffect(() => {
    // Check WebAuthn support
    if (!isWebAuthnSupported()) {
      setPhase('unsupported');
      return;
    }

    // Validate required params
    if (!walletId || !partyId || !userShareHex) {
      setError('Missing required parameters');
      setPhase('error');
      return;
    }

    setPhase('ready');
  }, [walletId, partyId, userShareHex]);

  const handleSetupPasskey = useCallback(async () => {
    if (!walletId || !partyId || !userShareHex) return;

    try {
      setPhase('registering');
      setError(null);

      // Generate challenge
      const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

      // Register passkey and encrypt the user share
      const { credential, encryptedShare } = await registerPasskeyWithShare(
        walletId,
        challenge,
        userShareHex,
        email
      );

      // Register passkey with backend
      await api.registerPasskey({
        credentialId: credential.credentialId,
        publicKeySpki: credential.publicKeySpki,
        encryptedShare: encryptedShare.ciphertext,
        nonce: encryptedShare.nonce,
        userShareHex: userShareHex,
        deviceName: getDeviceName(),
      });

      // Store credential ID locally
      localStorage.setItem('cc_passkey_credential_id', credential.credentialId);

      // Also store in a way that Mini App can access
      localStorage.setItem('cc_passkey_setup_complete', 'true');
      localStorage.setItem('cc_passkey_wallet_id', walletId);

      setPhase('success');
      // User will manually close and return to Telegram

    } catch (err) {
      console.error('Passkey setup failed:', err);
      setError(err instanceof Error ? err.message : 'Setup failed');
      setPhase('error');
    }
  }, [walletId, partyId, userShareHex, email, returnUrl]);

  const handleRetry = () => {
    setPhase('ready');
    setError(null);
  };

  const handleClose = () => {
    if (returnUrl) {
      window.location.href = returnUrl;
    } else {
      window.close();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#030206] text-[#FFFFFC]">
      {/* Header */}
      <div className="p-4 pt-6 text-center">
        <h1 className="text-xl font-bold">CC Bot Wallet</h1>
        <p className="text-sm text-[#FFFFFC]/60">Passkey Setup</p>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        {phase === 'checking' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
            <p className="text-[#FFFFFC]/60">Checking compatibility...</p>
          </motion.div>
        )}

        {phase === 'unsupported' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center bg-yellow-500/20">
              <span className="material-symbols-outlined text-5xl text-yellow-400">warning</span>
            </div>
            <h2 className="text-xl font-bold mb-2 text-yellow-400">Not Supported</h2>
            <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">
              This browser doesn't support passkeys. Please try opening in Safari or Chrome.
            </p>
            <button
              onClick={handleClose}
              className="w-full py-4 rounded-2xl font-semibold bg-[#FFFFFC]/10"
            >
              Close
            </button>
          </motion.div>
        )}

        {phase === 'ready' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            {/* Passkey Icon */}
            <motion.div
              className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(135, 92, 255, 0.2), rgba(213, 165, 227, 0.2))' }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <span className="material-symbols-outlined text-5xl text-[#875CFF]">fingerprint</span>
            </motion.div>

            <h2 className="text-2xl font-bold mb-3">Set Up Passkey</h2>
            <p className="text-[#FFFFFC]/60 mb-8 max-w-xs mx-auto">
              Use Face ID, Touch ID, or your device PIN to secure your wallet.
            </p>

            {/* Benefits */}
            <div className="space-y-3 mb-8 text-left max-w-xs mx-auto">
              {[
                { icon: 'shield', text: 'Bank-level security' },
                { icon: 'sync', text: 'Syncs across your devices' },
                { icon: 'speed', text: 'Instant authentication' },
              ].map((item, i) => (
                <motion.div
                  key={item.icon}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 * i }}
                  className="flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-sm text-[#875CFF]">{item.icon}</span>
                  </div>
                  <span className="text-sm text-[#FFFFFC]/80">{item.text}</span>
                </motion.div>
              ))}
            </div>

            <motion.button
              onClick={handleSetupPasskey}
              className="w-full py-4 rounded-2xl font-semibold text-lg mb-3"
              style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Set Up Passkey
            </motion.button>

            <motion.button
              onClick={handleClose}
              className="w-full py-4 rounded-2xl font-semibold text-lg bg-[#FFFFFC]/10 text-[#FFFFFC]/80"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Cancel
            </motion.button>
          </motion.div>
        )}

        {phase === 'registering' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <motion.div
              className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center relative"
              style={{ background: 'linear-gradient(135deg, rgba(135, 92, 255, 0.2), rgba(213, 165, 227, 0.2))' }}
            >
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-[#875CFF]/30"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                style={{ borderTopColor: '#875CFF' }}
              />
              <span className="material-symbols-outlined text-4xl text-[#875CFF]">fingerprint</span>
            </motion.div>

            <h2 className="text-xl font-bold mb-2">Setting Up Passkey...</h2>
            <p className="text-[#FFFFFC]/60 text-sm">
              Complete authentication on your device
            </p>
          </motion.div>
        )}

        {phase === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <motion.div
              className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(134, 239, 172, 0.2))' }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 10 }}
            >
              <motion.span
                className="material-symbols-outlined text-5xl text-green-400"
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: 'spring' }}
              >
                check_circle
              </motion.span>
            </motion.div>

            <h2 className="text-2xl font-bold mb-2 text-green-400">Passkey Created!</h2>
            <p className="text-[#FFFFFC]/60 mb-6">
              Your wallet is now secured with passkey
            </p>

            <div className="p-4 rounded-xl bg-[#FFFFFC]/5 border border-[#FFFFFC]/10 mb-6">
              <p className="text-sm text-[#FFFFFC]/80">
                Now return to Telegram to start using your wallet!
              </p>
            </div>

            <motion.button
              onClick={() => window.close()}
              className="w-full py-4 rounded-2xl font-semibold text-lg bg-[#FFFFFC]/10 text-[#FFFFFC]/80"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Close This Window
            </motion.button>
          </motion.div>
        )}

        {phase === 'error' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <motion.div
              className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(239, 68, 68, 0.2)' }}
            >
              <span className="material-symbols-outlined text-5xl text-red-400">error</span>
            </motion.div>

            <h2 className="text-xl font-bold mb-2 text-red-400">Setup Failed</h2>
            <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">
              {error || 'Something went wrong. Please try again.'}
            </p>

            <motion.button
              onClick={handleRetry}
              className="w-full py-4 rounded-2xl font-semibold mb-3"
              style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Try Again
            </motion.button>

            <motion.button
              onClick={handleClose}
              className="w-full py-4 rounded-2xl font-semibold bg-[#FFFFFC]/10 text-[#FFFFFC]/80"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Cancel
            </motion.button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// Main page component with Suspense wrapper
export default function PasskeySetupPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PasskeySetupContent />
    </Suspense>
  );
}
