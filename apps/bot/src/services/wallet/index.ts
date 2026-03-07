import { eq } from 'drizzle-orm';
import { db, wallets, serverShares } from '../../db/index.js';
import {
  deriveEd25519PrivateKey,
  ed25519GetPublicKey,
  generate2of3Shares,
  shareToHex,
  shareFromHex,
  bytesToHex,
  secureZero,
  withReconstructedKey,
  reconstructEd25519Key,
  type Share,
} from '@repo/crypto';
import { encrypt, decrypt } from '@repo/crypto/encryption';
import { env } from '../../config/env.js';
import type { OfficialSDKClient } from '@repo/canton-client';
import { hexToBytes } from '@noble/hashes/utils';
import { logger } from '../../lib/logger.js';

export class WalletService {
  constructor(private sdk: OfficialSDKClient) {}

  /**
   * Create a wallet with Ed25519 key generation and 2-of-3 Shamir splitting.
   * Uses the Official Canton SDK for party creation.
   */
  async createWallet(
    userId: string,
    telegramId: string,
    clientPublicKeyHex?: string
  ): Promise<{
    walletId: string;
    partyId: string;
    publicKey: string;
    userShareHex: string;
    serverShareIndex: number;
    recoveryShareHex: string;
  }> {
    // Check for existing wallet
    const existing = await this.getWalletByUserId(userId);
    if (existing) {
      return {
        walletId: existing.id,
        partyId: existing.partyId,
        publicKey: existing.publicKey ?? '',
        userShareHex: '', // Already distributed
        serverShareIndex: 2,
        recoveryShareHex: '', // Already distributed
      };
    }

    // Generate Ed25519 key pair
    const privateKey = deriveEd25519PrivateKey(telegramId, env.APP_SECRET);
    const publicKey = ed25519GetPublicKey(privateKey);
    const publicKeyHex = clientPublicKeyHex ?? bytesToHex(publicKey);

    // Create external party on Canton Network using Official SDK
    const partyHint = `ccbot-${telegramId}`;

    let partyId: string;
    try {
      logger.info(
        { publicKeyHex, partyHint },
        'Creating external party on Canton via Official SDK'
      );

      // SECURITY: Create privateKeyHex inline and minimize its lifetime
      // Note: JavaScript strings cannot be zeroed from memory
      const setupResult = await this.sdk.setupWallet(bytesToHex(privateKey), partyHint);
      partyId = setupResult.partyId;

      logger.info(
        { partyId, preapproval: setupResult.preapprovalContractId },
        'Wallet setup completed on Canton'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ errorMessage, errorStack }, 'Failed to create party on Canton');

      // Check if party already exists with this hint
      const existingByKey = await db
        .select()
        .from(wallets)
        .where(eq(wallets.publicKey, publicKeyHex))
        .limit(1);

      const existingWallet = existingByKey[0];
      if (existingWallet && existingWallet.partyId.includes('::1220')) {
        partyId = existingWallet.partyId;
        logger.info({ partyId }, 'Found existing Canton party for this key');
      } else {
        // Fallback to local party ID for development/testing
        partyId = `ccbot-${publicKeyHex.slice(0, 32)}`;
        logger.warn({ partyId }, 'Using fallback local party ID');
      }
    }

    // Split into 2-of-3 Shamir shares
    const { userShare, serverShare, recoveryShare } = generate2of3Shares(privateKey);

    // SECURITY: Securely zero original private key immediately after use
    secureZero(privateKey);

    // Store wallet
    const [wallet] = await db
      .insert(wallets)
      .values({
        userId,
        partyId,
        publicKey: publicKeyHex,
        isPrimary: true,
      })
      .returning();

    if (!wallet) {
      throw new Error('Failed to create wallet');
    }

    // Encrypt and store server share
    const encryptionKey = hexToBytes(env.ENCRYPTION_KEY);
    const encryptedShare = encrypt(shareToHex(serverShare), encryptionKey);

    await db.insert(serverShares).values({
      walletId: wallet.id,
      encryptedShare,
      shareIndex: serverShare.index,
    });

    // Get user share hex before zeroing
    const userShareHex = shareToHex(userShare);

