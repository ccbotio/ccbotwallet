'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  registerPasskeyWithShare,
} from '../../../crypto/passkey';
import api from '../../../lib/api';

type Phase = 'checking' | 'ready' | 'registering' | 'success' | 'error' | 'unsupported';

function PasskeyRegisterContent() {
  const searchParams = useSearchParams();
  const partyId = searchParams.get('party') || '';
  const walletId = searchParams.get('walletId') || '';
  const userShareHex = searchParams.get('userShare') || '';
  const callbackUrl = searchParams.get('callback') || '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  // Mark app as hydrated to prevent flash of unstyled content
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      requestAnimationFrame(() => appRoot.classList.add('hydrated'));
    }
  }, []);

  useEffect(() => {
    async function checkSupport() {
      const webAuthn = isWebAuthnSupported();
      if (!webAuthn) {
        setPhase('unsupported');
        return;
      }

      const platform = await isPlatformAuthenticatorAvailable();
      if (!platform) {
        setPhase('unsupported');
        return;
      }

      setIsSupported(true);
      setPhase('ready');
    }

    checkSupport();
  }, []);

  const handleRegister = useCallback(async () => {
    if (!walletId || !userShareHex) {
      setError('Missing wallet data. Please try again from the app.');
      setPhase('error');
      return;
    }

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
        'CC Bot User'
      );

      // Register with backend
      await api.registerPasskey({
        credentialId: credential.credentialId,
        publicKeySpki: credential.publicKeySpki,
        encryptedShare: encryptedShare.ciphertext,
        nonce: encryptedShare.nonce,
        userShareHex,
        deviceName: getDeviceName(),
      });

      // Store credential ID locally
      localStorage.setItem('cc_passkey_credential_id', credential.credentialId);

      setPhase('success');

      // Redirect back to Telegram app after success
      if (callbackUrl) {
        setTimeout(() => {
          window.location.href = callbackUrl;
        }, 2000);
      }
    } catch (err) {
      console.error('Passkey registration failed:', err);
      setError(err instanceof Error ? err.message : 'Registration failed');
      setPhase('error');
    }
  }, [walletId, userShareHex, callbackUrl]);

  const handleRetry = () => {
    setPhase('ready');
    setError(null);
  };

  return (
    <div className="h-full bg-[#030206] text-[#FFFFFC] flex flex-col items-center justify-center p-4 overflow-hidden">
      {phase === 'checking' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-purple-400 animate-pulse">fingerprint</span>
          </div>
          <p className="text-[#FFFFFC]/60">Checking device support...</p>
        </motion.div>
      )}

      {phase === 'unsupported' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center max-w-sm"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-yellow-400">warning</span>
          </div>
          <h2 className="text-xl font-bold mb-2">Not Supported</h2>
          <p className="text-[#FFFFFC]/60 mb-6">
            Passkey is not supported on this device or browser. Please use a device with Face ID, Touch ID, or Windows Hello.
          </p>
        </motion.div>
      )}

      {phase === 'ready' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-purple-400">fingerprint</span>
          </div>
          <h2 className="text-2xl font-bold mb-2">Set Up Passkey</h2>
          <p className="text-[#FFFFFC]/60 mb-8">
            Use Face ID, Touch ID, or your device PIN to secure your wallet.
          </p>
          <motion.button
            className="w-full py-4 rounded-2xl font-semibold text-lg"
            style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRegister}
          >
            Register Passkey
          </motion.button>
        </motion.div>
      )}

      {phase === 'registering' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-purple-500/20 flex items-center justify-center relative">
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-purple-500/30"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{ borderTopColor: '#875CFF' }}
            />
            <span className="material-symbols-outlined text-4xl text-purple-400">fingerprint</span>
          </div>
          <h2 className="text-xl font-bold mb-2">Authenticating...</h2>
          <p className="text-[#FFFFFC]/60">Complete the prompt on your device</p>
        </motion.div>
      )}

      {phase === 'success' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <motion.div
            className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 10 }}
          >
            <span className="material-symbols-outlined text-4xl text-green-400">check_circle</span>
          </motion.div>
          <h2 className="text-2xl font-bold mb-2 text-green-400">Passkey Created!</h2>
          <p className="text-[#FFFFFC]/60">
            {callbackUrl ? 'Returning to CC Bot...' : 'You can close this window.'}
          </p>
        </motion.div>
      )}

      {phase === 'error' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center max-w-sm"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-red-400">error</span>
          </div>
          <h2 className="text-xl font-bold mb-2 text-red-400">Registration Failed</h2>
          <p className="text-[#FFFFFC]/60 mb-6">{error || 'Something went wrong.'}</p>
          <motion.button
            className="w-full py-4 rounded-2xl font-semibold"
            style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRetry}
          >
            Try Again
          </motion.button>
        </motion.div>
      )}
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

export default function PasskeyRegisterPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center" style={{ background: 'linear-gradient(180deg, #030206 0%, #0d0b14 100%)' }}>
        <div className="animate-spin w-8 h-8 border-2 border-[#875CFF] border-t-transparent rounded-full" />
      </div>
    }>
      <PasskeyRegisterContent />
    </Suspense>
  );
}
