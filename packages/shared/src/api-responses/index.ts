import { z } from 'zod';

// ============================================================================
// Common Response Schemas
// ============================================================================

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: apiErrorSchema.optional(),
  });

// ============================================================================
// Auth Response Schemas
// ============================================================================

export const authResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
  }),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

// ============================================================================
// Wallet Response Schemas
// ============================================================================

export const walletCreateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    walletId: z.string(),
    partyId: z.string(),
    publicKey: z.string(),
    userShareHex: z.string(),
    recoveryShareHex: z.string(),
    serverShareIndex: z.number().optional(),
  }),
});

export type WalletCreateResponse = z.infer<typeof walletCreateResponseSchema>;

export const walletDetailsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    walletId: z.string(),
    partyId: z.string(),
    publicKey: z.string().nullable(),
    isPrimary: z.boolean().optional(),
    createdAt: z.string().optional(), // ISO date string
  }),
});

export type WalletDetailsResponse = z.infer<typeof walletDetailsResponseSchema>;

export const balanceItemSchema = z.object({
  token: z.string(),
  amount: z.string(), // Always string for precision
  locked: z.string(), // Always string for precision
});

export const walletBalanceResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(balanceItemSchema),
});

export type WalletBalanceResponse = z.infer<typeof walletBalanceResponseSchema>;
export type BalanceItem = z.infer<typeof balanceItemSchema>;

export const walletRecoverResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    walletId: z.string(),
    partyId: z.string(),
    publicKey: z.string(),
    userShareHex: z.string(),
    recoveryShareHex: z.string(),
    serverShareIndex: z.number().optional(),
  }),
});

export type WalletRecoverResponse = z.infer<typeof walletRecoverResponseSchema>;

// ============================================================================
// Transaction Response Schemas
// ============================================================================

export const transactionTypeSchema = z.enum(['send', 'receive', 'swap']);
export const transactionStatusSchema = z.enum(['pending', 'confirmed', 'failed']);

export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  walletId: z.string().optional(),
  type: transactionTypeSchema,
  status: transactionStatusSchema,
  amount: z.string(), // Always string for precision
  token: z.string(),
  fromParty: z.string().nullable().optional(),
  toParty: z.string().nullable().optional(),
  txHash: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string(), // ISO date string
  confirmedAt: z.string().nullable().optional(), // ISO date string
});

export type TransactionRecord = z.infer<typeof transactionSchema>;

export const transactionsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(transactionSchema),
});

export type TransactionsResponse = z.infer<typeof transactionsResponseSchema>;

// ============================================================================
// Transfer Response Schemas
// ============================================================================

export const transferSendResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    transactionId: z.string(),
    txHash: z.string(),
    status: z.string(),
  }),
});

export type TransferSendResponse = z.infer<typeof transferSendResponseSchema>;

// ============================================================================
// UTXO Response Schemas
// ============================================================================

export const utxoStatusResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    utxoCount: z.number(),
    needsMerge: z.boolean(),
    threshold: z.number(),
  }),
});

export type UtxoStatusResponse = z.infer<typeof utxoStatusResponseSchema>;

export const utxoMergeResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    mergedCount: z.number(),
    message: z.string(),
  }),
});

export type UtxoMergeResponse = z.infer<typeof utxoMergeResponseSchema>;

// ============================================================================
// Sync Response Schemas
// ============================================================================

export const syncResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    synced: z.number(),
    updated: z.number(),
    message: z.string(),
  }),
});

export type SyncResponse = z.infer<typeof syncResponseSchema>;

// ============================================================================
// Price Response Schemas
// ============================================================================

export const priceResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    price: z.string(), // Changed to string for precision
    round: z.number(),
    currency: z.string(),
    symbol: z.string(),
    cached: z.boolean().optional(),
    amuletPriceUsd: z.string().optional(), // Changed to string for precision
    rewardRate: z.string().optional(), // Changed to string for precision
  }),
});

export type PriceResponse = z.infer<typeof priceResponseSchema>;

// ============================================================================
// Username Response Schemas
// ============================================================================

