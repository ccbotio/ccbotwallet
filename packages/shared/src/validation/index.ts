import { z } from 'zod';

export const telegramIdSchema = z.string().regex(/^\d+$/, 'Invalid Telegram ID');

export const partyIdSchema = z.string().min(1).max(256);

export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Invalid amount format')
  .refine((val) => parseFloat(val) > 0, 'Amount must be positive');

export const tokenSchema = z.enum(['CC', 'USDC', 'ETH']);

export const sendTransactionSchema = z.object({
  toPartyId: partyIdSchema,
  amount: amountSchema,
  token: tokenSchema,
  memo: z.string().max(256).optional(),
});

export const userProfileSchema = z.object({
  telegramId: telegramIdSchema,
  telegramUsername: z.string().max(64).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const verificationRequestSchema = z.object({
  type: z.enum(['telegram_age', 'botbasher', 'x_account']),
});

export type SendTransactionInput = z.infer<typeof sendTransactionSchema>;
export type UserProfileInput = z.infer<typeof userProfileSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type VerificationRequestInput = z.infer<typeof verificationRequestSchema>;

// Re-export CIP-103 validation schemas
export * from './cip103.js';
