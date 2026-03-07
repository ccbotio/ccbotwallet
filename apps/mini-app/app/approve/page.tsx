'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import api from '../../lib/api';

/**
 * dApp Approval Page - CIP-103 Canton dApp Standard
 *
 * This page is shown when a dApp requests interaction with the user's wallet.
 * The user can approve or reject the request.
 */

// Session status types
type ApprovalPhase =
  | 'loading'           // Loading session data
  | 'ready'             // Ready for user decision
  | 'requesting_pin'    // Showing PIN modal (for signing methods)
  | 'approving'         // Processing approval
  | 'success'           // Approved, showing redirect
  | 'rejected'          // User rejected
  | 'error'             // Error occurred
  | 'expired';          // Session expired

// Method descriptions for UI
const METHOD_DESCRIPTIONS: Record<string, { title: string; description: string; requiresPin: boolean }> = {
  connect: {
    title: 'Connect Wallet',
    description: 'Allow this app to view your wallet address and balance.',
    requiresPin: false,
  },
  isConnected: {
    title: 'Check Connection',
    description: 'Check if this app is connected to your wallet.',
    requiresPin: false,
  },
  disconnect: {
    title: 'Disconnect',
    description: 'Disconnect this app from your wallet.',
    requiresPin: false,
  },
  status: {
    title: 'Wallet Status',
    description: 'View your wallet connection status.',
    requiresPin: false,
  },
  getActiveNetwork: {
    title: 'Get Network',
    description: 'View the current Canton network.',
    requiresPin: false,
  },
  listAccounts: {
    title: 'List Accounts',
    description: 'View your wallet accounts.',
    requiresPin: false,
  },
  getPrimaryAccount: {
    title: 'Get Account',
    description: 'View your primary wallet account.',
    requiresPin: false,
  },
  signMessage: {
    title: 'Sign Message',
    description: 'Sign a message with your wallet key.',
    requiresPin: true,
  },
  prepareExecute: {
    title: 'Execute Transaction',
    description: 'Execute a transaction on Canton Network.',
    requiresPin: true,
  },
  ledgerApi: {
    title: 'Ledger API',
    description: 'Execute a ledger API operation.',
    requiresPin: true,
  },
};

// Session data interface
interface SessionData {
  sessionId: string;
  method: string;
  params?: unknown;
  dappOrigin: string;
  dappName?: string;
  dappIcon?: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

// Loading component
function LoadingState() {
  return (
    <div className="h-full flex flex-col bg-[#030206] text-[#FFFFFC] items-center justify-center overflow-hidden">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
      <p className="text-[#FFFFFC]/60">Loading request...</p>
    </div>
  );
}

// Main content component
function ApprovalContent() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<ApprovalPhase>('loading');
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // Get session ID from URL
  const sessionId = searchParams.get('session');

