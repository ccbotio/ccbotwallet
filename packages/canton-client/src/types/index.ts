export interface CantonConfig {
  network: 'devnet' | 'testnet' | 'mainnet';
  ledgerApiUrl: string;
  jsonApiUrl?: string | undefined;
  participantId: string;
  validatorUrl?: string | undefined;
  scanUrl?: string | undefined;
  /** Ledger API user name for JWT auth (default: 'ledger-api-user') */
  ledgerApiUser?: string | undefined;
  /** Validator audience for JWT auth (default: 'https://validator.example.com') */
  validatorAudience?: string | undefined;
}

export interface Party {
  id: string;
  displayName?: string;
  publicKey?: string;
}

export interface Contract {
  contractId: string;
  templateId: string;
  payload: Record<string, unknown>;
}

export interface TokenBalance {
  token: string;
  amount: string;
  locked: string;
}

export interface HoldingUtxo {
  contractId: string;
  amount: string;
  owner: string;
  provider: string;
}

/**
 * SDK HoldingUtxo response - complex nested structure from Canton SDK
 * The SDK returns various nested formats depending on the operation
 */
export interface SDKHoldingUtxo {
  cid?: string;
  contractId?: string;
  view?: {
    amount: string;
    lock?: unknown;
    owner: string;
    account?: { custodian: string };
  };
  amount?: string;
  owner?: string;
  // Top-level interfaceViewValue (simpler path)
  interfaceViewValue?: {
    amount?: string;
    lock?: unknown;
    owner?: string;
    account?: { custodian?: string };
  };
  activeContract?: {
    createdEvent?: {
      interfaceViews?: Array<{
        viewValue?: {
          amount?: string;
          lock?: unknown;
          owner?: string;
          account?: { custodian?: string };
        };
      }>;
    };
  };
}

export interface TransferRequest {
  fromParty: string;
  toParty: string;
  token: string;
  amount: string;
  memo?: string;
}

export interface TransferResult {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  updateId?: string;
}

export interface TransferPreapproval {
  contractId: string;
  receiver: string;
  provider: string;
  expiresAt?: string;
}

export interface ExternalPartyResult {
  partyId: string;
  publicKey: string;
  topologyTxHashes: string[];
}

export interface LedgerEvent {
  type: 'created' | 'archived';
  contractId: string;
  templateId: string;
  payload: Record<string, unknown>;
  offset?: string;
}

export interface SubmissionRequest {
  commands: Command[];
  signatures?: SignatureEntry[];
}

export interface Command {
  type: 'create' | 'exercise';
  templateId?: string;
  contractId?: string;
  choice?: string;
  argument?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface SignatureEntry {
  publicKey: string;
  signature: string;
  format: 'ed25519';
}

export interface WalletSetupResult {
  partyId: string;
  preapprovalContractId?: string;
  validatorRightContractId?: string;
}

export interface AuthToken {
  token: string;
  expiresAt: number;
}
