import { pgTable, uuid, varchar, timestamp, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: varchar('telegram_id', { length: 32 }).notNull().unique(),
  telegramUsername: varchar('telegram_username', { length: 64 }),
  /** Unique CC Bot username (3-15 chars, a-z, 0-9, _) */
  username: varchar('username', { length: 15 }).unique(),
  /** Timestamp when username was last changed (can only change once) */
  usernameChangedAt: timestamp('username_changed_at'),
  /** Verified email address - UNIQUE to prevent duplicate accounts */
  email: varchar('email', { length: 256 }).unique(),
  /** Timestamp when email was verified (required before passkey registration) */
  emailVerifiedAt: timestamp('email_verified_at'),
  cantonPartyId: varchar('canton_party_id', { length: 256 }),
  tier: varchar('tier', { length: 16 }).default('bronze').notNull(),
  isVerified: boolean('is_verified').default(false).notNull(),
  streakCount: integer('streak_count').default(0).notNull(),
  lastActiveAt: timestamp('last_active_at'),
  /** User preference: Auto-merge UTXOs when >10 (requires MergeDelegation) */
  autoMergeUtxo: boolean('auto_merge_utxo').default(true).notNull(),
  /** User preference: Enable 1-step transfers via TransferPreapproval */
  oneStepTransfers: boolean('one_step_transfers').default(true).notNull(),
  /** User preference: Auto-accept pending incoming transfers */
  autoAcceptTransfers: boolean('auto_accept_transfers').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  partyId: varchar('party_id', { length: 256 }).notNull().unique(),
  publicKey: varchar('public_key', { length: 512 }),
  isPrimary: boolean('is_primary').default(true).notNull(),
  transferNonce: integer('transfer_nonce').default(0).notNull(),
  /** MergeDelegation contract ID - enables auto UTXO merge without PIN */
  mergeDelegationCid: varchar('merge_delegation_cid', { length: 256 }),
  /** TransferPreapproval contract ID - enables 1-step incoming transfers */
  transferPreapprovalCid: varchar('transfer_preapproval_cid', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_wallet_user').on(table.userId),
]);

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  // Status: 'pending', 'confirmed', 'failed'
  status: varchar('status', { length: 16 }).notNull(),
  amount: varchar('amount', { length: 64 }).notNull(),
  token: varchar('token', { length: 32 }).notNull(),
  fromParty: varchar('from_party', { length: 256 }),
  toParty: varchar('to_party', { length: 256 }),
  // txHash is unique to prevent duplicate transactions
  txHash: varchar('tx_hash', { length: 256 }).unique(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
}, (table) => [
  index('idx_tx_wallet').on(table.walletId),
  index('idx_tx_created').on(table.createdAt),
]);

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  metadata: jsonb('metadata'),
  verifiedAt: timestamp('verified_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export const serverShares = pgTable('server_shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id, { onDelete: 'cascade' }),
  encryptedShare: varchar('encrypted_share', { length: 1024 }).notNull(),
  shareIndex: integer('share_index').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  telegramId: varchar('telegram_id', { length: 32 }).notNull(),
  refreshToken: varchar('refresh_token', { length: 512 }).notNull(),
  // Device binding for session security
  deviceFingerprint: varchar('device_fingerprint', { length: 256 }),
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
}, (table) => [
  index('idx_session_user').on(table.userId),
  index('idx_session_expires').on(table.expiresAt),
]);

export const emailCodes = pgTable('email_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 256 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  // SECURITY: Hash of code for comparison (never store plaintext)
  codeHash: varchar('code_hash', { length: 128 }),
  attempts: integer('attempts').default(0).notNull(),
  // IP tracking for rate limiting
  requestIp: varchar('request_ip', { length: 64 }),
  expiresAt: timestamp('expires_at').notNull(),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_email_code_user').on(table.userId),
  index('idx_email_code_email').on(table.email),
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(), // 'transfer_received', 'transfer_sent', 'utxo_merge', etc.
  title: varchar('title', { length: 255 }).notNull(),
  body: varchar('body', { length: 1024 }).notNull(),
  data: jsonb('data'), // { txId, amount, from, to }
  read: boolean('read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_notification_user').on(table.userId),
]);

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type ServerShare = typeof serverShares.$inferSelect;
export type NewServerShare = typeof serverShares.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type EmailCode = typeof emailCodes.$inferSelect;
export type NewEmailCode = typeof emailCodes.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// Passkey credentials for wallet recovery
// SECURITY: Direct userId link ensures passkey is bound to specific user, not just wallet
export const passkeyCredentials = pgTable('passkey_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Direct user binding (not just via wallet) for security
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id, { onDelete: 'cascade' }),
  credentialId: varchar('credential_id', { length: 512 }).notNull().unique(),
  publicKeySpki: varchar('public_key_spki', { length: 1024 }).notNull(),
  // Email that was verified when passkey was created (immutable audit trail)
  emailAtRegistration: varchar('email_at_registration', { length: 256 }).notNull(),
  cantonContractId: varchar('canton_contract_id', { length: 256 }),
  deviceName: varchar('device_name', { length: 128 }),
  // Device fingerprint for additional verification
  deviceFingerprint: varchar('device_fingerprint', { length: 256 }),
  lastUsedAt: timestamp('last_used_at'),
  // Revocation support
  revokedAt: timestamp('revoked_at'),
  revokedReason: varchar('revoked_reason', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_passkey_user').on(table.userId),
  index('idx_passkey_email').on(table.emailAtRegistration),
]);

