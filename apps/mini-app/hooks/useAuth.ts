'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';

interface User {
  id: string;
  telegramId: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    error: null,
  });

  // Use ref to track if component is mounted
  const isMountedRef = useRef(true);

  const authenticate = useCallback(async (signal?: AbortSignal) => {
    try {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      // Get Telegram initData
      const tg = window.Telegram?.WebApp;
      if (!tg) {
        // Development mode - use mock data
        if (process.env.NODE_ENV === 'development') {
          if (!isMountedRef.current || signal?.aborted) return;
          setState({
            isAuthenticated: true,
            isLoading: false,
            user: { id: 'dev-user', telegramId: '555666777' },
            error: null,
          });
          return;
        }
        throw new Error('Telegram WebApp not available');
      }

      const initData = tg.initData;
      if (!initData) {
        throw new Error('No initData available');
      }

      const result = await api.authenticate(initData, signal);

      // Check if request was aborted or component unmounted
      if (signal?.aborted || !isMountedRef.current) return;

      api.setTokens(result.token, result.refreshToken);

      setState({
        isAuthenticated: true,
        isLoading: false,
        user: result.user,
        error: null,
      });
    } catch (error) {
      // Ignore abort errors - component unmounted
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      if (!isMountedRef.current) return;

      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        error: error instanceof Error ? error.message : 'Authentication failed',
      });
    }
  }, []);

  const logout = useCallback(() => {
    api.clearTokens();
    setState({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      error: null,
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const abortController = new AbortController();

    authenticate(abortController.signal);

    return () => {
      isMountedRef.current = false;
      abortController.abort();
    };
  }, [authenticate]);

  return {
    ...state,
    authenticate: () => authenticate(),
    logout,
  };
}

export default useAuth;
