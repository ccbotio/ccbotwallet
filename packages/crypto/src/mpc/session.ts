import { randomBytes } from '@noble/ciphers/webcrypto';
import { bytesToHex } from '@noble/hashes/utils';

export type SessionStatus = 'pending' | 'active' | 'completed' | 'expired' | 'failed';

export interface MPCSession {
  id: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  participantCount: number;
  threshold: number;
  sharesCollected: number;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a new MPC signing session.
 */
export function createSession(
  threshold: number,
  participantCount: number,
  timeoutMs: number = SESSION_TIMEOUT_MS
): MPCSession {
  const now = Date.now();
  return {
    id: bytesToHex(randomBytes(16)),
    status: 'pending',
    createdAt: now,
    expiresAt: now + timeoutMs,
    participantCount,
    threshold,
    sharesCollected: 0,
  };
}

/**
 * Check if a session is still valid.
 */
export function isSessionValid(session: MPCSession): boolean {
  if (session.status === 'completed' || session.status === 'failed') return false;
  if (Date.now() > session.expiresAt) return false;
  return true;
}

/**
 * Record that a share has been collected for the session.
 */
export function collectShare(session: MPCSession): MPCSession {
  const updated = { ...session, sharesCollected: session.sharesCollected + 1 };

  if (updated.sharesCollected >= updated.threshold) {
    updated.status = 'active';
  }

  return updated;
}

/**
 * Mark session as completed.
 */
export function completeSession(session: MPCSession): MPCSession {
  return { ...session, status: 'completed' };
}

/**
 * Mark session as failed.
 */
export function failSession(session: MPCSession): MPCSession {
  return { ...session, status: 'failed' };
}

/**
 * In-memory session store for managing active signing sessions.
 */
export class SessionStore {
  private sessions = new Map<string, MPCSession>();

  create(threshold: number, participantCount: number): MPCSession {
    const session = createSession(threshold, participantCount);
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string): MPCSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && !isSessionValid(session)) {
      this.sessions.set(sessionId, { ...session, status: 'expired' });
      return { ...session, status: 'expired' };
    }
    return session;
  }

  update(session: MPCSession): void {
    this.sessions.set(session.id, session);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }
}
