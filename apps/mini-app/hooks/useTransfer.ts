'use client';

import { useState, useCallback } from 'react';
import api from '../lib/api';

interface TransferState {
  isLoading: boolean;
  error: string | null;
  lastTxHash: string | null;
}

interface TransferHistory {
  id: string;
  type: 'send' | 'receive' | 'swap';
  amount: string;
  token?: string;
  counterparty: string | null;
  timestamp: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string | null;
}

export function useTransfer() {
  const [state, setState] = useState<TransferState>({
    isLoading: false,
    error: null,
    lastTxHash: null,
  });

  const [history, setHistory] = useState<TransferHistory[]>([]);

  const sendTransfer = useCallback(
    async (
      toParty: string,
      amount: string,
      userShare: string
    ): Promise<boolean> => {
      try {
        setState({ isLoading: true, error: null, lastTxHash: null });

        const result = await api.sendTransfer(toParty, amount, userShare);

        setState({
          isLoading: false,
          error: null,
          lastTxHash: result.txHash,
        });

        return true;
      } catch (error) {
        setState({
          isLoading: false,
          error: error instanceof Error ? error.message : 'Transfer failed',
          lastTxHash: null,
        });
        return false;
      }
    },
    []
  );

  const loadHistory = useCallback(async (limit = 20) => {
    try {
      const transfers = await api.getTransferHistory(limit);
      setHistory(transfers);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    history,
    sendTransfer,
    loadHistory,
    clearError,
  };
}

export default useTransfer;
