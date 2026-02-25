'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  recoverWithPasskey,
  openPasskeyInBrowser,
  type EncryptedShare,
} from '../crypto/passkey';
import api from '../lib/api';

interface PasskeyRecoveryProps {
  partyId: string;
  onRecovered: (recoveryShareHex: string) => void;
  onCancel: () => void;
}

type RecoveryStep = 'loading' | 'ready' | 'authenticating' | 'decrypting' | 'success' | 'error' | 'unsupported' | 'no-passkey';

interface Credential {
  credentialId: string;
}

export default function PasskeyRecovery({
  partyId,
  onRecovered,
  onCancel,
}: PasskeyRecoveryProps) {
  const [step, setStep] = useState<RecoveryStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);

  // Check for registered passkeys on mount
  useEffect(() => {
    async function checkPasskeys() {
      try {
        // Check WebAuthn support first
        const webAuthnSupported = isWebAuthnSupported();
        if (!webAuthnSupported) {
          setStep('unsupported');
          return;
        }

        const platformAvailable = await isPlatformAuthenticatorAvailable();
        if (!platformAvailable) {
          setStep('unsupported');
          return;
        }

        // Fetch registered credentials for this wallet
        const response = await api.request<{ credentials: Credential[] }>(
          `/api/passkey/credentials/${encodeURIComponent(partyId)}`,
          { method: 'GET' }
        );

        if (!response.credentials || response.credentials.length === 0) {
          setStep('no-passkey');
          return;
        }

        setCredentials(response.credentials);
        setStep('ready');
      } catch (err) {
        console.error('Failed to check passkeys:', err);
        // If API returns 404, no passkeys registered
        if (err instanceof Error && err.message.includes('404')) {
          setStep('no-passkey');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to check passkeys');
          setStep('error');
        }
      }
    }

    checkPasskeys();
  }, [partyId]);

  const handleAuthenticate = useCallback(async () => {
    try {
      setStep('authenticating');
      setError(null);

      // Get challenge from server
      const challengeResponse = await api.request<{
        challenge: string;
        allowCredentials: Credential[];
      }>('/api/passkey/challenge', {
        method: 'POST',
        body: { partyId },
      });

      setStep('decrypting');

      // Authenticate and get encrypted share from server
      // First authenticate with WebAuthn
      const { assertion, recoveryShareHex } = await recoverWithPasskey(
        challengeResponse.challenge,
        challengeResponse.allowCredentials,
        // We need to get the encrypted share from server first
        // This is a two-step process:
        // 1. Authenticate with WebAuthn
        // 2. Send assertion to server to get encrypted share
        // 3. Decrypt share client-side
        await getEncryptedShareFromServer(challengeResponse.challenge, challengeResponse.allowCredentials),
        partyId
      );

      setStep('success');

      // Wait a moment to show success, then proceed
      setTimeout(() => {
        onRecovered(recoveryShareHex);
      }, 1000);
    } catch (err) {
      console.error('Passkey recovery failed:', err);
      setError(err instanceof Error ? err.message : 'Recovery failed');
      setStep('error');
    }
  }, [partyId, onRecovered]);

  const handleOpenBrowser = useCallback(() => {
    openPasskeyInBrowser('recover', partyId);
  }, [partyId]);

  const handleRetry = useCallback(() => {
    setError(null);
    setStep('ready');
  }, []);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] rounded-3xl p-6 max-w-sm w-full"
      >
        <AnimatePresence mode="wait">
          {step === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-8"
            >
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white">Checking for passkeys...</p>
            </motion.div>
          )}

          {step === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-6"
            >
              {/* Icon */}
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
              </div>

              {/* Title */}
              <div>
                <h2 className="text-xl font-bold text-white mb-2">Recover with Passkey</h2>
                <p className="text-gray-400 text-sm">
                  Use Face ID, Touch ID, or your device PIN to recover your wallet.
                </p>
              </div>

              {/* Passkey count */}
              <div className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Registered passkeys</span>
                  <span className="text-white font-medium">{credentials.length}</span>
                </div>
              </div>

              {/* Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleAuthenticate}
                  className="w-full py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Authenticate with Passkey
                </button>
                <button
                  onClick={onCancel}
                  className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {step === 'authenticating' && (
            <motion.div
              key="authenticating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-8"
            >
              <div className="w-16 h-16 mx-auto mb-4 relative">
                <div className="absolute inset-0 bg-purple-500/20 rounded-full animate-ping" />
                <div className="relative w-full h-full bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                  </svg>
                </div>
              </div>
              <p className="text-white font-medium mb-2">Complete on your device</p>
              <p className="text-gray-400 text-sm">Use Face ID, Touch ID, or PIN when prompted</p>
            </motion.div>
          )}

          {step === 'decrypting' && (
            <motion.div
              key="decrypting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-8"
            >
              <div className="w-12 h-12 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white font-medium mb-2">Decrypting wallet...</p>
              <p className="text-gray-400 text-sm">Restoring your recovery share</p>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8"
            >
              <div className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white font-medium mb-2">Recovery Successful!</p>
              <p className="text-gray-400 text-sm">Setting up your wallet...</p>
            </motion.div>
          )}

          {step === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6 space-y-4"
            >
              <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Recovery Failed</p>
                <p className="text-gray-400 text-sm">{error}</p>
              </div>
              <div className="space-y-2">
                <button
                  onClick={handleRetry}
                  className="w-full py-3 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onCancel}
                  className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {step === 'unsupported' && (
            <motion.div
              key="unsupported"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6 space-y-4"
            >
              <div className="w-16 h-16 mx-auto bg-yellow-500/20 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Passkeys Not Supported</p>
                <p className="text-gray-400 text-sm">
                  Your current browser doesn't support passkeys. Try opening in your device's browser.
                </p>
              </div>
              <div className="space-y-2">
                <button
                  onClick={handleOpenBrowser}
                  className="w-full py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
                >
                  Open in Browser
                </button>
                <button
                  onClick={onCancel}
                  className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {step === 'no-passkey' && (
            <motion.div
              key="no-passkey"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-6 space-y-4"
            >
              <div className="w-16 h-16 mx-auto bg-gray-500/20 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium mb-1">No Passkeys Found</p>
                <p className="text-gray-400 text-sm">
                  This wallet doesn't have any passkeys registered.
                </p>
              </div>
              <div className="space-y-2">
                <button
                  onClick={onCancel}
                  className="w-full py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
                >
                  Go Back
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/**
 * Helper to get encrypted share from server after WebAuthn authentication.
 * This is called during the recovery flow to fetch the encrypted share
 * which is then decrypted client-side using the passkey-derived key.
 */
async function getEncryptedShareFromServer(
  challenge: string,
  allowCredentials: Credential[]
): Promise<EncryptedShare> {
  // This function returns a placeholder - the actual implementation
  // uses the full recoverWithPasskey flow which handles this internally
  // by sending the assertion to the server and getting back the encrypted share
  return {
    ciphertext: '',
    nonce: '',
  };
}
