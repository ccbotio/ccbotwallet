/**
 * Canton Simulation Service
 *
 * Provides simulated Canton Network operations for local development
 * without requiring a real Canton Network connection.
 *
 * All balances and transactions are stored in Redis for persistence.
 */

import { randomBytes } from 'node:crypto';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

// Redis key prefixes for simulation
const SIM_KEYS = {
  balance: 'sim:balance:',
  transactions: 'sim:txs:',
  parties: 'sim:parties:',
  price: 'sim:price',
} as const;

// Default initial balance for new wallets (in CC)
const DEFAULT_INITIAL_BALANCE = '100.0000000000';

// Simulated CC price
const SIMULATED_PRICE = {
  price: 0.163,
  round: 12345,
  amuletPriceUsd: 0.163,
  rewardRate: 0.0001,
};

export interface SimulatedTransaction {
  id: string;
  type: 'send' | 'receive';
  fromParty: string;
  toParty: string;
  amount: string;
  timestamp: string;
  txHash: string;
  status: 'confirmed' | 'pending' | 'failed';
  memo?: string;
}

/**
 * Canton Simulation Service
 *
 * Simulates Canton Network operations using Redis as the backend.
 */
export class CantonSimulationService {
  /**
   * Generate a simulated transaction hash
   */
  private generateTxHash(): string {
    return `sim-tx-${randomBytes(16).toString('hex')}`;
  }

  /**
   * Generate a simulated party ID
   */
  private generatePartyId(publicKeyHex: string, hint?: string): string {
    const prefix = hint ?? 'ccbot';
    const keyPart = publicKeyHex.slice(0, 64);
    return `${prefix}::1220${keyPart}`;
  }

  /**
   * Get balance for a party
   */
  async getBalance(partyId: string): Promise<{
    token: string;
    amount: string;
    locked: string;
  }> {
    const balanceKey = `${SIM_KEYS.balance}${partyId}`;
    let amount = await redis.get(balanceKey);

    // Initialize balance if not exists
    if (!amount) {
      amount = DEFAULT_INITIAL_BALANCE;
      await redis.set(balanceKey, amount);
      logger.info({ partyId, amount }, '[SIM] Initialized balance for party');
    }

    return {
      token: 'CC',
      amount,
      locked: '0.0000000000',
    };
  }

  /**
   * Set balance for a party (for testing/faucet)
   */
  async setBalance(partyId: string, amount: string): Promise<void> {
    const balanceKey = `${SIM_KEYS.balance}${partyId}`;
    await redis.set(balanceKey, amount);
    logger.info({ partyId, amount }, '[SIM] Set balance for party');
  }

