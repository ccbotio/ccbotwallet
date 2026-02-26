'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { isWebAuthnSupported, decryptShareWithPasskey, deriveKeyFromPasskey } from '../../crypto/passkey';
import api from '../../lib/api';
import { config } from '../../lib/config';

// Base64 utilities
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const base64Standard = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64Standard);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

type VerifyPhase = 'loading' | 'ready' | 'authenticating' | 'decrypting' | 'success' | 'error' | 'unsupported' | 'expired';

// Loading component for Suspense
function LoadingState() {
  return (
    <div className="h-full flex flex-col bg-[#030206] text-[#FFFFFC] overflow-hidden items-center justify-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#F3FF97]/30 border-t-[#F3FF97] animate-spin" />
      <p className="text-[#FFFFFC]/60">Loading secure session...</p>
    </div>
  );
}

// Main content component
function PasskeyVerifyContent() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<VerifyPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [challengeData, setChallengeData] = useState<{
    challenge: string;
    allowCredentials: Array<{ id: string; type: string }>;
  } | null>(null);

  const sessionId = searchParams.get('session');
  const partyId = searchParams.get('party');

  // Mark app as hydrated
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      requestAnimationFrame(() => appRoot.classList.add('hydrated'));
    }
  }, []);

  // Load challenge data from backend
  useEffect(() => {
    async function loadChallenge() {
      if (!sessionId || !partyId) {
        setError('Missing session or party ID');
        setPhase('error');
        return;
      }

      if (!isWebAuthnSupported()) {
        setPhase('unsupported');
        return;
      }

      try {
        const data = await api.recoveryChallenge(sessionId, partyId);
        setChallengeData(data);
        setPhase('ready');
      } catch (err) {
        console.error('Failed to load challenge:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load session';

        if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('expired')) {
          setError('Session expired. Please return to the app and try again.');
          setPhase('expired');
        } else {
          setError(errorMessage);
          setPhase('error');
        }
      }
    }

    loadChallenge();
  }, [sessionId, partyId]);

  const handleAuthenticate = useCallback(async () => {
    if (!challengeData || !sessionId || !partyId) return;

    setPhase('authenticating');
    setError(null);

    try {
      // Prepare WebAuthn request with PRF extension for key derivation
      const challengeBuffer = base64ToBytes(challengeData.challenge);
      const allowCredentials = challengeData.allowCredentials.map(cred => ({
        id: base64ToBytes(cred.id),
        type: 'public-key' as const,
      }));

      // Do WebAuthn authentication with PRF extension
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBuffer,
          allowCredentials,
          userVerification: 'preferred',
          timeout: 60000,
          rpId: window.location.hostname,
          extensions: {
            // PRF extension for key derivation
            // @ts-ignore - PRF extension not in standard types yet
            prf: {
              eval: {
                first: new TextEncoder().encode('cc-bot-recovery-key'),
              },
            },
          },
        },
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('No credential selected');
      }

      setPhase('decrypting');

      const response = credential.response as AuthenticatorAssertionResponse;

      // Send to backend for verification and get encrypted share
      const verifyResult = await api.recoveryVerifyPasskey({
        sessionId,
        partyId,
        credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
        authenticatorData: bytesToBase64Url(new Uint8Array(response.authenticatorData)),
        clientDataJSON: bytesToBase64Url(new Uint8Array(response.clientDataJSON)),
        signature: bytesToBase64Url(new Uint8Array(response.signature)),
      });

      console.log('[PasskeyVerify] Backend verification successful, decrypting share...');

      // Derive decryption key from passkey
      const passkeyKey = await deriveKeyFromPasskey(credential, partyId);

      // Decrypt the recovery share
      const decryptedShareHex = await decryptShareWithPasskey(
        {
          ciphertext: verifyResult.encryptedShare,
          nonce: verifyResult.nonce,
        },
        passkeyKey
      );

      console.log('[PasskeyVerify] Share decrypted, storing for Telegram polling...');

      // Store decrypted share for Telegram app to retrieve
      await api.recoveryStoreDecrypted(sessionId, decryptedShareHex);

      console.log('[PasskeyVerify] Share stored successfully');

      setPhase('success');

      // Redirect back to Telegram after success
      setTimeout(() => {
        const botUsername = config.botUsername;
        window.location.href = `https://t.me/${botUsername}`;
      }, 2000);

    } catch (err) {
      console.error('Passkey authentication failed:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setPhase('error');
    }
  }, [challengeData, sessionId, partyId]);

  const handleRetry = () => {
    setPhase('ready');
    setError(null);
  };

  return (
    <div className="h-full flex flex-col bg-[#030206] text-[#FFFFFC] overflow-hidden">
      {/* Header */}
      <div className="p-4 pt-6 text-center border-b border-[#FFFFFC]/10">
        <h1 className="text-xl font-bold">CC Bot Wallet</h1>
        <p className="text-sm text-[#FFFFFC]/60">Verify Your Identity</p>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
        {phase === 'loading' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#F3FF97]/30 border-t-[#F3FF97] animate-spin" />
            <p className="text-[#FFFFFC]/60">Loading secure session...</p>
          </motion.div>
        )}

        {phase === 'unsupported' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center bg-[#F3FF97]/20">
              <span className="material-symbols-outlined text-5xl text-[#F3FF97]">warning</span>
            </div>
            <h2 className="text-xl font-bold mb-2 text-[#F3FF97]">Not Supported</h2>
            <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">
              This browser doesn't support passkeys. Please try Safari or Chrome.
            </p>
          </motion.div>
        )}

        {phase === 'expired' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center bg-[#F3FF97]/20">
              <span className="material-symbols-outlined text-5xl text-[#F3FF97]">schedule</span>
            </div>
            <h2 className="text-xl font-bold mb-2 text-[#F3FF97]">Session Expired</h2>
            <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">{error}</p>
          </motion.div>
        )}

        {phase === 'ready' && challengeData && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <motion.div
              className="w-24 h-24 mx-auto mb-6 rounded-full bg-[#F3FF97] flex items-center justify-center"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <span className="material-symbols-outlined text-5xl text-[#030206]">fingerprint</span>
            </motion.div>

            <h2 className="text-2xl font-bold mb-3">Verify Your Identity</h2>
            <p className="text-[#FFFFFC]/60 mb-6 max-w-xs mx-auto">
              Use Face ID, Touch ID, or your device PIN to verify your identity and reset your PIN.
            </p>

            <div className="mb-6 p-3 rounded-lg bg-[#F3FF97]/10 border border-[#F3FF97]/20">
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-sm text-[#F3FF97]">verified_user</span>
                <span className="text-sm text-[#F3FF97]">
                  {challengeData.allowCredentials.length} passkey{challengeData.allowCredentials.length > 1 ? 's' : ''} available
                </span>
              </div>
            </div>

            <motion.button
              onClick={handleAuthenticate}
              className="w-full py-4 rounded-2xl font-semibold text-lg bg-[#F3FF97] text-[#030206]"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Verify with Passkey
            </motion.button>
          </motion.div>
        )}

        {phase === 'authenticating' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 relative">
              <div className="absolute inset-0 bg-[#F3FF97]/20 rounded-full animate-ping" />
              <div className="relative w-full h-full bg-[#F3FF97] rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-4xl text-[#030206]">fingerprint</span>
              </div>
            </div>
            <h2 className="text-xl font-bold mb-2">Authenticating...</h2>
            <p className="text-[#FFFFFC]/60 text-sm">Use Face ID, Touch ID, or PIN when prompted</p>
          </motion.div>
        )}

        {phase === 'decrypting' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="w-12 h-12 border-2 border-[#F3FF97] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Verifying...</h2>
            <p className="text-[#FFFFFC]/60 text-sm">Completing verification</p>
          </motion.div>
        )}

        {phase === 'success' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <motion.div
              className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center bg-green-500/20"
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

            <h2 className="text-2xl font-bold mb-2 text-green-400">Verified!</h2>
            <p className="text-[#FFFFFC]/60 mb-6">Returning to Telegram...</p>

            <motion.button
              onClick={() => {
                const botUsername = config.botUsername;
                window.location.href = `https://t.me/${botUsername}`;
              }}
              className="w-full py-4 rounded-2xl font-semibold text-lg bg-[#F3FF97] text-[#030206]"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Return to Telegram
            </motion.button>
          </motion.div>
        )}

        {phase === 'error' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center bg-red-500/20">
              <span className="material-symbols-outlined text-5xl text-red-400">error</span>
            </div>

            <h2 className="text-xl font-bold mb-2 text-red-400">Verification Failed</h2>
            <p className="text-[#FFFFFC]/60 mb-6 text-sm max-w-xs mx-auto">
              {error || 'Something went wrong. Please try again.'}
            </p>

            <motion.button
              onClick={handleRetry}
              className="w-full py-4 rounded-2xl font-semibold bg-[#F3FF97] text-[#030206]"
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
        <p className="text-xs text-[#FFFFFC]/40">Secured with WebAuthn</p>
      </div>
    </div>
  );
}

export default function PasskeyVerifyPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PasskeyVerifyContent />
    </Suspense>
  );
}
