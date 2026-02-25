const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

// ============================================================================
// API Types - match backend response shapes
// ============================================================================

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type TransactionType = 'send' | 'receive' | 'swap';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface TransactionRecord {
  id: string;
  walletId?: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string; // String for precision
  token: string;
  fromParty: string | null;
  toParty: string | null;
  txHash?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string; // ISO date string
  confirmedAt?: string | null; // ISO date string
}

export interface BalanceItem {
  token: string;
  amount: string; // String for precision
  locked: string; // String for precision
}

export interface PriceData {
  price: string; // String for precision
  round: number;
  currency: string;
  symbol: string;
  cached?: boolean;
  amuletPriceUsd?: string;
  rewardRate?: string;
}

// Custom error class with structured error info
export class ApiClientError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<void> | null = null;

  setTokens(token: string, refreshToken?: string) {
    this.token = token;
    if (refreshToken) this.refreshToken = refreshToken;
  }

  clearTokens() {
    this.token = null;
    this.refreshToken = null;
  }

  private async doRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<Response> {
    const { method = 'GET', body, token, signal } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const authToken = token || this.token;
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    return fetch(`${API_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  }

  async request<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
    // Check if already aborted before making request
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let response = await this.doRequest<T>(endpoint, options);

    // Auto-refresh token on 401 (skip for auth endpoints)
    if (response.status === 401 && this.refreshToken && !endpoint.startsWith('/auth/')) {
      // Wait for any ongoing refresh
      if (this.isRefreshing && this.refreshPromise) {
        await this.refreshPromise;
      } else {
        // Start refresh
        this.isRefreshing = true;
        this.refreshPromise = this.tryRefreshToken();
        try {
          await this.refreshPromise;
        } finally {
          this.isRefreshing = false;
          this.refreshPromise = null;
        }
      }

      // Retry request with new token
      response = await this.doRequest<T>(endpoint, options);
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Error: ${response.status}`;
      let errorCode = 'UNKNOWN_ERROR';
      let errorDetails: Record<string, unknown> | undefined;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.error || errorJson.message || errorMessage;
        errorCode = errorJson.error?.code || errorCode;
        errorDetails = errorJson.error?.details;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new ApiClientError(errorMessage, errorCode, response.status, errorDetails);
    }

    return response.json();
  }

  private async tryRefreshToken(): Promise<void> {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (response.ok) {
        const result = await response.json();
        this.setTokens(result.data.accessToken, result.data.refreshToken);
        console.log('[API] Token refreshed successfully');
      } else {
        // Refresh failed - clear tokens
        console.warn('[API] Token refresh failed, clearing tokens');
        this.clearTokens();
      }
    } catch (error) {
      console.error('[API] Token refresh error:', error);
      this.clearTokens();
    }
  }

  // Auth
  async authenticate(initData: string, signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: { accessToken: string; refreshToken: string; expiresIn: number; isWhitelisted?: boolean }
    }>(
      '/auth/telegram',
      { method: 'POST', body: { initData }, signal }
    );
    // Extract user info from token (telegramId is in dev mode initData)
    const telegramId = initData.startsWith('dev_mode_') ? initData.replace('dev_mode_', '') : 'unknown';
    return {
      token: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      isWhitelisted: result.data.isWhitelisted ?? true,
      user: { id: 'from-token', telegramId }
    };
  }

  async refreshAuthToken() {
    if (!this.refreshToken) throw new Error('No refresh token');
    const result = await this.request<{ success: boolean; data: { accessToken: string; refreshToken: string } }>(
      '/auth/refresh',
      { method: 'POST', body: { refreshToken: this.refreshToken } }
    );
    this.setTokens(result.data.accessToken, result.data.refreshToken);
    return { token: result.data.accessToken, refreshToken: result.data.refreshToken };
  }

  // Email verification
  async checkEmail(email: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        exists: boolean;
        hasWallet: boolean;
        hasPasskey: boolean;
        partyId?: string;
      }
    }>(
      '/api/email/check',
      { method: 'POST', body: { email } }
    );
    return result.data;
  }

  async sendEmailCode(email: string) {
    const result = await this.request<{ success: boolean; data: { message: string; expiresAt?: string } }>(
      '/api/email/send-code',
      { method: 'POST', body: { email } }
    );
    return { success: result.success, message: result.data?.message || 'Code sent' };
  }

  async verifyEmailCode(email: string, code: string) {
    const result = await this.request<{ success: boolean; data: { message: string } }>(
      '/api/email/verify',
      { method: 'POST', body: { email, code } }
    );
    return { success: result.success, verified: result.success };
  }

  // Wallet
  async createWallet(pin: string, signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: {
        walletId: string;
        partyId: string;
        publicKey: string;
        userShareHex: string;
        recoveryShareHex: string;
      };
    }>('/api/wallet/create', { method: 'POST', body: { pin }, signal });

    return {
      walletId: result.data.walletId,
      partyId: result.data.partyId,
      publicKey: result.data.publicKey,
      userShare: result.data.userShareHex,
      recoveryShare: result.data.recoveryShareHex,
    };
  }

  async getWallet(signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: {
        walletId: string;
        partyId: string;
        publicKey: string;
      };
    }>('/api/wallet/details', { signal });

    return {
      walletId: result.data.walletId,
      partyId: result.data.partyId,
      publicKey: result.data.publicKey,
    };
  }

  async getBalance(signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: Array<{ token: string; amount: string; locked: string }>;
    }>('/api/wallet/balance', { signal });

    // Find CC token balance
    const ccBalance = result.data.find(b => b.token === 'CC') || { amount: '0', locked: '0' };
    return { balance: ccBalance.amount, locked: ccBalance.locked };
  }

  // Transfer
  async sendTransfer(receiverPartyId: string, amount: string, userShareHex: string, memo?: string, signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: { transactionId: string; txHash: string; status: string };
    }>(
      '/api/transfer/send',
      { method: 'POST', body: { receiverPartyId, amount, userShareHex, memo }, signal }
    );
    return result.data;
  }

  async getTransferHistory(limit = 20, signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: Array<{
        id: string;
        walletId?: string;
        type: 'send' | 'receive' | 'swap';
        status: 'pending' | 'confirmed' | 'failed';
        amount: string;
        token: string;
        fromParty: string | null;
        toParty: string | null;
        txHash?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: string; // ISO date string
        confirmedAt?: string | null; // ISO date string
      }>;
    }>(`/api/wallet/transactions?pageSize=${limit}`, { signal });

    return result.data.map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      token: tx.token,
      counterparty: tx.type === 'send' ? tx.toParty : tx.fromParty,
      timestamp: tx.createdAt,
      status: tx.status,
      txHash: tx.txHash,
    }));
  }

  /**
   * Get raw transaction records from backend
   * Returns full transaction objects without transformation
   */
  async getTransactions(limit = 20, page = 1, signal?: AbortSignal): Promise<TransactionRecord[]> {
    const result = await this.request<{
      success: boolean;
      data: TransactionRecord[];
    }>(`/api/wallet/transactions?pageSize=${limit}&page=${page}`, { signal });

    return result.data;
  }

  // UTXO Management
  async getUtxoStatus(signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: { utxoCount: number; needsMerge: boolean; threshold: number };
    }>('/api/wallet/utxos', { signal });
    return result.data;
  }

  async mergeUtxos(userShareHex: string, signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: { mergedCount: number; message: string };
    }>(
      '/api/wallet/merge',
      { method: 'POST', body: { userShareHex }, signal }
    );
    return result.data;
  }

  // Transaction Sync
  async syncTransactions(signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: { synced: number; updated: number; message: string };
    }>(
      '/api/wallet/sync',
      { method: 'POST', signal }
    );
    return result.data;
  }

  // Price
  async getCCPrice() {
    const result = await this.request<{
      success: boolean;
      data: {
        price: string; // String for precision
        round: number;
        currency: string;
        symbol: string;
        cached?: boolean;
        amuletPriceUsd?: string; // String for precision
        rewardRate?: string; // String for precision
      };
    }>('/api/price/cc');
    return result.data;
  }

  // Username
  async checkUsername(username: string) {
    const result = await this.request<{
      success: boolean;
      data: { available: boolean; reason?: string };
    }>(`/api/username/check/${encodeURIComponent(username)}`);
    return result.data;
  }

  async setUsername(username: string) {
    const result = await this.request<{
      success: boolean;
      data: { username: string; permanent: boolean };
    }>('/api/username/set', { method: 'POST', body: { username } });
    return result.data;
  }

  async resolveUsername(username: string) {
    const result = await this.request<{
      success: boolean;
      data: { username: string; partyId: string };
    }>(`/api/username/resolve/${encodeURIComponent(username)}`);
    return result.data;
  }

  async searchUsernames(query: string, limit = 10) {
    const result = await this.request<{
      success: boolean;
      data: { users: Array<{ username: string; partyId: string }> };
    }>(`/api/username/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return result.data.users;
  }

  // Passkey
  async registerPasskey(data: {
    credentialId: string;
    publicKeySpki: string;
    encryptedShare: string;
    nonce: string;
    userShareHex: string;
    deviceName?: string;
  }) {
    const result = await this.request<{
      success: boolean;
      data: { id: string; contractId?: string };
    }>('/api/passkey/register', { method: 'POST', body: data });
    return result.data;
  }

  async getPasskeyChallenge(partyId: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        challenge: string;
        expiresAt: string;
        allowCredentials: Array<{ credentialId: string; type: string }>;
      };
    }>('/api/passkey/challenge', { method: 'POST', body: { partyId } });
    return result.data;
  }

  async getPasskeyCredentials(partyId: string) {
    const result = await this.request<{
      success: boolean;
      data: { credentials: Array<{ credentialId: string; deviceName?: string; createdAt: string }> };
    }>(`/api/passkey/credentials/${encodeURIComponent(partyId)}`);
    return result.data;
  }

  async recoverWithPasskey(data: {
    partyId: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJson: string;
    signature: string;
    userHandle?: string;
  }) {
    const result = await this.request<{
      success: boolean;
      data: { encryptedShare: string; nonce: string; walletId: string };
    }>('/api/passkey/recover', { method: 'POST', body: data });
    return result.data;
  }

  // Passkey Session (OAuth+PKCE flow)
  async createPasskeySession(data: {
    walletId: string;
    partyId: string;
    userShareHex: string;
    codeChallenge: string;
    displayName?: string;
  }) {
    const result = await this.request<{
      sessionId: string;
      expiresAt: string;
      expiresInSeconds: number;
    }>('/api/passkey-session/create', { method: 'POST', body: data });
    return result;
  }

  async checkPasskeySessionStatus(sessionId: string, codeVerifier: string) {
    const result = await this.request<{
      status: 'pending' | 'completed' | 'expired' | 'invalid';
      credentialId?: string;
    }>(`/api/passkey-session/${sessionId}/status`, {
      method: 'POST',
      body: { codeVerifier },
    });
    return result;
  }

  // For external browser (no auth required)
  async getPasskeySession(sessionId: string) {
    const result = await this.request<{
      walletId: string;
      partyId: string;
      userShareHex: string;
      displayName: string;
      challenge: string;
    }>(`/api/passkey-session/${sessionId}`);
    return result;
  }

  async completePasskeySession(sessionId: string, data: {
    credentialId: string;
    publicKeySpki: string;
    encryptedShare: string;
    nonce: string;
    deviceName?: string;
  }) {
    const result = await this.request<{
      success: boolean;
      message: string;
    }>(`/api/passkey-session/${sessionId}/complete`, { method: 'POST', body: data });
    return result;
  }

  // Recovery with recovery code (share 3)
  async recoverWallet(recoveryShareHex: string, signal?: AbortSignal) {
    const result = await this.request<{
      success: boolean;
      data: {
        walletId: string;
        partyId: string;
        publicKey: string;
        userShareHex: string;
        recoveryShareHex: string;
        serverShareIndex: number;
      };
    }>('/api/wallet/recover', { method: 'POST', body: { recoveryShareHex }, signal });

    return {
      walletId: result.data.walletId,
      partyId: result.data.partyId,
      publicKey: result.data.publicKey,
      userShare: result.data.userShareHex,
      recoveryShare: result.data.recoveryShareHex,
      serverShareIndex: result.data.serverShareIndex,
    };
  }

  // PIN Security
  async logPinChangeAudit(eventStatus: 'success' | 'failed', failureReason?: string) {
    const result = await this.request<{
      success: boolean;
      data: { message: string; timestamp: string };
    }>('/api/pin/change-audit', {
      method: 'POST',
      body: { eventStatus, failureReason },
    });
    return result.data;
  }

  async getSecurityEvents() {
    const result = await this.request<{
      success: boolean;
      data: {
        events: Array<{
          id: string;
          eventType: string;
          eventStatus: string;
          ipAddress: string | null;
          createdAt: string;
        }>;
      };
    }>('/api/pin/security-events');
    return result.data.events;
  }

  // Session Settings
  async getSessionSettings() {
    const result = await this.request<{
      success: boolean;
      data: {
        lockTimeoutSeconds: number;
        availableTimeouts: Array<{ value: number; label: string }>;
      };
    }>('/api/session/settings');
    return result.data;
  }

  async updateSessionSettings(lockTimeoutSeconds: number) {
    const result = await this.request<{
      success: boolean;
      data: {
        lockTimeoutSeconds: number;
        message: string;
      };
    }>('/api/session/settings', {
      method: 'PUT',
      body: { lockTimeoutSeconds },
    });
    return result.data;
  }

  async sendHeartbeat() {
    const result = await this.request<{
      success: boolean;
      data: { message: string; timestamp: string };
    }>('/api/session/heartbeat', { method: 'POST', body: {} });
    return result.data;
  }

  // Passkey-Only Session (for mandatory passkey creation before wallet)
  async createPasskeyOnlySession(data: {
    codeChallenge: string;
    displayName?: string;
  }) {
    const result = await this.request<{
      sessionId: string;
      expiresAt: string;
      expiresInSeconds: number;
    }>('/api/passkey-session/create-only', { method: 'POST', body: data });
    return result;
  }

  async checkPasskeyOnlySessionStatus(sessionId: string, codeVerifier: string) {
    const result = await this.request<{
      status: 'pending' | 'completed' | 'expired' | 'invalid';
      credentialId?: string;
      publicKeySpki?: string;
    }>(`/api/passkey-session/${sessionId}/status-only`, {
      method: 'POST',
      body: { codeVerifier },
    });
    return result;
  }

  // For external browser passkey-only creation (no auth required)
  async getPasskeyOnlySession(sessionId: string) {
    const result = await this.request<{
      displayName: string;
      challenge: string;
    }>(`/api/passkey-session/${sessionId}/only`);
    return result;
  }

  async completePasskeyOnlySession(sessionId: string, data: {
    credentialId: string;
    publicKeySpki: string;
    deviceName?: string;
    // codeVerifier removed - PKCE verification happens during polling from Telegram
  }) {
    const result = await this.request<{
      success: boolean;
      message: string;
    }>(`/api/passkey-session/${sessionId}/complete-only`, { method: 'POST', body: data });
    return result;
  }

  // Create wallet with existing passkey credential
  async createWalletWithPasskeyCredential(
    pin: string,
    credentialId: string,
    publicKeySpki: string,
    signal?: AbortSignal
  ) {
    const result = await this.request<{
      success: boolean;
      data: {
        walletId: string;
        partyId: string;
        publicKey: string;
        userShare: string;
        recoveryShare: string;
      };
    }>('/api/wallet/create-with-passkey', {
      method: 'POST',
      body: { pin, credentialId, publicKeySpki },
      signal,
    });
    return result.data;
  }

  // ==================== RECOVERY (PUBLIC - No Auth Required) ====================

  /**
   * Check if email has a wallet with passkey
   * PUBLIC endpoint - no auth required
   */
  async recoveryCheckEmail(email: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        exists: boolean;
        hasWallet: boolean;
        hasPasskey: boolean;
        partyId?: string;
      };
    }>('/api/recovery/check-email', { method: 'POST', body: { email } });
    return result.data;
  }

  /**
   * Send verification code for wallet recovery
   * PUBLIC endpoint - no auth required
   */
  async recoverySendCode(email: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        message: string;
        expiresAt?: string;
      };
    }>('/api/recovery/send-code', { method: 'POST', body: { email } });
    return result.data;
  }

  /**
   * Verify code and create recovery session
   * PUBLIC endpoint - no auth required
   */
  async recoveryVerifyCode(email: string, code: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        sessionId: string;
        partyId: string;
        walletId: string;
        message: string;
      };
    }>('/api/recovery/verify-code', { method: 'POST', body: { email, code } });
    return result.data;
  }

  /**
   * Get WebAuthn challenge for passkey verification during recovery
   * Requires valid recovery session
   */
  async recoveryChallenge(sessionId: string, partyId: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        challenge: string;
        allowCredentials: Array<{ id: string; type: string }>;
        timeout: number;
        userVerification: string;
      };
    }>('/api/recovery/challenge', { method: 'POST', body: { sessionId, partyId } });
    return result.data;
  }

  /**
   * Verify passkey and get encrypted share during recovery
   */
  async recoveryVerifyPasskey(data: {
    sessionId: string;
    partyId: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  }) {
    const result = await this.request<{
      success: boolean;
      data: {
        encryptedShare: string;
        nonce: string;
        walletId: string;
        userId: string;
        message: string;
      };
    }>('/api/recovery/verify-passkey', { method: 'POST', body: data });
    return result.data;
  }

  /**
   * Mark recovery as complete
   */
  async recoveryComplete(sessionId: string) {
    const result = await this.request<{
      success: boolean;
      data: { message: string };
    }>('/api/recovery/complete', { method: 'POST', body: { sessionId } });
    return result.data;
  }

  // ==================== PIN RESET ====================

  /**
   * Reset PIN after recovery session verification
   * Validates recovery session and logs PIN reset event
   */
  async pinReset(sessionId: string) {
    const result = await this.request<{
      success: boolean;
      data: {
        message: string;
        userId: string;
        walletId: string;
      };
    }>('/api/pin/reset', { method: 'POST', body: { sessionId } });
    return result.data;
  }
}

export const api = new ApiClient();
export default api;