    return {
      walletId: wallet.id,
      partyId,
      publicKey: publicKeyHex,
      userShareHex,
      serverShareIndex: serverShare.index,
      recoveryShareHex: shareToHex(recoveryShare),
    };
  }

  /**
   * Retrieve the server's Shamir share for signing operations.
   */
  async getServerShare(walletId: string): Promise<Share> {
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

  async getWalletByUserId(userId: string) {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    return wallet ?? null;
  }

  async getWalletByPartyId(partyId: string) {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.partyId, partyId)).limit(1);
    return wallet ?? null;
  }

  /**
   * Get balance using Official SDK.
   */
  async getBalance(partyId: string, token: string = 'CC') {
    return this.sdk.getBalance(partyId, token);
  }

  /**
   * List all holdings (UTXOs) for a party.
   */
  async listHoldings(partyId: string) {
    return this.sdk.listHoldings(partyId);
  }

  /**
   * Merge UTXOs for a wallet (requires private key reconstruction).
   * Returns the number of UTXOs before merge.
   * SECURITY: Uses withReconstructedKey for automatic memory cleanup.
   */
  async mergeUtxos(walletId: string, userShareHex: string): Promise<{ mergedCount: number }> {
    // Get wallet by ID
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Check current UTXO count
    const holdingsBefore = await this.sdk.listHoldings(wallet.partyId);
    const utxoCountBefore = holdingsBefore.length;

    if (utxoCountBefore <= 1) {
      logger.info({ partyId: wallet.partyId, utxoCount: utxoCountBefore }, 'No UTXOs to merge');
      return { mergedCount: 0 };
    }

    // Reconstruct private key from shares
    const serverShare = await this.getServerShare(walletId);
    const userShare = shareFromHex(userShareHex);

    // SECURITY: Use withReconstructedKey for automatic memory cleanup
    return withReconstructedKey([userShare, serverShare], async (privateKeyHex) => {
      await this.sdk.mergeUtxos(wallet.partyId, privateKeyHex);

      // Check UTXO count after merge
      const holdingsAfter = await this.sdk.listHoldings(wallet.partyId);
      const mergedCount = utxoCountBefore - holdingsAfter.length;

      logger.info(
        {
          partyId: wallet.partyId,
          before: utxoCountBefore,
          after: holdingsAfter.length,
          merged: mergedCount,
        },
        'UTXOs merged successfully'
      );

      return { mergedCount };
    });
  }

  /**
   * Get UTXO count for a wallet.
   */
  async getUtxoCount(partyId: string): Promise<number> {
    const holdings = await this.sdk.listHoldings(partyId);
    return holdings.length;
  }

  /**
   * Validate a user share by reconstructing the key and checking against wallet's public key.
   * Used for PIN unlock verification.
   */
  async validateUserShare(
    userId: string,
    userShareHex: string
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      // 1. Get user's wallet
      const wallet = await this.getWalletByUserId(userId);
      if (!wallet) {
        return { valid: false, error: 'NO_WALLET' };
      }

      // 2. Parse user share
      let userShare: Share;
      try {
        userShare = shareFromHex(userShareHex);
      } catch {
        return { valid: false, error: 'INVALID_SHARE_FORMAT' };
      }

      // 3. Get server share
      let serverShare: Share;
      try {
        serverShare = await this.getServerShare(wallet.id);
      } catch {
        return { valid: false, error: 'NO_SERVER_SHARE' };
      }

      // 4. Reconstruct private key and derive public key
      const privateKey = reconstructEd25519Key([userShare, serverShare]);
      const publicKey = ed25519GetPublicKey(privateKey);
      const publicKeyHex = bytesToHex(publicKey);

      // 5. Securely zero private key immediately
      secureZero(privateKey);

      // 6. Compare with wallet's stored public key
      if (publicKeyHex !== wallet.publicKey) {
        return { valid: false, error: 'SHARE_MISMATCH' };
      }

      return { valid: true };
    } catch (error) {
      logger.error({ userId, error }, 'Share validation failed');
      return { valid: false, error: 'VALIDATION_FAILED' };
    }
  }

  /**
   * Recover a wallet using recovery share (share 3).
   * Combines with server share (share 2) to reconstruct the private key,
   * then generates new 2-of-3 shares.
   *
   * @param walletId - The wallet ID to recover
   * @param recoveryShareHex - The recovery share in hex format (share index 3)
   * @returns New user share, recovery share, and server share index
   */
  async recoverWallet(
    walletId: string,
    recoveryShareHex: string
  ): Promise<{
    userShareHex: string;
    recoveryShareHex: string;
    serverShareIndex: number;
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

    // Get server share
    const serverShare = await this.getServerShare(walletId);

    // Parse recovery share
    const recoveryShare = shareFromHex(recoveryShareHex);

    // Verify recovery share is index 3 (recovery)
    if (recoveryShare.index !== 3) {
      throw new Error('Invalid recovery share: expected share index 3');
    }

    // Reconstruct the private key from recovery share (3) + server share (2)
    const { reconstructEd25519Key } = await import('@repo/crypto');
    const privateKey = reconstructEd25519Key([recoveryShare, serverShare]);

    try {
      // Generate new 2-of-3 shares
      const { userShare: newUserShare, serverShare: newServerShare, recoveryShare: newRecoveryShare } =
        generate2of3Shares(privateKey);

      // Encrypt and update server share in database
      const encryptionKey = hexToBytes(env.ENCRYPTION_KEY);
      const encryptedShare = encrypt(shareToHex(newServerShare), encryptionKey);

      // Update server share
      await db
        .update(serverShares)
        .set({
          encryptedShare,
          shareIndex: newServerShare.index,
        })
        .where(eq(serverShares.walletId, walletId));

      logger.info({ walletId }, 'Wallet recovery completed - new shares generated');

      return {
        userShareHex: shareToHex(newUserShare),
        recoveryShareHex: shareToHex(newRecoveryShare),
        serverShareIndex: newServerShare.index,
      };
    } finally {
      // Zero private key memory
      secureZero(privateKey);
    }
  }

  /**
   * Create a TransferPreapproval for a wallet to receive Token Standard transfers.
   */
  async createPreapproval(
    telegramId: string,
    partyId: string
  ): Promise<{ contractId: string }> {
    // Derive the private key for signing
    const privateKey = deriveEd25519PrivateKey(telegramId, env.APP_SECRET);
    const privateKeyHex = bytesToHex(privateKey);

    try {
      logger.info({ partyId }, 'Creating TransferPreapproval');
      const result = await this.sdk.createPreapproval(partyId, privateKeyHex);
      logger.info({ partyId, contractId: result.contractId }, 'TransferPreapproval created');
      return result;
    } finally {
      // Zero private key memory
      secureZero(privateKey);
    }
  }

  /**
   * List pending incoming transfers (Token Standard 2-step transfers awaiting acceptance).
   */
  async listPendingTransfers(partyId: string): Promise<Array<{
    contractId: string;
    sender: string;
    receiver: string;
    amount: string;
  }>> {
    return this.sdk.listPendingTransfers(partyId);
  }

  /**
   * Accept all pending incoming transfers for a wallet.
   * This converts TransferInstruction contracts into Holding contracts.
   */
  async acceptPendingTransfers(
    telegramId: string,
    partyId: string
  ): Promise<{ accepted: number; failed: number; errors: string[] }> {
    // Derive the private key for signing
    const privateKey = deriveEd25519PrivateKey(telegramId, env.APP_SECRET);
    const privateKeyHex = bytesToHex(privateKey);

    try {
      logger.info({ partyId }, 'Accepting pending transfers');
      const result = await this.sdk.acceptAllPendingTransfers(partyId, privateKeyHex);
      logger.info(
        { partyId, accepted: result.accepted, failed: result.failed },
        'Pending transfers processed'
      );
      return result;
    } finally {
      // Zero private key memory
      secureZero(privateKey);
    }
  }

  /**
   * Reject a specific pending incoming transfer.
   * This declines the TransferInstruction, returning funds to sender.
   */
  async rejectPendingTransfer(
    walletId: string,
    transferInstructionCid: string,
    userShareHex: string
  ): Promise<{ success: boolean; error?: string }> {
    // Find the wallet
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
    if (!wallet) {
      return { success: false, error: 'Wallet not found' };
    }

    try {
      // Get server share (decrypted)
      const serverShare = await this.getServerShare(walletId);

      // Parse user share
      const userShare: Share = shareFromHex(userShareHex);

      logger.info({ walletId, transferInstructionCid }, 'Rejecting pending transfer');

      // Use withReconstructedKey for automatic memory cleanup
      const result = await withReconstructedKey([userShare, serverShare], async (privateKeyHex) => {
        return this.sdk.rejectTransferInstruction(
          wallet.partyId,
          transferInstructionCid,
          privateKeyHex
        );
      });

      if (result.success) {
        logger.info({ walletId, transferInstructionCid }, 'Pending transfer rejected');
      } else {
        logger.warn({ walletId, transferInstructionCid, error: result.error }, 'Failed to reject transfer');
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ walletId, transferInstructionCid, error: errorMessage }, 'Error rejecting pending transfer');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Reconstruct the private key from user share and server share.
   *
   * SECURITY WARNING: The returned private key must be securely zeroed after use.
   * Prefer using withReconstructedKey() when possible for automatic cleanup.
   *
   * This method is provided for cases where the operation needs to be performed
   * outside of this service (e.g., swap service).
   */
  async reconstructPrivateKey(walletId: string, userShareHex: string): Promise<string> {
    const serverShare = await this.getServerShare(walletId);
    const userShare = shareFromHex(userShareHex);

    const privateKey = reconstructEd25519Key([userShare, serverShare]);
    const privateKeyHex = bytesToHex(privateKey);

    // Zero the raw key bytes (the hex string caller gets is their responsibility)
    secureZero(privateKey);

    return privateKeyHex;
  }
}
