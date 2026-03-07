'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import api from '../lib/api';
import { storeEncryptedShare, getEncryptedShare, hasStoredShare } from '../crypto/keystore';
import { encryptWithPin, decryptWithPin } from '../crypto/pin';

interface User {
  id: string;
  telegramId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

interface WalletData {
  walletId: string;
  partyId: string;
  publicKey: string;
  balance: string;  // CC balance (backwards compat)
  locked: string;   // CC locked (backwards compat)
}

// Multi-token balance item
interface TokenBalance {
  amount: string;
  locked: string;
}

interface Transaction {
  id: string;
  txHash?: string | null;
  type: 'send' | 'receive' | 'swap';
  amount: string;
  token?: string;
  counterparty: string | null;
  timestamp: string;
  status: 'pending' | 'confirmed' | 'failed';
}

interface UtxoStatus {
  utxoCount: number;
  needsMerge: boolean;
  threshold: number;
}

interface PendingTransfer {
  contractId: string;
  sender: string;
  receiver: string;
  amount: string;
  createdAt?: string;
}

interface WalletContextType {
  // Auth
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  isWhitelisted: boolean;
  user: User | null;

  // Wallet
  hasWallet: boolean;
  isWalletLoading: boolean;
  wallet: WalletData | null;

  // Multi-token balances: { CC: { amount, locked }, USDCx: { amount, locked }, ... }
  balances: Record<string, TokenBalance>;

  // Transfer
  isTransferring: boolean;
  transferError: string | null;
  transactions: Transaction[];

  // UTXO
  utxoStatus: UtxoStatus | null;
  isMerging: boolean;

  // Sync
  isSyncing: boolean;

  // Pending Transfers
  pendingTransfers: PendingTransfer[];
  isLoadingPendingTransfers: boolean;
  isAcceptingTransfers: boolean;

  // Recovery
  recoveryCode: string | null;
  userShareHex: string | null;

  // Actions
  createWallet: (pin: string) => Promise<boolean>;
  createWalletWithPasskey: () => Promise<{
    success: boolean;
    data?: {
      walletId: string;
      partyId: string;
      publicKey: string;
      userShare: string;
      recoveryShare: string;
    };
    error?: string;
  }>;
  createWalletWithPasskeyCredential: (
    pin: string,
    credentialId: string,
    publicKeySpki: string
  ) => Promise<{
    success: boolean;
    data?: {
      walletId: string;
      partyId: string;
      publicKey: string;
      userShare: string;
      recoveryShare: string;
    };
    error?: string;
  }>;
  completeWalletSetup: () => void;
  refreshBalance: () => Promise<void>;
  sendTransfer: (toParty: string, amount: string, pin: string, token?: 'CC' | 'USDCx') => Promise<boolean>;
  loadTransactions: () => Promise<void>;
  syncTransactions: () => Promise<{ success: boolean; synced?: number; error?: string }>;
  verifyPin: (pin: string) => Promise<boolean>;
  clearRecoveryCode: () => void;
  checkUtxoStatus: () => Promise<void>;
  mergeUtxos: (pin: string) => Promise<{ success: boolean; mergedCount?: number; error?: string }>;
  loadPendingTransfers: () => Promise<void>;
  acceptPendingTransfers: (pin: string) => Promise<{ success: boolean; accepted?: number; failed?: number; error?: string }>;
  rejectPendingTransfer: (contractId: string, pin: string) => Promise<{ success: boolean; error?: string }>;
  recoverWithCode: (recoveryCode: string, newPin: string) => Promise<{
    success: boolean;
    error?: string;
    newRecoveryCode?: string;
  }>;
}

const WalletContext = createContext<WalletContextType | null>(null);

// Helper to check if error is an AbortError
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function WalletProvider({ children }: { children: ReactNode }) {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isWhitelisted, setIsWhitelisted] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  // Wallet state
  const [hasWallet, setHasWallet] = useState(false);
  const [isWalletLoading, setIsWalletLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletData | null>(null);

  // Multi-token balances
  const [balances, setBalances] = useState<Record<string, TokenBalance>>({});

  // Transfer state
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // UTXO state
  const [utxoStatus, setUtxoStatus] = useState<UtxoStatus | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);

