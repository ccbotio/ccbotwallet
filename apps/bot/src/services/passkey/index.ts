import { eq, and, lt, gt } from 'drizzle-orm';
import { db, passkeyCredentials, passkeyChallenges, wallets, serverShares } from '../../db/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  PasskeyContractManager,
  type WebAuthnAssertion,
} from '@repo/canton-client';
import { shareFromHex, reconstructEd25519Key, ed25519Sign, secureZero } from '@repo/crypto';
import { hexToBytes } from '@noble/hashes/utils';
import { decrypt } from '@repo/crypto/encryption';

/**
 * Challenge validity period (dev mode - 24 hours)
 */
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * PasskeyService handles passkey registration, verification, and recovery.
 *
 * Key responsibilities:
 * - Register passkeys during wallet creation
 * - Generate and validate WebAuthn challenges
 * - Verify WebAuthn signatures
 * - Retrieve encrypted recovery shares
 * - Store passkey metadata in local DB for caching
 */
export class PasskeyService {
  private cantonManager: PasskeyContractManager | null = null;

  /**
   * Initialize the Canton contract manager if Canton is configured.
   */
  private async getCantonManagerAsync(): Promise<PasskeyContractManager | null> {
    if (this.cantonManager) {
      return this.cantonManager;
    }

    const ledgerApiUrl = env.CANTON_LEDGER_API_URL;
    const validatorUrl = env.CANTON_VALIDATOR_API_URL;

    if (!ledgerApiUrl || !validatorUrl) {
      logger.warn('Canton URLs not configured, passkey contracts will be simulated');
      return null;
    }

    // Import dynamically to avoid circular dependencies
    const { AuthTokenProvider } = await import('@repo/canton-client');

    const config = {
      network: env.CANTON_NETWORK as 'devnet' | 'testnet' | 'mainnet',
      ledgerApiUrl,
      validatorUrl,
      participantId: env.CANTON_PARTICIPANT_ID || '',
      ledgerApiUser: env.CANTON_LEDGER_API_USER,
      validatorAudience: env.CANTON_VALIDATOR_AUDIENCE,
    };

    const auth = new AuthTokenProvider(config);
    this.cantonManager = new PasskeyContractManager(config, auth);
    return this.cantonManager;
  }

  /**
   * Generate a WebAuthn challenge for passkey registration or authentication.
   *
   * @param walletId - The wallet ID requesting the challenge
   * @returns Challenge string (base64url encoded) and expiration time
   */
  async generateChallenge(walletId: string): Promise<{
    challenge: string;
    expiresAt: Date;
  }> {
    // Generate random challenge
    const challengeBytes = new Uint8Array(32);
    crypto.getRandomValues(challengeBytes);
    const challenge = this.bytesToBase64Url(challengeBytes);

    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    // Store challenge for later verification
    await db.insert(passkeyChallenges).values({
      walletId,
      challenge,
      expiresAt,
    });

    logger.debug({ walletId, challenge: challenge.slice(0, 16) + '...' }, 'Generated passkey challenge');

    return { challenge, expiresAt };
  }

  /**
   * Validate a challenge is valid and unused.
   */
  async validateChallenge(walletId: string, challenge: string): Promise<boolean> {
    const now = new Date();

    const [stored] = await db
      .select()
      .from(passkeyChallenges)
      .where(
        and(
          eq(passkeyChallenges.walletId, walletId),
          eq(passkeyChallenges.challenge, challenge),
          gt(passkeyChallenges.expiresAt, now)
        )
      )
      .limit(1);

    if (!stored) {
      logger.warn({ walletId }, 'Invalid or expired passkey challenge');
      return false;
    }

    if (stored.usedAt) {
      logger.warn({ walletId }, 'Challenge already used (replay attack attempt)');
      return false;
    }

    // Mark challenge as used
    await db
      .update(passkeyChallenges)
      .set({ usedAt: now })
      .where(eq(passkeyChallenges.id, stored.id));

    return true;
  }

