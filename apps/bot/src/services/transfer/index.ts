import { eq } from 'drizzle-orm';
import { db, transactions, wallets, users } from '../../db/index.js';
import { shareFromHex, withReconstructedKey, type Share } from '@repo/crypto';
import type { OfficialSDKClient } from '@repo/canton-client';
import type { WalletService } from '../wallet/index.js';
import { logger } from '../../lib/logger.js';
import { queueNotification } from '../../jobs/index.js';

export class TransferService {
  constructor(
    private sdk: OfficialSDKClient,
    private walletService: WalletService
  ) {}

  /**
   * Execute a CC transfer using the Official Canton SDK.
   * 1. Get wallet from DB
   * 2. Retrieve server share (Share 2) from DB
   * 3. Accept user share (Share 1) from client
   * 4. Reconstruct Ed25519 private key
   * 5. Use Official SDK to sign and submit transfer
   * 6. Record transaction in DB
   */
  async sendCC(
    walletId: string,
    receiverPartyId: string,
    amount: string,
    userShareHex: string,
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
        token: 'CC',
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
        { from: wallet.partyId, to: receiverPartyId, amount },
        'Submitting transfer to Canton via Official SDK'
      );

      // SECURITY: Use withReconstructedKey for automatic memory cleanup
      // The private key is zeroed automatically after the operation completes
      const result = await withReconstructedKey([userShare, serverShare], async (privateKeyHex) => {
        // Use Official SDK to send CC
        const transferRequest = {
          fromParty: wallet.partyId,
          toParty: receiverPartyId,
          token: 'CC',
          amount,
          ...(memo && { memo }),
        };
        return this.sdk.sendCC(transferRequest, privateKeyHex);
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
        { txHash: result.txHash, from: wallet.partyId, to: receiverPartyId, amount },
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
            data: { amount, toParty: receiverPartyId },
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

      logger.error({ err: error, walletId, receiverPartyId, amount }, 'Transfer failed');
      throw error;
    }
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
}
