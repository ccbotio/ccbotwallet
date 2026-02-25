'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import {
  isWebAuthnSupported,
  registerPasskeyWithShare,
} from '../../crypto/passkey';
import api from '../../lib/api';

type SetupPhase = 'loading' | 'ready' | 'registering' | 'success' | 'error' | 'unsupported' | 'expired';

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
      <p className="text-[#FFFFFC]/60">Loading secure session...</p>
    </div>
  );
}

// Main content component that uses useSearchParams
function PasskeyAuthContent() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<SetupPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<{
    walletId: string;
    partyId: string;
    userShareHex: string;
    displayName: string;
    challenge: string;
  } | null>(null);

  // Get session ID from URL
  const sessionId = searchParams.get('session');

  // Mark app as hydrated to prevent flash of unstyled content
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      requestAnimationFrame(() => appRoot.classList.add('hydrated'));
    }
  }, []);

  // Load session data from backend
  useEffect(() => {
    async function loadSession() {
      if (!sessionId) {
        setError('Missing session ID');
        setPhase('error');
        return;
      }

      // Check WebAuthn support first
      if (!isWebAuthnSupported()) {
        setPhase('unsupported');
        return;
      }

      try {
        // Get session data from backend (no auth required, session ID is the auth)
        const data = await api.getPasskeySession(sessionId);
        setSessionData(data);
        setPhase('ready');
      } catch (err) {
        console.error('Failed to load session:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load session';

        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          setError('Session expired or invalid. Please return to the app and try again.');
          setPhase('expired');
        } else {
          setError(errorMessage);
          setPhase('error');
        }
      }
    }

    loadSession();
  }, [sessionId]);

  const handleSetupPasskey = useCallback(async () => {
    if (!sessionData || !sessionId) return;

    try {
      setPhase('registering');
      setError(null);

      // Register passkey with WebAuthn
      const { credential, encryptedShare } = await registerPasskeyWithShare(
        sessionData.walletId,
        sessionData.challenge,
        sessionData.userShareHex,
        sessionData.displayName
      );

      // Complete session on backend (registers passkey credential)
      await api.completePasskeySession(sessionId, {
        credentialId: credential.credentialId,
        publicKeySpki: credential.publicKeySpki,
        encryptedShare: encryptedShare.ciphertext,
        nonce: encryptedShare.nonce,
        deviceName: getDeviceName(),
      });

      // Store credential ID locally (in Safari)
      localStorage.setItem('cc_passkey_credential_id', credential.credentialId);

      setPhase('success');

    } catch (err) {
      console.error('Passkey setup failed:', err);
      setError(err instanceof Error ? err.message : 'Setup failed');
      setPhase('error');
    }
  }, [sessionData, sessionId]);

  const handleRetry = () => {
    setPhase('ready');
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#030206] text-[#FFFFFC]">
      {/* Header */}
      <div className="p-4 pt-6 text-center border-b border-[#FFFFFC]/10">
        <h1 className="text-xl font-bold">CC Bot Wallet</h1>
        <p className="text-sm text-[#FFFFFC]/60">Secure Passkey Setup</p>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        {phase === 'loading' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
            <p className="text-[#FFFFFC]/60">Loading secure session...</p>
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
          </motion.div>
        )}

        {phase === 'expired' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center bg-orange-500/20">
              <span className="material-symbols-outlined text-5xl text-orange-400">schedule</span>
            </div>
            <h2 className="text-xl font-bold mb-2 text-orange-400">Session Expired</h2>
            <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">
              This session has expired. Please return to the CC Bot app and try again.
            </p>
            <div className="p-4 rounded-xl bg-[#FFFFFC]/5 border border-[#FFFFFC]/10">
              <p className="text-sm text-[#FFFFFC]/80">
                You can close this window and return to Telegram.
              </p>
            </div>
          </motion.div>
        )}

        {phase === 'ready' && sessionData && (
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

            {/* Security Badge */}
            <div className="mb-6 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-sm text-green-400">verified_user</span>
                <span className="text-sm text-green-400">Secure session verified</span>
              </div>
            </div>

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
              className="w-full py-4 rounded-2xl font-semibold text-lg"
              style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Set Up Passkey
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
                ✅ You can now close this window and return to Telegram.
              </p>
              <p className="text-xs text-[#FFFFFC]/50 mt-2">
                Your wallet will be ready automatically.
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
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 text-center border-t border-[#FFFFFC]/10">
        <p className="text-xs text-[#FFFFFC]/40">
          🔒 Secured with OAuth 2.0 + PKCE
        </p>
      </div>
    </div>
  );
}

// Main page component with Suspense wrapper
export default function PasskeyAuthPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PasskeyAuthContent />
    </Suspense>
  );
}
