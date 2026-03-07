import { LedgerApi } from './ledger-api/index.js';
import { TokenStandard } from './token-standard/index.js';
import { AuthTokenProvider } from './auth.js';
import { PartyManager, SetupProposalManager } from './party.js';
import { BalanceManager } from './balance.js';
import { TransferManager } from './transfer.js';
import { PreapprovalManager } from './preapproval.js';
import type {
  CantonConfig,
  TokenBalance,
  TransferRequest,
  TransferResult,
  ExternalPartyResult,
  TransferPreapproval,
  WalletSetupResult,
} from './types/index.js';

export class CantonClient {
  private config: CantonConfig;
  private auth: AuthTokenProvider;
  private ledgerApi: LedgerApi;
  private tokenStandard: TokenStandard;
  private partyManager: PartyManager;
  private balanceManager: BalanceManager;
  private transferManager: TransferManager;
  private preapprovalManager: PreapprovalManager;
  private setupProposalManager: SetupProposalManager;

  constructor(config: CantonConfig) {
    this.config = config;
    this.auth = new AuthTokenProvider(config);
    this.ledgerApi = new LedgerApi(config, this.auth);
    this.tokenStandard = new TokenStandard(this.ledgerApi);
    this.partyManager = new PartyManager(config, this.auth);
    this.balanceManager = new BalanceManager(config, this.auth);
    this.transferManager = new TransferManager(config, this.auth);
    this.preapprovalManager = new PreapprovalManager(config, this.auth);
    this.setupProposalManager = new SetupProposalManager(config, this.auth);
  }

  // --- Balance ---

  /**
   * Get balance for a party. Uses external party balance API by default.
   */
  async getBalance(partyId: string, _token: string = 'CC'): Promise<TokenBalance> {
    // Use external party balance API which is the correct endpoint for our wallets
    return this.balanceManager.getExternalPartyBalance(partyId);
  }

  async getAllBalances(partyId: string): Promise<TokenBalance[]> {
    // For external parties, we primarily deal with CC
    const ccBalance = await this.balanceManager.getExternalPartyBalance(partyId);
    return [ccBalance];
  }

  // --- Party Management ---

  /**
   * Create an external party on Canton Network.
   * @param publicKeyHex - Ed25519 public key in hex
   * @param signHash - Function to sign topology tx hashes
   * @param displayName - Optional display name
   */
  async createExternalParty(
    publicKeyHex: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    displayName?: string
  ): Promise<ExternalPartyResult> {
    return this.partyManager.createAndAllocateParty(publicKeyHex, signHash, displayName);
  }

  // --- Transfer ---

  /**
   * Send CC using Ed25519 signed transfer.
   * @param request - Transfer details (fromParty, toParty, amount)
   * @param signHash - Function to sign the transaction hash with Ed25519
   * @param publicKeyHex - The sender's Ed25519 public key
   * @param nonce - Optional nonce for the transfer (required for sequential transfers)
   */
  async sendCC(
    request: TransferRequest,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string,
    nonce?: number
  ): Promise<TransferResult> {
    return this.transferManager.sendCC(request, signHash, publicKeyHex, nonce);
  }

  /**
   * Legacy transfer through token standard (no external signing).
   */
  async transfer(request: TransferRequest): Promise<TransferResult> {
    return this.tokenStandard.transfer(request);
  }

  /**
   * Get transfer history.
   */
  async getTransferHistory(partyId: string, limit?: number) {
    return this.transferManager.getTransferHistory(partyId, limit);
  }

  // --- Preapproval ---

  /**
   * Create a TransferPreapproval so the party can receive CC.
   */
  async createPreapproval(
    partyId: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string
  ): Promise<TransferPreapproval> {
    return this.preapprovalManager.createPreapproval(partyId, signHash, publicKeyHex);
  }

  async getPreapproval(partyId: string): Promise<TransferPreapproval | null> {
    return this.preapprovalManager.getPreapproval(partyId);
  }

  // --- Wallet Setup ---

  /**
   * Full wallet setup: create party + ValidatorRight + TransferPreapproval.
   * Uses the setup-proposal workflow which creates all contracts atomically.
   */
  async setupWallet(
    publicKeyHex: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    displayName?: string
  ): Promise<WalletSetupResult> {
    // Step 1: Create external party
    const party = await this.createExternalParty(publicKeyHex, signHash, displayName);

    // Step 2: Create ValidatorRight + TransferPreapproval via setup-proposal
    const result: WalletSetupResult = { partyId: party.partyId };
    try {
      const setupResult = await this.setupProposalManager.createAndAcceptProposal(
        party.partyId,
        publicKeyHex,
        signHash
      );
      result.preapprovalContractId = setupResult.transferPreapprovalContractId;
    } catch {
      // Non-fatal: wallet can function without preapproval (but won't be visible on CCView)
    }

    return result;
  }

  // --- UTXO Management ---

  async mergeUtxos(partyId: string, maxUtxos?: number) {
    return this.balanceManager.mergeHoldingUtxos(partyId, maxUtxos);
  }

  // --- Accessors ---

  getLedgerApi(): LedgerApi {
    return this.ledgerApi;
  }

  getTokenStandard(): TokenStandard {
    return this.tokenStandard;
  }

  getPartyManager(): PartyManager {
    return this.partyManager;
  }

  getBalanceManager(): BalanceManager {
    return this.balanceManager;
  }

  getTransferManager(): TransferManager {
    return this.transferManager;
  }

  getPreapprovalManager(): PreapprovalManager {
    return this.preapprovalManager;
  }

  getSetupProposalManager(): SetupProposalManager {
    return this.setupProposalManager;
  }

  getConfig(): CantonConfig {
    return this.config;
  }
}

export { LedgerApi } from './ledger-api/index.js';
export { TokenStandard } from './token-standard/index.js';
export { AuthTokenProvider } from './auth.js';
export { PartyManager, SetupProposalManager } from './party.js';
export { BalanceManager } from './balance.js';
export { TransferManager } from './transfer.js';
export { PreapprovalManager } from './preapproval.js';
export * from './types/index.js';

// Official Canton SDK integration
export {
  OfficialSDKClient,
  type OfficialSDKConfig,
  type TokenSymbol,
  type InstrumentConfig,
  INSTRUMENT_CONFIGS,
  TESTNET_INSTRUMENT_CONFIGS,
  getInstrumentConfig,
  WalletSDKImpl,
  UnsafeAuthController,
  AuthTokenProvider as SDKAuthTokenProvider,
  LedgerController,
  TokenStandardController,
  ValidatorController,
  signTransactionHash,
  createKeyPair,
  type SDKConfig,
  type WalletSDK,
} from './official-sdk.js';

// Passkey recovery support
export {
  PasskeyContractManager,
  type WebAuthnAssertion,
  type PasskeyContract,
  type CreatePasskeyResult,
  type RecoveryResult,
  type RecoveryChallenge,
} from './passkey.js';
