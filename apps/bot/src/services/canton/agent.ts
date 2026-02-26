/**
 * Canton Agent Service
 *
 * Unified service for all Canton Network operations with:
 * - Connection management and health checks
 * - Retry mechanism with exponential backoff
 * - Devnet-specific features (faucet, setup validation)
 * - Metrics collection
 * - Error recovery
 */

import { OfficialSDKClient, type OfficialSDKConfig } from '@repo/canton-client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { simulationService } from './simulation.js';

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
} as const;

// Health check configuration
const HEALTH_CHECK_CONFIG = {
  intervalMs: 30000, // 30 seconds
  timeoutMs: 5000,
  unhealthyThreshold: 3,
} as const;

// Metrics keys
const METRICS_KEYS = {
  operationCount: 'canton:metrics:operations',
  errorCount: 'canton:metrics:errors',
  latency: 'canton:metrics:latency',
  lastHealthCheck: 'canton:health:last_check',
  healthStatus: 'canton:health:status',
} as const;

export interface AgentHealthStatus {
  isHealthy: boolean;
  ledgerConnected: boolean;
  validatorAccessible: boolean;
  lastCheckAt: string;
  consecutiveFailures: number;
  latencyMs: number | null;
}

export interface AgentMetrics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatencyMs: number;
  operationsByType: Record<string, number>;
  errorsByType: Record<string, number>;
}

export interface DevnetSetupStatus {
  ledgerConnected: boolean;
  validatorAccessible: boolean;
  dsoPartyConfigured: boolean;
  providerPartyConfigured: boolean;
  networkType: string;
  errors: string[];
}

type OperationType =
  | 'getBalance'
  | 'sendTransfer'
  | 'createParty'
  | 'createPreapproval'
  | 'getPreapproval'
  | 'setupWallet'
  | 'listHoldings'
  | 'mergeUtxos'
  | 'getTransactionHistory'
  | 'getCCPrice'
  | 'healthCheck'
  | 'faucetRequest';

/**
 * Canton Agent Service
 *
 * Provides a robust, production-ready interface to Canton Network
 * with automatic retries, health monitoring, and metrics.
 */
export class CantonAgentService {
  private sdk: OfficialSDKClient;
  private config: OfficialSDKConfig;
  private initialized = false;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private isHealthy = true;
  private readonly simulationMode: boolean;

  constructor() {
    this.simulationMode = env.CANTON_SIMULATION_MODE;

    this.config = {
      network: env.CANTON_NETWORK,
      ledgerApiUrl: env.CANTON_LEDGER_API_URL ?? '',
      jsonApiUrl: env.CANTON_LEDGER_API_URL ?? '',
      participantId: env.CANTON_PARTICIPANT_ID ?? '',
      validatorUrl: env.CANTON_VALIDATOR_API_URL ?? env.CANTON_LEDGER_API_URL ?? '',
      ledgerApiUser: env.CANTON_LEDGER_API_USER ?? 'ledger-api-user',
      validatorAudience: env.CANTON_VALIDATOR_AUDIENCE ?? 'https://validator.example.com',
      useUnsafeAuth: env.CANTON_NETWORK === 'devnet' || env.NODE_ENV !== 'production',
      unsafeSecret: env.APP_SECRET,
      ...(env.CANTON_DSO_PARTY_ID && { dsoPartyId: env.CANTON_DSO_PARTY_ID }),
      ...(env.CANTON_PROVIDER_PARTY_ID && { providerPartyId: env.CANTON_PROVIDER_PARTY_ID }),
    };

    this.sdk = new OfficialSDKClient(this.config);

    if (this.simulationMode) {
      logger.info('[SIMULATION MODE] Canton operations will be simulated locally');
    }
  }

  // ============================================================
  // Connection Management
  // ============================================================

