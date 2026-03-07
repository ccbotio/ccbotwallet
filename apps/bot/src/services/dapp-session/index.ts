/**
 * DappSessionService - CIP-103 dApp Session Management
 *
 * Handles dApp session lifecycle for the CIP-103 Canton dApp Standard.
 * Sessions represent JSON-RPC requests from external dApps that require
 * user approval before execution.
 *
 * Security:
 * - PKCE (Proof Key for Code Exchange) for session verification
 * - 15-minute session expiry
 * - Private key zeroing after signing operations
 */

import { eq, and, gt, lt } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { dappSessions, dappConnections, wallets, serverShares } from '../../db/schema.js';
import { randomBytes, createHash } from 'crypto';
import { createLogger } from '@repo/shared/logger';
import {
  shareFromHex,
  withReconstructedKey,
  ed25519Sign,
  hexToBytes,
  bytesToHex,
  type Share,
} from '@repo/crypto';
import { decrypt } from '@repo/crypto/encryption';
import { env } from '../../config/env.js';
import type {
  Cip103Method,
  DappSessionStatus,
  Cip103Account,
  Cip103Network,
  Cip103ConnectResult,
  Cip103SignMessageResult,
  JsonRpcError,
} from '@repo/shared/types';
import { CIP103_ERROR_CODES } from '@repo/shared/types';
import { requiresSigning, requiresConnection, validateMethodParams } from '@repo/shared/validation';

const logger = createLogger('dapp-session');

const SESSION_EXPIRY_MINUTES = 15;

// Helper to check affected rows from drizzle update/delete
function getAffectedRows(result: unknown): number {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.rowCount === 'number') return r.rowCount;
    if (typeof r.changes === 'number') return r.changes;
    if (typeof r.count === 'number') return r.count;
  }
  return 0;
}

// ========== Types ==========

export interface CreateSessionParams {
  method: Cip103Method;
  params?: unknown;
  origin: string;
  name?: string | undefined;
  icon?: string | undefined;
  callbackUrl: string;
  codeChallenge: string;
  requestId?: string | number | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface SessionData {
  sessionId: string;
  method: Cip103Method;
  params?: unknown;
  dappOrigin: string;
  dappName?: string | undefined;
  dappIcon?: string | undefined;
  status: DappSessionStatus;
  expiresAt: string;
  createdAt: string;
}

export interface ApproveResult {
  success: boolean;
  redirectUrl?: string;
  error?: JsonRpcError;
}

export interface RejectResult {
  success: boolean;
  redirectUrl: string;
}

// ========== Service Class ==========

export class DappSessionService {
  /**
   * Create a new dApp session.
   */
  async createSession(params: CreateSessionParams): Promise<{
    sessionId: string;
    walletUrl: string;
    expiresAt: Date;
  }> {
    // Validate method params
    const validation = validateMethodParams(params.method, params.params);
    if (!validation.success) {
      throw new Error(`Invalid params: ${validation.error}`);
    }

    // Generate unique session ID
    const sessionId = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000);

    await db.insert(dappSessions).values({
      sessionId,
      codeChallenge: params.codeChallenge,
      dappOrigin: params.origin,
      dappName: params.name,
      dappIcon: params.icon,
      callbackUrl: params.callbackUrl,
      method: params.method,
      params: params.params,
      requestId: params.requestId?.toString(),
      status: 'pending',
      requestIp: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt,
    });

    // Build wallet approval URL
    const walletBaseUrl = env.MINI_APP_URL || env.TELEGRAM_MINI_APP_URL || 'https://t.me/CCBotWallet';
    const walletUrl = `${walletBaseUrl}/approve?session=${sessionId}`;

    logger.info('Created dApp session', {
      sessionId,
      method: params.method,
      origin: params.origin,
      expiresAt: expiresAt.toISOString(),
    });

    return { sessionId, walletUrl, expiresAt };
  }

