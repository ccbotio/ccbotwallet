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