// Recovery challenges for WebAuthn (temporary, for replay protection)
export const passkeyChallenges = pgTable('passkey_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => wallets.id, { onDelete: 'cascade' }),
  challenge: varchar('challenge', { length: 256 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type PasskeyCredential = typeof passkeyCredentials.$inferSelect;
export type NewPasskeyCredential = typeof passkeyCredentials.$inferInsert;
export type PasskeyChallenge = typeof passkeyChallenges.$inferSelect;
export type NewPasskeyChallenge = typeof passkeyChallenges.$inferInsert;

// Passkey sessions for OAuth+PKCE flow (secure external browser auth)
export const passkeySessions = pgTable('passkey_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Session identifier (public, passed in URL)
  sessionId: varchar('session_id', { length: 64 }).notNull().unique(),

  // PKCE code challenge (SHA256 hash of code_verifier)
  codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),

  // User/wallet info - with CASCADE for proper cleanup
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  telegramId: varchar('telegram_id', { length: 32 }).notNull(),
  // walletId and partyId are nullable for passkey-only flow (created before wallet)
  walletId: uuid('wallet_id')
    .references(() => wallets.id, { onDelete: 'cascade' }),
  partyId: varchar('party_id', { length: 256 }),

  // Email that must match user's verified email
  emailAtCreation: varchar('email_at_creation', { length: 256 }).notNull(),

  // Encrypted user share (stored securely, never in URL) - nullable for passkey-only flow
  encryptedUserShare: varchar('encrypted_user_share', { length: 1024 }),

  // User display name for passkey
  displayName: varchar('display_name', { length: 128 }),

  // Session state
  status: varchar('status', { length: 16 }).default('pending').notNull(), // pending, completed, expired, used

  // Passkey credential ID (set after successful registration)
  completedCredentialId: varchar('completed_credential_id', { length: 512 }),

  // Device/IP tracking
  requestIp: varchar('request_ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),

  // Timestamps
  expiresAt: timestamp('expires_at').notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_passkey_session_user').on(table.userId),
  index('idx_passkey_session_expires').on(table.expiresAt),
]);

export type PasskeySession = typeof passkeySessions.$inferSelect;
export type NewPasskeySession = typeof passkeySessions.$inferInsert;

// Session locks for automatic session timeout
export const sessionLocks = pgTable('session_locks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  isLocked: boolean('is_locked').default(false).notNull(),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
  lockTimeoutSeconds: integer('lock_timeout_seconds').default(300).notNull(), // 5 minutes default
  // Failed unlock attempts tracking
  failedUnlockAttempts: integer('failed_unlock_attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SessionLock = typeof sessionLocks.$inferSelect;
export type NewSessionLock = typeof sessionLocks.$inferInsert;

// Security events for audit trail
// SECURITY: Never delete - retain for forensics even if user is deleted
export const securityEvents = pgTable('security_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'set null' }), // Keep events even if user deleted (nullable)
  eventType: varchar('event_type', { length: 64 }).notNull(), // 'pin_change', 'passkey_register', 'login_attempt', 'email_verify', etc.
  eventStatus: varchar('event_status', { length: 16 }).notNull(), // 'success', 'failed', 'blocked'
  severity: varchar('severity', { length: 16 }).default('info').notNull(), // 'info', 'warning', 'critical'
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  // Session/request tracking
  sessionId: varchar('session_id', { length: 128 }),
  requestId: varchar('request_id', { length: 128 }),
  metadata: jsonb('metadata'), // Additional event-specific data
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_security_user').on(table.userId),
  index('idx_security_type').on(table.eventType),
  index('idx_security_created').on(table.createdAt),
  index('idx_security_severity').on(table.severity),
]);

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;

// Blocked email domains (disposable email providers)
// SECURITY: Block temporary/disposable email services
export const blockedEmailDomains = pgTable('blocked_email_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: varchar('domain', { length: 256 }).notNull().unique(),
  reason: varchar('reason', { length: 256 }), // 'disposable', 'spam', 'manual_block'
  addedBy: varchar('added_by', { length: 64 }), // 'system', 'admin', etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type BlockedEmailDomain = typeof blockedEmailDomains.$inferSelect;
export type NewBlockedEmailDomain = typeof blockedEmailDomains.$inferInsert;

// Email verification rate limiting
// SECURITY: Prevent email bombing and brute force
export const emailRateLimits = pgTable('email_rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Can track by email, IP, or userId
  email: varchar('email', { length: 256 }),
  ipAddress: varchar('ip_address', { length: 64 }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  // Rate limit tracking
  sendCount: integer('send_count').default(0).notNull(),
  verifyAttempts: integer('verify_attempts').default(0).notNull(),
  lastSendAt: timestamp('last_send_at'),
  blockedUntil: timestamp('blocked_until'),
  // Window tracking
  windowStart: timestamp('window_start').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_email_rate_email').on(table.email),
  index('idx_email_rate_ip').on(table.ipAddress),
]);

export type EmailRateLimit = typeof emailRateLimits.$inferSelect;
export type NewEmailRateLimit = typeof emailRateLimits.$inferInsert;

// Login attempt tracking
// SECURITY: Detect suspicious login patterns
export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: varchar('telegram_id', { length: 32 }),
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),
  success: boolean('success').default(false).notNull(),
  failureReason: varchar('failure_reason', { length: 128 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_login_telegram').on(table.telegramId),
  index('idx_login_ip').on(table.ipAddress),
  index('idx_login_created').on(table.createdAt),
]);

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;

// ==================== Swap Tables ====================

// Swap quotes - temporary quotes with expiration
export const swapQuotes = pgTable('swap_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Quote details
  fromToken: varchar('from_token', { length: 16 }).notNull(), // 'CC' or 'USDCx'
  toToken: varchar('to_token', { length: 16 }).notNull(), // 'CC' or 'USDCx'
  fromAmount: varchar('from_amount', { length: 64 }).notNull(),
  toAmount: varchar('to_amount', { length: 64 }).notNull(),
  // Pricing
  rate: varchar('rate', { length: 64 }).notNull(), // Exchange rate at quote time
  fee: varchar('fee', { length: 64 }).notNull(), // Fee in fromToken
  feePercentage: varchar('fee_percentage', { length: 16 }).notNull(), // e.g., "0.3"
  ccPriceUsd: varchar('cc_price_usd', { length: 64 }).notNull(), // CC price at quote time
  // Status
  status: varchar('status', { length: 16 }).default('pending').notNull(), // 'pending', 'executed', 'expired', 'cancelled'
  // Expiration
  expiresAt: timestamp('expires_at').notNull(),
  executedAt: timestamp('executed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_swap_quote_user').on(table.userId),
  index('idx_swap_quote_status').on(table.status),
  index('idx_swap_quote_expires').on(table.expiresAt),
]);

// Swap transactions - completed swaps
// Status flow: pending → user_sent → completed
//                     ↘ failed → refund_pending → refunded
//                     ↘ failed (with refund_failed)
export const swapTransactions = pgTable('swap_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  quoteId: uuid('quote_id')
    .references(() => swapQuotes.id, { onDelete: 'set null' }),
  // Swap details
  fromToken: varchar('from_token', { length: 16 }).notNull(),
  toToken: varchar('to_token', { length: 16 }).notNull(),
  fromAmount: varchar('from_amount', { length: 64 }).notNull(),
  toAmount: varchar('to_amount', { length: 64 }).notNull(),
  fee: varchar('fee', { length: 64 }).notNull(),
  // User party for refunds
  userPartyId: varchar('user_party_id', { length: 256 }),
  // Transaction hashes
  userToTreasuryTxHash: varchar('user_to_treasury_tx_hash', { length: 256 }),
  treasuryToUserTxHash: varchar('treasury_to_user_tx_hash', { length: 256 }),
  // Refund tracking
  refundTxHash: varchar('refund_tx_hash', { length: 256 }),
  refundAmount: varchar('refund_amount', { length: 64 }),
  refundedAt: timestamp('refunded_at'),
  refundReason: varchar('refund_reason', { length: 512 }),
  refundAttempts: integer('refund_attempts').default(0).notNull(),
  // Status: 'pending', 'user_sent', 'completed', 'failed', 'refund_pending', 'refunded', 'refund_failed'
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  failureReason: varchar('failure_reason', { length: 512 }),
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('idx_swap_tx_user').on(table.userId),
  index('idx_swap_tx_status').on(table.status),
  index('idx_swap_tx_created').on(table.createdAt),
]);

// Treasury state - tracks treasury balances and configuration
export const treasuryState = pgTable('treasury_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Singleton config - only one row
  partyId: varchar('party_id', { length: 256 }).notNull().unique(),
  // Reserve tracking (updated after each swap)
  ccReserve: varchar('cc_reserve', { length: 64 }).default('0').notNull(),
  usdcxReserve: varchar('usdcx_reserve', { length: 64 }).default('0').notNull(),
  // Configuration
  feePercentage: varchar('fee_percentage', { length: 16 }).default('0.3').notNull(),
  maxSwapAmountCc: varchar('max_swap_amount_cc', { length: 64 }).default('10000').notNull(),
  maxSwapAmountUsdcx: varchar('max_swap_amount_usdcx', { length: 64 }).default('10000').notNull(),
  minSwapAmountCc: varchar('min_swap_amount_cc', { length: 64 }).default('1').notNull(),
  minSwapAmountUsdcx: varchar('min_swap_amount_usdcx', { length: 64 }).default('0.1').notNull(),
  // Status
  isActive: boolean('is_active').default(true).notNull(),
  pausedReason: varchar('paused_reason', { length: 256 }),
  // Stats
  totalSwapsCount: integer('total_swaps_count').default(0).notNull(),
  totalFeesCollectedCc: varchar('total_fees_collected_cc', { length: 64 }).default('0').notNull(),
  totalFeesCollectedUsdcx: varchar('total_fees_collected_usdcx', { length: 64 }).default('0').notNull(),
  // Timestamps
  lastSwapAt: timestamp('last_swap_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SwapQuote = typeof swapQuotes.$inferSelect;
export type NewSwapQuote = typeof swapQuotes.$inferInsert;
export type SwapTransaction = typeof swapTransactions.$inferSelect;
export type NewSwapTransaction = typeof swapTransactions.$inferInsert;
export type TreasuryState = typeof treasuryState.$inferSelect;
export type NewTreasuryState = typeof treasuryState.$inferInsert;

// ==================== Bridge Tables ====================

/**
 * Bridge Transactions - Tracks USDC<->USDCx bridging via Circle xReserve
 *
 * Deposit Flow (Ethereum → Canton):
 *   deposit_initiated → eth_tx_pending → eth_tx_confirmed → attestation_pending
 *   → attestation_received → mint_pending → mint_completed → completed
 *
 * Withdrawal Flow (Canton → Ethereum):
 *   withdrawal_initiated → burn_pending → burn_completed → attestation_pending
 *   → attestation_received → eth_release_pending → eth_release_completed → completed
 */
export const bridgeTransactions = pgTable('bridge_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id')
    .references(() => wallets.id, { onDelete: 'set null' }),

  // Bridge direction
  type: varchar('type', { length: 16 }).notNull(), // 'deposit' | 'withdrawal'
  fromChain: varchar('from_chain', { length: 16 }).notNull(), // 'ethereum' | 'canton'
  toChain: varchar('to_chain', { length: 16 }).notNull(), // 'canton' | 'ethereum'

  // Amounts
  fromAmount: varchar('from_amount', { length: 64 }).notNull(), // Amount being sent
  toAmount: varchar('to_amount', { length: 64 }), // Amount received (after fees)
  fee: varchar('fee', { length: 64 }), // Bridge fee

  // Addresses/Parties
  fromAddress: varchar('from_address', { length: 256 }), // Ethereum address (for deposits)
  toAddress: varchar('to_address', { length: 256 }), // Ethereum address (for withdrawals)
  cantonPartyId: varchar('canton_party_id', { length: 256 }).notNull(),

  // Ethereum transaction details
  ethTxHash: varchar('eth_tx_hash', { length: 128 }),
  ethBlockNumber: integer('eth_block_number'),
  ethConfirmations: integer('eth_confirmations').default(0),

  // Canton transaction details
  cantonTxHash: varchar('canton_tx_hash', { length: 256 }),
  cantonUpdateId: varchar('canton_update_id', { length: 256 }),

  // Circle xReserve attestation
  attestationHash: varchar('attestation_hash', { length: 256 }),
  attestationStatus: varchar('attestation_status', { length: 32 }), // 'pending' | 'complete' | 'failed'
  attestationReceivedAt: timestamp('attestation_received_at'),

  // For deposits: DepositAttestation contract ID on Canton
  depositAttestationCid: varchar('deposit_attestation_cid', { length: 256 }),
  // For withdrawals: BurnIntent contract ID on Canton
  burnIntentCid: varchar('burn_intent_cid', { length: 256 }),

  // Status tracking
  // Deposit: deposit_initiated → eth_tx_pending → eth_tx_confirmed → attestation_pending
  //          → attestation_received → mint_pending → mint_completed → completed
  // Withdrawal: withdrawal_initiated → burn_pending → burn_completed → attestation_pending
  //             → attestation_received → eth_release_pending → eth_release_completed → completed
  status: varchar('status', { length: 32 }).default('initiated').notNull(),
  failureReason: varchar('failure_reason', { length: 512 }),

  // Retry tracking
  retryCount: integer('retry_count').default(0).notNull(),
  lastRetryAt: timestamp('last_retry_at'),
  nextRetryAt: timestamp('next_retry_at'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('idx_bridge_tx_user').on(table.userId),
  index('idx_bridge_tx_status').on(table.status),
  index('idx_bridge_tx_type').on(table.type),
  index('idx_bridge_tx_eth_hash').on(table.ethTxHash),
  index('idx_bridge_tx_attestation_pending').on(table.attestationStatus),
  index('idx_bridge_tx_created').on(table.createdAt),
]);

export type BridgeTransaction = typeof bridgeTransactions.$inferSelect;
export type NewBridgeTransaction = typeof bridgeTransactions.$inferInsert;

// ==================== CIP-103 dApp Session Tables ====================

/**
 * dApp Sessions - Temporary sessions for CIP-103 JSON-RPC requests
 *
 * Each session represents a request from an external dApp that needs user approval.
 * Sessions expire after 15 minutes and support PKCE for security.
 *
 * Status flow:
 *   pending → awaiting_user → approved → completed
 *                          ↘ rejected
 *                          ↘ expired
 */
export const dappSessions = pgTable('dapp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: varchar('session_id', { length: 64 }).notNull().unique(),

  // PKCE (Proof Key for Code Exchange)
  codeChallenge: varchar('code_challenge', { length: 128 }).notNull(),

  // dApp information
  dappOrigin: varchar('dapp_origin', { length: 512 }).notNull(),
  dappName: varchar('dapp_name', { length: 128 }),
  dappIcon: varchar('dapp_icon', { length: 512 }),
  callbackUrl: varchar('callback_url', { length: 1024 }).notNull(),

  // JSON-RPC request
  method: varchar('method', { length: 64 }).notNull(),
  params: jsonb('params'),
  requestId: varchar('request_id', { length: 128 }),

  // User binding (set when user approves)
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id').references(() => wallets.id, { onDelete: 'cascade' }),

  // Session status
  status: varchar('status', { length: 16 }).default('pending').notNull(),

  // Result (set on completion)
  result: jsonb('result'),
  errorCode: integer('error_code'),
  errorMessage: varchar('error_message', { length: 512 }),

  // Security tracking
  requestIp: varchar('request_ip', { length: 64 }),
  userAgent: varchar('user_agent', { length: 512 }),

  // Timestamps
  expiresAt: timestamp('expires_at').notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_dapp_session_user').on(table.userId),
  index('idx_dapp_session_status').on(table.status),
  index('idx_dapp_session_expires').on(table.expiresAt),
]);

/**
 * dApp Connections - Persistent connections between users and dApps
 *
 * When a user approves a 'connect' request, a connection is created.
 * Connections can be revoked by the user at any time.
 */
export const dappConnections = pgTable('dapp_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),

  // dApp identification
  dappOrigin: varchar('dapp_origin', { length: 512 }).notNull(),
  dappName: varchar('dapp_name', { length: 128 }),

  // Connection status
  isActive: boolean('is_active').default(true).notNull(),

  // Granted permissions (JSON array of permission strings)
  permissions: jsonb('permissions').default([]),

  // Timestamps
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  disconnectedAt: timestamp('disconnected_at'),
}, (table) => [
  index('idx_dapp_connection_user').on(table.userId),
  index('idx_dapp_connection_origin').on(table.dappOrigin),
]);

export type DappSession = typeof dappSessions.$inferSelect;
export type NewDappSession = typeof dappSessions.$inferInsert;
export type DappConnection = typeof dappConnections.$inferSelect;
export type NewDappConnection = typeof dappConnections.$inferInsert;
