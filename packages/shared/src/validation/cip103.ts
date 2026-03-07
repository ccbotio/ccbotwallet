/**
 * CIP-103: Canton dApp Standard Validation Schemas
 *
 * Zod schemas for validating CIP-103 requests and responses.
 */

import { z } from 'zod';

// ========== Method Schema ==========

export const cip103MethodSchema = z.enum([
  'connect',
  'isConnected',
  'disconnect',
  'status',
  'getActiveNetwork',
  'listAccounts',
  'getPrimaryAccount',
  'signMessage',
  'prepareExecute',
  'ledgerApi',
]);

export type Cip103MethodType = z.infer<typeof cip103MethodSchema>;

// ========== Connect Params ==========

export const connectParamsSchema = z.object({
  origin: z.string().url(),
  name: z.string().max(128).optional(),
  icon: z.string().url().optional(),
  permissions: z.array(z.string()).optional(),
});

// ========== Sign Message Params ==========

export const signMessageParamsSchema = z.object({
  message: z.string().min(1).max(65536),
  encoding: z.enum(['utf8', 'hex']).default('utf8'),
  partyId: z.string().max(256).optional(),
});

// ========== DAML Command Schema ==========

export const damlCommandSchema = z.object({
  type: z.enum(['create', 'exercise']),
  templateId: z.string().optional(),
  contractId: z.string().optional(),
  choice: z.string().optional(),
  argument: z.record(z.unknown()),
}).refine(
  (data) => {
    if (data.type === 'create') {
      return !!data.templateId;
    }
    if (data.type === 'exercise') {
      return !!data.contractId && !!data.choice;
    }
    return false;
  },
  {
    message: 'Create commands require templateId, exercise commands require contractId and choice',
  }
);

// ========== Disclosed Contract Schema ==========

export const disclosedContractSchema = z.object({
  contractId: z.string().min(1),
  createdEventBlob: z.string().min(1),
  synchronizerId: z.string().min(1),
});

// ========== Prepare Execute Params ==========

export const prepareExecuteParamsSchema = z.object({
  command: damlCommandSchema,
  partyId: z.string().max(256).optional(),
  disclosedContracts: z.array(disclosedContractSchema).optional(),
  memo: z.string().max(512).optional(),
});

// ========== Ledger API Params ==========

export const ledgerApiParamsSchema = z.object({
  operation: z.enum(['query', 'create', 'exercise']),
  templateId: z.string().optional(),
  contractId: z.string().optional(),
  choice: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  partyId: z.string().max(256).optional(),
}).refine(
  (data) => {
    if (data.operation === 'create') {
      return !!data.templateId && !!data.payload;
    }
    if (data.operation === 'exercise') {
      return !!data.contractId && !!data.choice;
    }
    return true; // query is more flexible
  },
  {
    message: 'Create requires templateId and payload, exercise requires contractId and choice',
  }
);

// ========== Create Session Schema ==========

export const createDappSessionSchema = z.object({
  method: cip103MethodSchema,
  params: z.unknown().optional(),
  origin: z.string().url().max(512),
  name: z.string().max(128).optional(),
  icon: z.string().url().max(512).optional(),
  callbackUrl: z.string().url().max(1024),
  codeChallenge: z.string().min(43).max(128), // PKCE S256
  requestId: z.union([z.string(), z.number()]).optional(),
});

export type CreateDappSessionInput = z.infer<typeof createDappSessionSchema>;

// ========== Check Session Status Schema ==========

export const checkSessionStatusSchema = z.object({
  sessionId: z.string().min(1).max(64),
  codeVerifier: z.string().min(43).max(128), // PKCE verifier
});

export type CheckSessionStatusInput = z.infer<typeof checkSessionStatusSchema>;

// ========== Approve Session Schema ==========

export const approveSessionSchema = z.object({
  sessionId: z.string().min(1).max(64),
  userShareHex: z.string().min(1).optional(), // Required for signing methods
});

export type ApproveSessionInput = z.infer<typeof approveSessionSchema>;

// ========== Reject Session Schema ==========

export const rejectSessionSchema = z.object({
  sessionId: z.string().min(1).max(64),
});

export type RejectSessionInput = z.infer<typeof rejectSessionSchema>;

// ========== Validation Helper Functions ==========

/**
 * Validate method-specific params.
 */
export function validateMethodParams(method: string, params: unknown): { success: boolean; error?: string } {
  try {
    switch (method) {
      case 'connect':
        if (params) connectParamsSchema.parse(params);
        break;
      case 'signMessage':
        signMessageParamsSchema.parse(params);
        break;
      case 'prepareExecute':
        prepareExecuteParamsSchema.parse(params);
        break;
      case 'ledgerApi':
        ledgerApiParamsSchema.parse(params);
        break;
      // These methods don't require params
      case 'isConnected':
      case 'disconnect':
      case 'status':
      case 'getActiveNetwork':
      case 'listAccounts':
      case 'getPrimaryAccount':
        break;
      default:
        return { success: false, error: `Unknown method: ${method}` };
    }
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors.map(e => e.message).join(', ') };
    }
    return { success: false, error: 'Invalid params' };
  }
}

/**
 * Check if a method requires signing (user share).
 */
export function requiresSigning(method: string): boolean {
  return ['signMessage', 'prepareExecute', 'ledgerApi'].includes(method);
}

/**
 * Check if a method requires an existing connection.
 */
export function requiresConnection(method: string): boolean {
  return [
    'listAccounts',
    'getPrimaryAccount',
    'signMessage',
    'prepareExecute',
    'ledgerApi',
  ].includes(method);
}
