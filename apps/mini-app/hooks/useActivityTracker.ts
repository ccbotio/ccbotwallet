'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Auto-Lock Activity Tracker Hook
 *
 * Tracks user activity (touch, scroll, keypress, mouse move) and triggers
 * a lock callback after a period of inactivity.
 *
 * @param onLock - Callback function to be called when the lock timeout expires
 * @param lockTimeoutMs - Timeout in milliseconds before locking (default: 5 minutes)
 * @param enabled - Whether the activity tracking is enabled (default: true)
 * @returns Object with resetTimer function and lastActivityAt timestamp
 */

interface UseActivityTrackerOptions {
  onLock: () => void;
  lockTimeoutMs?: number;
  enabled?: boolean;
}

interface UseActivityTrackerReturn {
  resetTimer: () => void;
  lastActivityAt: number;
}

const DEFAULT_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

// Storage key for persisting lock state
const LOCK_STATE_KEY = 'cc_wallet_lock_state';
const LAST_ACTIVITY_KEY = 'cc_wallet_last_activity';

export function useActivityTracker({
  onLock,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT,
  enabled = true,
}: UseActivityTrackerOptions): UseActivityTrackerReturn {
  const [lastActivityAt, setLastActivityAt] = useState<number>(() => Date.now());

  // Use refs to avoid stale closures in event handlers
  const onLockRef = useRef(onLock);
  const lockTimeoutRef = useRef(lockTimeoutMs);
  const enabledRef = useRef(enabled);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Update refs when props change
  useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  useEffect(() => {
    lockTimeoutRef.current = lockTimeoutMs;
  }, [lockTimeoutMs]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Clear existing timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Start the inactivity timer
  const startTimer = useCallback(() => {
    clearTimer();

    if (!enabledRef.current) return;

    timerRef.current = setTimeout(() => {
      if (isMountedRef.current && enabledRef.current) {
        // Persist lock state to sessionStorage
        try {
          sessionStorage.setItem(LOCK_STATE_KEY, 'locked');
        } catch {
          // Ignore storage errors
        }

        onLockRef.current();
      }
    }, lockTimeoutRef.current);
  }, [clearTimer]);

  // Reset timer on activity
  const resetTimer = useCallback(() => {
    const now = Date.now();
    setLastActivityAt(now);

    // Persist last activity timestamp
    try {
      sessionStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
    } catch {
      // Ignore storage errors
    }

    startTimer();
  }, [startTimer]);

  // Check if we should lock on mount (page refresh handling)
  useEffect(() => {
    try {
      const lockState = sessionStorage.getItem(LOCK_STATE_KEY);
      const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY);

      if (lockState === 'locked') {
        // Already locked, trigger lock callback
        if (enabledRef.current) {
          onLockRef.current();
        }
        return;
      }

      if (lastActivity) {
        const lastActivityTime = parseInt(lastActivity, 10);
        const timeSinceActivity = Date.now() - lastActivityTime;

        // If more time has passed than the lock timeout, lock immediately
        if (timeSinceActivity >= lockTimeoutRef.current) {
          if (enabledRef.current) {
            sessionStorage.setItem(LOCK_STATE_KEY, 'locked');
            onLockRef.current();
          }
          return;
        }

        // Otherwise, restore the last activity time and start timer with remaining time
        setLastActivityAt(lastActivityTime);
      }
    } catch {
      // Ignore storage errors
    }

    // Start the timer on mount
    startTimer();
  }, [startTimer]);

  // Set up event listeners
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      clearTimer();
      return;
    }

    // Event types to track
    const activityEvents = [
      'touchstart',
      'touchmove',
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'wheel',
      'click',
    ] as const;

    // Throttle activity handler to prevent excessive updates
    let lastEventTime = 0;
    const THROTTLE_MS = 1000; // Only update once per second

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastEventTime >= THROTTLE_MS) {
        lastEventTime = now;
        resetTimer();
      }
    };

    // Add event listeners
    activityEvents.forEach((eventType) => {
      window.addEventListener(eventType, handleActivity, { passive: true });
    });

    // Handle visibility change (tab focus/blur)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if we should lock when tab becomes visible
        try {
          const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY);
          if (lastActivity) {
            const timeSinceActivity = Date.now() - parseInt(lastActivity, 10);
            if (timeSinceActivity >= lockTimeoutRef.current) {
              sessionStorage.setItem(LOCK_STATE_KEY, 'locked');
              onLockRef.current();
              return;
            }
          }
        } catch {
          // Ignore storage errors
        }

        // Tab is visible, reset timer
        resetTimer();
      } else {
        // Tab is hidden, clear timer (we'll check on return)
        clearTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start initial timer
    startTimer();

    return () => {
      isMountedRef.current = false;
      clearTimer();

      activityEvents.forEach((eventType) => {
        window.removeEventListener(eventType, handleActivity);
      });

      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, clearTimer, startTimer, resetTimer]);

  return {
    resetTimer,
    lastActivityAt,
  };
}

/**
 * Clear the persisted lock state (call this after successful unlock)
 */
export function clearLockState(): void {
  try {
    sessionStorage.removeItem(LOCK_STATE_KEY);
    sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if the app should be locked based on persisted state
 */
export function shouldBeLocked(lockTimeoutMs: number = DEFAULT_LOCK_TIMEOUT): boolean {
  try {
    const lockState = sessionStorage.getItem(LOCK_STATE_KEY);
    if (lockState === 'locked') {
      return true;
    }

    const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY);
    if (lastActivity) {
      const timeSinceActivity = Date.now() - parseInt(lastActivity, 10);
      return timeSinceActivity >= lockTimeoutMs;
    }

    return false;
  } catch {
    return false;
  }
}

export default useActivityTracker;
