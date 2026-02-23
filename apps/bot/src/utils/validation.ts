import { z } from 'zod';

export const walletCreateSchema = z.object({
  publicKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'Invalid Ed25519 public key')
    .optional(),
});

export const transferSendSchema = z.object({
  receiverPartyId: z.string().min(1).max(256),
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Invalid amount format')
    .refine((val) => parseFloat(val) > 0, 'Amount must be positive')
    .refine((val) => parseFloat(val) <= 1000000, 'Amount exceeds maximum'),
  userShareHex: z.string().min(1, 'User share is required'),
  memo: z.string().max(256).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const telegramAuthSchema = z.object({
  initData: z.string().min(1, 'initData is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().uuid('Invalid refresh token format'),
});

export type WalletCreateInput = z.infer<typeof walletCreateSchema>;
export type TransferSendInput = z.infer<typeof transferSendSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
