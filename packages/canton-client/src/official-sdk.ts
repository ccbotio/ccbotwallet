/**
 * Official Canton SDK Wrapper
 *
 * This module wraps the official @canton-network/wallet-sdk
 * to provide integration with Canton Network.
 */

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
} from './types/index.js';

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
        console.warn('[OfficialSDK] Failed to fetch amulet rules:', response.status);
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
        console.log('[OfficialSDK] Fetched synchronizer ID:', synchronizerId);
        return synchronizerId;
      }

      return null;
    } catch (error) {
      console.warn('[OfficialSDK] Error fetching synchronizer ID:', error);
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
      console.log('[OfficialSDK] Set synchronizer ID on ledger controller');
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
    console.log('[DEBUG getBalance] Called with partyId:', partyId);
    await this.ensureInitialized();

    if (!this.tokenStandard) {
      console.log('[DEBUG getBalance] tokenStandard not initialized');
      throw new Error('Token standard controller not initialized');
    }

    // Set party ID for the token standard controller
    console.log('[DEBUG getBalance] Setting partyId on tokenStandard');
    this.tokenStandard.setPartyId(partyId);

    // Get holdings - cast to any to handle SDK type compatibility
    console.log('[DEBUG getBalance] Calling listHoldingUtxos...');
    const holdings = await this.tokenStandard.listHoldingUtxos(false) as unknown as Array<{
      cid?: string;
      contractId?: string;
      view?: { amount: string; lock?: unknown; owner: string; account?: { custodian: string } };
      amount?: string;
      // Top-level interfaceViewValue (simpler path)
      interfaceViewValue?: {
        amount?: string;
        lock?: unknown;
      };
      activeContract?: {
        createdEvent?: {
          interfaceViews?: Array<{
            viewValue?: {
              amount?: string;
              lock?: unknown;
            };
          }>;
        };
      };
    }>;
    console.log('[DEBUG getBalance] Holdings count:', holdings?.length || 0);

    let totalAmount = 0n;
    let lockedAmount = 0n;

    // Handle empty or invalid holdings
    if (!holdings || !Array.isArray(holdings)) {
      console.log('[DEBUG getBalance] No holdings or not array, returning 0');
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
        console.log('[DEBUG getBalance] Found amount via interfaceViewValue:', amountStr);
      }
      // Path 2: Nested SDK structure
      else {
        const interfaceViews = holding.activeContract?.createdEvent?.interfaceViews;
        if (interfaceViews && interfaceViews.length > 0 && interfaceViews[0]?.viewValue?.amount) {
          amountStr = interfaceViews[0].viewValue.amount;
          hasLock = !!interfaceViews[0].viewValue?.lock;
          console.log('[DEBUG getBalance] Found amount via interfaceViews:', amountStr);
        }
      }
      // Path 3: Legacy view structure
      if (!amountStr && holding.view?.amount) {
        amountStr = holding.view.amount;
        hasLock = !!holding.view.lock;
        console.log('[DEBUG getBalance] Found amount via view:', amountStr);
      }
      // Path 4: Direct amount property
      if (!amountStr && holding.amount) {
        amountStr = holding.amount;
        console.log('[DEBUG getBalance] Found amount via direct property:', amountStr);
      }

      if (!amountStr) {
        console.log('[DEBUG getBalance] No amount found for holding, skipping');
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
    console.log('[DEBUG getBalance] Final result:', result);
    return result;
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

    // Cast to handle SDK type compatibility
    const holdings = await this.tokenStandard.listHoldingUtxos(true) as unknown as Array<{
      cid?: string;
      contractId?: string;
      view?: { amount: string; owner: string; account?: { custodian: string } };
      amount?: string;
      owner?: string;
      activeContract?: {
        createdEvent?: {
          interfaceViews?: Array<{
            viewValue?: {
              amount?: string;
              owner?: string;
              account?: { custodian?: string };
            };
          }>;
        };
      };
    }>;

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
   * Send CC using the official SDK.
   */
  async sendCC(
    request: TransferRequest,
    privateKeyHex: string
  ): Promise<TransferResult> {
    await this.ensureInitialized();

    if (!this.tokenStandard || !this.ledger) {
      throw new Error('Controllers not initialized');
    }

    // Set party ID
    this.tokenStandard.setPartyId(request.fromParty);

    // Get instrument info (CC / Amulet)
    const instrumentAdmin = this.config.dsoPartyId;
    const instrument = instrumentAdmin
      ? { instrumentId: 'Amulet', instrumentAdmin }
      : { instrumentId: 'Amulet' };

    // Create transfer command
    const [transferCommand, disclosedContracts] = await this.tokenStandard.createTransfer(
      request.fromParty,
      request.toParty,
      request.amount,
      instrument,
      undefined, // inputUtxos - auto select
      request.memo
    );

    // Prepare, sign, and execute
    const privateKeyBase64 = Buffer.from(privateKeyHex, 'hex').toString('base64');
    const commandId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
    const privateKeyBase64 = Buffer.from(privateKeyHex, 'hex').toString('base64');
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
      console.warn('Failed to fetch transaction history from ledger:', error);
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

      console.log(`[getCCPrice] Price: $${amuletPriceUsd}, Round: ${currentRound}`);

      return {
        price: amuletPriceUsd,
        round: currentRound,
        amuletPriceUsd,
        rewardRate,
      };
    } catch (error) {
      console.error('[getCCPrice] Failed to fetch price:', error);
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
