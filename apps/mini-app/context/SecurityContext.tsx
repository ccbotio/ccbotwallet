'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import api from '../lib/api';
import { getEncryptedShare, getPinCheck, hasPinSet, PIN_CHECK_VALUE } from '../crypto/keystore';
import { decryptWithPin } from '../crypto/pin';
import {
  useActivityTracker,
  clearLockState,
  shouldBeLocked,
} from '../hooks/useActivityTracker';

// ============================================================================
// Types
// ============================================================================

export interface PendingTransaction {
  recipientPartyId: string;
  recipientUsername?: string;
  amount: string;
}

export interface SecurityState {
  // Lock state
  isLocked: boolean;
  lockTimeout: number; // in seconds
  lastActivityAt: Date | null;

  // Biometric (placeholder for future)
  isBiometricAvailable: boolean;
  isBiometricEnabled: boolean;
  biometricType: 'finger' | 'face' | 'unknown' | null;

  // Transaction auth
  pendingTransaction: PendingTransaction | null;

  // PIN state
  isPinSet: boolean;
  pinAttempts: number;
  isLockedOut: boolean;
  lockoutEndsAt: Date | null;
}

export interface SecurityActions {
  // Lock
  lock(): void;
  unlock(pin: string): Promise<boolean>;
  resetActivityTimer(): void;
  setLockTimeout(seconds: number): Promise<void>;

  // Biometric (placeholder)
  enableBiometric(): Promise<boolean>;
  disableBiometric(): Promise<void>;
  authenticateWithBiometric(): Promise<boolean>;

  // Transaction
  setPendingTransaction(tx: PendingTransaction | null): void;
  confirmTransaction(
    pin: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }>;

  // PIN
  verifyPin(pin: string): Promise<boolean>;
  changePin(currentPin: string, newPin: string): Promise<boolean>;

  // Session
  sendHeartbeat(): Promise<void>;
}

export interface SecurityContextType extends SecurityState, SecurityActions {}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LOCK_TIMEOUT_SECONDS = 5 * 60; // 5 minutes
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1 minute

// Storage keys
const LOCKOUT_KEY = 'cc_wallet_lockout';
const PIN_ATTEMPTS_KEY = 'cc_wallet_pin_attempts';
const LOCK_TIMEOUT_KEY = 'cc_wallet_lock_timeout';

// ============================================================================
// Helper Functions
// ============================================================================

function getTelegramUserId(): string {
  if (typeof window !== 'undefined') {
    return (
      window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString() || 'dev-user'
    );
  }
  return 'dev-user';
}

