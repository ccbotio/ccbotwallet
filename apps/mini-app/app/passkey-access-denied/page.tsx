'use client';

import SecurityAccessDenied from '../../components/SecurityAccessDenied';

/**
 * Passkey Access Denied Page
 *
 * Shown when:
 * - User tries to access security.ccbot.io directly
 * - User accesses passkey page without valid session parameter
 */
export default function PasskeyAccessDeniedPage() {
  return <SecurityAccessDenied />;
}
