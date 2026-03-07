/**
 * CIP-103: Canton dApp Standard Type Definitions
 *
 * This module defines types for the CIP-103 standard, which enables
 * external applications to interact with Canton wallets securely.
 *
 * Based on EIP-1193 patterns, adapted for Canton Network.
 */

// ========== JSON-RPC 2.0 Base Types ==========

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ========== CIP-103 Error Codes ==========

/**
 * Standard error codes for CIP-103 responses.
 * Based on JSON-RPC 2.0 and EIP-1193 error codes.
 */
export const CIP103_ERROR_CODES = {
  // User rejection
  USER_REJECTED: 4001,

  // Authorization errors
  UNAUTHORIZED: 4100,

  // Method errors
  UNSUPPORTED_METHOD: 4200,

  // Connection errors
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,

  // JSON-RPC standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Custom errors
  SESSION_EXPIRED: -32001,
  SESSION_NOT_FOUND: -32002,
  WALLET_NOT_FOUND: -32003,
  INSUFFICIENT_BALANCE: -32004,
  TRANSACTION_FAILED: -32005,
  PKCE_VERIFICATION_FAILED: -32006,
} as const;

export type Cip103ErrorCode = typeof CIP103_ERROR_CODES[keyof typeof CIP103_ERROR_CODES];

// ========== CIP-103 Methods ==========

/**
 * Supported CIP-103 methods.
 */
export type Cip103Method =
  // Connection methods
  | 'connect'
  | 'isConnected'
  | 'disconnect'
  | 'status'
  | 'getActiveNetwork'
  // Account methods
  | 'listAccounts'
  | 'getPrimaryAccount'
  // Signing methods
  | 'signMessage'
  // Transaction methods
  | 'prepareExecute'
  | 'ledgerApi';

/**
 * Methods that require PIN/user share for signing.
 */
export const SIGNING_METHODS: Cip103Method[] = ['signMessage', 'prepareExecute', 'ledgerApi'];

/**
 * Methods that require an existing connection.
 */
export const CONNECTION_REQUIRED_METHODS: Cip103Method[] = [
  'listAccounts',
  'getPrimaryAccount',
  'signMessage',
  'prepareExecute',
  'ledgerApi',
];

// ========== Account & Network Types ==========

export interface Cip103Account {
  partyId: string;
  publicKey: string;
  displayName?: string;
  isPrimary: boolean;
}

export interface Cip103Network {
  networkId: 'mainnet' | 'testnet' | 'devnet';
  synchronizerId: string;
  validatorUrl: string;
}

// ========== Method Params & Results ==========

// Connect
export interface Cip103ConnectParams {
  origin: string;
  name?: string;
  icon?: string;
  permissions?: string[];
}

export interface Cip103ConnectResult {
  connected: boolean;
  accounts: Cip103Account[];
  network: Cip103Network;
}

// isConnected
export interface Cip103IsConnectedResult {
  connected: boolean;
}

// disconnect
export interface Cip103DisconnectResult {
  disconnected: boolean;
}

// status
export interface Cip103StatusResult {
  connected: boolean;
  network: Cip103Network;
  accounts: Cip103Account[];
  permissions: string[];
}

// getActiveNetwork
export interface Cip103GetActiveNetworkResult {
  network: Cip103Network;
}

// listAccounts
export interface Cip103ListAccountsResult {
  accounts: Cip103Account[];
}

// getPrimaryAccount
export interface Cip103GetPrimaryAccountResult {
  account: Cip103Account | null;
}

// signMessage
export interface Cip103SignMessageParams {
  message: string;
  encoding?: 'utf8' | 'hex';
  partyId?: string;
}

export interface Cip103SignMessageResult {
  signature: string;
  publicKey: string;
  partyId: string;
}

// prepareExecute
export interface DamlCommand {
  type: 'create' | 'exercise';
  templateId?: string;
  contractId?: string;
  choice?: string;
  argument: Record<string, unknown>;
}

