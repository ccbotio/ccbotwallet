'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  registerPasskeyWithShare,
  openPasskeyInBrowser,
} from '../crypto/passkey';
import api from '../lib/api';

interface PasskeySetupProps {
  walletId: string;
  partyId: string;
  recoveryShareHex: string;
  userShareHex: string;
  onComplete: (success: boolean) => void;
  onSkip: () => void;
}

type SetupStep = 'intro' | 'checking' | 'registering' | 'success' | 'error' | 'unsupported';

export default function PasskeySetup({
  walletId,
  partyId,
  recoveryShareHex,
  userShareHex,
  onComplete,
  onSkip,
}: PasskeySetupProps) {
  const [step, setStep] = useState<SetupStep>('intro');
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string>('');

  const checkSupport = useCallback(async () => {
    setStep('checking');

    const webAuthnSupported = isWebAuthnSupported();
    if (!webAuthnSupported) {
      setStep('unsupported');
      return false;
    }

    const platformAvailable = await isPlatformAuthenticatorAvailable();
    if (!platformAvailable) {
      setStep('unsupported');
      return false;
    }

    return true;
  }, []);

  const handleRegister = useCallback(async () => {
    try {
      const supported = await checkSupport();
      if (!supported) return;

      setStep('registering');
      setError(null);

      // Get challenge from server
      const challengeResponse = await api.request<{ challenge: string }>('/api/passkey/challenge', {
        method: 'POST',
        body: { partyId },
      });

      // Register passkey and encrypt recovery share
      const { credential, encryptedShare } = await registerPasskeyWithShare(
        walletId,
        challengeResponse.challenge,
        recoveryShareHex,
        deviceName || getDeviceName()
      );

      // Send to server
      await api.request('/api/passkey/register', {
        method: 'POST',
        body: {
          credentialId: credential.credentialId,
          publicKeySpki: credential.publicKeySpki,
          encryptedShare: encryptedShare.ciphertext,
          nonce: encryptedShare.nonce,
          userShareHex,
          deviceName: deviceName || getDeviceName(),
        },
      });

      setStep('success');
      setTimeout(() => onComplete(true), 1500);
    } catch (err) {
      console.error('Passkey registration failed:', err);
      setError(err instanceof Error ? err.message : 'Registration failed');
      setStep('error');
    }
  }, [walletId, partyId, recoveryShareHex, userShareHex, deviceName, checkSupport, onComplete]);

  const handleOpenBrowser = useCallback(() => {
    openPasskeyInBrowser('register', partyId);
    // Don't auto-complete, user will return via deep link
  }, [partyId]);

  const handleRetry = useCallback(() => {
    setError(null);
    setStep('intro');
  }, []);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] rounded-3xl p-6 max-w-sm w-full"
      >
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-6"
            >
              {/* Icon */}
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>

              {/* Title */}
              <div>
                <h2 className="text-xl font-bold text-white mb-2">Secure Your Wallet</h2>
                <p className="text-gray-400 text-sm">
                  Set up a passkey to recover your wallet using Face ID, Touch ID, or your device PIN.
                </p>
              </div>

              {/* Benefits */}
              <div className="space-y-3 text-left">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">No seed phrase to remember</p>
                    <p className="text-gray-500 text-xs">Your passkey syncs via iCloud or Google</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Phishing resistant</p>
                    <p className="text-gray-500 text-xs">Passkeys are bound to this app only</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Recover on any device</p>
                    <p className="text-gray-500 text-xs">Use the same passkey on iPhone, iPad, or Mac</p>
                  </div>
                </div>
              </div>

              {/* Device name input */}
              <div>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder={getDeviceName()}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500"
                />
                <p className="text-gray-500 text-xs mt-1">Device name (optional)</p>
              </div>

              {/* Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleRegister}
                  className="w-full py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity"
                >
                  Set Up Passkey
                </button>
                <button
                  onClick={onSkip}
                  className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
                >
                  Skip for now (use recovery code)
                </button>
              </div>
            </motion.div>
          )}

          {step === 'checking' && (
            <motion.div
              key="checking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-8"
            >
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white">Checking device support...</p>
            </motion.div>
          )}

          {step === 'registering' && (
            <motion.div
              key="registering"
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
              <p className="text-white font-medium mb-2">Passkey Created!</p>
              <p className="text-gray-400 text-sm">You can now recover your wallet with biometrics</p>
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
                <p className="text-white font-medium mb-1">Registration Failed</p>
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
                  onClick={onSkip}
                  className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
                >
                  Skip for now
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
                  onClick={onSkip}
                  className="w-full py-3 text-gray-400 text-sm hover:text-white transition-colors"
                >
                  Skip and use recovery code
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown Device';

  const ua = navigator.userAgent;

  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';

  return 'Unknown Device';
}