export const usernameCheckResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    available: z.boolean(),
    reason: z.string().optional(),
  }),
});

export type UsernameCheckResponse = z.infer<typeof usernameCheckResponseSchema>;

export const usernameSetResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    username: z.string(),
    permanent: z.boolean(),
  }),
});

export type UsernameSetResponse = z.infer<typeof usernameSetResponseSchema>;

export const usernameResolveResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    username: z.string(),
    partyId: z.string(),
  }),
});

export type UsernameResolveResponse = z.infer<typeof usernameResolveResponseSchema>;

export const usernameSearchResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    users: z.array(
      z.object({
        username: z.string(),
        partyId: z.string(),
      })
    ),
  }),
});

export type UsernameSearchResponse = z.infer<typeof usernameSearchResponseSchema>;

// ============================================================================
// Email Response Schemas
// ============================================================================

export const emailCheckResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    exists: z.boolean(),
    hasWallet: z.boolean(),
    hasPasskey: z.boolean(),
    partyId: z.string().optional(),
  }),
});

export type EmailCheckResponse = z.infer<typeof emailCheckResponseSchema>;

export const emailSendCodeResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    message: z.string(),
    expiresAt: z.string().optional(), // ISO date string
  }),
});

export type EmailSendCodeResponse = z.infer<typeof emailSendCodeResponseSchema>;

export const emailVerifyResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    message: z.string(),
  }),
});

export type EmailVerifyResponse = z.infer<typeof emailVerifyResponseSchema>;

// ============================================================================
// Passkey Response Schemas
// ============================================================================

export const passkeyRegisterResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    contractId: z.string().optional(),
  }),
});

export type PasskeyRegisterResponse = z.infer<typeof passkeyRegisterResponseSchema>;

export const passkeyChallengeResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    challenge: z.string(),
    expiresAt: z.string(), // ISO date string
    allowCredentials: z.array(
      z.object({
        credentialId: z.string(),
        type: z.string(),
      })
    ),
  }),
});

export type PasskeyChallengeResponse = z.infer<typeof passkeyChallengeResponseSchema>;

export const passkeyCredentialsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    credentials: z.array(
      z.object({
        credentialId: z.string(),
        deviceName: z.string().optional(),
        createdAt: z.string(), // ISO date string
      })
    ),
  }),
});

export type PasskeyCredentialsResponse = z.infer<typeof passkeyCredentialsResponseSchema>;

export const passkeyRecoverResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    encryptedShare: z.string(),
    nonce: z.string(),
    walletId: z.string(),
  }),
});

export type PasskeyRecoverResponse = z.infer<typeof passkeyRecoverResponseSchema>;

// ============================================================================
// Passkey Session Response Schemas
// ============================================================================

export const passkeySessionCreateResponseSchema = z.object({
  sessionId: z.string(),
  expiresAt: z.string(), // ISO date string
  expiresInSeconds: z.number(),
});

export type PasskeySessionCreateResponse = z.infer<typeof passkeySessionCreateResponseSchema>;

export const passkeySessionStatusResponseSchema = z.object({
  status: z.enum(['pending', 'completed', 'expired', 'invalid']),
  credentialId: z.string().optional(),
});

export type PasskeySessionStatusResponse = z.infer<typeof passkeySessionStatusResponseSchema>;

export const passkeySessionGetResponseSchema = z.object({
  walletId: z.string(),
  partyId: z.string(),
  userShareHex: z.string(),
  displayName: z.string(),
  challenge: z.string(),
});

export type PasskeySessionGetResponse = z.infer<typeof passkeySessionGetResponseSchema>;

export const passkeySessionCompleteResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type PasskeySessionCompleteResponse = z.infer<typeof passkeySessionCompleteResponseSchema>;

// ============================================================================
// Faucet Response Schema
// ============================================================================

export const faucetResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    amount: z.string(), // String for precision
    txHash: z.string().optional(),
    message: z.string(),
  }),
});

export type FaucetResponse = z.infer<typeof faucetResponseSchema>;
