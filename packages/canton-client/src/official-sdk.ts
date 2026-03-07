/**
 * Official Canton SDK Wrapper
 *
 * This module wraps the official @canton-network/wallet-sdk
 * to provide integration with Canton Network.
 */

import { createLogger } from '@repo/shared/logger';

const logger = createLogger('canton-sdk');

import {
  WalletSDKImpl,
  UnsafeAuthController,
  AuthTokenProvider,
  LedgerController,
  TokenStandardController,
  ValidatorController,
  signTransactionHash,
  createKeyPair,
  type Config,
  type WalletSDK,
} from '@canton-network/wallet-sdk';
import nacl from 'tweetnacl';

import type {
  CantonConfig,
  TokenBalance,
  TransferRequest,
  TransferResult,
  ExternalPartyResult,
  TransferPreapproval,
  WalletSetupResult,
  HoldingUtxo,
  SDKHoldingUtxo,
} from './types/index.js';

// ==================== Multi-Token Instrument Configuration ====================

/**
 * Token types supported by the wallet
 */
export type TokenSymbol = 'CC' | 'USDCx';

/**
 * Instrument configuration for a token
 */
export interface InstrumentConfig {
  /** Token symbol (CC, USDCx) */
  symbol: TokenSymbol;
  /** Instrument ID on Canton (e.g., 'Amulet' for CC, 'USDCx' for USDCx) */
  instrumentId: string;
  /** Admin party ID for this instrument */
  instrumentAdmin: string;
  /** Registry URL for token standard operations (different for each token) */
  registryUrl?: string;
  /** Utility backend URL for bridge operations (USDCx only) */
  utilityBackendUrl?: string;
  /** Number of decimal places for this token */
  decimals: number;
}

/**
 * Pre-configured instrument settings for MainNet
 */
export const INSTRUMENT_CONFIGS: Record<TokenSymbol, InstrumentConfig> = {
  CC: {
    symbol: 'CC',
    instrumentId: 'Amulet',
    instrumentAdmin: '', // Will be set from dsoPartyId at runtime
    // registryUrl not set - uses scan-proxy for CC
    decimals: 10, // CC has 10 decimal places
  },
  USDCx: {
    symbol: 'USDCx',
    instrumentId: 'USDCx',
    instrumentAdmin: 'decentralized-usdc-interchain-rep::12208115f1e168dd7e792320be9c4ca720c751a02a3053c7606e1c1cd3dad9bf60ef',
    registryUrl: 'https://api.utilities.digitalasset.com/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory',
    utilityBackendUrl: 'https://api.utilities.digitalasset.com',
    decimals: 6, // USDC has 6 decimal places
  },
};

/**
 * TestNet instrument configurations
 */
export const TESTNET_INSTRUMENT_CONFIGS: Record<TokenSymbol, InstrumentConfig> = {
  CC: {
    symbol: 'CC',
    instrumentId: 'Amulet',
    instrumentAdmin: '', // Will be set from dsoPartyId at runtime
    // registryUrl not set - uses scan-proxy for CC
    decimals: 10,
  },
  USDCx: {
    symbol: 'USDCx',
    instrumentId: 'USDCx',
    instrumentAdmin: '', // TestNet admin - needs to be configured
    registryUrl: 'https://api.utilities.digitalasset-staging.com/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory',
    utilityBackendUrl: 'https://api.utilities.digitalasset-staging.com',
    decimals: 6,
  },
};

/**
 * Get instrument configuration for a token
 */
export function getInstrumentConfig(
  symbol: TokenSymbol,
  isTestnet: boolean = false,
  dsoPartyId?: string
): InstrumentConfig {
  const configs = isTestnet ? TESTNET_INSTRUMENT_CONFIGS : INSTRUMENT_CONFIGS;
  const config = { ...configs[symbol] };

  // For CC/Amulet, use the dsoPartyId as instrumentAdmin
  if (symbol === 'CC' && dsoPartyId) {
    config.instrumentAdmin = dsoPartyId;
  }

  return config;
}

// ==================== SDK Configuration ====================

export interface OfficialSDKConfig extends CantonConfig {
  /** OAuth2 client ID for user authentication */
  oauthUserId?: string;
  /** OAuth2 client secret for user authentication */
  oauthUserSecret?: string;
  /** OAuth2 client ID for admin authentication */
  oauthAdminId?: string;
  /** OAuth2 client secret for admin authentication */
  oauthAdminSecret?: string;
  /** OAuth2 scope */
  oauthScope?: string;
  /** OAuth2 config URL (for M2M auth) */
  oauthConfigUrl?: string;
  /** Use unsafe auth for local development */
  useUnsafeAuth?: boolean;
  /** Unsafe JWT secret (for local dev only) */
  unsafeSecret?: string;
  /** DSO Party ID (required for token operations) */
  dsoPartyId?: string;
  /** Provider Party ID (validator operator party) */
  providerPartyId?: string;
  /** Whether this is a testnet deployment */
  isTestnet?: boolean;
}

/**
 * Official SDK Client
 *
 * Wraps the official @canton-network/wallet-sdk for Canton Network integration.
 * This is the recommended way to interact with Canton Network.
 */
export class OfficialSDKClient {
  private config: OfficialSDKConfig;
  private sdk: WalletSDK;
  private authController: UnsafeAuthController;
  private _authTokenProvider: AuthTokenProvider;
  private ledger: LedgerController | undefined;
  private tokenStandard: TokenStandardController | undefined;
  private validator: ValidatorController | undefined;
  private initialized = false;

  constructor(config: OfficialSDKConfig) {
    this.config = config;

    // Create auth controller (using UnsafeAuth for local dev, OAuth for production)
    this.authController = new UnsafeAuthController();
    this.authController.userId = config.ledgerApiUser || 'ledger-api-user';
    this.authController.adminId = config.ledgerApiUser || 'ledger-api-user';
    this.authController.audience = config.validatorAudience || 'https://validator.example.com';

    if (config.useUnsafeAuth && config.unsafeSecret) {
      this.authController.unsafeSecret = config.unsafeSecret;
    }

    // Create auth token provider
    this._authTokenProvider = new AuthTokenProvider(this.authController);

    // Create SDK instance
    this.sdk = new WalletSDKImpl();

    // Configure SDK with factories
    this.sdk.configure({
      authFactory: () => this.authController,
      ledgerFactory: (userId: string, authProvider: AuthTokenProvider, isAdmin: boolean) => {
        return new LedgerController(
          userId,
          new URL(config.ledgerApiUrl),
          undefined, // token (deprecated)
          isAdmin,
          authProvider
        );
      },
      tokenStandardFactory: (userId: string, authProvider: AuthTokenProvider, isAdmin: boolean) => {
        return new TokenStandardController(
          userId,
          new URL(config.ledgerApiUrl),
          new URL(config.validatorUrl || config.ledgerApiUrl),
          undefined, // token (deprecated)
          authProvider,
          isAdmin,
          false, // isMasterUser
          config.scanUrl ? new URL(config.scanUrl) : undefined
        );
      },
      validatorFactory: (userId: string, authProvider: AuthTokenProvider) => {
        return new ValidatorController(
          userId,
          new URL(config.validatorUrl || config.ledgerApiUrl),
          authProvider
        );
      },
    });
  }

