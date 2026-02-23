'use client';

import { useEffect, useLayoutEffect, useState, useCallback } from 'react';

interface ViewportState {
  height: number;
  stableHeight: number;
  isExpanded: boolean;
  isReady: boolean;
}

/**
 * Professional Telegram Mini App viewport management hook.
 * Handles viewport sizing across all platforms (iOS, Android, Desktop, Web).
 */
export function useTelegramViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    stableHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
    isExpanded: false,
    isReady: false,
  });

  const updateViewport = useCallback(() => {
    const tg = (window as any).Telegram?.WebApp;

    if (tg) {
      const height = tg.viewportHeight || window.innerHeight;
      const stableHeight = tg.viewportStableHeight || height;

      setState({
        height,
        stableHeight,
        isExpanded: tg.isExpanded ?? false,
        isReady: true,
      });

      // Set CSS custom properties
      document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
      document.documentElement.style.setProperty('--tg-viewport-stable-height', `${stableHeight}px`);

      // Also set on body for compatibility
      document.body.style.height = `${height}px`;
      document.body.style.minHeight = `${height}px`;
      document.body.style.maxHeight = `${height}px`;
    } else {
      // Fallback for non-Telegram environment
      const height = window.innerHeight;
      setState({
        height,
        stableHeight: height,
        isExpanded: false,
        isReady: true,
      });

      document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
      document.documentElement.style.setProperty('--tg-viewport-stable-height', `${height}px`);
      document.body.style.height = `${height}px`;
      document.body.style.minHeight = `${height}px`;
      document.body.style.maxHeight = `${height}px`;
    }
  }, []);

  // Use layout effect for synchronous updates
  useLayoutEffect(() => {
    // Initial update
    updateViewport();

    const tg = (window as any).Telegram?.WebApp;

    // Expand to full height
    if (tg?.expand) {
      tg.expand();
    }

    // Enable closing confirmation if available
    if (tg?.enableClosingConfirmation) {
      tg.enableClosingConfirmation();
    }

    // Listen for Telegram viewport changes
    if (tg?.onEvent) {
      tg.onEvent('viewportChanged', updateViewport);
    }

    // Also listen for window resize (for web/desktop)
    window.addEventListener('resize', updateViewport);

    // Periodic check for first few seconds (handles slow SDK initialization)
    let checks = 0;
    const interval = setInterval(() => {
      updateViewport();
      checks++;
      if (checks > 20) {
        clearInterval(interval);
      }
    }, 100);

    return () => {
      if (tg?.offEvent) {
        tg.offEvent('viewportChanged', updateViewport);
      }
      window.removeEventListener('resize', updateViewport);
      clearInterval(interval);
    };
  }, [updateViewport]);

  return state;
}

/**
 * Initialize Telegram viewport on app mount.
 * Call this in your root layout or app component.
 */
export function initTelegramViewport(): void {
  if (typeof window === 'undefined') return;

  const updateViewport = () => {
    const tg = (window as any).Telegram?.WebApp;
    const height = tg?.viewportHeight || window.innerHeight;
    const stableHeight = tg?.viewportStableHeight || height;

    document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--tg-viewport-stable-height', `${stableHeight}px`);

    // Critical: Set body dimensions
    document.body.style.height = `${height}px`;
    document.body.style.minHeight = `${height}px`;
    document.body.style.maxHeight = `${height}px`;
    document.body.style.overflow = 'hidden';
  };

  // Run immediately
  updateViewport();

  // Expand if available
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.expand) {
    tg.expand();
  }

  // Listen for changes
  if (tg?.onEvent) {
    tg.onEvent('viewportChanged', updateViewport);
  }
  window.addEventListener('resize', updateViewport);

  // Periodic updates during initialization
  let count = 0;
  const interval = setInterval(() => {
    updateViewport();
    count++;
    if (count > 30) clearInterval(interval);
  }, 100);
}
