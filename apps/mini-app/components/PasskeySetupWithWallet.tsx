'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletContext } from '../context/WalletContext';
import {
  isWebAuthnSupported,
  registerPasskeyWithShare,
} from '../crypto/passkey';
import { generatePKCEPair } from '../lib/pkce';
import api from '../lib/api';

interface PasskeySetupWithWalletProps {
  email: string;
  onComplete: (success: boolean, walletData?: { walletId: string; partyId: string; recoveryCode: string }) => void;
  onBack: () => void;
}

type SetupPhase = 'intro' | 'creating-wallet' | 'setting-up-passkey' | 'waiting-for-browser' | 'success' | 'error';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export default function PasskeySetupWithWallet({ email, onComplete, onBack }: PasskeySetupWithWalletProps) {
  const { createWalletWithPasskey, completeWalletSetup } = useWalletContext();
  const [phase, setPhase] = useState<SetupPhase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [walletData, setWalletData] = useState<{ walletId: string; partyId: string; recoveryCode: string } | null>(null);

  // PKCE state
  const [pkceData, setPkceData] = useState<{
    sessionId: string;
    codeVerifier: string;
    walletId: string;
    partyId: string;
    recoveryShare: string;
  } | null>(null);

  // Polling timer ref
  const pollStartTimeRef = useRef<number | null>(null);

  const isSupported = typeof window !== 'undefined' && isWebAuthnSupported();

  // Detect Telegram WebView - passkeys don't work in iframe (both mobile and web)
  // Telegram Web also runs in iframe where WebAuthn is blocked by permissions policy
  const isTelegramWebView = typeof window !== 'undefined' &&
    window.Telegram?.WebApp !== undefined &&
    (window.self !== window.top || window.Telegram.WebApp.platform !== 'tdesktop');

  // Poll for session completion with PKCE verification
  useEffect(() => {
    if (phase === 'waiting-for-browser' && pkceData) {
      let isActive = true;
      pollStartTimeRef.current = Date.now();

      const checkSessionStatus = async () => {
        // Check timeout
        if (pollStartTimeRef.current && Date.now() - pollStartTimeRef.current > MAX_POLL_DURATION_MS) {
          console.log('[Passkey] Polling timeout reached');
          setError('Session expired. Please try again.');
          setPhase('error');
          return;
        }

        try {
          const result = await api.checkPasskeySessionStatus(
            pkceData.sessionId,
            pkceData.codeVerifier
          );

          console.log('[Passkey] Session status:', result.status);

          if (result.status === 'completed' && isActive) {
            // Passkey was registered in external browser!
            setWalletData({
              walletId: pkceData.walletId,
              partyId: pkceData.partyId,
              recoveryCode: pkceData.recoveryShare,
            });
            setPhase('success');

            // Mark wallet as complete
            completeWalletSetup();
            setTimeout(() => {
              onComplete(true, {
                walletId: pkceData.walletId,
                partyId: pkceData.partyId,
                recoveryCode: pkceData.recoveryShare,
              });
            }, 2000);
          } else if (result.status === 'expired' || result.status === 'invalid') {
            setError('Session expired or invalid. Please try again.');
            setPhase('error');
          }
        } catch (err) {
          console.log('[Passkey] Polling error:', err);
          // Ignore errors, keep polling
        }
      };

      // Poll every 2 seconds
      const checkInterval = setInterval(checkSessionStatus, POLL_INTERVAL_MS);
      // Also check immediately
      checkSessionStatus();

      return () => {
        isActive = false;
        clearInterval(checkInterval);
      };
    }
  }, [phase, pkceData, onComplete, completeWalletSetup]);

  // Skip passkey and create wallet with recovery code only
  const handleSkipPasskey = useCallback(async () => {
    try {
      setPhase('creating-wallet');
      setError(null);

      // Create wallet without passkey
      const result = await createWalletWithPasskey();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create wallet');
      }

      const { walletId, partyId, recoveryShare } = result.data;

      setWalletData({ walletId, partyId, recoveryCode: recoveryShare });
      setPhase('success');

      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      } catch {}

      // Mark wallet as complete
      completeWalletSetup();
      setTimeout(() => {
        onComplete(true, { walletId, partyId, recoveryCode: recoveryShare });
      }, 2000);

    } catch (err) {
      console.error('Wallet creation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
      setPhase('error');
    }
  }, [createWalletWithPasskey, completeWalletSetup, onComplete]);

  // Open passkey setup in external browser with PKCE
  const handleSetupInBrowser = useCallback(async () => {
    try {
      setPhase('creating-wallet');
      setError(null);

      // Step 1: Create wallet first
      const result = await createWalletWithPasskey();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create wallet');
      }

      const { walletId, partyId, userShare, recoveryShare } = result.data;

      // Step 2: Generate PKCE code_verifier and code_challenge
      const { codeVerifier, codeChallenge } = await generatePKCEPair();

      console.log('[Passkey] Generated PKCE pair');

      // Step 3: Create secure session on backend
      const session = await api.createPasskeySession({
        walletId,
        partyId,
        userShareHex: userShare,
        codeChallenge,
        displayName: email || 'CC Bot User',
      });

      console.log('[Passkey] Created session:', session.sessionId);

      // Save PKCE data for polling
      setPkceData({
        sessionId: session.sessionId,
        codeVerifier,
        walletId,
        partyId,
        recoveryShare,
      });

      // Step 4: Build URL for passkey setup page (only session ID, no sensitive data!)
      const baseUrl = window.location.origin;
      const passkeyUrl = `${baseUrl}/passkey-auth?session=${session.sessionId}`;

      // Step 5: Open in external browser
      setPhase('waiting-for-browser');

      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
      } catch {}

      // Use openLink with try_browser option to open in DEFAULT system browser
      // (not Telegram's in-app browser)
      if (window.Telegram?.WebApp?.openLink) {
        // try_browser: true forces opening in the system's default browser
        // Type assertion needed because TS types don't include the options parameter
        (window.Telegram.WebApp.openLink as (url: string, options?: { try_browser?: boolean }) => void)(
          passkeyUrl,
          { try_browser: true }
        );
      } else {
        // Fallback: open in new tab
        window.open(passkeyUrl, '_blank');
      }

    } catch (err) {
      console.error('Failed to start passkey setup:', err);
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
      setPhase('error');
    }
  }, [createWalletWithPasskey, email]);

  // Complete without passkey after browser setup was skipped
  const handleCompleteWithoutPasskey = useCallback(() => {
    if (pkceData) {
      setWalletData({
        walletId: pkceData.walletId,
        partyId: pkceData.partyId,
        recoveryCode: pkceData.recoveryShare,
      });
      setPhase('success');

      // Mark wallet as complete
      completeWalletSetup();
      setTimeout(() => {
        onComplete(true, {
          walletId: pkceData.walletId,
          partyId: pkceData.partyId,
          recoveryCode: pkceData.recoveryShare,
        });
      }, 2000);
    }
  }, [pkceData, completeWalletSetup, onComplete]);

  // Direct passkey setup (for non-Telegram browsers)
  const handleSetupPasskey = useCallback(async () => {
    if (!isSupported) {
      setError('WebAuthn is not supported on this device');
      setPhase('error');
      return;
    }

    try {
      setPhase('creating-wallet');
      setError(null);

      // Step 1: Create wallet
      const result = await createWalletWithPasskey();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create wallet');
      }

      const { walletId, partyId, userShare, recoveryShare } = result.data;

      setPhase('setting-up-passkey');

      // Step 2: Generate a challenge and register passkey with WebAuthn
      const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

      // Register passkey and encrypt the user share in one step
      const { credential, encryptedShare } = await registerPasskeyWithShare(
        walletId,
        challenge,
        userShare,
        email || 'CC Bot User'
      );

      // Step 3: Register passkey with backend
      await api.registerPasskey({
        credentialId: credential.credentialId,
        publicKeySpki: credential.publicKeySpki,
        encryptedShare: encryptedShare.ciphertext,
        nonce: encryptedShare.nonce,
        userShareHex: userShare,
        deviceName: getDeviceName(),
      });

      // Step 4: Store encrypted share locally for quick access
      localStorage.setItem('cc_passkey_credential_id', credential.credentialId);

      setWalletData({ walletId, partyId, recoveryCode: recoveryShare });
      setPhase('success');

      // Trigger haptic feedback
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      } catch {}

      // Mark wallet as complete
      completeWalletSetup();
      setTimeout(() => {
        onComplete(true, { walletId, partyId, recoveryCode: recoveryShare });
      }, 2000);

    } catch (err) {
      console.error('Passkey setup failed:', err);
      setError(err instanceof Error ? err.message : 'Setup failed');
      setPhase('error');

      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      } catch {}
    }
  }, [isSupported, createWalletWithPasskey, completeWalletSetup, email, onComplete]);

  const handleRetry = useCallback(() => {
    setPhase('intro');
    setError(null);
    setPkceData(null);
  }, []);

  return (
    <div className="h-full flex flex-col bg-[#030206] text-[#FFFFFC]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[#FFFFFC]/60 hover:text-[#FFFFFC] transition-colors"
        >
          <span className="text-lg">←</span>
          <span className="text-sm">Back</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
        <AnimatePresence mode="wait">
          {phase === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
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

              <h2 className="text-2xl font-bold mb-3">Secure with Passkey</h2>
              <p className="text-[#FFFFFC]/60 mb-8 max-w-xs mx-auto">
                Use Face ID, Touch ID, or your device PIN to secure your wallet. No password to remember!
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

              {isTelegramWebView && (
                <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-sm text-blue-400">
                    Passkey will open in your browser for secure setup.
                  </p>
                </div>
              )}

              {!isSupported && !isTelegramWebView && (
                <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-sm text-yellow-400">
                    Passkey is not supported on this device.
                  </p>
                </div>
              )}

              {/* In Telegram: Show "Set Up in Browser" button */}
              {isTelegramWebView && (
                <motion.button
                  onClick={handleSetupInBrowser}
                  className="w-full py-4 rounded-2xl font-semibold text-lg mb-3"
                  style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Set Up Passkey in Browser
                </motion.button>
              )}

              {/* Normal browser: Direct passkey setup */}
              {!isTelegramWebView && isSupported && (
                <motion.button
                  onClick={handleSetupPasskey}
                  className="w-full py-4 rounded-2xl font-semibold text-lg mb-3"
                  style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Set Up Passkey
                </motion.button>
              )}

              <p className="text-xs text-[#FFFFFC]/30 mt-3 text-center">
                Passkey is required to create a wallet
              </p>
            </motion.div>
          )}

          {(phase === 'creating-wallet' || phase === 'setting-up-passkey') && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              {/* Loading Animation */}
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
                <span className="material-symbols-outlined text-4xl text-[#875CFF]">
                  {phase === 'creating-wallet' ? 'account_balance_wallet' : 'fingerprint'}
                </span>
              </motion.div>

              <h2 className="text-xl font-bold mb-2">
                {phase === 'creating-wallet' ? 'Creating Wallet...' : 'Setting Up Passkey...'}
              </h2>
              <p className="text-[#FFFFFC]/60 text-sm">
                {phase === 'creating-wallet'
                  ? 'Generating secure keys for your wallet'
                  : 'Complete authentication on your device'
                }
              </p>
            </motion.div>
          )}

          {phase === 'waiting-for-browser' && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              {/* Browser Icon */}
              <motion.div
                className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(135, 92, 255, 0.2), rgba(213, 165, 227, 0.2))' }}
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <span className="material-symbols-outlined text-5xl text-[#875CFF]">open_in_browser</span>
              </motion.div>

              <h2 className="text-xl font-bold mb-2">Complete in Browser</h2>
              <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">
                Complete the passkey setup in your browser, then return here.
              </p>

              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-xs text-green-400">
                    ✅ Wallet created securely
                  </p>
                  <p className="text-xs text-green-400/70 mt-1">
                    🔒 Session secured with PKCE
                  </p>
                </div>

                <p className="text-xs text-[#FFFFFC]/40 text-center mt-2">
                  Complete passkey setup in browser, then return here.
                </p>
              </div>
            </motion.div>
          )}

          {phase === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
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

              <h2 className="text-2xl font-bold mb-2 text-green-400">Wallet Created!</h2>
              <p className="text-[#FFFFFC]/60 mb-4">
                Your wallet is secured with passkey
              </p>

              {walletData && (
                <div className="p-4 rounded-xl bg-[#FFFFFC]/5 border border-[#FFFFFC]/10 text-left">
                  <p className="text-xs text-[#FFFFFC]/40 mb-1">Party ID</p>
                  <p className="text-sm font-mono text-[#FFFFFC]/80 break-all">
                    {walletData.partyId.slice(0, 20)}...
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
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
                className="w-full py-4 rounded-2xl font-semibold"
                style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Try Again
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Unknown Device';
}
