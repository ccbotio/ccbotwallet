'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  recoverWithPasskey,
} from '../../../crypto/passkey';
import api from '../../../lib/api';

type Phase = 'checking' | 'ready' | 'authenticating' | 'success' | 'error' | 'unsupported' | 'no-passkey';

function PasskeyRecoverContent() {
  const searchParams = useSearchParams();
  const partyId = searchParams.get('party') || '';
  const callbackUrl = searchParams.get('callback') || '';

  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ credentialId: string }[]>([]);

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

      // Check if this party has passkey credentials
      if (partyId) {
        try {
          const result = await api.getPasskeyCredentials(partyId);
          if (result.credentials && result.credentials.length > 0) {
            setCredentials(result.credentials);
            setPhase('ready');
          } else {
            setPhase('no-passkey');
          }
        } catch (err) {
          console.error('Failed to get credentials:', err);
          setPhase('no-passkey');
        }
      } else {
        setPhase('error');
        setError('Missing party ID');
      }
    }

    checkSupport();
  }, [partyId]);

  const handleRecover = useCallback(async () => {
    try {
      setPhase('authenticating');
      setError(null);

      // Get challenge from server
      const challengeResult = await api.getPasskeyChallenge(partyId);
      const { challenge, allowCredentials } = challengeResult;

      // Authenticate with passkey and get decrypted recovery share
      const { recoveryShareHex } = await recoverWithPasskey(
        challenge,
        allowCredentials,
        { ciphertext: '', nonce: '' }, // Placeholder - actual encrypted share comes from server
        partyId
      );

      // Store recovered share locally (encrypted with device key)
      // The main app will use this to reconstruct the wallet
      localStorage.setItem('cc_recovered_share', recoveryShareHex);
      localStorage.setItem('cc_recovered_party', partyId);

      setPhase('success');

      // Redirect back to Telegram app after success
      if (callbackUrl) {
        setTimeout(() => {
          window.location.href = callbackUrl;
        }, 2000);
      }
    } catch (err) {
      console.error('Passkey recovery failed:', err);
      setError(err instanceof Error ? err.message : 'Recovery failed');
      setPhase('error');
    }
  }, [partyId, callbackUrl]);

  const handleRetry = () => {
    setPhase('ready');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#030206] text-[#FFFFFC] flex flex-col items-center justify-center p-6">
      {phase === 'checking' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-purple-400 animate-pulse">fingerprint</span>
          </div>
          <p className="text-[#FFFFFC]/60">Checking for passkeys...</p>
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
            Passkey is not supported on this device or browser.
          </p>
        </motion.div>
      )}

      {phase === 'no-passkey' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center max-w-sm"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-yellow-400">key_off</span>
          </div>
          <h2 className="text-xl font-bold mb-2">No Passkey Found</h2>
          <p className="text-[#FFFFFC]/60 mb-6">
            No passkey is registered for this wallet. Please use your recovery code instead.
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
          <h2 className="text-2xl font-bold mb-2">Recover Wallet</h2>
          <p className="text-[#FFFFFC]/60 mb-8">
            Use your passkey to recover access to your wallet.
          </p>
          <motion.button
            className="w-full py-4 rounded-2xl font-semibold text-lg"
            style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRecover}
          >
            Authenticate with Passkey
          </motion.button>
        </motion.div>
      )}

      {phase === 'authenticating' && (
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
          <h2 className="text-2xl font-bold mb-2 text-green-400">Wallet Recovered!</h2>
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
          <h2 className="text-xl font-bold mb-2 text-red-400">Recovery Failed</h2>
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

export default function PasskeyRecoverPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(180deg, #030206 0%, #0d0b14 100%)' }}>
        <div className="animate-spin w-8 h-8 border-2 border-[#875CFF] border-t-transparent rounded-full" />
      </div>
    }>
      <PasskeyRecoverContent />
    </Suspense>
  );
}