  /**
   * Initialize the agent and connect to Canton Network.
   */
  async connect(): Promise<void> {
    if (this.initialized) {
      logger.debug('Canton agent already initialized');
      return;
    }

    const startTime = Date.now();

    // Simulation mode: skip real connection
    if (this.simulationMode) {
      this.initialized = true;
      this.isHealthy = true;
      logger.info('[SIMULATION] Canton agent initialized in simulation mode');
      return;
    }

    try {
      logger.info({ network: this.config.network }, 'Connecting to Canton Network...');

      await this.sdk.initialize();
      this.initialized = true;
      this.isHealthy = true;
      this.consecutiveFailures = 0;

      const latency = Date.now() - startTime;
      await this.recordMetric('healthCheck', latency, true);

      logger.info(
        {
          network: this.config.network,
          ledgerUrl: this.config.ledgerApiUrl,
          latencyMs: latency,
        },
        'Connected to Canton Network'
      );
    } catch (error) {
      this.isHealthy = false;
      await this.recordMetric('healthCheck', Date.now() - startTime, false);
      logger.error({ err: error }, 'Failed to connect to Canton Network');
      throw error;
    }
  }

  /**
   * Disconnect and cleanup resources.
   */
  disconnect(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.initialized = false;
    this.isHealthy = false;
    logger.info('Disconnected from Canton Network');
  }

  /**
   * Reconnect to Canton Network (useful after failures).
   */
  async reconnect(): Promise<void> {
    logger.info('Reconnecting to Canton Network...');
    this.initialized = false;
    this.sdk = new OfficialSDKClient(this.config);
    await this.connect();
  }

