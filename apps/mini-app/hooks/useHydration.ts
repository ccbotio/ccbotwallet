'use client';

import { useEffect } from 'react';

/**
 * Hook to mark the app as hydrated
 * This removes the loading overlay and shows the content
 * Should be called in the root component of each page
 */
export function useHydration() {
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot && !appRoot.classList.contains('hydrated')) {
      // Small delay to ensure React has finished rendering
      requestAnimationFrame(() => {
        appRoot.classList.add('hydrated');
      });
    }
  }, []);
}

/**
 * Mark app as hydrated immediately
 * Call this in useEffect of your page component
 */
export function markHydrated() {
  const appRoot = document.getElementById('app-root');
  if (appRoot) {
    appRoot.classList.add('hydrated');
  }
}