  // Mark app as hydrated
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      requestAnimationFrame(() => appRoot.classList.add('hydrated'));
    }
  }, []);

  // Load session data
  useEffect(() => {
    if (!sessionId) {
      setError('Missing session ID');
      setPhase('error');
      return;
    }

    loadSession();
  }, [sessionId]);

  const loadSession = async () => {
    if (!sessionId) return;

    try {
      const response = await api.getDappSession(sessionId);
      if (!response) {
        setError('Session not found or expired');
        setPhase('expired');
        return;
      }
      setSession(response);
      setPhase('ready');
    } catch (err) {
      console.error('Failed to load session:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setPhase('error');
    }
  };

  // Get method info
  const methodInfo = session?.method
    ? METHOD_DESCRIPTIONS[session.method] || {
        title: session.method,
        description: 'Execute this action.',
        requiresPin: false,
      }
    : null;

  // Handle approve
  const handleApprove = useCallback(async () => {
    if (!session) return;

    // Check if PIN is required
    if (methodInfo?.requiresPin && !pin) {
      setPhase('requesting_pin');
      return;
    }

    setPhase('approving');
    setError(null);

    try {
      // Get user share from PIN (if required)
      let userShareHex: string | undefined;
      if (methodInfo?.requiresPin && pin) {
        // TODO: Decrypt user share from IndexedDB using PIN
        // For now, we'll pass it from the request body
        userShareHex = pin; // Placeholder - should be decrypted share
      }

      const result = await api.approveDappSession(session.sessionId, userShareHex);

      if (result.redirectUrl) {
        const redirect = result.redirectUrl;
        setRedirectUrl(redirect);
        setPhase('success');

        // Redirect after short delay
        setTimeout(() => {
          window.location.href = redirect;
        }, 2000);
      } else {
        setPhase('success');
      }
    } catch (err) {
      console.error('Approval failed:', err);
      setError(err instanceof Error ? err.message : 'Approval failed');
      setPhase('error');
    }
  }, [session, methodInfo, pin]);

  // Handle reject
  const handleReject = useCallback(async () => {
    if (!session) return;

    try {
      const result = await api.rejectDappSession(session.sessionId);

      if (result.redirectUrl) {
        const redirect = result.redirectUrl;
        setRedirectUrl(redirect);
        setPhase('rejected');

        // Redirect after short delay
        setTimeout(() => {
          window.location.href = redirect;
        }, 2000);
      } else {
        setPhase('rejected');
      }
    } catch (err) {
      console.error('Rejection failed:', err);
      // Still show rejected state even if API fails
      setPhase('rejected');
    }
  }, [session]);

  // Handle PIN submit
  const handlePinSubmit = useCallback(() => {
    if (pin.length < 6) {
      setError('Please enter your 6-digit PIN');
      return;
    }
    handleApprove();
  }, [pin, handleApprove]);

  // Handle close
  const handleClose = () => {
    window.close();
  };

  // Format message preview for signMessage
  const getMessagePreview = (): string | null => {
    if (session?.method !== 'signMessage' || !session.params) return null;
    const params = session.params as { message?: string };
    if (!params.message) return null;

    const message = params.message;
    return message.length > 200 ? `${message.slice(0, 200)}...` : message;
  };

  return (
    <div className="h-full flex flex-col bg-[#030206] text-[#FFFFFC] overflow-hidden">
      {/* Header */}
      <div className="p-4 pt-6 text-center border-b border-[#FFFFFC]/10">
        <h1 className="text-xl font-bold">CC Bot Wallet</h1>
        <p className="text-sm text-[#FFFFFC]/60">dApp Request</p>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
        {/* Loading */}
        {phase === 'loading' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
            <p className="text-[#FFFFFC]/60">Loading request...</p>
          </motion.div>
        )}

        {/* Ready - Show request details */}
        {phase === 'ready' && session && methodInfo && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-sm"
          >
            {/* dApp Info */}
            <div className="text-center mb-6">
              {session.dappIcon ? (
                <img
                  src={session.dappIcon}
                  alt={session.dappName || 'dApp'}
                  className="w-16 h-16 mx-auto mb-3 rounded-xl"
                />
              ) : (
                <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-[#875CFF]/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-[#875CFF]">apps</span>
                </div>
              )}
              <h2 className="text-lg font-semibold">
                {session.dappName || 'Unknown App'}
              </h2>
              <p className="text-sm text-[#FFFFFC]/60 truncate">
                {session.dappOrigin}
              </p>
            </div>

            {/* Request Info */}
            <div className="bg-[#FFFFFC]/5 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[#875CFF]/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#875CFF]">
                    {methodInfo.requiresPin ? 'edit_square' : 'visibility'}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold">{methodInfo.title}</h3>
                  <p className="text-sm text-[#FFFFFC]/60">{methodInfo.description}</p>
                </div>
              </div>

              {/* Message preview for signMessage */}
              {getMessagePreview() && (
                <div className="mt-3 p-3 bg-[#030206] rounded-xl">
                  <p className="text-xs text-[#FFFFFC]/40 mb-1">Message to sign:</p>
                  <p className="text-sm text-[#FFFFFC]/80 font-mono break-all">
                    {getMessagePreview()}
                  </p>
                </div>
              )}

              {/* PIN warning */}
              {methodInfo.requiresPin && (
                <div className="mt-3 flex items-center gap-2 text-yellow-400/80">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  <p className="text-xs">This action requires your PIN to sign</p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <motion.button
                onClick={handleApprove}
                className="w-full py-4 rounded-2xl font-semibold text-lg"
                style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Approve
              </motion.button>

              <motion.button
                onClick={handleReject}
                className="w-full py-4 rounded-2xl font-semibold text-lg bg-[#FFFFFC]/10 text-[#FFFFFC]/80"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Reject
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* PIN Entry */}
        {phase === 'requesting_pin' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#875CFF]/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-[#875CFF]">lock</span>
              </div>
              <h2 className="text-xl font-bold mb-2">Enter PIN</h2>
              <p className="text-sm text-[#FFFFFC]/60">
                Enter your 6-digit PIN to sign this request
              </p>
            </div>

            {/* PIN Input */}
            <div className="mb-6">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter PIN"
                className="w-full py-4 px-6 rounded-2xl bg-[#FFFFFC]/10 text-center text-2xl tracking-[0.5em] placeholder:text-[#FFFFFC]/30 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#875CFF]/50"
                autoFocus
              />
              {error && (
                <p className="text-red-400 text-sm text-center mt-2">{error}</p>
              )}
            </div>

            <div className="space-y-3">
              <motion.button
                onClick={handlePinSubmit}
                disabled={pin.length < 6}
                className="w-full py-4 rounded-2xl font-semibold text-lg disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Confirm
              </motion.button>

              <motion.button
                onClick={() => {
                  setPin('');
                  setPhase('ready');
                }}
                className="w-full py-4 rounded-2xl font-semibold text-lg bg-[#FFFFFC]/10 text-[#FFFFFC]/80"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Cancel
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Approving */}
        {phase === 'approving' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
            <h2 className="text-lg font-semibold mb-2">Processing...</h2>
            <p className="text-sm text-[#FFFFFC]/60">Please wait</p>
          </motion.div>
        )}

        {/* Success */}
        {phase === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <motion.div
              className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 10 }}
            >
              <span className="material-symbols-outlined text-4xl text-green-400">check_circle</span>
            </motion.div>
            <h2 className="text-xl font-bold text-green-400 mb-2">Approved</h2>
            <p className="text-sm text-[#FFFFFC]/60 mb-4">
              Redirecting back to the app...
            </p>
            {!redirectUrl && (
              <motion.button
                onClick={handleClose}
                className="py-3 px-6 rounded-xl bg-[#FFFFFC]/10 text-sm"
                whileTap={{ scale: 0.98 }}
              >
                Close
              </motion.button>
            )}
          </motion.div>
        )}

        {/* Rejected */}
        {phase === 'rejected' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-red-400">close</span>
            </div>
            <h2 className="text-xl font-bold text-red-400 mb-2">Rejected</h2>
            <p className="text-sm text-[#FFFFFC]/60 mb-4">
              {redirectUrl ? 'Redirecting back to the app...' : 'Request was rejected'}
            </p>
            {!redirectUrl && (
              <motion.button
                onClick={handleClose}
                className="py-3 px-6 rounded-xl bg-[#FFFFFC]/10 text-sm"
                whileTap={{ scale: 0.98 }}
              >
                Close
              </motion.button>
            )}
          </motion.div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-red-400">error</span>
            </div>
            <h2 className="text-xl font-bold text-red-400 mb-2">Error</h2>
            <p className="text-sm text-[#FFFFFC]/60 mb-4 max-w-xs">
              {error || 'Something went wrong'}
            </p>
            <motion.button
              onClick={() => loadSession()}
              className="py-3 px-6 rounded-xl bg-[#875CFF] text-sm mr-2"
              whileTap={{ scale: 0.98 }}
            >
              Try Again
            </motion.button>
            <motion.button
              onClick={handleClose}
              className="py-3 px-6 rounded-xl bg-[#FFFFFC]/10 text-sm"
              whileTap={{ scale: 0.98 }}
            >
              Close
            </motion.button>
          </motion.div>
        )}

        {/* Expired */}
        {phase === 'expired' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-yellow-400">schedule</span>
            </div>
            <h2 className="text-xl font-bold text-yellow-400 mb-2">Session Expired</h2>
            <p className="text-sm text-[#FFFFFC]/60 mb-4">
              This request has expired. Please try again from the app.
            </p>
            <motion.button
              onClick={handleClose}
              className="py-3 px-6 rounded-xl bg-[#FFFFFC]/10 text-sm"
              whileTap={{ scale: 0.98 }}
            >
              Close
            </motion.button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// Main page component with Suspense
export default function ApprovePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ApprovalContent />
    </Suspense>
  );
}
