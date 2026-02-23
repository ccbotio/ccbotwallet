export interface User {
  id: string;
  telegramId: string;
  telegramUsername?: string;
  cantonPartyId?: string;
  tier: UserTier;
  isVerified: boolean;
  streakCount: number;
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Wallet {
  id: string;
  userId: string;
  partyId: string;
  publicKey?: string;
  isPrimary: boolean;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  token: string;
  fromParty?: string;
  toParty?: string;
  txHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  confirmedAt?: Date;
}

export type TransactionType = 'send' | 'receive' | 'swap';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface Verification {
  id: string;
  userId: string;
  type: VerificationType;
  status: VerificationStatus;
  metadata?: Record<string, unknown>;
  verifiedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export type VerificationType = 'telegram_age' | 'botbasher' | 'x_account';
export type VerificationStatus = 'pending' | 'verified' | 'failed' | 'expired';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