  // Pending transfers state
  const [pendingTransfers, setPendingTransfers] = useState<PendingTransfer[]>([]);
  const [isLoadingPendingTransfers, setIsLoadingPendingTransfers] = useState(false);
  const [isAcceptingTransfers, setIsAcceptingTransfers] = useState(false);

  // Recovery
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [userShareHex, setUserShareHex] = useState<string | null>(null);

  // Refs for cleanup and stale closure prevention
  const isMountedRef = useRef(true);
  const walletRef = useRef<WalletData | null>(null);

  // Keep walletRef in sync with wallet state
  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  // Authenticate on mount
  useEffect(() => {
    const abortController = new AbortController();
    isMountedRef.current = true;

    async function authenticate() {
      try {
        setIsAuthLoading(true);

        // Get Telegram initData
        const tg = window.Telegram?.WebApp;

        // Check if running on localhost (dev mode)
        const isLocalDev = typeof window !== 'undefined' && window.location.hostname === 'localhost';

        if (tg?.initData) {
          const result = await api.authenticate(tg.initData, abortController.signal);

          if (abortController.signal.aborted || !isMountedRef.current) return;

          api.setTokens(result.token, result.refreshToken);
          setIsWhitelisted(result.isWhitelisted);

          const tgUser = tg.initDataUnsafe?.user;
          setUser({
            id: result.user.id,
            telegramId: result.user.telegramId,
            firstName: tgUser?.first_name,
            lastName: tgUser?.last_name,
            username: tgUser?.username,
          });
          setIsAuthenticated(true);
        } else if (isLocalDev) {
          // Dev mode - authenticate with backend using mock data
          console.log('[WalletContext] Dev mode, authenticating...');
          try {
            const mockInitData = 'dev_mode_555666777';
            const result = await api.authenticate(mockInitData, abortController.signal);

            if (abortController.signal.aborted || !isMountedRef.current) return;

            console.log('[WalletContext] Auth result:', result);
            api.setTokens(result.token, result.refreshToken);
            setIsWhitelisted(result.isWhitelisted);
            setUser({
              id: result.user.id,
              telegramId: result.user.telegramId,
              firstName: 'Developer',
            });
            console.log('[WalletContext] User set:', result.user);
          } catch (authError) {
            if (isAbortError(authError)) return;
            if (!isMountedRef.current) return;

            console.error('[WalletContext] Auth failed:', authError);
            // Fallback if backend auth fails - set dev token and user
            api.setTokens('dev-token-555666777');
            setUser({
              id: 'dev-user',
              telegramId: '555666777',
              firstName: 'Developer',
            });
            console.log('[WalletContext] Using fallback user with dev token');
          }
          setIsAuthenticated(true);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        if (!isMountedRef.current) return;
        console.error('Auth failed:', error);
      } finally {
        if (isMountedRef.current) {
          setIsAuthLoading(false);
        }
      }
    }

    authenticate();

    return () => {
      isMountedRef.current = false;
      abortController.abort();
    };
  }, []);

  // Check wallet on auth
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const abortController = new AbortController();
    // Capture user in closure to avoid null check issues
    const currentUser = user;

    async function checkWallet() {
      try {
        setIsWalletLoading(true);

        // Check local storage for key share (PIN-based flow)
        const hasLocal = await hasStoredShare(currentUser.telegramId);

        if (abortController.signal.aborted || !isMountedRef.current) return;

        // Also check if there's a passkey-based wallet by trying to fetch wallet from API
        // This handles the case where user set up passkey in external browser
        let walletData = null;
        try {
          walletData = await api.getWallet(abortController.signal);
        } catch (error) {
          if (isAbortError(error)) return;
          // No wallet exists on backend
        }

        if (abortController.signal.aborted || !isMountedRef.current) return;

        if (!hasLocal && !walletData) {
          // No local share AND no backend wallet - truly new user
          setHasWallet(false);
          setIsWalletLoading(false);
          return;
        }

        if (walletData) {
          // Wallet exists on backend (passkey or PIN flow)
          // Fetch all token balances
          const allBalances = await api.getAllBalances(abortController.signal);

          if (abortController.signal.aborted || !isMountedRef.current) return;

          // Convert array to record and extract CC balance
          const balanceRecord: Record<string, TokenBalance> = {};
          let ccBalance = '0';
          let ccLocked = '0';

          for (const item of allBalances) {
            balanceRecord[item.token] = {
              amount: item.amount,
              locked: item.locked,
            };
            if (item.token === 'CC') {
              ccBalance = item.amount;
              ccLocked = item.locked;
            }
          }

          setBalances(balanceRecord);
          setWallet({
            ...walletData,
            balance: ccBalance,
            locked: ccLocked,
          });
          setHasWallet(true);
        } else {
          // Has local share but no backend wallet (shouldn't happen normally)
          setHasWallet(false);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        if (!isMountedRef.current) return;
        console.error('Wallet check failed:', error);
        setHasWallet(false);
      } finally {
        if (isMountedRef.current) {
          setIsWalletLoading(false);
        }
      }
    }

    checkWallet();

    return () => {
      abortController.abort();
    };
  }, [isAuthenticated, user]);

