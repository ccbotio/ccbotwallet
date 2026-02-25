'use client';

import { useEffect } from 'react';
import SecurityAccessDenied from '../../components/SecurityAccessDenied';

/**
 * Passkey Access Denied Page
 *
 * Shown when:
 * - User tries to access security.ccbot.io directly
 * - User accesses passkey page without valid session parameter
 */
export default function PasskeyAccessDeniedPage() {
  // Mark app as hydrated to prevent flash of unstyled content
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      requestAnimationFrame(() => appRoot.classList.add('hydrated'));
    }
  }, []);

  return <SecurityAccessDenied />;
}