  /**
   * Register a passkey for wallet recovery.
   *
   * @param walletId - The wallet to register the passkey for
   * @param credentialId - WebAuthn credential ID (base64)
   * @param publicKeySpki - Passkey public key in SPKI format (base64)
   * @param encryptedRecoveryShare - Recovery share encrypted with passkey-derived key (base64)
   * @param nonce - AES-GCM nonce (base64)
   * @param userShareHex - User's Shamir share (needed to sign Canton tx)
   * @param deviceName - Optional device name
   */
  async registerPasskey(
    userId: string,
    walletId: string,
    email: string, // User's verified email at registration time
    credentialId: string,
    publicKeySpki: string,
    encryptedRecoveryShare: string,
    nonce: string,
    userShareHex: string,
    deviceName?: string,
    deviceFingerprint?: string
  ): Promise<{
    id: string;
    cantonContractId?: string | undefined;
  }> {
    // Get wallet to verify it exists
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .limit(1);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Check for duplicate credential
    const [existing] = await db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, credentialId))
      .limit(1);

    if (existing) {
      throw new Error('Passkey already registered');
    }

    let cantonContractId: string | undefined;

    // Try to create Canton contract if available
    const cantonManager = await this.getCantonManagerAsync();
    if (cantonManager) {
      try {
        // Reconstruct private key to sign Canton transaction
        const signHash = await this.createSignFunction(walletId, userShareHex);

        const result = await cantonManager.createPasskeyContract(
          wallet.partyId,
          credentialId,
          publicKeySpki,
          encryptedRecoveryShare,
          nonce,
          signHash,
          deviceName
        );

        cantonContractId = result.contractId;
        logger.info({ walletId, contractId: cantonContractId }, 'Passkey contract created on Canton');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ walletId, errorMessage }, 'Failed to create passkey contract on Canton');
        // Continue without Canton contract - we'll store locally
      }
    }

    // Store in local database
    // SECURITY: Link passkey to both user and email for audit trail
    const [credential] = await db
      .insert(passkeyCredentials)
      .values({
        userId,
        walletId,
        credentialId,
        publicKeySpki,
        emailAtRegistration: email.toLowerCase(),
        cantonContractId,
        deviceName,
        deviceFingerprint,
      })
      .returning();

    if (!credential) {
      throw new Error('Failed to store passkey credential');
    }

    logger.info(
      { walletId, credentialId: credentialId.slice(0, 16) + '...', deviceName },
      'Passkey registered successfully'
    );

    return {
      id: credential.id,
      cantonContractId,
    };
  }

  /**
   * Get all passkey credentials for a wallet.
   */
  async getCredentials(walletId: string): Promise<Array<{
    id: string;
    credentialId: string;
    deviceName: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }>> {
    const credentials = await db
      .select({
        id: passkeyCredentials.id,
        credentialId: passkeyCredentials.credentialId,
        deviceName: passkeyCredentials.deviceName,
        lastUsedAt: passkeyCredentials.lastUsedAt,
        createdAt: passkeyCredentials.createdAt,
      })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.walletId, walletId));

    return credentials;
  }

  /**
   * Get credentials by party ID (for recovery).
   */
  async getCredentialsByPartyId(partyId: string): Promise<Array<{
    credentialId: string;
    publicKeySpki: string;
    cantonContractId: string | null;
    walletId: string;
  }>> {
    const results = await db
      .select({
        credentialId: passkeyCredentials.credentialId,
        publicKeySpki: passkeyCredentials.publicKeySpki,
        cantonContractId: passkeyCredentials.cantonContractId,
        walletId: passkeyCredentials.walletId,
      })
      .from(passkeyCredentials)
      .innerJoin(wallets, eq(passkeyCredentials.walletId, wallets.id))
      .where(eq(wallets.partyId, partyId));

    return results;
  }

  /**
   * Verify a WebAuthn assertion signature.
   *
   * @param publicKeySpki - The passkey's public key in SPKI format (base64)
   * @param assertion - The WebAuthn assertion from the client
   * @returns true if signature is valid
   */
  async verifyWebAuthnSignature(
    publicKeySpki: string,
    assertion: WebAuthnAssertion
  ): Promise<boolean> {
    try {
      // Decode the public key from SPKI format
      const publicKeyBytes = this.base64ToBytes(publicKeySpki);

      // Decode assertion data
      const authenticatorData = this.base64ToBytes(assertion.authenticatorData);
      const clientDataJSON = this.base64ToBytes(assertion.clientDataJson);
      const signature = this.base64ToBytes(assertion.signature);

      // Build the signed data: authenticatorData || SHA-256(clientDataJSON)
      const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
      const signedData = new Uint8Array(authenticatorData.length + 32);
      signedData.set(authenticatorData, 0);
      signedData.set(new Uint8Array(clientDataHash), authenticatorData.length);

      // Import the public key
      const publicKey = await crypto.subtle.importKey(
        'spki',
        publicKeyBytes,
        {
          name: 'ECDSA',
          namedCurve: 'P-256',
        },
        false,
        ['verify']
      );

      // Verify the signature
      // Note: WebAuthn uses DER-encoded signatures, we need to handle this
      const derSignature = this.convertWebAuthnSignatureToDER(signature);

      const isValid = await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' },
        },
        publicKey,
        derSignature,
        signedData
      );

      return isValid;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ errorMessage }, 'WebAuthn signature verification failed');
      return false;
    }
  }

  /**
   * Recover with passkey - returns encrypted recovery share after verification.
   *
   * @param partyId - Canton party ID to recover
   * @param assertion - WebAuthn assertion from client
   */
  async recoverWithPasskey(
    partyId: string,
    assertion: WebAuthnAssertion
  ): Promise<{
    encryptedShare: string;
    nonce: string;
    walletId: string;
  }> {
    // Find credentials for this party
    const credentials = await this.getCredentialsByPartyId(partyId);

    if (credentials.length === 0) {
      throw new Error('No passkey credentials found for this wallet');
    }

    // Find the matching credential
    const credential = credentials.find(
      (c) => c.credentialId === assertion.credentialId
    );

    if (!credential) {
      throw new Error('Passkey credential not found');
    }

    // Verify the WebAuthn signature
    const isValid = await this.verifyWebAuthnSignature(
      credential.publicKeySpki,
      assertion
    );

    if (!isValid) {
      logger.warn({ partyId, credentialId: assertion.credentialId }, 'Invalid passkey signature');
      throw new Error('Passkey verification failed');
    }

    // Update last used timestamp
    await db
      .update(passkeyCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(passkeyCredentials.credentialId, credential.credentialId));

    // Try to get encrypted share from Canton contract
    const cantonManager = await this.getCantonManagerAsync();
    if (cantonManager && credential.cantonContractId) {
      try {
        // For Canton recovery, we need to exercise the RequestRecovery choice
        // This requires signing with the wallet's key, which we don't have during recovery
        // So we fetch the contract data directly
        const contracts = await cantonManager.getPasskeyContracts(partyId);
        const contract = contracts.find(
          (c) => c.credentialId === credential.credentialId
        );

        if (contract) {
          logger.info({ partyId }, 'Retrieved encrypted share from Canton contract');
          return {
            encryptedShare: contract.encryptedRecoveryShare,
            nonce: contract.encryptionNonce,
            walletId: credential.walletId,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ partyId, errorMessage }, 'Failed to retrieve from Canton, falling back to local');
      }
    }

    // Fallback: The encrypted share is stored on Canton during registration
    // For now, we need to indicate that the share should be decrypted client-side
    // since the actual encrypted share is on the Canton contract

    throw new Error(
      'Passkey verification succeeded but encrypted share not found. ' +
      'Please ensure passkey was registered with recovery share.'
    );
  }

  /**
   * Revoke a passkey credential.
   *
   * @param credentialId - The credential ID to revoke
   * @param walletId - The wallet owning this credential
   * @param userShareHex - User's share to sign Canton tx (if applicable)
   */
  async revokeCredential(
    credentialId: string,
    walletId: string,
    userShareHex?: string
  ): Promise<void> {
    // Find the credential
    const [credential] = await db
      .select()
      .from(passkeyCredentials)
      .where(
        and(
          eq(passkeyCredentials.credentialId, credentialId),
          eq(passkeyCredentials.walletId, walletId)
        )
      )
      .limit(1);

    if (!credential) {
      throw new Error('Passkey credential not found');
    }

    // Revoke on Canton if contract exists
    const cantonManager = await this.getCantonManagerAsync();
    if (cantonManager && credential.cantonContractId && userShareHex) {
      try {
        const [wallet] = await db
          .select()
          .from(wallets)
          .where(eq(wallets.id, walletId))
          .limit(1);

        if (wallet) {
          const signHash = await this.createSignFunction(walletId, userShareHex);
          await cantonManager.revokeCredential(
            credential.cantonContractId,
            wallet.partyId,
            signHash
          );
          logger.info({ credentialId }, 'Passkey revoked on Canton');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ errorMessage }, 'Failed to revoke on Canton, continuing with local deletion');
      }
    }

    // Delete from local database
    await db
      .delete(passkeyCredentials)
      .where(eq(passkeyCredentials.id, credential.id));

    logger.info({ credentialId: credentialId.slice(0, 16) + '...' }, 'Passkey credential revoked');
  }

  /**
   * Create a one-time signing function for Canton transactions.
   * SECURITY: The returned function can only be used once. After the first call,
   * the private key is securely zeroed and subsequent calls will throw.
   */
  private async createSignFunction(
    walletId: string,
    userShareHex: string
  ): Promise<(hash: Uint8Array) => Uint8Array> {
    // Get server share
    const [stored] = await db
      .select()
      .from(serverShares)
      .where(eq(serverShares.walletId, walletId))
      .limit(1);

    if (!stored) {
      throw new Error('Server share not found');
    }

    const encryptionKey = hexToBytes(env.ENCRYPTION_KEY);
    const serverShareHex = decrypt(stored.encryptedShare, encryptionKey);

    const userShare = shareFromHex(userShareHex);
    const serverShare = shareFromHex(serverShareHex);

    const privateKey = reconstructEd25519Key([userShare, serverShare]);

    // Track if the signer has been used (one-time use pattern)
    let used = false;

    return (hash: Uint8Array): Uint8Array => {
      if (used) {
        throw new Error('Signing function has already been used and disposed');
      }

      try {
        const signature = ed25519Sign(hash, privateKey);
        return signature;
      } finally {
        // SECURITY: Securely zero private key after first use
        used = true;
        secureZero(privateKey);
      }
    };
  }

  // Utility methods

  private bytesToBase64Url(bytes: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private base64ToBytes(base64: string): Uint8Array {
    // Handle base64url encoding
    const base64Standard = base64.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64Standard.length % 4;
    const padded = padding ? base64Standard + '='.repeat(4 - padding) : base64Standard;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Convert WebAuthn signature format to DER format if needed.
   * WebAuthn signatures from ECDSA are already in the format expected by Web Crypto.
   */
  private convertWebAuthnSignatureToDER(signature: Uint8Array): Uint8Array {
    // WebAuthn ECDSA signatures are already in IEEE P1363 format (r || s)
    // which is what Web Crypto API expects, so no conversion needed
    return signature;
  }

  /**
   * Cleanup expired challenges.
   * Should be called periodically (e.g., via cron job).
   */
  async cleanupExpiredChallenges(): Promise<number> {
    const now = new Date();
    await db
      .delete(passkeyChallenges)
      .where(lt(passkeyChallenges.expiresAt, now));

    // Drizzle doesn't return count directly, so we log the action
    logger.debug('Cleaned up expired passkey challenges');
    return 0; // Would need to use raw SQL to get actual count
  }
}

// Export singleton instance
export const passkeyService = new PasskeyService();