  // Create wallet
  const createWallet = useCallback(async (pin: string): Promise<boolean> => {
    console.log('[WalletContext] createWallet called, user:', user);
    if (!user) {
      console.error('[WalletContext] No user, cannot create wallet');
      return false;
    }

    const abortController = new AbortController();

    try {
      setIsWalletLoading(true);
      console.log('[WalletContext] Calling API createWallet...');

      let result;
      try {
        // Create wallet via API
        result = await api.createWallet(pin, abortController.signal);
      } catch (apiError) {
        // DEV MODE: If API fails, mock the wallet creation
        if (process.env.NODE_ENV === 'development') {
          console.log('[WalletContext] DEV MODE: Mocking wallet creation...');
          // Generate mock data for local testing
          const mockWalletId = `dev-wallet-${Date.now()}`;
          const mockPartyId = `dev-party-${Date.now()}`;
          const mockPublicKey = '0'.repeat(64);
          const mockUserShare = '1'.repeat(64);
          const mockRecoveryShare = 'DEV-RCVRY-' + Math.random().toString(36).substring(2, 10).toUpperCase();

          result = {
            walletId: mockWalletId,
            partyId: mockPartyId,
            publicKey: mockPublicKey,
            userShare: mockUserShare,
            recoveryShare: mockRecoveryShare,
          };
        } else {
          throw apiError;
        }
      }

      if (abortController.signal.aborted || !isMountedRef.current) return false;

      console.log('[WalletContext] API response:', result);

      // Encrypt and store user share locally
      const encrypted = await encryptWithPin(result.userShare, pin);
      await storeEncryptedShare(
        user.telegramId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.salt
      );

      if (!isMountedRef.current) return false;

      setWallet({
        walletId: result.walletId,
        partyId: result.partyId,
        publicKey: result.publicKey,
        balance: '0',
        locked: '0',
      });
      setHasWallet(true);
      setRecoveryCode(result.recoveryShare);
      setUserShareHex(result.userShare);

      return true;
    } catch (error) {
      if (isAbortError(error)) return false;
      if (!isMountedRef.current) return false;
      console.error('Create wallet failed:', error);
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsWalletLoading(false);
      }
    }
  }, [user]);

  // Create wallet with passkey (no PIN encryption)
  const createWalletWithPasskey = useCallback(async (): Promise<{
    success: boolean;
    data?: {
      walletId: string;
      partyId: string;
      publicKey: string;
      userShare: string;
      recoveryShare: string;
    };
    error?: string;
  }> => {
    console.log('[WalletContext] createWalletWithPasskey called, user:', user);
    if (!user) {
      console.error('[WalletContext] No user, cannot create wallet');
      return { success: false, error: 'User not authenticated' };
    }

    const abortController = new AbortController();

    try {
      setIsWalletLoading(true);
      console.log('[WalletContext] Calling API createWallet for passkey flow...');

      // Create wallet via API (pass empty string as PIN - server will generate keys)
      const result = await api.createWallet('', abortController.signal);

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      console.log('[WalletContext] API response:', result);

      // DON'T set hasWallet here - let the caller decide when setup is complete
      // This allows passkey flow to redirect to browser without marking wallet as complete
      setWallet({
        walletId: result.walletId,
        partyId: result.partyId,
        publicKey: result.publicKey,
        balance: '0',
        locked: '0',
      });
      // Don't set hasWallet(true) yet - this will be done after passkey/skip
      setRecoveryCode(result.recoveryShare);
      setUserShareHex(result.userShare);

      return {
        success: true,
        data: {
          walletId: result.walletId,
          partyId: result.partyId,
          publicKey: result.publicKey,
          userShare: result.userShare,
          recoveryShare: result.recoveryShare,
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, error: 'Operation cancelled' };
      }
      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }
      console.error('Create wallet with passkey failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create wallet',
      };
    } finally {
      if (isMountedRef.current) {
        setIsWalletLoading(false);
      }
    }
  }, [user]);

  // Refresh balance - use ref to avoid stale closure
  // Now fetches ALL token balances (CC, USDCx, etc.)
  const refreshBalance = useCallback(async (signal?: AbortSignal) => {
    // Use ref to get current wallet value, avoiding stale closure
    if (!walletRef.current) return;

    try {
      // Fetch all token balances
      const allBalances = await api.getAllBalances(signal);

      if (signal?.aborted || !isMountedRef.current) return;

      // Convert array to record
      const balanceRecord: Record<string, TokenBalance> = {};
      let ccBalance = '0';
      let ccLocked = '0';

      for (const item of allBalances) {
        balanceRecord[item.token] = {
          amount: item.amount,
          locked: item.locked,
        };
        // Keep CC balance for backwards compat
        if (item.token === 'CC') {
          ccBalance = item.amount;
          ccLocked = item.locked;
        }
      }

      setBalances(balanceRecord);
      setWallet(prev => prev ? { ...prev, balance: ccBalance, locked: ccLocked } : null);
    } catch (error) {
      if (isAbortError(error)) return;
      if (!isMountedRef.current) return;
      console.error('Refresh balance failed:', error);
    }
  }, []);

  // Send transfer
  const sendTransfer = useCallback(async (
    toParty: string,
    amount: string,
    pin: string,
    token: 'CC' | 'USDCx' = 'CC'
  ): Promise<boolean> => {
    if (!user || !walletRef.current) return false;

    const abortController = new AbortController();

    try {
      setIsTransferring(true);
      setTransferError(null);

      // Get user share from local storage and decrypt
      const stored = await getEncryptedShare(user.telegramId);
      if (!stored) {
        if (isMountedRef.current) {
          setTransferError('Wallet key not found');
        }
        return false;
      }

      const userShare = await decryptWithPin(
        stored.encryptedShare,
        stored.iv,
        stored.salt,
        pin
      );

      if (abortController.signal.aborted || !isMountedRef.current) return false;

      // Send transfer
      await api.sendTransfer(toParty, amount, userShare, undefined, token, abortController.signal);

      if (abortController.signal.aborted || !isMountedRef.current) return false;

      // Refresh balance
      await refreshBalance(abortController.signal);

      return true;
    } catch (error) {
      if (isAbortError(error)) return false;
      if (!isMountedRef.current) return false;
      console.error('Transfer failed:', error);
      setTransferError(error instanceof Error ? error.message : 'Transfer failed');
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsTransferring(false);
      }
    }
  }, [user, refreshBalance]);

  // Load transactions
  const loadTransactions = useCallback(async (signal?: AbortSignal) => {
    try {
      const txs = await api.getTransferHistory(20, signal);

      if (signal?.aborted || !isMountedRef.current) return;

      setTransactions(txs);
    } catch (error) {
      if (isAbortError(error)) return;
      if (!isMountedRef.current) return;
      console.error('Load transactions failed:', error);
    }
  }, []);

  // Sync transactions from Canton ledger
  const syncTransactions = useCallback(async (): Promise<{ success: boolean; synced?: number; error?: string }> => {
    const abortController = new AbortController();

    try {
      setIsSyncing(true);
      const result = await api.syncTransactions(abortController.signal);

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      // Reload transactions after sync
      await loadTransactions(abortController.signal);
      return { success: true, synced: result.synced };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, error: 'Operation cancelled' };
      }
      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }
      console.error('Sync transactions failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Sync failed' };
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [loadTransactions]);

  // Verify PIN
  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const stored = await getEncryptedShare(user.telegramId);
      if (!stored) return false;

      await decryptWithPin(stored.encryptedShare, stored.iv, stored.salt, pin);
      return true;
    } catch {
      return false;
    }
  }, [user]);

  // Check UTXO status
  const checkUtxoStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const status = await api.getUtxoStatus(signal);

      if (signal?.aborted || !isMountedRef.current) return;

      setUtxoStatus(status);
    } catch (error) {
      if (isAbortError(error)) return;
      if (!isMountedRef.current) return;
      console.error('Failed to check UTXO status:', error);
    }
  }, []);

  // Merge UTXOs
  const mergeUtxos = useCallback(async (pin: string): Promise<{ success: boolean; mergedCount?: number; error?: string }> => {
    if (!user) return { success: false, error: 'Not authenticated' };

    const abortController = new AbortController();

    try {
      setIsMerging(true);

      // Get user share from local storage and decrypt
      const stored = await getEncryptedShare(user.telegramId);
      if (!stored) {
        return { success: false, error: 'Wallet key not found' };
      }

      const userShare = await decryptWithPin(
        stored.encryptedShare,
        stored.iv,
        stored.salt,
        pin
      );

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      // Call merge API
      const result = await api.mergeUtxos(userShare, abortController.signal);

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      // Refresh UTXO status
      await checkUtxoStatus(abortController.signal);

      return { success: true, mergedCount: result.mergedCount };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, error: 'Operation cancelled' };
      }
      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }
      console.error('Merge failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Merge failed' };
    } finally {
      if (isMountedRef.current) {
        setIsMerging(false);
      }
    }
  }, [user, checkUtxoStatus]);

  // Clear recovery code and user share
  const clearRecoveryCode = useCallback(() => {
    setRecoveryCode(null);
    setUserShareHex(null);
  }, []);

  // Load pending transfers
  const loadPendingTransfers = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoadingPendingTransfers(true);
      const transfers = await api.getPendingTransfers(signal);

      if (signal?.aborted || !isMountedRef.current) return;

      // Ensure we always set an array
      setPendingTransfers(Array.isArray(transfers) ? transfers : []);
    } catch (error) {
      if (isAbortError(error)) return;
      if (!isMountedRef.current) return;
      console.error('Load pending transfers failed:', error);
      // On error, ensure state is empty array not undefined
      setPendingTransfers([]);
    } finally {
      if (isMountedRef.current) {
        setIsLoadingPendingTransfers(false);
      }
    }
  }, []);

  // Accept pending transfers
  const acceptPendingTransfers = useCallback(async (pin: string): Promise<{
    success: boolean;
    accepted?: number;
    failed?: number;
    error?: string;
  }> => {
    if (!user) return { success: false, error: 'Not authenticated' };

    const abortController = new AbortController();

    try {
      setIsAcceptingTransfers(true);

      // Verify PIN locally before proceeding (security UX)
      const stored = await getEncryptedShare(user.telegramId);
      if (!stored) {
        return { success: false, error: 'Wallet key not found' };
      }

      try {
        // This validates PIN is correct by attempting to decrypt
        await decryptWithPin(stored.encryptedShare, stored.iv, stored.salt, pin);
      } catch {
        return { success: false, error: 'Invalid PIN' };
      }

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      // Call accept transfers API (backend derives key server-side)
      const result = await api.acceptPendingTransfers(abortController.signal);

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      // Refresh pending transfers and balance
      await loadPendingTransfers(abortController.signal);
      await refreshBalance(abortController.signal);

      return { success: true, accepted: result.accepted, failed: result.failed };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, error: 'Operation cancelled' };
      }
      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }
      console.error('Accept transfers failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Accept failed' };
    } finally {
      if (isMountedRef.current) {
        setIsAcceptingTransfers(false);
      }
    }
  }, [user, loadPendingTransfers, refreshBalance]);

  // Reject a single pending transfer
  const rejectPendingTransfer = useCallback(async (
    contractId: string,
    pin: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'Not authenticated' };

    try {
      // Verify PIN and get decrypted share
      const stored = await getEncryptedShare(user.telegramId);
      if (!stored) {
        return { success: false, error: 'Wallet key not found' };
      }

      let userShareHex: string;
      try {
        userShareHex = await decryptWithPin(stored.encryptedShare, stored.iv, stored.salt, pin);
      } catch {
        return { success: false, error: 'Invalid PIN' };
      }

      // Call reject API with the decrypted share
      await api.rejectPendingTransfer(contractId, userShareHex);

      // Refresh pending transfers
      await loadPendingTransfers();

      return { success: true };
    } catch (error) {
      console.error('Reject transfer failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Reject failed' };
    }
  }, [user, loadPendingTransfers]);

  // Create wallet with existing passkey credential (new flow: passkey BEFORE wallet)
  const createWalletWithPasskeyCredential = useCallback(async (
    pin: string,
    credentialId: string,
    publicKeySpki: string
  ): Promise<{
    success: boolean;
    data?: {
      walletId: string;
      partyId: string;
      publicKey: string;
      userShare: string;
      recoveryShare: string;
    };
    error?: string;
  }> => {
    console.log('[WalletContext] createWalletWithPasskeyCredential called, user:', user);
    if (!user) {
      console.error('[WalletContext] No user, cannot create wallet');
      return { success: false, error: 'User not authenticated' };
    }

    const abortController = new AbortController();

    try {
      setIsWalletLoading(true);
      console.log('[WalletContext] Calling API createWalletWithPasskeyCredential...');

      let result;
      try {
        // Create wallet via API with passkey credential already in place
        result = await api.createWalletWithPasskeyCredential(
          pin,
          credentialId,
          publicKeySpki,
          abortController.signal
        );
      } catch (apiError) {
        // DEV MODE: If API fails, mock the wallet creation
        if (process.env.NODE_ENV === 'development') {
          console.log('[WalletContext] DEV MODE: Mocking wallet creation with passkey...');
          const mockWalletId = `dev-wallet-${Date.now()}`;
          const mockPartyId = `dev-party-${Date.now()}`;
          const mockPublicKey = '0'.repeat(64);
          const mockUserShare = '1'.repeat(64);
          const mockRecoveryShare = 'DEV-RCVRY-' + Math.random().toString(36).substring(2, 10).toUpperCase();

          result = {
            walletId: mockWalletId,
            partyId: mockPartyId,
            publicKey: mockPublicKey,
            userShare: mockUserShare,
            recoveryShare: mockRecoveryShare,
          };
        } else {
          throw apiError;
        }
      }

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      console.log('[WalletContext] API response:', result);

      // Encrypt and store user share locally with PIN
      const encrypted = await encryptWithPin(result.userShare, pin);
      await storeEncryptedShare(
        user.telegramId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.salt
      );

      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      setWallet({
        walletId: result.walletId,
        partyId: result.partyId,
        publicKey: result.publicKey,
        balance: '0',
        locked: '0',
      });
      setHasWallet(true);
      setRecoveryCode(result.recoveryShare);
      setUserShareHex(result.userShare);

      return {
        success: true,
        data: {
          walletId: result.walletId,
          partyId: result.partyId,
          publicKey: result.publicKey,
          userShare: result.userShare,
          recoveryShare: result.recoveryShare,
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, error: 'Operation cancelled' };
      }
      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }
      console.error('Create wallet with passkey credential failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create wallet',
      };
    } finally {
      if (isMountedRef.current) {
        setIsWalletLoading(false);
      }
    }
  }, [user]);

  // Complete wallet setup (called after passkey setup or skip)
  const completeWalletSetup = useCallback(() => {
    console.log('[WalletContext] completeWalletSetup called');
    setHasWallet(true);
  }, []);

  // Recover wallet with recovery code (share 3 + server share 2)
  const recoverWithCode = useCallback(async (recoveryCodeInput: string, newPin: string): Promise<{
    success: boolean;
    error?: string;
    newRecoveryCode?: string;
  }> => {
    console.log('[WalletContext] recoverWithCode called');
    if (!user) {
      console.error('[WalletContext] No user, cannot recover wallet');
      return { success: false, error: 'User not authenticated' };
    }

    const abortController = new AbortController();

    try {
      setIsWalletLoading(true);

      // Call recovery API with the recovery share (share 3)
      const result = await api.recoverWallet(recoveryCodeInput, abortController.signal);

      if (abortController.signal.aborted || !isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      console.log('[WalletContext] Recovery API response:', result);

      // Encrypt and store new user share locally with new PIN
      const encrypted = await encryptWithPin(result.userShare, newPin);
      await storeEncryptedShare(
        user.telegramId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.salt
      );

      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }

      // Update wallet state
      setWallet({
        walletId: result.walletId,
        partyId: result.partyId,
        publicKey: result.publicKey,
        balance: '0',
        locked: '0',
      });
      setHasWallet(true);
      setRecoveryCode(result.recoveryShare);
      setUserShareHex(result.userShare);

      // Refresh balance
      try {
        const balance = await api.getBalance(abortController.signal);

        if (!abortController.signal.aborted && isMountedRef.current) {
          setWallet(prev => prev ? { ...prev, balance: balance.balance, locked: balance.locked } : null);
        }
      } catch (balanceError) {
        if (!isAbortError(balanceError)) {
          console.warn('[WalletContext] Failed to fetch balance after recovery:', balanceError);
        }
      }

      console.log('[WalletContext] Wallet recovery successful');
      return { success: true, newRecoveryCode: result.recoveryShare };
    } catch (error) {
      if (isAbortError(error)) {
        return { success: false, error: 'Operation cancelled' };
      }
      if (!isMountedRef.current) {
        return { success: false, error: 'Operation cancelled' };
      }
      console.error('[WalletContext] Recovery failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Recovery failed',
      };
    } finally {
      if (isMountedRef.current) {
        setIsWalletLoading(false);
      }
    }
  }, [user]);

  // Poll balance
  useEffect(() => {
    if (!hasWallet) return;

    // Create abort controller for polling
    const pollController = new AbortController();

    const interval = setInterval(() => {
      if (!pollController.signal.aborted && isMountedRef.current) {
        refreshBalance(pollController.signal);
      }
    }, 30000);

    return () => {
      pollController.abort();
      clearInterval(interval);
    };
  }, [hasWallet, refreshBalance]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return (
    <WalletContext.Provider
      value={{
        isAuthenticated,
        isAuthLoading,
        isWhitelisted,
        user,
        hasWallet,
        isWalletLoading,
        wallet,
        balances,
        isTransferring,
        transferError,
        transactions,
        utxoStatus,
        isMerging,
        isSyncing,
        pendingTransfers,
        isLoadingPendingTransfers,
        isAcceptingTransfers,
        recoveryCode,
        userShareHex,
        createWallet,
        createWalletWithPasskey,
        createWalletWithPasskeyCredential,
        completeWalletSetup,
        refreshBalance: () => refreshBalance(),
        sendTransfer,
        loadTransactions: () => loadTransactions(),
        syncTransactions,
        verifyPin,
        clearRecoveryCode,
        checkUtxoStatus: () => checkUtxoStatus(),
        mergeUtxos,
        loadPendingTransfers: () => loadPendingTransfers(),
        acceptPendingTransfers,
        rejectPendingTransfer,
        recoverWithCode,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletContext() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within WalletProvider');
  }
  return context;
}

export default WalletContext;