  /**
   * Get instrument configuration for a token symbol
   * @param symbol - Token symbol (CC or USDCx)
   * @returns InstrumentConfig with all necessary details for this token
   */
  getTokenInstrumentConfig(symbol: TokenSymbol): InstrumentConfig {
    return getInstrumentConfig(
      symbol,
      this.config.isTestnet || false,
      this.config.dsoPartyId
    );
  }

  /**
   * Get instrument object for SDK operations
   * @param symbol - Token symbol (CC or USDCx)
   * @returns Object with instrumentId and instrumentAdmin for SDK calls
   */
  private getInstrument(symbol: TokenSymbol = 'CC'): { instrumentId: string; instrumentAdmin?: string } {
    const config = this.getTokenInstrumentConfig(symbol);
    return config.instrumentAdmin
      ? { instrumentId: config.instrumentId, instrumentAdmin: config.instrumentAdmin }
      : { instrumentId: config.instrumentId };
  }

  /**
   * Fetch the synchronizer ID from the scan-proxy API.
   */
  private async fetchSynchronizerId(): Promise<string | null> {
    try {
      const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
      // Use 'unsafe' secret directly for devnet scan-proxy (not APP_SECRET)
      const token = await this.getAuthTokenForScanProxy();

      const response = await fetch(
        `${validatorUrl}/api/validator/v0/scan-proxy/amulet-rules`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        logger.warn('Failed to fetch amulet rules', { status: response.status });
        return null;
      }

      const data = await response.json() as {
        amulet_rules?: {
          contract?: {
            payload?: {
              configSchedule?: {
                initialValue?: {
                  decentralizedSynchronizer?: {
                    activeSynchronizer?: string;
                  };
                };
              };
            };
          };
        };
      };

      const synchronizerId = data.amulet_rules?.contract?.payload?.configSchedule?.initialValue?.decentralizedSynchronizer?.activeSynchronizer;

      if (synchronizerId) {
        logger.debug('Fetched synchronizer ID', { synchronizerId });
        return synchronizerId;
      }

      return null;
    } catch (error) {
      logger.warn('Error fetching synchronizer ID', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /**
   * Initialize the SDK and connect to the ledger.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Connect to ledger (user mode)
    await this.sdk.connect();
    this.ledger = this.sdk.userLedger;
    this.tokenStandard = this.sdk.tokenStandard;
    this.validator = this.sdk.validator;

    // Fetch and set the synchronizer ID for party creation
    const synchronizerId = await this.fetchSynchronizerId();
    if (synchronizerId && this.ledger) {
      (this.ledger as { setSynchronizerId?: (id: string) => void }).setSynchronizerId?.(synchronizerId);
      logger.info('Set synchronizer ID on ledger controller');
    }

    // Set the transfer factory registry URL (required for accepting transfers)
    if (this.tokenStandard) {
      const registryUrl = new URL(
        '/api/validator/v0/scan-proxy',
        this.config.validatorUrl || this.config.ledgerApiUrl
      );
      this.tokenStandard.setTransferFactoryRegistryUrl(registryUrl);
      logger.info('Set transfer factory registry URL', { url: registryUrl.toString() });
    }

    this.initialized = true;
  }

  /**
   * Ensure SDK is initialized before operations.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get an auth token for scan-proxy API requests.
   * Uses the literal "unsafe" secret for devnet scan-proxy.
   */
  private async getAuthTokenForScanProxy(): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: this.config.ledgerApiUser || 'ledger-api-user',
      aud: this.config.validatorAudience || 'https://validator.example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const enc = new TextEncoder();
    const headerB64 = this.base64url(JSON.stringify(header));
    const payloadB64 = this.base64url(JSON.stringify(payload));
    const data = `${headerB64}.${payloadB64}`;

    // Use 'unsafe' directly for devnet scan-proxy authentication
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode('unsafe'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const sigB64 = this.base64url(new Uint8Array(sig));

    return `${data}.${sigB64}`;
  }

  /**
   * Get an auth token for HTTP API requests.
   * Creates a devnet JWT using HS256 with "unsafe" secret.
   */
  private async getAuthToken(): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: this.config.ledgerApiUser || 'administrator',
      aud: this.config.validatorAudience || 'https://validator.example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const enc = new TextEncoder();
    const headerB64 = this.base64url(JSON.stringify(header));
    const payloadB64 = this.base64url(JSON.stringify(payload));
    const data = `${headerB64}.${payloadB64}`;

    const secret = this.config.unsafeSecret || 'unsafe';
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    const sigB64 = this.base64url(new Uint8Array(sig));

    return `${data}.${sigB64}`;
  }

  /**
   * Base64url encode a string or Uint8Array.
   */
  private base64url(input: string | Uint8Array): string {
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

  // --- Balance ---

  /**
   * Get balance for a party.
   */
  async getBalance(partyId: string, _token: string = 'CC'): Promise<TokenBalance> {
    logger.debug('Called with partyId', { partyId });
    await this.ensureInitialized();

    if (!this.tokenStandard) {
      logger.debug('tokenStandard not initialized');
      throw new Error('Token standard controller not initialized');
    }

    // Set party ID for the token standard controller
    logger.debug('Setting partyId on tokenStandard');
    this.tokenStandard.setPartyId(partyId);

    // Get holdings - SDK returns complex nested structure
    logger.debug('Calling listHoldingUtxos');
    const holdings = await this.tokenStandard.listHoldingUtxos(false) as SDKHoldingUtxo[];
    logger.debug('Holdings count', { count: holdings?.length || 0 });

    let totalAmount = 0n;
    let lockedAmount = 0n;

    // Handle empty or invalid holdings
    if (!holdings || !Array.isArray(holdings)) {
      logger.debug('No holdings or not array, returning 0');
      return {
        token: 'CC',
        amount: '0.0000000000',
        locked: '0.0000000000',
      };
    }

    for (const holding of holdings) {
      if (!holding) continue;

      // Try multiple paths to get the amount:
      // 1. interfaceViewValue.amount (top-level, simplest path)
      // 2. activeContract.createdEvent.interfaceViews[0].viewValue.amount (nested SDK structure)
      // 3. view.amount (legacy structure)
      // 4. amount (direct property)
      let amountStr: string | undefined;
      let hasLock = false;

      // Path 1: Top-level interfaceViewValue (simplest, most common)
      if (holding.interfaceViewValue?.amount) {
        amountStr = holding.interfaceViewValue.amount;
        hasLock = !!holding.interfaceViewValue.lock;
        logger.debug('Found amount via interfaceViewValue', { amount: amountStr });
      }
      // Path 2: Nested SDK structure
      else {
        const interfaceViews = holding.activeContract?.createdEvent?.interfaceViews;
        if (interfaceViews && interfaceViews.length > 0 && interfaceViews[0]?.viewValue?.amount) {
          amountStr = interfaceViews[0].viewValue.amount;
          hasLock = !!interfaceViews[0].viewValue?.lock;
          logger.debug('Found amount via interfaceViews', { amount: amountStr });
        }
      }
      // Path 3: Legacy view structure
      if (!amountStr && holding.view?.amount) {
        amountStr = holding.view.amount;
        hasLock = !!holding.view.lock;
        logger.debug('Found amount via view', { amount: amountStr });
      }
      // Path 4: Direct amount property
      if (!amountStr && holding.amount) {
        amountStr = holding.amount;
        logger.debug('Found amount via direct property', { amount: amountStr });
      }

      if (!amountStr) {
        logger.debug('No amount found for holding, skipping');
        continue;
      }

      const amount = BigInt(Math.floor(parseFloat(amountStr) * 1e10));

      if (hasLock) {
        lockedAmount += amount;
      } else {
        totalAmount += amount;
      }
    }

    const result = {
      token: 'CC',
      amount: (Number(totalAmount) / 1e10).toFixed(10),
      locked: (Number(lockedAmount) / 1e10).toFixed(10),
    };
    logger.debug('Final result', { result });
    return result;
  }

  /**
   * Get balance for a specific token (CC or USDCx).
   * This is the new multi-token aware balance method.
   */
  async getTokenBalance(partyId: string, token: TokenSymbol = 'CC'): Promise<TokenBalance> {
    logger.debug('Getting token balance', { token, partyId });

    // For now, both CC and USDCx use the same balance query
    // In the future, we may need to configure different registry URLs
    const balance = await this.getBalance(partyId, token);

    // Update the token symbol in the result
    return {
      ...balance,
      token: token,
    };
  }

  /**
   * Get all token balances for a party (CC and USDCx).
   */
  async getAllBalances(partyId: string): Promise<{ cc: TokenBalance; usdcx: TokenBalance }> {
    logger.info('Getting all balances', { partyId });

    // Query balances in parallel
    const [ccBalance, usdcxBalance] = await Promise.all([
      this.getTokenBalance(partyId, 'CC').catch(() => ({
        token: 'CC' as const,
        amount: '0.0000000000',
        locked: '0.0000000000',
      })),
      this.getTokenBalance(partyId, 'USDCx').catch(() => ({
        token: 'USDCx' as const,
        amount: '0.000000',
        locked: '0.000000',
      })),
    ]);

    return {
      cc: ccBalance,
      usdcx: usdcxBalance,
    };
  }

  /**
   * Get USDCx balance - convenience method
   */
  async getUSDCxBalance(partyId: string): Promise<TokenBalance> {
    return this.getTokenBalance(partyId, 'USDCx');
  }

  /**
   * List holding UTXOs for a party.
   */
  async listHoldings(partyId: string): Promise<HoldingUtxo[]> {
    await this.ensureInitialized();

    if (!this.tokenStandard) {
      throw new Error('Token standard controller not initialized');
    }

    this.tokenStandard.setPartyId(partyId);

    // SDK returns complex nested structure
    const holdings = await this.tokenStandard.listHoldingUtxos(true) as SDKHoldingUtxo[];

    if (!holdings || !Array.isArray(holdings)) {
      return [];
    }

    return holdings
      .filter((h) => {
        if (!h) return false;
        // Check for new SDK structure
        const interfaceViews = h.activeContract?.createdEvent?.interfaceViews;
        if (interfaceViews && interfaceViews.length > 0 && interfaceViews[0]?.viewValue?.amount) {
          return true;
        }
        // Check for legacy structures
        return !!(h.view || h.amount);
      })
      .map((h) => {
        // Try new SDK structure first
        const interfaceViews = h.activeContract?.createdEvent?.interfaceViews;
        if (interfaceViews && interfaceViews.length > 0 && interfaceViews[0]?.viewValue) {
          const viewValue = interfaceViews[0].viewValue;
          return {
            contractId: h.cid || h.contractId || '',
            amount: viewValue.amount || '0',
            owner: viewValue.owner || h.owner || '',
            provider: viewValue.account?.custodian || '',
          };
        }
        // Fall back to legacy structure
        return {
          contractId: h.cid || h.contractId || '',
          amount: h.view?.amount || h.amount || '0',
          owner: h.view?.owner || h.owner || '',
          provider: h.view?.account?.custodian || '',
        };
      });
  }

  // --- Party Management ---

  /**
   * Create an external party on Canton Network.
   * Uses the official SDK's signAndAllocateExternalParty.
   */
  async createExternalParty(
    privateKeyHex: string,
    partyHint?: string
  ): Promise<ExternalPartyResult> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    // The official SDK expects a 64-byte Ed25519 secret key (seed + public key)
    // Our privateKeyHex is a 32-byte seed, so we need to derive the full keypair
    const seed = Buffer.from(privateKeyHex, 'hex');

    // Use TweetNaCl to generate the full 64-byte secret key from the 32-byte seed
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    const secretKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');

    // Create external party
    const result = await this.ledger.signAndAllocateExternalParty(
      secretKeyBase64,
      partyHint
    );

    // Extract public key from partyId or use fingerprint
    const publicKey = result.publicKeyFingerprint || '';

    return {
      partyId: result.partyId,
      publicKey,
      topologyTxHashes: result.topologyTransactions || [],
    };
  }

  // --- Transfer ---

  /**
   * Send tokens using the official SDK.
   * Supports both CC (Amulet) and USDCx transfers.
   *
   * @param request - Transfer request with from, to, amount
   * @param privateKeyHex - Sender's private key (hex encoded)
   * @param token - Token to transfer (default: 'CC')
   */
  async sendToken(
    request: TransferRequest,
    privateKeyHex: string,
    token: TokenSymbol = 'CC'
  ): Promise<TransferResult> {
    await this.ensureInitialized();

    if (!this.tokenStandard || !this.ledger) {
      throw new Error('Controllers not initialized');
    }

    // Set party ID on both controllers
    this.tokenStandard.setPartyId(request.fromParty);
    this.ledger.setPartyId(request.fromParty);

    // Get instrument info for the specified token
    const instrument = this.getInstrument(token);
    logger.debug('Sending token with instrument', { token, instrumentId: instrument?.instrumentId });

    // For USDCx, we may need to set a different registry URL
    const tokenConfig = this.getTokenInstrumentConfig(token);
    if (tokenConfig.registryUrl && this.tokenStandard.setTransferFactoryRegistryUrl) {
      await this.tokenStandard.setTransferFactoryRegistryUrl(new URL(tokenConfig.registryUrl));
    }

    // Create transfer command
    const [transferCommand, disclosedContracts] = await this.tokenStandard.createTransfer(
      request.fromParty,
      request.toParty,
      request.amount,
      instrument,
      undefined, // inputUtxos - auto select
      request.memo
    );

    // Convert 32-byte seed to 64-byte secret key (seed + public key)
    const seed = Buffer.from(privateKeyHex, 'hex');
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
    const commandId = `transfer-${token.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const submissionId = await this.ledger.prepareSignAndExecuteTransaction(
      transferCommand,
      privateKeyBase64,
      commandId,
      disclosedContracts
    );

    return {
      txHash: submissionId,
      status: 'confirmed',
      updateId: submissionId,
    };
  }

  /**
   * Send CC (Canton Coin / Amulet) - convenience method
   * @deprecated Use sendToken(request, privateKeyHex, 'CC') instead
   */
  async sendCC(
    request: TransferRequest,
    privateKeyHex: string
  ): Promise<TransferResult> {
    return this.sendToken(request, privateKeyHex, 'CC');
  }

  /**
   * Send USDCx - convenience method
   */
  async sendUSDCx(
    request: TransferRequest,
    privateKeyHex: string
  ): Promise<TransferResult> {
    return this.sendToken(request, privateKeyHex, 'USDCx');
  }

  // --- Preapproval ---

  /**
   * Create a TransferPreapproval so the party can receive CC.
   */
  async createPreapproval(
    partyId: string,
    privateKeyHex: string
  ): Promise<TransferPreapproval> {
    await this.ensureInitialized();

    if (!this.ledger || !this.validator) {
      throw new Error('Controllers not initialized');
    }

    // Get provider party (validator operator)
    const providerParty = this.config.providerPartyId || await this.validator.getValidatorUser();
    const dsoParty = this.config.dsoPartyId;

    if (!dsoParty) {
      throw new Error('DSO party ID is required for creating preapproval');
    }

    // Set the partyId on ledger controller
    this.ledger.setPartyId(partyId);

    // Create preapproval command
    const preapprovalCommand = await this.ledger.createTransferPreapprovalCommand(
      providerParty,
      partyId,
      dsoParty
    );

    if (!preapprovalCommand) {
      throw new Error('Failed to create preapproval command');
    }

    // Sign and execute
    // Convert 32-byte seed to 64-byte secret key (seed + public key)
    const seed = Buffer.from(privateKeyHex, 'hex');
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
    const commandId = `preapproval-${Date.now()}`;

    const submissionId = await this.ledger.prepareSignAndExecuteTransaction(
      preapprovalCommand,
      privateKeyBase64,
      commandId
    );

    return {
      contractId: submissionId,
      receiver: partyId,
      provider: providerParty,
    };
  }

  // --- USDCx Bridge (xReserve) ---

  /**
   * Bridge configuration for USDCx minting/burning
   */
  private getBridgeConfig() {
    const isTestnet = this.config.isTestnet || false;
    const usdcxConfig = this.getTokenInstrumentConfig('USDCx');

    return {
      isTestnet,
      instrumentAdmin: usdcxConfig.instrumentAdmin,
      utilityBackendUrl: usdcxConfig.utilityBackendUrl || 'https://api.utilities.digitalasset.com',
      burnMintFactoryEndpoint: `${usdcxConfig.utilityBackendUrl}/api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory`,
      // Bridge operator party (same as instrument admin for USDCx)
      bridgeOperatorParty: usdcxConfig.instrumentAdmin,
    };
  }

  /**
   * Fetch burn-mint factory context from utilities backend.
   * Required for mint/burn operations.
   */
  async fetchBurnMintFactoryContext(): Promise<{
    factoryId: string;
    disclosedContracts: unknown[];
    instrumentConfigurationCid: string;
    appRewardConfigurationCid: string;
    featuredAppRightCid?: string;
  } | null> {
    const bridgeConfig = this.getBridgeConfig();

    try {
      const response = await fetch(bridgeConfig.burnMintFactoryEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.error('Failed to fetch burn-mint factory', { status: response.status });
        return null;
      }

      const data = await response.json() as {
        factory_id?: string;
        disclosed_contracts?: unknown[];
        instrument_configuration_cid?: string;
        app_reward_configuration_cid?: string;
        featured_app_right_cid?: string;
      };

      const result: {
        factoryId: string;
        disclosedContracts: unknown[];
        instrumentConfigurationCid: string;
        appRewardConfigurationCid: string;
        featuredAppRightCid?: string;
      } = {
        factoryId: data.factory_id || '',
        disclosedContracts: data.disclosed_contracts || [],
        instrumentConfigurationCid: data.instrument_configuration_cid || '',
        appRewardConfigurationCid: data.app_reward_configuration_cid || '',
      };
      if (data.featured_app_right_cid) {
        result.featuredAppRightCid = data.featured_app_right_cid;
      }
      return result;
    } catch (error) {
      logger.error('Error fetching burn-mint factory', error);
      return null;
    }
  }

  /**
   * Check if a party has an active BridgeUserAgreement for USDCx.
   * This is required before minting/burning USDCx.
   */
  async hasBridgeUserAgreement(partyId: string): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    logger.info('Checking BridgeUserAgreement', { partyId });

    try {
      // Query active contracts for BridgeUserAgreement template
      // Template ID pattern: Splice.Amulet.BurnMint:BridgeUserAgreement
      const ledgerEnd = await this.ledger.ledgerEnd();
      const offset = ledgerEnd?.offset ?? 0;

      const contracts = await this.ledger.activeContracts({
        offset,
        templateIds: ['Splice.Amulet.BurnMint:BridgeUserAgreement'],
        parties: [partyId],
        filterByParty: true,
      });

      // Check if any BridgeUserAgreement contract exists for this party
      const hasAgreement = contracts.some((entry) => {
        const contract = entry.contractEntry as {
          activeContract?: {
            createdEvent?: {
              payload?: {
                user?: string;
              };
            };
          };
        };
        const payload = contract?.activeContract?.createdEvent?.payload;
        return payload?.user === partyId;
      });

      logger.info('BridgeUserAgreement exists', { exists: hasAgreement });
      return hasAgreement;
    } catch (error) {
      // If template not found or query fails, return false
      logger.warn('Error checking BridgeUserAgreement', { error: String(error) });
      return false;
    }
  }

  /**
   * Get the BridgeUserAgreement contract ID for a party.
   * Returns null if no agreement exists.
   */
  async getBridgeUserAgreementCid(partyId: string): Promise<string | null> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    try {
      const ledgerEnd = await this.ledger.ledgerEnd();
      const offset = ledgerEnd?.offset ?? 0;

      const contracts = await this.ledger.activeContracts({
        offset,
        templateIds: ['Splice.Amulet.BurnMint:BridgeUserAgreement'],
        parties: [partyId],
        filterByParty: true,
      });

      for (const entry of contracts) {
        const contract = entry.contractEntry as {
          activeContract?: {
            contractId?: string;
            createdEvent?: {
              payload?: {
                user?: string;
              };
            };
          };
        };
        const payload = contract?.activeContract?.createdEvent?.payload;
        if (payload?.user === partyId) {
          return contract?.activeContract?.contractId || null;
        }
      }

      return null;
    } catch (error) {
      logger.warn('Error getting BridgeUserAgreement CID', { error: String(error) });
      return null;
    }
  }

  /**
   * Create a BridgeUserAgreementRequest for USDCx onboarding.
   * This must be accepted by the bridge operator before mint/burn is possible.
   */
  async createBridgeUserAgreementRequest(
    partyId: string,
    privateKeyHex: string
  ): Promise<{ success: boolean; requestId?: string; error?: string }> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    const bridgeConfig = this.getBridgeConfig();
    const usdcxConfig = this.getTokenInstrumentConfig('USDCx');

    logger.info('Creating BridgeUserAgreementRequest', { partyId });

    try {
      // Check if user already has an agreement
      const existingAgreement = await this.hasBridgeUserAgreement(partyId);
      if (existingAgreement) {
        logger.info('User already has BridgeUserAgreement');
        return { success: true, requestId: 'existing' };
      }

      // Set party ID on ledger controller
      this.ledger.setPartyId(partyId);

      // Create BridgeUserAgreementRequest contract
      // Template: Splice.Amulet.BurnMint:BridgeUserAgreementRequest
      const createCommand = {
        CreateCommand: {
          templateId: 'Splice.Amulet.BurnMint:BridgeUserAgreementRequest',
          createArguments: {
            user: partyId,
            bridgeOperator: bridgeConfig.bridgeOperatorParty,
            instrument: {
              admin: usdcxConfig.instrumentAdmin,
              id: 'USDCx',
            },
          },
        },
      };

      // Convert 32-byte seed to 64-byte secret key
      const seed = Buffer.from(privateKeyHex, 'hex');
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
      const commandId = `bridge-agreement-request-${Date.now()}`;

      logger.info('Submitting BridgeUserAgreementRequest...');

      const submissionId = await this.ledger.prepareSignAndExecuteTransaction(
        createCommand,
        privateKeyBase64,
        commandId
      );

      logger.info('BridgeUserAgreementRequest created', { submissionId });

      return {
        success: true,
        requestId: submissionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to create BridgeUserAgreementRequest', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Mint USDCx from a deposit attestation.
   * Called after USDC is deposited on Ethereum and attestation is available.
   *
   * @param depositAttestationCid - Contract ID of the DepositAttestation
   * @param partyId - User's Canton party ID
   * @param privateKeyHex - User's private key for signing
   */
  async mintUSDCx(
    depositAttestationCid: string,
    partyId: string,
    privateKeyHex: string
  ): Promise<{ success: boolean; amount?: string; txHash?: string; error?: string }> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    logger.info('Minting USDCx', { partyId, attestationCid: depositAttestationCid });

    try {
      // Step 1: Get user's BridgeUserAgreement contract ID
      const agreementCid = await this.getBridgeUserAgreementCid(partyId);
      if (!agreementCid) {
        return {
          success: false,
          error: 'No BridgeUserAgreement found. Please complete bridge onboarding first.',
        };
      }

      // Step 2: Fetch factory context for disclosed contracts
      const factoryContext = await this.fetchBurnMintFactoryContext();
      if (!factoryContext) {
        return { success: false, error: 'Failed to fetch burn-mint factory context' };
      }

      // Step 3: Set party ID on ledger controller
      this.ledger.setPartyId(partyId);

      // Step 4: Create ExerciseCommand to mint USDCx
      // Exercise BridgeUserAgreement_Mint choice with DepositAttestation
      const exerciseCommand = {
        ExerciseCommand: {
          templateId: 'Splice.Amulet.BurnMint:BridgeUserAgreement',
          contractId: agreementCid,
          choice: 'BridgeUserAgreement_Mint',
          choiceArgument: {
            depositAttestationCid: depositAttestationCid,
            // Factory context for reward configuration
            instrumentConfigurationCid: factoryContext.instrumentConfigurationCid,
            appRewardConfigurationCid: factoryContext.appRewardConfigurationCid,
          },
        },
      };

      // Step 5: Convert private key and sign
      const seed = Buffer.from(privateKeyHex, 'hex');
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
      const commandId = `mint-usdcx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Step 6: Transform disclosed contracts to SDK format
      const disclosedContracts = (factoryContext.disclosedContracts as Array<{
        contract_id?: string;
        contractId?: string;
        created_event_blob?: string;
        createdEventBlob?: string;
        domain_id?: string;
        synchronizerId?: string;
      }>).map((dc) => ({
        contractId: dc.contractId || dc.contract_id || '',
        createdEventBlob: dc.createdEventBlob || dc.created_event_blob || '',
        synchronizerId: dc.synchronizerId || dc.domain_id || '',
      }));

      // Step 7: Execute the mint transaction
      logger.info('Executing mint transaction...');

      const submissionId = await this.ledger.prepareSignAndExecuteTransaction(
        exerciseCommand,
        privateKeyBase64,
        commandId,
        disclosedContracts
      );

      logger.info('USDCx minted successfully', { txHash: submissionId });

      // Note: The actual minted amount would need to be fetched from the transaction result
      // or the DepositAttestation contract. For now, we return success.
      return {
        success: true,
        txHash: submissionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to mint USDCx', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Burn USDCx to withdraw to Ethereum.
   * Creates a burn intent that Circle xReserve will process.
   *
   * @param amount - Amount of USDCx to burn (max 6 decimals)
   * @param ethereumAddress - Destination Ethereum address
   * @param partyId - User's Canton party ID
   * @param privateKeyHex - User's private key for signing
   */
  async burnUSDCx(
    amount: string,
    ethereumAddress: string,
    partyId: string,
    privateKeyHex: string
  ): Promise<{ success: boolean; burnRequestId?: string; txHash?: string; error?: string }> {
    await this.ensureInitialized();

    if (!this.ledger || !this.tokenStandard) {
      throw new Error('Controllers not initialized');
    }

    logger.info('Burning USDCx', { partyId, amount, ethereumAddress });

    try {
      // Step 1: Validate Ethereum address
      if (!ethereumAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return { success: false, error: 'Invalid Ethereum address' };
      }

      // Step 2: Validate amount (max 6 decimals for USDC)
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return { success: false, error: 'Invalid amount' };
      }

      // Step 3: Check USDCx balance
      const balance = await this.getTokenBalance(partyId, 'USDCx');
      const availableBalance = parseFloat(balance.amount);
      if (availableBalance < amountNum) {
        return {
          success: false,
          error: `Insufficient USDCx balance. Available: ${availableBalance}, Requested: ${amountNum}`,
        };
      }

      // Step 4: Get user's BridgeUserAgreement contract ID
      const agreementCid = await this.getBridgeUserAgreementCid(partyId);
      if (!agreementCid) {
        return {
          success: false,
          error: 'No BridgeUserAgreement found. Please complete bridge onboarding first.',
        };
      }

      // Step 5: Fetch factory context for disclosed contracts
      const factoryContext = await this.fetchBurnMintFactoryContext();
      if (!factoryContext) {
        return { success: false, error: 'Failed to fetch burn-mint factory context' };
      }

      // Step 6: Get USDCx holding UTXOs to burn
      this.tokenStandard.setPartyId(partyId);
      const usdcxConfig = this.getTokenInstrumentConfig('USDCx');

      // Set the USDCx registry URL for listing holdings
      if (usdcxConfig.registryUrl) {
        this.tokenStandard.setTransferFactoryRegistryUrl(new URL(usdcxConfig.registryUrl));
      }

      const holdings = await this.tokenStandard.listHoldingUtxos(false);
      const holdingCids = holdings.map((h) => h.contractId).filter((cid): cid is string => !!cid);

      if (holdingCids.length === 0) {
        return { success: false, error: 'No USDCx holdings found' };
      }

      // Step 7: Set party ID on ledger controller
      this.ledger.setPartyId(partyId);

      // Step 8: Create ExerciseCommand to burn USDCx
      // Exercise BridgeUserAgreement_Burn choice
      // Domain IDs: Ethereum = 0, Canton = 10001
      const ETHEREUM_DOMAIN_ID = 0;

      const exerciseCommand = {
        ExerciseCommand: {
          templateId: 'Splice.Amulet.BurnMint:BridgeUserAgreement',
          contractId: agreementCid,
          choice: 'BridgeUserAgreement_Burn',
          choiceArgument: {
            amount: amount,
            destinationDomain: ETHEREUM_DOMAIN_ID,
            recipientAddress: ethereumAddress,
            holdingCids: holdingCids,
            // Factory context for reward configuration
            instrumentConfigurationCid: factoryContext.instrumentConfigurationCid,
            appRewardConfigurationCid: factoryContext.appRewardConfigurationCid,
          },
        },
      };

      // Step 9: Convert private key and sign
      const seed = Buffer.from(privateKeyHex, 'hex');
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
      const commandId = `burn-usdcx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Step 10: Transform disclosed contracts to SDK format
      const disclosedContracts = (factoryContext.disclosedContracts as Array<{
        contract_id?: string;
        contractId?: string;
        created_event_blob?: string;
        createdEventBlob?: string;
        domain_id?: string;
        synchronizerId?: string;
      }>).map((dc) => ({
        contractId: dc.contractId || dc.contract_id || '',
        createdEventBlob: dc.createdEventBlob || dc.created_event_blob || '',
        synchronizerId: dc.synchronizerId || dc.domain_id || '',
      }));

      // Step 11: Execute the burn transaction
      logger.info('Executing burn transaction...');

      const submissionId = await this.ledger.prepareSignAndExecuteTransaction(
        exerciseCommand,
        privateKeyBase64,
        commandId,
        disclosedContracts
      );

      logger.info('USDCx burned successfully', { txHash: submissionId });

      return {
        success: true,
        burnRequestId: submissionId,
        txHash: submissionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to burn USDCx', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * List pending DepositAttestation contracts for a party.
   * These are created by Circle xReserve after USDC is deposited on Ethereum.
   * Each attestation can be used to mint USDCx.
   */
  async listPendingDepositAttestations(partyId: string): Promise<Array<{
    contractId: string;
    amount: string;
    sourceChain: number;
    ethereumTxHash?: string;
    createdAt?: string;
  }>> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    logger.info('Listing pending DepositAttestations', { partyId });

    try {
      const ledgerEnd = await this.ledger.ledgerEnd();
      const offset = ledgerEnd?.offset ?? 0;

      const contracts = await this.ledger.activeContracts({
        offset,
        templateIds: ['Splice.Amulet.BurnMint:DepositAttestation'],
        parties: [partyId],
        filterByParty: true,
      });

      const attestations: Array<{
        contractId: string;
        amount: string;
        sourceChain: number;
        ethereumTxHash?: string;
        createdAt?: string;
      }> = [];

      for (const entry of contracts) {
        const contract = entry.contractEntry as {
          activeContract?: {
            contractId?: string;
            createdEvent?: {
              createdAt?: string;
              payload?: {
                beneficiary?: string;
                amount?: string;
                sourceDomain?: number;
                depositTxHash?: string;
              };
            };
          };
        };

        const activeContract = contract?.activeContract;
        const payload = activeContract?.createdEvent?.payload;

        // Only include attestations where the user is the beneficiary
        if (payload?.beneficiary === partyId) {
          const attestation: {
            contractId: string;
            amount: string;
            sourceChain: number;
            ethereumTxHash?: string;
            createdAt?: string;
          } = {
            contractId: activeContract?.contractId || '',
            amount: payload?.amount || '0',
            sourceChain: payload?.sourceDomain || 0,
          };

          // Only set optional properties if they have values
          if (payload?.depositTxHash) {
            attestation.ethereumTxHash = payload.depositTxHash;
          }
          if (activeContract?.createdEvent?.createdAt) {
            attestation.createdAt = activeContract.createdEvent.createdAt;
          }

          attestations.push(attestation);
        }
      }

      logger.info('Found pending attestations', { count: attestations.length });
      return attestations;
    } catch (error) {
      logger.warn('Error listing DepositAttestations', { error: String(error) });
      return [];
    }
  }

  /**
   * List pending BurnIntent contracts for a party.
   * These are created when USDCx is burned and are awaiting processing by Circle xReserve.
   */
  async listPendingBurnIntents(partyId: string): Promise<Array<{
    contractId: string;
    amount: string;
    destinationChain: number;
    recipientAddress: string;
    status: 'pending' | 'processing' | 'completed';
    createdAt?: string;
  }>> {
    await this.ensureInitialized();

    if (!this.ledger) {
      throw new Error('Ledger controller not initialized');
    }

    logger.info('Listing pending BurnIntents', { partyId });

    try {
      const ledgerEnd = await this.ledger.ledgerEnd();
      const offset = ledgerEnd?.offset ?? 0;

      const contracts = await this.ledger.activeContracts({
        offset,
        templateIds: ['Splice.Amulet.BurnMint:BurnIntent'],
        parties: [partyId],
        filterByParty: true,
      });

      const burnIntents: Array<{
        contractId: string;
        amount: string;
        destinationChain: number;
        recipientAddress: string;
        status: 'pending' | 'processing' | 'completed';
        createdAt?: string;
      }> = [];

      for (const entry of contracts) {
        const contract = entry.contractEntry as {
          activeContract?: {
            contractId?: string;
            createdEvent?: {
              createdAt?: string;
              payload?: {
                burner?: string;
                amount?: string;
                destinationDomain?: number;
                recipientAddress?: string;
              };
            };
          };
        };

        const activeContract = contract?.activeContract;
        const payload = activeContract?.createdEvent?.payload;

        // Only include burn intents where the user is the burner
        if (payload?.burner === partyId) {
          const burnIntent: {
            contractId: string;
            amount: string;
            destinationChain: number;
            recipientAddress: string;
            status: 'pending' | 'processing' | 'completed';
            createdAt?: string;
          } = {
            contractId: activeContract?.contractId || '',
            amount: payload?.amount || '0',
            destinationChain: payload?.destinationDomain || 0,
            recipientAddress: payload?.recipientAddress || '',
            status: 'pending', // Active contracts are pending; archived ones would be completed
          };

          // Only set optional properties if they have values
          if (activeContract?.createdEvent?.createdAt) {
            burnIntent.createdAt = activeContract.createdEvent.createdAt;
          }

          burnIntents.push(burnIntent);
        }
      }

      logger.info('Found pending burn intents', { count: burnIntents.length });
      return burnIntents;
    } catch (error) {
      logger.warn('Error listing BurnIntents', { error: String(error) });
      return [];
    }
  }

  // --- Pending Transfers ---

  /**
   * List pending transfer instructions (incoming 2-step transfers awaiting acceptance).
   */
  async listPendingTransfers(partyId: string): Promise<Array<{
    contractId: string;
    sender: string;
    receiver: string;
    amount: string;
  }>> {
    await this.ensureInitialized();

    if (!this.tokenStandard) {
      throw new Error('Token standard controller not initialized');
    }

    this.tokenStandard.setPartyId(partyId);

    try {
      const pendingInstructions = await this.tokenStandard.fetchPendingTransferInstructionView();

      return pendingInstructions.map((instr) => {
        const view = instr.interfaceViewValue as {
          sender?: string;
          receiver?: string;
          amount?: string;
        } | undefined;

        return {
          contractId: instr.contractId || '',
          sender: view?.sender || '',
          receiver: view?.receiver || partyId,
          amount: view?.amount || '0',
        };
      });
    } catch (error) {
      logger.warn('Failed to list pending transfers', { error: String(error) });
      return [];
    }
  }

  /**
   * Accept a pending transfer instruction.
   */
  async acceptTransferInstruction(
    partyId: string,
    transferInstructionCid: string,
    privateKeyHex: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();

    if (!this.tokenStandard || !this.ledger) {
      throw new Error('Controllers not initialized');
    }

    this.tokenStandard.setPartyId(partyId);
    this.ledger.setPartyId(partyId);

    try {
      // Get the choice context and command for accepting
      const [command, disclosedContracts] = await this.tokenStandard.exerciseTransferInstructionChoice(
        transferInstructionCid,
        'Accept'
      );

      // Convert 32-byte seed to 64-byte secret key
      const seed = Buffer.from(privateKeyHex, 'hex');
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
      const commandId = `accept-transfer-${Date.now()}`;

      await this.ledger.prepareSignAndExecuteTransaction(
        command,
        privateKeyBase64,
        commandId,
        disclosedContracts
      );

      logger.info('Transfer instruction accepted', { contractId: transferInstructionCid });
      return { success: true };
    } catch (error) {
      // Handle various error formats from the SDK
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        // SDK may return {error: "message"} or other object formats
        const errObj = error as Record<string, unknown>;
        errorMessage = errObj.error as string || errObj.message as string || JSON.stringify(error);
      } else {
        errorMessage = String(error);
      }
      logger.error('Failed to accept transfer', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Reject a pending transfer instruction.
   * This declines the incoming Token Standard 2-step transfer.
   */
  async rejectTransferInstruction(
    partyId: string,
    transferInstructionCid: string,
    privateKeyHex: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureInitialized();

    if (!this.tokenStandard || !this.ledger) {
      throw new Error('Controllers not initialized');
    }

    this.tokenStandard.setPartyId(partyId);
    this.ledger.setPartyId(partyId);

    try {
      // Get the choice context and command for rejecting
      const [command, disclosedContracts] = await this.tokenStandard.exerciseTransferInstructionChoice(
        transferInstructionCid,
        'Reject'
      );

      // Convert 32-byte seed to 64-byte secret key
      const seed = Buffer.from(privateKeyHex, 'hex');
      const keyPair = nacl.sign.keyPair.fromSeed(seed);
      const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
      const commandId = `reject-transfer-${Date.now()}`;

      await this.ledger.prepareSignAndExecuteTransaction(
        command,
        privateKeyBase64,
        commandId,
        disclosedContracts
      );

      logger.info('Transfer instruction rejected', { contractId: transferInstructionCid });
      return { success: true };
    } catch (error) {
      // Handle various error formats from the SDK
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        const errObj = error as Record<string, unknown>;
        errorMessage = errObj.error as string || errObj.message as string || JSON.stringify(error);
      } else {
        errorMessage = String(error);
      }
      logger.error('Failed to reject transfer', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Accept all pending transfer instructions for a party.
   * This is used to automatically accept incoming Token Standard transfers.
   */
  async acceptAllPendingTransfers(
    partyId: string,
    privateKeyHex: string
  ): Promise<{ accepted: number; failed: number; errors: string[] }> {
    const pending = await this.listPendingTransfers(partyId);

    let accepted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const transfer of pending) {
      const result = await this.acceptTransferInstruction(
        partyId,
        transfer.contractId,
        privateKeyHex
      );

      if (result.success) {
        accepted++;
        logger.info('Accepted transfer', { sender: transfer.sender, amount: transfer.amount });
      } else {
        failed++;
        errors.push(result.error || 'Unknown error');
      }
    }

    return { accepted, failed, errors };
  }

  /**
   * Get preapproval status for a party.
   */
  async getPreapproval(partyId: string): Promise<TransferPreapproval | null> {
    await this.ensureInitialized();

    if (!this.tokenStandard) {
      throw new Error('Token standard controller not initialized');
    }

    try {
      const preapproval = await this.tokenStandard.getTransferPreApprovalByParty(
        partyId,
        'Amulet'
      );

      if (!preapproval) {
        return null;
      }

      return {
        contractId: preapproval.contractId,
        receiver: preapproval.receiverId,
        provider: preapproval.dso,
        expiresAt: preapproval.expiresAt.toISOString(),
      };
    } catch {
      return null;
    }
  }

  // --- Wallet Setup ---

  /**
   * Full wallet setup: create party + TransferPreapproval.
   */
  async setupWallet(
    privateKeyHex: string,
    displayName?: string
  ): Promise<WalletSetupResult> {
    // Step 1: Create external party
    const party = await this.createExternalParty(privateKeyHex, displayName);

    // Step 2: Create TransferPreapproval
    const result: WalletSetupResult = { partyId: party.partyId };

    try {
      const preapproval = await this.createPreapproval(party.partyId, privateKeyHex);
      result.preapprovalContractId = preapproval.contractId;
    } catch {
      // Non-fatal: wallet can function without preapproval
    }

    return result;
  }

  // --- Transaction History ---

  /**
   * Get transaction history for a party from the ledger.
   * Uses the /v2/updates/flats API to fetch transfer events.
   */
  async getTransactionHistory(
    partyId: string,
    limit: number = 50,
    afterOffset?: string
  ): Promise<Array<{
    updateId: string;
    type: 'send' | 'receive';
    amount: string;
    counterparty: string;
    timestamp: string;
    txHash: string;
  }>> {
    await this.ensureInitialized();

    try {
      const ledgerApiUrl = this.config.ledgerApiUrl;
      const token = await this.getAuthToken();

      const body: Record<string, unknown> = {
        party: partyId,
        page_size: limit,
      };
      if (afterOffset) {
        body.after = afterOffset;
      }

      const response = await fetch(`${ledgerApiUrl}/v2/updates/flats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        updates: Array<{
          update_id: string;
          events: Array<{
            created?: {
              template_id: string;
              payload: {
                sender?: string;
                receiver?: string;
                amount?: { amount: string };
                owner?: string;
                provider?: string;
              };
            };
            archived?: { contract_id: string };
          }>;
          effective_at: string;
        }>;
      };

      const transactions: Array<{
        updateId: string;
        type: 'send' | 'receive';
        amount: string;
        counterparty: string;
        timestamp: string;
        txHash: string;
      }> = [];

      for (const update of data.updates ?? []) {
        for (const event of update.events) {
          if (event.created?.payload) {
            const payload = event.created.payload;
            const templateId = event.created.template_id || '';

            // Check if this is a transfer-related event
            if (
              templateId.includes('TransferCommand') ||
              templateId.includes('Transfer') ||
              (payload.sender && payload.receiver)
            ) {
              const sender = payload.sender || '';
              const receiver = payload.receiver || '';
              const amount = payload.amount?.amount || '0';

              const isSend = sender === partyId || sender.includes(partyId);
              const isReceive = receiver === partyId || receiver.includes(partyId);

              if (isSend || isReceive) {
                transactions.push({
                  updateId: update.update_id,
                  type: isSend ? 'send' : 'receive',
                  amount,
                  counterparty: isSend ? receiver : sender,
                  timestamp: update.effective_at,
                  txHash: update.update_id,
                });
              }
            }

            // Also check for Amulet holding events (receiving CC)
            if (
              templateId.includes('Amulet') &&
              payload.owner &&
              (payload.owner === partyId || payload.owner.includes(partyId))
            ) {
              const amount = payload.amount?.amount || '0';
              if (!transactions.find(t => t.updateId === update.update_id)) {
                transactions.push({
                  updateId: update.update_id,
                  type: 'receive',
                  amount,
                  counterparty: payload.provider || 'unknown',
                  timestamp: update.effective_at,
                  txHash: update.update_id,
                });
              }
            }
          }
        }
      }

      return transactions;
    } catch (error) {
      logger.warn('Failed to fetch transaction history from ledger', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  // --- UTXO Management ---

  /**
   * Merge UTXOs for a party.
   */
  async mergeUtxos(partyId: string, privateKeyHex: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.tokenStandard || !this.ledger) {
      throw new Error('Controllers not initialized');
    }

    this.tokenStandard.setPartyId(partyId);

    // Get merge commands
    const [mergeCommands, disclosedContracts] = await this.tokenStandard.mergeHoldingUtxos();

    if (mergeCommands.length === 0) {
      return; // No UTXOs to merge
    }

    // Execute each merge command
    const privateKeyBase64 = Buffer.from(privateKeyHex, 'hex').toString('base64');

    for (let i = 0; i < mergeCommands.length; i++) {
      const commandId = `merge-${Date.now()}-${i}`;
      await this.ledger.prepareSignAndExecuteTransaction(
        mergeCommands[i],
        privateKeyBase64,
        commandId,
        disclosedContracts
      );
    }
  }

  // --- Price ---

  /**
   * Get CC/Amulet price information from Canton Network.
   * Fetches from OpenMiningRounds via scan-proxy API.
   */
  async getCCPrice(): Promise<{
    price: number;
    round: number;
    amuletPriceUsd: number;
    rewardRate: number;
  }> {
    await this.ensureInitialized();

    try {
      // Fetch open mining rounds via validator's scan-proxy endpoint
      const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;

      // Generate auth token with 'unsafe' secret for devnet
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = {
        sub: this.config.ledgerApiUser || 'ledger-api-user',
        aud: this.config.validatorAudience || 'https://validator.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const headerB64 = this.base64url(JSON.stringify(header));
      const payloadB64 = this.base64url(JSON.stringify(payload));
      const jwtData = `${headerB64}.${payloadB64}`;

      // Use 'unsafe' secret for devnet scan-proxy
      const secret = 'unsafe';
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(jwtData));
      const sigB64 = this.base64url(new Uint8Array(sig));
      const token = `${jwtData}.${sigB64}`;

      const response = await fetch(
        `${validatorUrl}/api/validator/v0/scan-proxy/open-and-issuing-mining-rounds`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch mining rounds: ${response.status}`);
      }

      const data = await response.json() as {
        open_mining_rounds?: Array<{
          contract: {
            payload: {
              amuletPrice?: string;
              round?: { number?: string };
              issuanceConfig?: {
                validatorRewardPercentage?: string;
              };
              transferConfigUsd?: {
                holdingFee?: { rate?: string };
              };
            };
          };
        }>;
      };

      // Extract price from the first open mining round
      let amuletPriceUsd = 0.16; // Default fallback
      let currentRound = 0;
      let rewardRate = 0.0001;

      if (data.open_mining_rounds && data.open_mining_rounds.length > 0) {
        const firstRound = data.open_mining_rounds[0];
        const payload = firstRound?.contract?.payload;

        if (payload) {
          // Get amulet price (CC price in USD)
          if (payload.amuletPrice) {
            amuletPriceUsd = parseFloat(payload.amuletPrice);
          }

          // Get current round number
          if (payload.round?.number) {
            currentRound = parseInt(payload.round.number, 10);
          }

          // Get holding fee rate
          if (payload.transferConfigUsd?.holdingFee?.rate) {
            rewardRate = parseFloat(payload.transferConfigUsd.holdingFee.rate);
          }
        }
      }

      logger.debug('Fetched CC price', { price: amuletPriceUsd, round: currentRound });

      return {
        price: amuletPriceUsd,
        round: currentRound,
        amuletPriceUsd,
        rewardRate,
      };
    } catch (error) {
      logger.error('Failed to fetch CC price', error);
      // Return default values on error
      return {
        price: 0.16,
        round: 0,
        amuletPriceUsd: 0.16,
        rewardRate: 0.0001,
      };
    }
  }

  // --- Accessors ---

  getSDK(): WalletSDK {
    return this.sdk;
  }

  getLedgerController(): LedgerController | undefined {
    return this.ledger;
  }

  getTokenStandardController(): TokenStandardController | undefined {
    return this.tokenStandard;
  }

  getValidatorController(): ValidatorController | undefined {
    return this.validator;
  }

  getAuthTokenProvider(): AuthTokenProvider {
    return this._authTokenProvider;
  }

  getConfig(): OfficialSDKConfig {
    return this.config;
  }
}

// Re-export SDK types and utilities
export {
  WalletSDKImpl,
  UnsafeAuthController,
  AuthTokenProvider,
  LedgerController,
  TokenStandardController,
  ValidatorController,
  signTransactionHash,
  createKeyPair,
  type Config as SDKConfig,
  type WalletSDK,
};