export interface DisclosedContract {
  contractId: string;
  createdEventBlob: string;
  synchronizerId: string;
}

export interface Cip103PrepareExecuteParams {
  command: DamlCommand;
  partyId?: string;
  disclosedContracts?: DisclosedContract[];
  memo?: string;
}

export interface Cip103PrepareExecuteResult {
  submissionId: string;
  status: 'submitted' | 'failed';
  updateId?: string;
  error?: string;
}

// ledgerApi
export interface Cip103LedgerApiParams {
  operation: 'query' | 'create' | 'exercise';
  templateId?: string;
  contractId?: string;
  choice?: string;
  payload?: Record<string, unknown>;
  partyId?: string;
}

export interface Cip103LedgerApiResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ========== Session Types ==========

/**
 * dApp session status values.
 */
export type DappSessionStatus =
  | 'pending'        // Session created, waiting for user
  | 'awaiting_user'  // User is viewing approval screen
  | 'approved'       // User approved, processing
  | 'rejected'       // User rejected
  | 'expired'        // Session expired
  | 'completed';     // Request completed successfully

/**
 * Parameters for creating a new dApp session.
 */
export interface CreateDappSessionParams {
  method: Cip103Method;
  params?: unknown;
  origin: string;
  name?: string;
  icon?: string;
  callbackUrl: string;
  codeChallenge: string;
  requestId?: string | number;
}

/**
 * Result of creating a dApp session.
 */
export interface DappSessionResult {
  sessionId: string;
  walletUrl: string;
  expiresAt: string;
}

/**
 * Session data returned to the approval page.
 */
export interface DappSessionData {
  sessionId: string;
  method: Cip103Method;
  params?: unknown;
  dappOrigin: string;
  dappName?: string;
  dappIcon?: string;
  status: DappSessionStatus;
  expiresAt: string;
  createdAt: string;
}

/**
 * Result of checking session status (with PKCE verification).
 */
export interface CheckSessionStatusResult {
  status: DappSessionStatus;
  result?: unknown;
  error?: JsonRpcError;
}

// ========== Connection Types ==========

/**
 * Active dApp connection.
 */
export interface DappConnectionInfo {
  id: string;
  dappOrigin: string;
  dappName?: string;
  permissions: string[];
  connectedAt: string;
  lastUsedAt: string;
}

// ========== Method Result Types ==========

/**
 * Generic method result union for type safety.
 */
export type Cip103MethodResult =
  | Cip103ConnectResult
  | Cip103IsConnectedResult
  | Cip103DisconnectResult
  | Cip103StatusResult
  | Cip103GetActiveNetworkResult
  | Cip103ListAccountsResult
  | Cip103GetPrimaryAccountResult
  | Cip103SignMessageResult
  | Cip103PrepareExecuteResult
  | Cip103LedgerApiResult;

// ========== Helper Types ==========

/**
 * Map method names to their params types.
 */
export interface Cip103MethodParams {
  connect: Cip103ConnectParams;
  isConnected: undefined;
  disconnect: undefined;
  status: undefined;
  getActiveNetwork: undefined;
  listAccounts: undefined;
  getPrimaryAccount: undefined;
  signMessage: Cip103SignMessageParams;
  prepareExecute: Cip103PrepareExecuteParams;
  ledgerApi: Cip103LedgerApiParams;
}

/**
 * Map method names to their result types.
 */
export interface Cip103MethodResults {
  connect: Cip103ConnectResult;
  isConnected: Cip103IsConnectedResult;
  disconnect: Cip103DisconnectResult;
  status: Cip103StatusResult;
  getActiveNetwork: Cip103GetActiveNetworkResult;
  listAccounts: Cip103ListAccountsResult;
  getPrimaryAccount: Cip103GetPrimaryAccountResult;
  signMessage: Cip103SignMessageResult;
  prepareExecute: Cip103PrepareExecuteResult;
  ledgerApi: Cip103LedgerApiResult;
}