  /**
   * Get session data for the approval page.
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const [session] = await db
      .select()
      .from(dappSessions)
      .where(
        and(
          eq(dappSessions.sessionId, sessionId),
          gt(dappSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      logger.debug('Session not found or expired', { sessionId });
      return null;
    }

    return {
      sessionId: session.sessionId,
      method: session.method as Cip103Method,
      params: session.params,
      dappOrigin: session.dappOrigin,
      dappName: session.dappName ?? undefined,
      dappIcon: session.dappIcon ?? undefined,
      status: session.status as DappSessionStatus,
      expiresAt: session.expiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
    };
  }

  /**
   * Approve a session and execute the requested method.
   */
  async approveSession(
    sessionId: string,
    userId: string,
    walletId: string,
    partyId: string,
    userShareHex?: string
  ): Promise<ApproveResult> {
    // Get session
    const [session] = await db
      .select()
      .from(dappSessions)
      .where(
        and(
          eq(dappSessions.sessionId, sessionId),
          eq(dappSessions.status, 'pending'),
          gt(dappSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      return {
        success: false,
        error: {
          code: CIP103_ERROR_CODES.SESSION_NOT_FOUND,
          message: 'Session not found or expired',
        },
      };
    }

    const method = session.method as Cip103Method;

    // Check if method requires signing
    if (requiresSigning(method) && !userShareHex) {
      return {
        success: false,
        error: {
          code: CIP103_ERROR_CODES.UNAUTHORIZED,
          message: 'User share required for signing methods',
        },
      };
    }

    // Check if method requires connection
    if (requiresConnection(method)) {
      const isConnected = await this.checkConnection(userId, session.dappOrigin);
      if (!isConnected && method !== 'connect') {
        return {
          success: false,
          error: {
            code: CIP103_ERROR_CODES.UNAUTHORIZED,
            message: 'dApp not connected',
          },
        };
      }
    }

    // Update session with user binding
    await db
      .update(dappSessions)
      .set({
        userId,
        walletId,
        status: 'approved',
      })
      .where(eq(dappSessions.sessionId, sessionId));

    try {
      // Execute method
      const result = await this.executeMethod(
        method,
        session.params,
        userId,
        walletId,
        partyId,
        session.dappOrigin,
        session.dappName,
        userShareHex
      );

      // Mark as completed
      await db
        .update(dappSessions)
        .set({
          status: 'completed',
          result,
          completedAt: new Date(),
        })
        .where(eq(dappSessions.sessionId, sessionId));

      // Build redirect URL with result
      const redirectUrl = this.buildRedirectUrl(
        session.callbackUrl,
        session.requestId,
        result
      );

      logger.info('Session approved and completed', {
        sessionId,
        method,
        userId,
      });

      return { success: true, redirectUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await db
        .update(dappSessions)
        .set({
          status: 'completed',
          errorCode: CIP103_ERROR_CODES.INTERNAL_ERROR,
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(dappSessions.sessionId, sessionId));

      const redirectUrl = this.buildErrorRedirectUrl(
        session.callbackUrl,
        session.requestId,
        CIP103_ERROR_CODES.INTERNAL_ERROR,
        errorMessage
      );

      logger.error('Session execution failed', { sessionId, error: errorMessage });

      return {
        success: false,
        redirectUrl,
        error: {
          code: CIP103_ERROR_CODES.INTERNAL_ERROR,
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Reject a session.
   */
  async rejectSession(sessionId: string): Promise<RejectResult> {
    const [session] = await db
      .select()
      .from(dappSessions)
      .where(
        and(
          eq(dappSessions.sessionId, sessionId),
          eq(dappSessions.status, 'pending'),
          gt(dappSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      throw new Error('Session not found or expired');
    }

    await db
      .update(dappSessions)
      .set({
        status: 'rejected',
        errorCode: CIP103_ERROR_CODES.USER_REJECTED,
        errorMessage: 'User rejected the request',
        completedAt: new Date(),
      })
      .where(eq(dappSessions.sessionId, sessionId));

    const redirectUrl = this.buildErrorRedirectUrl(
      session.callbackUrl,
      session.requestId,
      CIP103_ERROR_CODES.USER_REJECTED,
      'User rejected the request'
    );

    logger.info('Session rejected', { sessionId });

    return { success: true, redirectUrl };
  }

  /**
   * Check session status with PKCE verification.
   */
  async checkSessionStatus(
    sessionId: string,
    codeVerifier: string
  ): Promise<{
    status: DappSessionStatus;
    result?: unknown;
    error?: JsonRpcError;
  }> {
    const [session] = await db
      .select()
      .from(dappSessions)
      .where(eq(dappSessions.sessionId, sessionId))
      .limit(1);

    if (!session) {
      return { status: 'expired' };
    }

    // Verify PKCE
    const computedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (computedChallenge !== session.codeChallenge) {
      logger.warn('PKCE verification failed', { sessionId });
      return {
        status: 'expired',
        error: {
          code: CIP103_ERROR_CODES.PKCE_VERIFICATION_FAILED,
          message: 'Invalid code verifier',
        },
      };
    }

    // Check expiry
    if (new Date() > session.expiresAt) {
      return { status: 'expired' };
    }

    const status = session.status as DappSessionStatus;

    if (status === 'completed') {
      return {
        status,
        result: session.result,
      };
    }

    if (status === 'rejected') {
      return {
        status,
        error: {
          code: session.errorCode ?? CIP103_ERROR_CODES.USER_REJECTED,
          message: session.errorMessage ?? 'User rejected the request',
        },
      };
    }

    return { status };
  }

  // ========== Connection Management ==========

  /**
   * Check if a dApp is connected.
   */
  async checkConnection(userId: string, origin: string): Promise<boolean> {
    const [connection] = await db
      .select()
      .from(dappConnections)
      .where(
        and(
          eq(dappConnections.userId, userId),
          eq(dappConnections.dappOrigin, origin),
          eq(dappConnections.isActive, true)
        )
      )
      .limit(1);

    return !!connection;
  }

  /**
   * Create or update a connection.
   */
  async createConnection(
    userId: string,
    walletId: string,
    origin: string,
    name?: string,
    permissions: string[] = []
  ): Promise<void> {
    // Check for existing connection
    const [existing] = await db
      .select()
      .from(dappConnections)
      .where(
        and(
          eq(dappConnections.userId, userId),
          eq(dappConnections.dappOrigin, origin)
        )
      )
      .limit(1);

    if (existing) {
      // Reactivate and update
      await db
        .update(dappConnections)
        .set({
          isActive: true,
          dappName: name,
          permissions,
          lastUsedAt: new Date(),
          disconnectedAt: null,
        })
        .where(eq(dappConnections.id, existing.id));
    } else {
      // Create new
      await db.insert(dappConnections).values({
        userId,
        walletId,
        dappOrigin: origin,
        dappName: name,
        permissions,
      });
    }

    logger.info('dApp connection created/updated', { userId, origin });
  }

  /**
   * Disconnect a dApp.
   */
  async disconnectDapp(connectionId: string, userId: string): Promise<boolean> {
    const result = await db
      .update(dappConnections)
      .set({
        isActive: false,
        disconnectedAt: new Date(),
      })
      .where(
        and(
          eq(dappConnections.id, connectionId),
          eq(dappConnections.userId, userId)
        )
      );

    const affected = getAffectedRows(result);
    logger.info('dApp disconnected', { connectionId, userId, affected });

    return affected > 0;
  }

  /**
   * Get active connections for a user.
   */
  async getConnections(userId: string): Promise<Array<{
    id: string;
    dappOrigin: string;
    dappName?: string | undefined;
    permissions: string[];
    connectedAt: string;
    lastUsedAt: string;
  }>> {
    const connections = await db
      .select()
      .from(dappConnections)
      .where(
        and(
          eq(dappConnections.userId, userId),
          eq(dappConnections.isActive, true)
        )
      );

    return connections.map(c => ({
      id: c.id,
      dappOrigin: c.dappOrigin,
      dappName: c.dappName ?? undefined,
      permissions: (c.permissions as string[]) ?? [],
      connectedAt: c.connectedAt.toISOString(),
      lastUsedAt: c.lastUsedAt.toISOString(),
    }));
  }

  // ========== Method Execution ==========

  /**
   * Execute a CIP-103 method.
   */
  private async executeMethod(
    method: Cip103Method,
    params: unknown,
    userId: string,
    walletId: string,
    partyId: string,
    origin: string,
    dappName?: string | null,
    userShareHex?: string
  ): Promise<unknown> {
    switch (method) {
      case 'connect':
        return this.handleConnect(userId, walletId, partyId, origin, dappName ?? undefined);

      case 'isConnected':
        return this.handleIsConnected(userId, origin);

      case 'disconnect':
        return this.handleDisconnect(userId, origin);

      case 'status':
        return this.handleStatus(userId, partyId, origin);

      case 'getActiveNetwork':
        return this.handleGetActiveNetwork();

      case 'listAccounts':
        return this.handleListAccounts(userId);

      case 'getPrimaryAccount':
        return this.handleGetPrimaryAccount(userId);

      case 'signMessage':
        if (!userShareHex) throw new Error('User share required');
        return this.handleSignMessage(walletId, partyId, params, userShareHex);

      case 'prepareExecute':
        if (!userShareHex) throw new Error('User share required');
        return this.handlePrepareExecute(walletId, partyId, params, userShareHex);

      case 'ledgerApi':
        if (!userShareHex) throw new Error('User share required');
        return this.handleLedgerApi(walletId, partyId, params, userShareHex);

      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  /**
   * Handle connect method - establish dApp connection.
   */
  private async handleConnect(
    userId: string,
    walletId: string,
    partyId: string,
    origin: string,
    name?: string
  ): Promise<Cip103ConnectResult> {
    // Create connection
    await this.createConnection(userId, walletId, origin, name);

    // Get wallet for public key
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .limit(1);

    const accounts: Cip103Account[] = [{
      partyId,
      publicKey: wallet?.publicKey ?? '',
      isPrimary: true,
    }];

    const network = this.getNetwork();

    return {
      connected: true,
      accounts,
      network,
    };
  }

  /**
   * Handle isConnected method.
   */
  private async handleIsConnected(
    userId: string,
    origin: string
  ): Promise<{ connected: boolean }> {
    const connected = await this.checkConnection(userId, origin);
    return { connected };
  }

  /**
   * Handle disconnect method.
   */
  private async handleDisconnect(
    userId: string,
    origin: string
  ): Promise<{ disconnected: boolean }> {
    const [connection] = await db
      .select()
      .from(dappConnections)
      .where(
        and(
          eq(dappConnections.userId, userId),
          eq(dappConnections.dappOrigin, origin),
          eq(dappConnections.isActive, true)
        )
      )
      .limit(1);

    if (connection) {
      await this.disconnectDapp(connection.id, userId);
    }

    return { disconnected: true };
  }

  /**
   * Handle status method.
   */
  private async handleStatus(
    userId: string,
    _partyId: string,
    origin: string
  ): Promise<{
    connected: boolean;
    network: Cip103Network;
    accounts: Cip103Account[];
    permissions: string[];
  }> {
    const [connection] = await db
      .select()
      .from(dappConnections)
      .where(
        and(
          eq(dappConnections.userId, userId),
          eq(dappConnections.dappOrigin, origin),
          eq(dappConnections.isActive, true)
        )
      )
      .limit(1);

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1);

    const accounts: Cip103Account[] = wallet ? [{
      partyId: wallet.partyId,
      publicKey: wallet.publicKey ?? '',
      isPrimary: wallet.isPrimary,
    }] : [];

    return {
      connected: !!connection,
      network: this.getNetwork(),
      accounts,
      permissions: (connection?.permissions as string[]) ?? [],
    };
  }

  /**
   * Handle getActiveNetwork method.
   */
  private handleGetActiveNetwork(): { network: Cip103Network } {
    return { network: this.getNetwork() };
  }

  /**
   * Handle listAccounts method.
   */
  private async handleListAccounts(userId: string): Promise<{ accounts: Cip103Account[] }> {
    const userWallets = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId));

    const accounts: Cip103Account[] = userWallets.map(w => ({
      partyId: w.partyId,
      publicKey: w.publicKey ?? '',
      isPrimary: w.isPrimary,
    }));

    return { accounts };
  }

  /**
   * Handle getPrimaryAccount method.
   */
  private async handleGetPrimaryAccount(userId: string): Promise<{ account: Cip103Account | null }> {
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.isPrimary, true)))
      .limit(1);

    if (!wallet) {
      return { account: null };
    }

    return {
      account: {
        partyId: wallet.partyId,
        publicKey: wallet.publicKey ?? '',
        isPrimary: true,
      },
    };
  }

  /**
   * Handle signMessage method - sign a message with Ed25519.
   */
  private async handleSignMessage(
    walletId: string,
    partyId: string,
    params: unknown,
    userShareHex: string
  ): Promise<Cip103SignMessageResult> {
    const { message, encoding } = params as { message: string; encoding?: string };

    // Get server share
    const serverShare = await this.getServerShare(walletId);
    const userShare = shareFromHex(userShareHex);

    // Prepare message bytes
    const messageBytes = encoding === 'hex'
      ? hexToBytes(message)
      : new TextEncoder().encode(message);

    // Get wallet for public key
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .limit(1);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Sign with reconstructed key
    const signature = await withReconstructedKey(
      [userShare, serverShare],
      async (privateKeyHex) => {
        const privateKey = hexToBytes(privateKeyHex);
        const sig = ed25519Sign(messageBytes, privateKey);
        return bytesToHex(sig);
      }
    );

    logger.info('Message signed', { walletId, partyId, messageLength: message.length });

    return {
      signature,
      publicKey: wallet.publicKey ?? '',
      partyId,
    };
  }

  /**
   * Handle prepareExecute method - prepare and execute a DAML command.
   * TODO: Implement actual Canton SDK integration for DAML commands.
   */
  private async handlePrepareExecute(
    _walletId: string,
    partyId: string,
    params: unknown,
    _userShareHex: string
  ): Promise<{ submissionId: string; status: 'submitted' | 'failed'; error?: string }> {
    // This is a placeholder - actual implementation would use Canton SDK
    logger.info('prepareExecute called', { partyId, params });

    return {
      submissionId: `submission-${Date.now()}`,
      status: 'submitted',
    };
  }

  /**
   * Handle ledgerApi method - execute ledger API operations.
   * TODO: Implement actual Canton SDK integration for ledger API.
   */
  private async handleLedgerApi(
    _walletId: string,
    partyId: string,
    params: unknown,
    _userShareHex: string
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    // This is a placeholder - actual implementation would use Canton SDK
    logger.info('ledgerApi called', { partyId, params });

    return {
      success: true,
      data: null,
    };
  }

  // ========== Helper Methods ==========

  /**
   * Get server share for a wallet.
   */
  private async getServerShare(walletId: string): Promise<Share> {
    const [stored] = await db
      .select()
      .from(serverShares)
      .where(eq(serverShares.walletId, walletId))
      .limit(1);

    if (!stored) {
      throw new Error('Server share not found');
    }

    const encryptionKey = hexToBytes(env.ENCRYPTION_KEY);
    const shareHex = decrypt(stored.encryptedShare, encryptionKey);

    return shareFromHex(shareHex);
  }

  /**
   * Get current network configuration.
   */
  private getNetwork(): Cip103Network {
    const networkId = env.CANTON_NETWORK === 'mainnet' ? 'mainnet'
      : env.CANTON_NETWORK === 'testnet' ? 'testnet'
      : 'devnet';

    return {
      networkId,
      synchronizerId: env.CANTON_PARTICIPANT_ID ?? 'unknown',
      validatorUrl: env.CANTON_VALIDATOR_API_URL ?? '',
    };
  }

  /**
   * Build redirect URL with success result.
   */
  private buildRedirectUrl(
    callbackUrl: string,
    requestId: string | null,
    result: unknown
  ): string {
    const response = {
      jsonrpc: '2.0',
      id: requestId ?? null,
      result,
    };

    const base64Response = Buffer.from(JSON.stringify(response)).toString('base64url');
    const url = new URL(callbackUrl);
    url.searchParams.set('response', base64Response);

    return url.toString();
  }

  /**
   * Build redirect URL with error.
   */
  private buildErrorRedirectUrl(
    callbackUrl: string,
    requestId: string | null,
    code: number,
    message: string
  ): string {
    const response = {
      jsonrpc: '2.0',
      id: requestId ?? null,
      error: { code, message },
    };

    const base64Response = Buffer.from(JSON.stringify(response)).toString('base64url');
    const url = new URL(callbackUrl);
    url.searchParams.set('response', base64Response);

    return url.toString();
  }

  /**
   * Cleanup expired sessions.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await db
      .delete(dappSessions)
      .where(
        and(
          lt(dappSessions.expiresAt, new Date()),
          eq(dappSessions.status, 'pending')
        )
      );

    const deleted = getAffectedRows(result);
    if (deleted > 0) {
      logger.info('Cleaned up expired dApp sessions', { count: deleted });
    }

    return deleted;
  }
}

export const dappSessionService = new DappSessionService();