  /**
   * Send CC transfer (simulation)
   */
  async sendTransfer(
    fromParty: string,
    toParty: string,
    amount: string,
    _privateKeyHex: string,
    memo?: string
  ): Promise<{ txHash: string; status: string; updateId: string }> {
    // Get sender balance
    const senderBalance = await this.getBalance(fromParty);
    const senderAmount = parseFloat(senderBalance.amount);
    const transferAmount = parseFloat(amount);

    // Check sufficient balance
    if (senderAmount < transferAmount) {
      throw new Error(`Insufficient balance: ${senderAmount} < ${transferAmount}`);
    }

    // Update sender balance
    const newSenderBalance = (senderAmount - transferAmount).toFixed(10);
    await redis.set(`${SIM_KEYS.balance}${fromParty}`, newSenderBalance);

    // Update receiver balance
    const receiverBalance = await this.getBalance(toParty);
    const receiverAmount = parseFloat(receiverBalance.amount);
    const newReceiverBalance = (receiverAmount + transferAmount).toFixed(10);
    await redis.set(`${SIM_KEYS.balance}${toParty}`, newReceiverBalance);

    // Create transaction record
    const txHash = this.generateTxHash();
    const updateId = `update-${randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();

    const senderTx: SimulatedTransaction = {
      id: `${txHash}-send`,
      type: 'send',
      fromParty,
      toParty,
      amount,
      timestamp: now,
      txHash,
      status: 'confirmed',
      ...(memo && { memo }),
    };

    const receiverTx: SimulatedTransaction = {
      id: `${txHash}-receive`,
      type: 'receive',
      fromParty,
      toParty,
      amount,
      timestamp: now,
      txHash,
      status: 'confirmed',
      ...(memo && { memo }),
    };

    // Store transactions
    await redis.lpush(`${SIM_KEYS.transactions}${fromParty}`, JSON.stringify(senderTx));
    await redis.lpush(`${SIM_KEYS.transactions}${toParty}`, JSON.stringify(receiverTx));

    // Trim to last 100 transactions
    await redis.ltrim(`${SIM_KEYS.transactions}${fromParty}`, 0, 99);
    await redis.ltrim(`${SIM_KEYS.transactions}${toParty}`, 0, 99);

    logger.info(
      { fromParty, toParty, amount, txHash },
      '[SIM] Transfer completed'
    );

    return {
      txHash,
      status: 'confirmed',
      updateId,
    };
  }

  /**
   * Create external party (simulation)
   */
  async createParty(
    publicKeyHex: string,
    partyHint?: string
  ): Promise<{
    partyId: string;
    publicKey: string;
    topologyTxHashes: string[];
  }> {
    const partyId = this.generatePartyId(publicKeyHex, partyHint);

    // Store party info
    await redis.hset(`${SIM_KEYS.parties}${partyId}`, {
      publicKey: publicKeyHex,
      createdAt: new Date().toISOString(),
    });

    // Initialize balance
    await this.setBalance(partyId, DEFAULT_INITIAL_BALANCE);

    logger.info({ partyId, publicKey: publicKeyHex.slice(0, 16) + '...' }, '[SIM] Party created');

    return {
      partyId,
      publicKey: publicKeyHex,
      topologyTxHashes: [this.generateTxHash()],
    };
  }

  /**
   * Setup wallet (simulation)
   */
  async setupWallet(
    publicKeyHex: string,
    displayName?: string
  ): Promise<{
    partyId: string;
    preapprovalContractId?: string;
  }> {
    const result = await this.createParty(publicKeyHex, displayName);

    return {
      partyId: result.partyId,
      preapprovalContractId: `preapproval-${randomBytes(8).toString('hex')}`,
    };
  }

  /**
   * Create preapproval (simulation)
   */
  async createPreapproval(
    partyId: string,
    _privateKeyHex: string
  ): Promise<{
    contractId: string;
    receiver: string;
    provider: string;
  }> {
    return {
      contractId: `preapproval-${randomBytes(8).toString('hex')}`,
      receiver: partyId,
      provider: 'sim-provider',
    };
  }

  /**
   * Get preapproval (simulation)
   */
  async getPreapproval(partyId: string): Promise<{
    contractId: string;
    receiver: string;
    provider: string;
    expiresAt?: string;
  } | null> {
    return {
      contractId: `preapproval-${partyId.slice(-16)}`,
      receiver: partyId,
      provider: 'sim-provider',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  /**
   * List holdings (simulation)
   */
  async listHoldings(partyId: string): Promise<
    Array<{
      contractId: string;
      amount: string;
      owner: string;
      provider: string;
    }>
  > {
    const balance = await this.getBalance(partyId);

    // Simulate 1-3 UTXOs
    const amount = parseFloat(balance.amount);
    if (amount <= 0) {
      return [];
    }

    return [
      {
        contractId: `utxo-${partyId.slice(-8)}-1`,
        amount: balance.amount,
        owner: partyId,
        provider: 'sim-provider',
      },
    ];
  }

  /**
   * Merge UTXOs (simulation - no-op)
   */
  async mergeUtxos(_partyId: string, _privateKeyHex: string): Promise<void> {
    logger.info('[SIM] UTXO merge simulated (no-op)');
  }

  /**
   * Get transaction history (simulation)
   */
  async getTransactionHistory(
    partyId: string,
    limit: number = 50,
    _afterOffset?: string
  ): Promise<
    Array<{
      updateId: string;
      type: 'send' | 'receive';
      amount: string;
      counterparty: string;
      timestamp: string;
      txHash: string;
    }>
  > {
    const txKey = `${SIM_KEYS.transactions}${partyId}`;
    const rawTxs = await redis.lrange(txKey, 0, limit - 1);

    return rawTxs.map((raw) => {
      const tx = JSON.parse(raw) as SimulatedTransaction;
      return {
        updateId: tx.id,
        type: tx.type,
        amount: tx.amount,
        counterparty: tx.type === 'send' ? tx.toParty : tx.fromParty,
        timestamp: tx.timestamp,
        txHash: tx.txHash,
      };
    });
  }

  /**
   * Get CC price (simulation)
   */
  async getCCPrice(): Promise<{
    price: number;
    round: number;
    amuletPriceUsd: number;
    rewardRate: number;
  }> {
    return SIMULATED_PRICE;
  }

  /**
   * Request faucet funds (simulation)
   */
  async requestFaucetFunds(
    partyId: string,
    amount: string = '1000.0'
  ): Promise<{ success: boolean; txHash?: string; message: string }> {
    const currentBalance = await this.getBalance(partyId);
    const newBalance = (parseFloat(currentBalance.amount) + parseFloat(amount)).toFixed(10);

    await this.setBalance(partyId, newBalance);

    const txHash = this.generateTxHash();

    // Create faucet transaction record
    const faucetTx: SimulatedTransaction = {
      id: `${txHash}-faucet`,
      type: 'receive',
      fromParty: 'faucet',
      toParty: partyId,
      amount,
      timestamp: new Date().toISOString(),
      txHash,
      status: 'confirmed',
      memo: 'Faucet funds',
    };

    await redis.lpush(`${SIM_KEYS.transactions}${partyId}`, JSON.stringify(faucetTx));

    logger.info({ partyId, amount, txHash }, '[SIM] Faucet funds sent');

    return {
      success: true,
      txHash,
      message: `Sent ${amount} CC from simulation faucet`,
    };
  }

  /**
   * Check if simulation mode is enabled
   */
  isSimulationMode(): boolean {
    return true;
  }
}

// Export singleton
export const simulationService = new CantonSimulationService();
