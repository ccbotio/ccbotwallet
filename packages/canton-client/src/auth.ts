import type { AuthToken, CantonConfig } from './types/index.js';
import { fetchWithRetry } from './utils/fetch-with-retry.js';
import { CANTON_TIMEOUTS, RETRY_CONFIG } from '@repo/shared/constants';

/**
 * AuthTokenProvider manages JWT tokens for Canton validator API authentication.
 * In LocalNet/devnet, the validator uses HS256 with "unsafe" secret.
 * For testnet/mainnet, this acquires tokens from the validator's auth endpoint.
 */
export class AuthTokenProvider {
  private config: CantonConfig;
  private currentToken: AuthToken | null = null;

  constructor(config: CantonConfig) {
    this.config = config;
  }

  /**
   * Get a valid auth token, refreshing if expired.
   */
  async getToken(): Promise<string> {
    if (this.currentToken && this.currentToken.expiresAt > Date.now()) {
      return this.currentToken.token;
    }

    return this.refreshToken();
  }

  /**
   * Refresh the auth token from the validator.
   */
  private async refreshToken(): Promise<string> {
    // For devnet: use HS256 JWT with "unsafe" secret
    if (this.config.network === 'devnet') {
      const token = await this.createDevnetToken();
      this.currentToken = {
        token,
        expiresAt: Date.now() + 3600 * 1000,
      };
      return this.currentToken.token;
    }

    const validatorUrl = this.config.validatorUrl;
    if (!validatorUrl) {
      throw new Error('Validator URL required for non-devnet auth');
    }

    const response = await fetchWithRetry(`${validatorUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantId: this.config.participantId,
      }),
      timeout: CANTON_TIMEOUTS.auth,
      retries: RETRY_CONFIG.maxRetries,
      backoffBase: RETRY_CONFIG.backoffBase,
      backoffMax: RETRY_CONFIG.backoffMax,
      retryOnStatus: RETRY_CONFIG.retryableStatus,
    });

    if (!response.ok) {
      throw new Error(`Auth token refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };

    this.currentToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 60000,
    };

    return this.currentToken.token;
  }

  /**
   * Create a devnet JWT using HS256 with "unsafe" secret.
   * The subject must be the validator admin user (default: 'administrator').
   * The audience must match VALIDATOR_AUTH_AUDIENCE from Canton config.
   */
  private async createDevnetToken(): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: this.config.ledgerApiUser || 'administrator',
      aud: this.config.validatorAudience || 'https://validator.example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const enc = new TextEncoder();
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const data = `${headerB64}.${payloadB64}`;

    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('unsafe'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const sigB64 = base64url(new Uint8Array(sig));

    return `${data}.${sigB64}`;
  }

  /**
   * Get auth headers for API requests.
   */
  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Invalidate the current token.
   */
  invalidate(): void {
    this.currentToken = null;
  }
}

function base64url(input: string | Uint8Array): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
