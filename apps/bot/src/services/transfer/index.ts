import { eq } from 'drizzle-orm';
import { db, transactions, wallets, users } from '../../db/index.js';
import { shareFromHex, withReconstructedKey, deriveEd25519PrivateKey, bytesToHex, secureZero, type Share } from '@repo/crypto';
import type { OfficialSDKClient, TokenSymbol } from '@repo/canton-client';
import type { WalletService } from '../wallet/index.js';
import { logger } from '../../lib/logger.js';
import { queueNotification } from '../../jobs/index.js';
import { env } from '../../config/env.js';

export class TransferService {
  constructor(
    private sdk: OfficialSDKClient,
    private walletService: WalletService
  ) {}

  /**
   * Execute a token transfer using the Official Canton SDK.
   * Supports CC and USDCx tokens.
   *
   * 1. Get wallet from DB
   * 2. Retrieve server share (Share 2) from DB
   * 3. Accept user share (Share 1) from client
   * 4. Reconstruct Ed25519 private key
   * 5. Use Official SDK to sign and submit transfer
   * 6. Record transaction in DB
   */
  async sendToken(
    walletId: string,
    receiverPartyId: string,
    amount: string,
    userShareHex: string,
    token: TokenSymbol = 'CC',
    memo?: string
  ): Promise<{ txHash: string; status: string; transactionId: string }> {
    // Get wallet
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Get server share
    const serverShare = await this.walletService.getServerShare(walletId);

    // Parse user share
    const userShare: Share = shareFromHex(userShareHex);

    // Record pending transaction
    const [transaction] = await db
      .insert(transactions)
      .values({
        walletId,
        type: 'send',
        status: 'pending',
        amount,
        token,
        fromParty: wallet.partyId,
        toParty: receiverPartyId,
        metadata: memo ? { memo } : {},
      })
      .returning();

    if (!transaction) {
      throw new Error('Failed to create transaction record');
    }

    try {
      logger.info(
        { from: wallet.partyId, to: receiverPartyId, amount, token },
        'Submitting transfer to Canton via Official SDK'
      );

      // SECURITY: Use withReconstructedKey for automatic memory cleanup
      // The private key is zeroed automatically after the operation completes
      const result = await withReconstructedKey([userShare, serverShare], async (privateKeyHex) => {
        // Use Official SDK to send token
        const transferRequest = {
          fromParty: wallet.partyId,
          toParty: receiverPartyId,
          token,
          amount,
          ...(memo && { memo }),
        };
        return this.sdk.sendToken(transferRequest, privateKeyHex, token);
      });

      // Update transaction status
      await db
        .update(transactions)
        .set({
          status: 'confirmed',
          txHash: result.txHash,
          confirmedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      logger.info(
        { txHash: result.txHash, from: wallet.partyId, to: receiverPartyId, amount, token },
        'Transfer completed via Official SDK'
      );

      // Queue notification for sender
      try {
        const [user] = await db
          .select({ telegramId: users.telegramId, email: users.email })
          .from(users)
          .where(eq(users.id, wallet.userId))
          .limit(1);

        if (user) {
          await queueNotification({
            type: 'outgoing_transfer',
            telegramId: user.telegramId,
            ...(user.email && { email: user.email }),
            data: { amount, toParty: receiverPartyId, token },
          });
        }
      } catch (notifyError) {
        // Don't fail the transfer if notification fails
        logger.error({ err: notifyError }, 'Failed to queue transfer notification');
      }

      return {
        txHash: result.txHash,
        status: result.status,
        transactionId: transaction.id,
      };
    } catch (error) {
      // Mark as failed
      await db
        .update(transactions)
        .set({ status: 'failed' })
        .where(eq(transactions.id, transaction.id));

      logger.error({ err: error, walletId, receiverPartyId, amount, token }, 'Transfer failed');
      throw error;
    }
  }

  /**
   * Execute a CC transfer (convenience method)
   */
  async sendCC(
    walletId: string,
    receiverPartyId: string,
    amount: string,
    userShareHex: string,
    memo?: string
  ): Promise<{ txHash: string; status: string; transactionId: string }> {
    return this.sendToken(walletId, receiverPartyId, amount, userShareHex, 'CC', memo);
  }

  /**
   * Get transaction history for a wallet.
   */
  async getHistory(walletId: string, page: number = 1, pageSize: number = 20) {
    const offset = (page - 1) * pageSize;

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, walletId))
      .orderBy(transactions.createdAt)
      .limit(pageSize)
      .offset(offset);

    return txs;
  }

  /**
   * DEV MODE ONLY: Send token using derived private key (no user share needed).
   * This bypasses the Shamir reconstruction and derives the key directly.
   * SECURITY: Only use this for development/testing!
   */
  async sendTokenDevMode(
    telegramId: string,
    receiverPartyId: string,
    amount: string,
    token: TokenSymbol = 'CC',
    memo?: string
  ): Promise<{ txHash: string; status: string; transactionId: string }> {
    // Get user and wallet
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      throw new Error('User not found');
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Record pending transaction
    const [transaction] = await db
      .insert(transactions)
      .values({
        walletId: wallet.id,
        type: 'send',
        status: 'pending',
        amount,
        token,
        fromParty: wallet.partyId,
        toParty: receiverPartyId,
        metadata: memo ? { memo } : {},
      })
      .returning();

    if (!transaction) {
      throw new Error('Failed to create transaction record');
    }

    // Derive private key directly (DEV MODE ONLY)
    const privateKey = deriveEd25519PrivateKey(telegramId, env.APP_SECRET);
    const privateKeyHex = bytesToHex(privateKey);

    try {
      logger.info(
        { from: wallet.partyId, to: receiverPartyId, amount, token },
        '[DEV MODE] Submitting transfer to Canton'
      );

      const transferRequest = {
        fromParty: wallet.partyId,
        toParty: receiverPartyId,
        token,
        amount,
        ...(memo && { memo }),
      };

      const result = await this.sdk.sendToken(transferRequest, privateKeyHex, token);

      // Update transaction status
      await db
        .update(transactions)
        .set({
          status: 'confirmed',
          txHash: result.txHash,
          confirmedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));

      logger.info(
        { txHash: result.txHash, from: wallet.partyId, to: receiverPartyId, amount, token },
        '[DEV MODE] Transfer completed'
      );

      return {
        txHash: result.txHash,
        status: result.status,
        transactionId: transaction.id,
      };
    } catch (error) {
      await db
        .update(transactions)
        .set({ status: 'failed' })
        .where(eq(transactions.id, transaction.id));

      logger.error({ err: error, telegramId, receiverPartyId, amount, token }, '[DEV MODE] Transfer failed');
      throw error;
    } finally {
      secureZero(privateKey);
    }
  }

  /**
   * DEV MODE ONLY: Send CC (convenience method)
   */
  async sendCCDevMode(
    telegramId: string,
    receiverPartyId: string,
    amount: string,
    memo?: string
  ): Promise<{ txHash: string; status: string; transactionId: string }> {
    return this.sendTokenDevMode(telegramId, receiverPartyId, amount, 'CC', memo);
  }
}