function getStoredLockTimeout(): number {
  if (typeof window === 'undefined') return DEFAULT_LOCK_TIMEOUT_SECONDS;
  try {
    const stored = localStorage.getItem(LOCK_TIMEOUT_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_LOCK_TIMEOUT_SECONDS;
}

function getStoredLockout(): { attempts: number; endsAt: Date | null } {
  if (typeof window === 'undefined') return { attempts: 0, endsAt: null };
  try {
    const lockoutStr = sessionStorage.getItem(LOCKOUT_KEY);
    const attemptsStr = sessionStorage.getItem(PIN_ATTEMPTS_KEY);

    const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

    if (lockoutStr) {
      const endTime = parseInt(lockoutStr, 10);
      if (Date.now() < endTime) {
        return { attempts, endsAt: new Date(endTime) };
      } else {
        // Lockout expired, clear it
        sessionStorage.removeItem(LOCKOUT_KEY);
        sessionStorage.removeItem(PIN_ATTEMPTS_KEY);
        return { attempts: 0, endsAt: null };
      }
    }

    return { attempts, endsAt: null };
  } catch {
    return { attempts: 0, endsAt: null };
  }
}

// ============================================================================
// Context
// ============================================================================

const SecurityContext = createContext<SecurityContextType | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface SecurityProviderProps {
  children: ReactNode;
  telegramUserId?: string;
  enabled?: boolean;
}

export function SecurityProvider({
  children,
  telegramUserId,
  enabled = true,
}: SecurityProviderProps) {
  // Resolve user ID
  const userId = telegramUserId || getTelegramUserId();

  // Refs for cleanup
  const isMountedRef = useRef(true);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ========== Lock State ==========
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return shouldBeLocked(getStoredLockTimeout() * 1000);
    }
    return true;
  });

  const [lockTimeout, setLockTimeoutState] = useState<number>(getStoredLockTimeout);
  const [lastActivityAt, setLastActivityAt] = useState<Date | null>(null);

  // ========== Biometric State (Placeholder) ==========
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<'finger' | 'face' | 'unknown' | null>(null);

  // ========== PIN State ==========
  const [isPinSet, setIsPinSet] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(() => getStoredLockout().attempts);
  const [lockoutEndsAt, setLockoutEndsAt] = useState<Date | null>(
    () => getStoredLockout().endsAt
  );

  // ========== Transaction State ==========
  const [pendingTransaction, setPendingTransactionState] = useState<PendingTransaction | null>(
    null
  );

  // ========== Computed State ==========
  const isLockedOut = lockoutEndsAt !== null && lockoutEndsAt > new Date();

  // ========== Activity Tracker Integration ==========
  const handleAutoLock = useCallback(() => {
    if (isMountedRef.current && isPinSet) {
      setIsLocked(true);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
      } catch {
        // Ignore haptic errors
      }
    }
  }, [isPinSet]);

  const { resetTimer, lastActivityAt: trackerLastActivity } = useActivityTracker({
    onLock: handleAutoLock,
    lockTimeoutMs: lockTimeout * 1000,
    enabled: enabled && !isLocked && isPinSet,
  });

  // Sync lastActivityAt from tracker
  useEffect(() => {
    if (trackerLastActivity) {
      setLastActivityAt(new Date(trackerLastActivity));
    }
  }, [trackerLastActivity]);

  // ========== Initialize Biometric Detection ==========
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const tg = window.Telegram?.WebApp;
    if (tg?.BiometricManager) {
      const biometric = tg.BiometricManager;

      // Initialize biometric manager
      biometric.init(() => {
        if (isMountedRef.current) {
          setIsBiometricAvailable(biometric.isBiometricAvailable);
          setBiometricType(
            biometric.isBiometricAvailable ? biometric.biometricType : null
          );
          setIsBiometricEnabled(biometric.isAccessGranted);
        }
      });
    }
  }, []);

  // ========== Check PIN Status on Mount ==========
  useEffect(() => {
    async function checkPinStatus() {
      try {
        const hasPin = await hasPinSet(userId);
        if (isMountedRef.current) {
          setIsPinSet(hasPin);
          // If no PIN is set, we shouldn't lock
          if (!hasPin) {
            setIsLocked(false);
          }
        }
      } catch (error) {
        console.error('[SecurityContext] Failed to check PIN status:', error);
        if (isMountedRef.current) {
          setIsLocked(false);
        }
      }
    }
    checkPinStatus();
  }, [userId]);

  // ========== Lockout Timer ==========
  useEffect(() => {
    if (!lockoutEndsAt) return;

    const checkLockout = () => {
      if (lockoutEndsAt <= new Date()) {
        setLockoutEndsAt(null);
        setPinAttempts(0);
        try {
          sessionStorage.removeItem(LOCKOUT_KEY);
          sessionStorage.removeItem(PIN_ATTEMPTS_KEY);
        } catch {
          // Ignore storage errors
        }
      }
    };

    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
  }, [lockoutEndsAt]);

  // ========== Heartbeat ==========
  useEffect(() => {
    if (!enabled || isLocked) {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    // Start heartbeat
    const sendBeat = async () => {
      try {
        await api.sendHeartbeat();
      } catch (error) {
        console.warn('[SecurityContext] Heartbeat failed:', error);
      }
    };

    // Send initial heartbeat
    sendBeat();

    // Set up interval
    heartbeatIntervalRef.current = setInterval(sendBeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [enabled, isLocked]);

  // ========== Cleanup ==========
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, []);

  // ========== Actions ==========

  const lock = useCallback(() => {
    setIsLocked(true);
    try {
      sessionStorage.setItem('cc_wallet_lock_state', 'locked');
    } catch {
      // Ignore storage errors
    }
  }, []);

  const unlock = useCallback(
    async (pin: string): Promise<boolean> => {
      // Check lockout
      if (isLockedOut) {
        return false;
      }

      try {
        // Get stored PIN check
        const stored = await getPinCheck(userId);
        if (!stored) {
          // No PIN set - should not happen, but allow unlock
          setIsLocked(false);
          clearLockState();
          resetTimer();
          return true;
        }

        // Verify PIN
        const decrypted = await decryptWithPin(
          stored.encryptedCheck,
          stored.iv,
          stored.salt,
          pin
        );

        if (decrypted === PIN_CHECK_VALUE) {
          // Success
          setIsLocked(false);
          setPinAttempts(0);
          clearLockState();
          resetTimer();

          // Clear stored attempts
          try {
            sessionStorage.removeItem(PIN_ATTEMPTS_KEY);
            sessionStorage.removeItem(LOCKOUT_KEY);
          } catch {
            // Ignore
          }

          try {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
          } catch {
            // Ignore
          }

          return true;
        } else {
          throw new Error('Invalid PIN');
        }
      } catch {
        // Failed verification
        const newAttempts = pinAttempts + 1;
        setPinAttempts(newAttempts);

        try {
          sessionStorage.setItem(PIN_ATTEMPTS_KEY, newAttempts.toString());
        } catch {
          // Ignore
        }

        if (newAttempts >= MAX_PIN_ATTEMPTS) {
          // Set lockout
          const lockoutEnd = new Date(Date.now() + LOCKOUT_DURATION_MS);
          setLockoutEndsAt(lockoutEnd);

          try {
            sessionStorage.setItem(LOCKOUT_KEY, lockoutEnd.getTime().toString());
          } catch {
            // Ignore
          }
        }

        try {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
        } catch {
          // Ignore
        }

        return false;
      }
    },
    [userId, isLockedOut, pinAttempts, resetTimer]
  );

  const resetActivityTimer = useCallback(() => {
    resetTimer();
    setLastActivityAt(new Date());
  }, [resetTimer]);

  const setLockTimeoutAction = useCallback(async (seconds: number) => {
    setLockTimeoutState(seconds);

    // Persist to localStorage
    try {
      localStorage.setItem(LOCK_TIMEOUT_KEY, seconds.toString());
    } catch {
      // Ignore
    }

    // Update backend setting
    try {
      await api.updateSessionSettings(seconds);
    } catch (error) {
      console.warn('[SecurityContext] Failed to update lock timeout on server:', error);
    }
  }, []);

  // ========== Biometric Actions (Placeholder) ==========

  const enableBiometric = useCallback(async (): Promise<boolean> => {
    // Placeholder implementation
    // In the future, this would request biometric access from Telegram
    if (typeof window === 'undefined') return false;

    const tg = window.Telegram?.WebApp;
    if (!tg?.BiometricManager?.isBiometricAvailable) {
      return false;
    }

    return new Promise((resolve) => {
      tg.BiometricManager.requestAccess(
        { reason: 'Enable biometric authentication for quick unlock' },
        (granted) => {
          if (isMountedRef.current) {
            setIsBiometricEnabled(granted);
          }
          resolve(granted);
        }
      );
    });
  }, []);

  const disableBiometric = useCallback(async () => {
    // Placeholder - just update state
    setIsBiometricEnabled(false);
  }, []);

  const authenticateWithBiometric = useCallback(async (): Promise<boolean> => {
    // Placeholder implementation - always returns false for now
    if (!isBiometricEnabled) return false;

    const tg = window.Telegram?.WebApp;
    if (!tg?.BiometricManager?.isBiometricAvailable) {
      return false;
    }

    return new Promise((resolve) => {
      tg.BiometricManager.authenticate(
        { reason: 'Authenticate to unlock wallet' },
        (success) => {
          resolve(success);
        }
      );
    });
  }, [isBiometricEnabled]);

  // ========== Transaction Actions ==========

  const setPendingTransaction = useCallback((tx: PendingTransaction | null) => {
    setPendingTransactionState(tx);
  }, []);

  const confirmTransaction = useCallback(
    async (
      pin: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      if (!pendingTransaction) {
        return { success: false, error: 'No pending transaction' };
      }

      try {
        // Get user share from local storage and decrypt
        const stored = await getEncryptedShare(userId);
        if (!stored) {
          return { success: false, error: 'Wallet key not found' };
        }

        const userShare = await decryptWithPin(
          stored.encryptedShare,
          stored.iv,
          stored.salt,
          pin
        );

        // Send transfer
        const result = await api.sendTransfer(
          pendingTransaction.recipientPartyId,
          pendingTransaction.amount,
          userShare
        );

        // Clear pending transaction on success
        setPendingTransactionState(null);

        try {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
        } catch {
          // Ignore
        }

        return { success: true, txHash: result.txHash };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Transaction failed';

        try {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
        } catch {
          // Ignore
        }

        return { success: false, error: errorMessage };
      }
    },
    [userId, pendingTransaction]
  );

  // ========== PIN Actions ==========

  const verifyPin = useCallback(
    async (pin: string): Promise<boolean> => {
      try {
        const stored = await getEncryptedShare(userId);
        if (!stored) return false;

        await decryptWithPin(stored.encryptedShare, stored.iv, stored.salt, pin);
        return true;
      } catch {
        return false;
      }
    },
    [userId]
  );

  const changePin = useCallback(
    async (currentPin: string, newPin: string): Promise<boolean> => {
      try {
        // Verify current PIN first
        const isValid = await verifyPin(currentPin);
        if (!isValid) {
          return false;
        }

        // Get and decrypt user share with current PIN
        const stored = await getEncryptedShare(userId);
        if (!stored) {
          return false;
        }

        const userShare = await decryptWithPin(
          stored.encryptedShare,
          stored.iv,
          stored.salt,
          currentPin
        );

        // Re-encrypt with new PIN
        const { encryptWithPin } = await import('../crypto/pin');
        const { storeEncryptedShare, storePinCheck } = await import(
          '../crypto/keystore'
        );

        // Store re-encrypted share
        const encrypted = await encryptWithPin(userShare, newPin);
        await storeEncryptedShare(
          userId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.salt
        );

        // Store new PIN check
        const pinCheckEncrypted = await encryptWithPin(PIN_CHECK_VALUE, newPin);
        await storePinCheck(
          userId,
          pinCheckEncrypted.ciphertext,
          pinCheckEncrypted.iv,
          pinCheckEncrypted.salt
        );

        // Log audit event to backend
        try {
          await api.logPinChangeAudit('success');
        } catch (auditError) {
          console.warn('[SecurityContext] Failed to log PIN change audit:', auditError);
        }

        return true;
      } catch (error) {
        console.error('[SecurityContext] PIN change failed:', error);

        // Log failed audit event
        try {
          await api.logPinChangeAudit(
            'failed',
            error instanceof Error ? error.message : 'Unknown error'
          );
        } catch {
          // Ignore audit logging errors
        }

        return false;
      }
    },
    [userId, verifyPin]
  );

  // ========== Session Actions ==========

  const sendHeartbeat = useCallback(async () => {
    try {
      await api.sendHeartbeat();
    } catch (error) {
      console.warn('[SecurityContext] Heartbeat failed:', error);
    }
  }, []);

  // ========== Context Value ==========

  const contextValue: SecurityContextType = {
    // State
    isLocked,
    lockTimeout,
    lastActivityAt,
    isBiometricAvailable,
    isBiometricEnabled,
    biometricType,
    pendingTransaction,
    isPinSet,
    pinAttempts,
    isLockedOut,
    lockoutEndsAt,

    // Actions
    lock,
    unlock,
    resetActivityTimer,
    setLockTimeout: setLockTimeoutAction,
    enableBiometric,
    disableBiometric,
    authenticateWithBiometric,
    setPendingTransaction,
    confirmTransaction,
    verifyPin,
    changePin,
    sendHeartbeat,
  };

  return (
    <SecurityContext.Provider value={contextValue}>
      {children}
    </SecurityContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useSecurity(): SecurityContextType {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error('useSecurity must be used within SecurityProvider');
  }
  return context;
}

// ============================================================================
// Export Default
// ============================================================================

export default SecurityContext;