  /**
   * Start periodic health checks.
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck().catch((err: unknown) => {
        logger.error({ err }, 'Health check failed');
      });
    }, HEALTH_CHECK_CONFIG.intervalMs);

    logger.info({ intervalMs: HEALTH_CHECK_CONFIG.intervalMs }, 'Canton health checks started');
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Canton health checks stopped');
    }
  }

  // ============================================================
  // Health Checks
  // ============================================================

  /**
   * Perform a health check against Canton Network.
   */
  async performHealthCheck(): Promise<AgentHealthStatus> {
    const startTime = Date.now();
    let ledgerConnected = false;
    let validatorAccessible = false;

    try {
      // Check ledger connectivity by fetching price (lightweight operation)
      await Promise.race([
        this.sdk.getCCPrice(),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Health check timeout'));
          }, HEALTH_CHECK_CONFIG.timeoutMs);
        }),
      ]);

      ledgerConnected = true;
      validatorAccessible = true;
      this.consecutiveFailures = 0;
      this.isHealthy = true;
    } catch {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= HEALTH_CHECK_CONFIG.unhealthyThreshold) {
        this.isHealthy = false;
        logger.warn(
          { consecutiveFailures: this.consecutiveFailures },
          'Canton Network marked as unhealthy'
        );
      }
    }

    const latencyMs = Date.now() - startTime;
    const status: AgentHealthStatus = {
      isHealthy: this.isHealthy,
      ledgerConnected,
      validatorAccessible,
      lastCheckAt: new Date().toISOString(),
      consecutiveFailures: this.consecutiveFailures,
      latencyMs: ledgerConnected ? latencyMs : null,
    };

    // Store health status in Redis
    await redis.set(
      METRICS_KEYS.healthStatus,
      JSON.stringify(status),
      'EX',
      HEALTH_CHECK_CONFIG.intervalMs / 1000 + 10
    );

    return status;
  }

  /**
   * Get the current health status.
   */
  async getHealthStatus(): Promise<AgentHealthStatus> {
    const cached = await redis.get(METRICS_KEYS.healthStatus);

    if (cached) {
      return JSON.parse(cached) as AgentHealthStatus;
    }

    return this.performHealthCheck();
  }

  /**
   * Validate devnet setup configuration.
   */
  async validateDevnetSetup(): Promise<DevnetSetupStatus> {
    const errors: string[] = [];
    let ledgerConnected = false;
    let validatorAccessible = false;

    // Check ledger connection
    try {
      await this.ensureConnected();
      ledgerConnected = true;
    } catch (error) {
      errors.push(`Ledger connection failed: ${String(error)}`);
    }

    // Check validator
    try {
      await this.sdk.getCCPrice();
      validatorAccessible = true;
    } catch (error) {
      errors.push(`Validator not accessible: ${String(error)}`);
    }

    // Check DSO party
    const dsoPartyConfigured = !!this.config.dsoPartyId;
    if (!dsoPartyConfigured) {
      errors.push('DSO party ID not configured (CANTON_DSO_PARTY_ID)');
    }

    // Check provider party
    const providerPartyConfigured = !!this.config.providerPartyId;
    if (!providerPartyConfigured) {
      errors.push('Provider party ID not configured (CANTON_PROVIDER_PARTY_ID)');
    }

    return {
      ledgerConnected,
      validatorAccessible,
      dsoPartyConfigured,
      providerPartyConfigured,
      networkType: this.config.network,
      errors,
    };
  }

  // ============================================================
  // Core Operations (with retry)
  // ============================================================

  /**
   * Get balance for a party with retry.
   */
  async getBalance(partyId: string): Promise<{
    token: string;
    amount: string;
    locked: string;
  }> {
    if (this.simulationMode) {
      return simulationService.getBalance(partyId);
    }

    return this.withRetry('getBalance', async () => {
      await this.ensureConnected();
      return this.sdk.getBalance(partyId);
    });
  }

  /**
   * Send CC transfer with retry.
   */
  async sendTransfer(
    fromParty: string,
    toParty: string,
    amount: string,
    privateKeyHex: string,
    memo?: string
  ): Promise<{ txHash: string; status: string; updateId?: string }> {
    if (this.simulationMode) {
      return simulationService.sendTransfer(fromParty, toParty, amount, privateKeyHex, memo);
    }

    return this.withRetry('sendTransfer', async () => {
      await this.ensureConnected();
      return this.sdk.sendCC(
        {
          fromParty,
          toParty,
          token: 'CC',
          amount,
          ...(memo && { memo }),
        },
        privateKeyHex
      );
    });
  }

  /**
   * Create external party with retry.
   */
  async createParty(
    privateKeyHex: string,
    partyHint?: string
  ): Promise<{
    partyId: string;
    publicKey: string;
    topologyTxHashes: string[];
  }> {
    if (this.simulationMode) {
      return simulationService.createParty(privateKeyHex, partyHint);
    }

    return this.withRetry('createParty', async () => {
      await this.ensureConnected();
      return this.sdk.createExternalParty(privateKeyHex, partyHint);
    });
  }

  /**
   * Create transfer preapproval with retry.
   */
  async createPreapproval(
    partyId: string,
    privateKeyHex: string
  ): Promise<{
    contractId: string;
    receiver: string;
    provider: string;
  }> {
    if (this.simulationMode) {
      return simulationService.createPreapproval(partyId, privateKeyHex);
    }

    return this.withRetry('createPreapproval', async () => {
      await this.ensureConnected();
      return this.sdk.createPreapproval(partyId, privateKeyHex);
    });
  }

  /**
   * Get preapproval status with retry.
   */
  async getPreapproval(partyId: string): Promise<{
    contractId: string;
    receiver: string;
    provider: string;
    expiresAt?: string;
  } | null> {
    if (this.simulationMode) {
      return simulationService.getPreapproval(partyId);
    }

    return this.withRetry('getPreapproval', async () => {
      await this.ensureConnected();
      return this.sdk.getPreapproval(partyId);
    });
  }

  /**
   * Full wallet setup (party + preapproval) with retry.
   */
  async setupWallet(
    privateKeyHex: string,
    displayName?: string
  ): Promise<{
    partyId: string;
    preapprovalContractId?: string;
  }> {
    if (this.simulationMode) {
      return simulationService.setupWallet(privateKeyHex, displayName);
    }

    return this.withRetry('setupWallet', async () => {
      await this.ensureConnected();
      return this.sdk.setupWallet(privateKeyHex, displayName);
    });
  }

  /**
   * List holding UTXOs with retry.
   */
  async listHoldings(partyId: string): Promise<
    Array<{
      contractId: string;
      amount: string;
      owner: string;
      provider: string;
    }>
  > {
    if (this.simulationMode) {
      return simulationService.listHoldings(partyId);
    }

    return this.withRetry('listHoldings', async () => {
      await this.ensureConnected();
      return this.sdk.listHoldings(partyId);
    });
  }

  /**
   * Merge UTXOs with retry.
   */
  async mergeUtxos(partyId: string, privateKeyHex: string): Promise<void> {
    if (this.simulationMode) {
      return simulationService.mergeUtxos(partyId, privateKeyHex);
    }

    return this.withRetry('mergeUtxos', async () => {
      await this.ensureConnected();
      return this.sdk.mergeUtxos(partyId, privateKeyHex);
    });
  }

  /**
   * Get transaction history with retry.
   */
  async getTransactionHistory(
    partyId: string,
    limit: number = 50,
    afterOffset?: string
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
    if (this.simulationMode) {
      return simulationService.getTransactionHistory(partyId, limit, afterOffset);
    }

    return this.withRetry('getTransactionHistory', async () => {
      await this.ensureConnected();
      return this.sdk.getTransactionHistory(partyId, limit, afterOffset);
    });
  }

  /**
   * Get CC price with retry.
   */
  async getCCPrice(): Promise<{
    price: number;
    round: number;
    amuletPriceUsd: number;
    rewardRate: number;
  }> {
    if (this.simulationMode) {
      return simulationService.getCCPrice();
    }

    return this.withRetry('getCCPrice', async () => {
      await this.ensureConnected();
      return this.sdk.getCCPrice();
    });
  }

  // ============================================================
  // Devnet Features
  // ============================================================

  /**
   * Request funds from devnet faucet.
   * Only available on devnet/testnet.
   */
  async requestFaucetFunds(
    partyId: string,
    amount: string = '1000.0'
  ): Promise<{ success: boolean; txHash?: string; message: string }> {
    if (this.config.network === 'mainnet') {
      return {
        success: false,
        message: 'Faucet not available on mainnet',
      };
    }

    // Simulation mode: use simulated faucet
    if (this.simulationMode) {
      return simulationService.requestFaucetFunds(partyId, amount);
    }

    try {
      await this.ensureConnected();

      // Devnet faucet endpoint (if available)
      const faucetUrl = env.CANTON_FAUCET_URL;

      if (!faucetUrl) {
        logger.warn('No faucet URL configured for devnet');
        return {
          success: false,
          message: 'Faucet URL not configured (CANTON_FAUCET_URL)',
        };
      }

      const response = await fetch(`${faucetUrl}/api/faucet/tap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partyId,
          amount,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Faucet request failed');
        return {
          success: false,
          message: `Faucet request failed: ${errorText}`,
        };
      }

      const result = (await response.json()) as { txHash?: string };

      await this.recordMetric('faucetRequest', 0, true);

      return {
        success: true,
        ...(result.txHash && { txHash: result.txHash }),
        message: `Requested ${amount} CC from faucet`,
      };
    } catch (error) {
      await this.recordMetric('faucetRequest', 0, false);
      logger.error({ err: error, partyId }, 'Faucet request error');
      return {
        success: false,
        message: `Faucet error: ${String(error)}`,
      };
    }
  }

  /**
   * Check faucet availability.
   */
  async checkFaucetAvailability(): Promise<{
    available: boolean;
    network: string;
    message: string;
  }> {
    if (this.config.network === 'mainnet') {
      return {
        available: false,
        network: 'mainnet',
        message: 'Faucet not available on mainnet',
      };
    }

    const faucetUrl = env.CANTON_FAUCET_URL;

    if (!faucetUrl) {
      return {
        available: false,
        network: this.config.network,
        message: 'Faucet URL not configured',
      };
    }

    try {
      const response = await fetch(`${faucetUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      return {
        available: response.ok,
        network: this.config.network,
        message: response.ok ? 'Faucet is available' : 'Faucet is not responding',
      };
    } catch {
      return {
        available: false,
        network: this.config.network,
        message: 'Faucet is not reachable',
      };
    }
  }

  // ============================================================
  // Metrics
  // ============================================================

  /**
   * Get agent metrics.
   */
  async getMetrics(): Promise<AgentMetrics> {
    const operationsData = await redis.hgetall(METRICS_KEYS.operationCount);
    const errorsData = await redis.hgetall(METRICS_KEYS.errorCount);
    const latencyData = await redis.hgetall(METRICS_KEYS.latency);

    let totalOperations = 0;
    let failedOperations = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    const operationsByType: Record<string, number> = {};
    const errorsByType: Record<string, number> = {};

    for (const [key, value] of Object.entries(operationsData)) {
      const count = parseInt(value, 10);
      operationsByType[key] = count;
      totalOperations += count;
    }

    for (const [key, value] of Object.entries(errorsData)) {
      const count = parseInt(value, 10);
      errorsByType[key] = count;
      failedOperations += count;
    }

    for (const value of Object.values(latencyData)) {
      const latency = parseFloat(value);
      if (!isNaN(latency)) {
        totalLatency += latency;
        latencyCount++;
      }
    }

    return {
      totalOperations,
      successfulOperations: totalOperations - failedOperations,
      failedOperations,
      averageLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      operationsByType,
      errorsByType,
    };
  }

  /**
   * Reset metrics.
   */
  async resetMetrics(): Promise<void> {
    await redis.del(METRICS_KEYS.operationCount);
    await redis.del(METRICS_KEYS.errorCount);
    await redis.del(METRICS_KEYS.latency);
    logger.info('Canton agent metrics reset');
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * Ensure the SDK is connected.
   */
  private async ensureConnected(): Promise<void> {
    if (!this.initialized) {
      await this.connect();
    }
  }

  /**
   * Execute operation with retry and exponential backoff.
   */
  private async withRetry<T>(
    operationType: OperationType,
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        const result = await operation();

        // Record success metrics
        const latency = Date.now() - startTime;
        await this.recordMetric(operationType, latency, true);

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        logger.warn(
          {
            operationType,
            attempt,
            maxAttempts: RETRY_CONFIG.maxAttempts,
            error: lastError.message,
          },
          'Canton operation failed, retrying...'
        );

        // Don't retry on the last attempt
        if (attempt < RETRY_CONFIG.maxAttempts) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1),
            RETRY_CONFIG.maxDelayMs
          );
          await this.sleep(delay);
        }
      }
    }

    // Record failure metrics
    const latency = Date.now() - startTime;
    await this.recordMetric(operationType, latency, false);

    const finalError = lastError ?? new Error('Operation failed with unknown error');

    logger.error(
      {
        operationType,
        attempts: RETRY_CONFIG.maxAttempts,
        error: finalError.message,
      },
      'Canton operation failed after all retries'
    );

    throw finalError;
  }

  /**
   * Record operation metrics.
   */
  private async recordMetric(
    operationType: OperationType,
    latencyMs: number,
    success: boolean
  ): Promise<void> {
    try {
      // Increment operation count
      await redis.hincrby(METRICS_KEYS.operationCount, operationType, 1);

      // Record latency (rolling average)
      await redis.hset(METRICS_KEYS.latency, operationType, String(latencyMs));

      // Increment error count if failed
      if (!success) {
        await redis.hincrby(METRICS_KEYS.errorCount, operationType, 1);
      }

      // Set TTL for metrics (24 hours)
      await redis.expire(METRICS_KEYS.operationCount, 86400);
      await redis.expire(METRICS_KEYS.latency, 86400);
      await redis.expire(METRICS_KEYS.errorCount, 86400);
    } catch (error) {
      // Don't fail the operation if metrics recording fails
      logger.debug({ err: error }, 'Failed to record Canton metrics');
    }
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // Accessors
  // ============================================================

  /**
   * Get the underlying SDK client.
   */
  getSDK(): OfficialSDKClient {
    return this.sdk;
  }

  /**
   * Check if agent is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if agent is healthy.
   */
  isAgentHealthy(): boolean {
    return this.isHealthy;
  }

  /**
   * Get network type.
   */
  getNetwork(): string {
    return this.config.network;
  }

  /**
   * Check if running in simulation mode.
   */
  isSimulationMode(): boolean {
    return this.simulationMode;
  }
}

// Singleton instance
let agentInstance: CantonAgentService | null = null;

/**
 * Get the Canton Agent Service singleton.
 */
export function getCantonAgent(): CantonAgentService {
  if (!agentInstance) {
    agentInstance = new CantonAgentService();
  }
  return agentInstance;
}

/**
 * Initialize the Canton Agent (call at startup).
 */
export async function initCantonAgent(): Promise<void> {
  const agent = getCantonAgent();
  await agent.connect();
  agent.startHealthChecks();
}

/**
 * Shutdown the Canton Agent (call at shutdown).
 */
export function shutdownCantonAgent(): void {
  if (agentInstance) {
    agentInstance.disconnect();
    agentInstance = null;
  }
}

/**
 * Reset the singleton (for testing).
 */
export function resetCantonAgent(): void {
  if (agentInstance) {
    agentInstance.stopHealthChecks();
  }
  agentInstance = null;
}
