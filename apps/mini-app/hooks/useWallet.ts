'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { storeEncryptedShare, getEncryptedShare, hasStoredShare } from '../crypto/keystore';
import { encryptWithPin, decryptWithPin } from '../crypto/pin';

interface WalletState {
  hasWallet: boolean;
  isLoading: boolean;
  walletId: string | null;
  partyId: string | null;
  publicKey: string | null;
  balance: string;
  error: string | null;
}

export function useWallet(userId: string | null) {
  const [state, setState] = useState<WalletState>({
    hasWallet: false,
    isLoading: true,
    walletId: null,
    partyId: null,
    publicKey: null,
    balance: '0',
    error: null,
  });

  // Use ref to track if component is mounted
  const isMountedRef = useRef(true);
  // Use ref for abort controller to allow cancellation from callbacks
  const abortControllerRef = useRef<AbortController | null>(null);

  const checkWallet = useCallback(async (signal?: AbortSignal) => {
    if (!userId) return;

    try {
      setState((s) => ({ ...s, isLoading: true }));

      // Check if we have a stored share locally
      const hasLocal = await hasStoredShare(userId);
      if (!hasLocal) {
        if (!isMountedRef.current || signal?.aborted) return;
        setState((s) => ({ ...s, hasWallet: false, isLoading: false }));
        return;
      }

      // Fetch wallet info from API
      const wallet = await api.getWallet(signal);

      // Check if aborted before continuing
      if (signal?.aborted || !isMountedRef.current) return;

      // Fetch balance separately
      let balance = '0';
      try {
        const balanceData = await api.getBalance(signal);
        if (!signal?.aborted && isMountedRef.current) {
          balance = balanceData.balance;
        }
      } catch (error) {
        // Ignore abort errors, re-throw others for outer catch
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        // Balance fetch failed, use default
      }

      if (!isMountedRef.current || signal?.aborted) return;

      setState({
        hasWallet: true,
        isLoading: false,
        walletId: wallet.walletId,
        partyId: wallet.partyId,
        publicKey: wallet.publicKey,
        balance,
        error: null,
      });
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      if (!isMountedRef.current) return;

      setState((s) => ({
        ...s,
        hasWallet: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load wallet',
      }));
    }
  }, [userId]);

  const createWallet = useCallback(
    async (pin: string): Promise<{ recoveryShare: string } | null> => {
      if (!userId) return null;

      // Create a new abort controller for this operation
      const controller = new AbortController();

      try {
        setState((s) => ({ ...s, isLoading: true, error: null }));

        // Create wallet via API
        const result = await api.createWallet(pin, controller.signal);

        if (controller.signal.aborted || !isMountedRef.current) return null;

        // Encrypt and store user share locally
        const encrypted = await encryptWithPin(result.userShare, pin);
        await storeEncryptedShare(
          userId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.salt
        );

        if (!isMountedRef.current) return null;

        setState({
          hasWallet: true,
          isLoading: false,
          walletId: result.walletId,
          partyId: result.partyId,
          publicKey: result.publicKey,
          balance: '0',
          error: null,
        });

        return { recoveryShare: result.recoveryShare };
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          return null;
        }

        if (!isMountedRef.current) return null;

        setState((s) => ({
          ...s,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to create wallet',
        }));
        return null;
      }
    },
    [userId]
  );

  const refreshBalance = useCallback(async (signal?: AbortSignal) => {
    try {
      const { balance } = await api.getBalance(signal);
      if (!signal?.aborted && isMountedRef.current) {
        setState((s) => ({ ...s, balance }));
      }
    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Failed to refresh balance:', error);
    }
  }, []);

  const getUserShare = useCallback(
    async (pin: string): Promise<string | null> => {
      if (!userId) return null;

      try {
        const stored = await getEncryptedShare(userId);
        if (!stored) return null;

        return await decryptWithPin(
          stored.encryptedShare,
          stored.iv,
          stored.salt,
          pin
        );
      } catch {
        return null;
      }
    },
    [userId]
  );

  // Initial wallet check effect
  useEffect(() => {
    isMountedRef.current = true;
    abortControllerRef.current = new AbortController();

    checkWallet(abortControllerRef.current.signal);

    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, [checkWallet]);

  // Poll balance every 30 seconds
  useEffect(() => {
    if (!state.hasWallet) return;

    // Create abort controller for polling
    const pollController = new AbortController();

    const interval = setInterval(() => {
      // Only refresh if not aborted
      if (!pollController.signal.aborted) {
        refreshBalance(pollController.signal);
      }
    }, 30000);

    return () => {
      pollController.abort();
      clearInterval(interval);
    };
  }, [state.hasWallet, refreshBalance]);

  return {
    ...state,
    createWallet,
    refreshBalance: () => refreshBalance(),
    getUserShare,
    checkWallet: () => checkWallet(),
  };
}

export default useWallet;
