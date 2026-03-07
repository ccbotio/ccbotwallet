/**
 * AI Agent Types
 *
 * Type definitions for the AI Agent service.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Anthropic Tool type alias for cleaner exports
export type AnthropicTool = Anthropic.Tool;

// Zod schemas for tool params validation
export const sendCCParamsSchema = z.object({
  amount: z.string(),
  recipient: z.string(),
  memo: z.string().optional(),
});

export const swapParamsSchema = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
});

// Tool parameter types (inferred from Zod schemas)
export type SendCCParams = z.infer<typeof sendCCParamsSchema>;
export type SwapParams = z.infer<typeof swapParamsSchema>;

export interface CheckBalanceParams {
  token?: string;
}

export interface LookupAddressParams {
  query: string;
}

// Helper to safely parse tool params
export function parseSendCCParams(params: Record<string, unknown>): SendCCParams {
  return sendCCParamsSchema.parse(params);
}

export function parseSwapParams(params: Record<string, unknown>): SwapParams {
  return swapParamsSchema.parse(params);
}

// Pending action that requires PIN confirmation
export interface PendingAction {
  id: string;
  type: 'send' | 'swap';
  params: SendCCParams | SwapParams;
  createdAt: number;
  expiresAt: number;
}

// Chat message types
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Agent response types
export interface AgentResponse {
  message: string;
  pendingAction?: PendingAction | undefined;
  txResult?: {
    txHash: string;
    explorerUrl: string;
    amount: string;
    recipient: string;
    status: string;
  } | undefined;
  balance?: {
    token: string;
    amount: string;
    usdValue?: string | undefined;
  } | undefined;
}

// Conversation context
export interface ConversationContext {
  telegramId: string;
  walletId?: string;
  partyId?: string;
  messages: ChatMessage[];
  pendingAction?: PendingAction;
  language?: string;
}

// Tool definitions for Claude
export const AGENT_TOOLS = [
  {
    name: 'send_cc',
    description: 'Send Canton Coin (CC) to another wallet. Requires PIN confirmation from user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: {
          type: 'string',
          description: 'Amount of CC to send (e.g., "10", "5.5")',
        },
        recipient: {
          type: 'string',
          description: 'Recipient address (party ID) or Canton Name (e.g., "@alice.canton")',
        },
        memo: {
          type: 'string',
          description: 'Optional memo/note for the transaction',
        },
      },
      required: ['amount', 'recipient'],
    },
  },
  {
    name: 'swap_tokens',
    description: 'Swap between tokens. Requires PIN confirmation from user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromToken: {
          type: 'string',
          description: 'Token to swap from (e.g., "CC", "USDC")',
        },
        toToken: {
          type: 'string',
          description: 'Token to swap to (e.g., "CC", "USDC")',
        },
        amount: {
          type: 'string',
          description: 'Amount of source token to swap',
        },
      },
      required: ['fromToken', 'toToken', 'amount'],
    },
  },
  {
    name: 'check_balance',
    description: 'Check wallet balance with optional details like locked amount and USD value.',
    input_schema: {
      type: 'object' as const,
      properties: {
        detailed: {
          type: 'boolean',
          description: 'Show detailed balance info including locked amount, USD value, and recent activity',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_transaction_history',
    description: 'Get transaction history with optional filters. Can filter by recipient, type, or date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Number of transactions to fetch (default: 10, max: 50)',
        },
        recipient: {
          type: 'string',
          description: 'Filter by recipient address or Canton Name (e.g., "@alice.canton" or Party ID)',
        },
        type: {
          type: 'string',
          description: 'Filter by type: "send", "receive", or "all" (default: all)',
        },
        days: {
          type: 'number',
          description: 'Filter transactions from last N days (e.g., 7 for last week)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_transaction_summary',
    description: 'Get a summary of transactions with a specific address. Shows total sent/received.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'The address (Party ID or Canton Name) to get transaction summary for',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'lookup_address',
    description: 'Look up a Canton Name or Party ID to get wallet details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Canton Name (e.g., "@alice.canton") or Party ID to look up',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_cc_price',
    description: 'Get current CC token price and market data.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'register_canton_name',
    description: 'Register a new Canton Name (.canton) for the wallet. Requires PIN confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The name to register (without .canton suffix, e.g., "alice")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_canton_name',
    description: 'Check if a Canton Name is available for registration.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The name to check (without .canton suffix)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_my_canton_names',
    description: 'List all Canton Names registered to this wallet.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_utxos',
    description: 'Check UTXO count and whether merging is needed.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_wallet_address',
    description: 'Get the wallet Party ID (address) for receiving tokens.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'explain_transaction',
    description: 'Explain what a specific transaction did.',
    input_schema: {
      type: 'object' as const,
      properties: {
        txHash: {
          type: 'string',
          description: 'Transaction hash to explain',
        },
      },
      required: ['txHash'],
    },
  },
  {
    name: 'get_network_info',
    description: 'Get Canton Network status, current round, and network health information.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_open_rounds',
    description: 'Get current open mining rounds with amulet price, reward rates, and issuance config.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_amulet_rules',
    description: 'Get Amulet (CC) rules including transfer fees, holding fees, and network configuration.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'explain_canton',
    description: 'Answer questions about Canton Network ecosystem, including DSO governance, validators, synchronizers, and how the network works.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description: 'Topic to explain: "dso", "validators", "synchronizer", "amulet", "transfers", "fees", "governance", or general question',
        },
      },
      required: ['topic'],
    },
  },
] as const;

// Type-safe tool array that satisfies Anthropic.Tool[]
export const TYPED_AGENT_TOOLS: AnthropicTool[] = AGENT_TOOLS.map(tool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
}));

export type ToolName = typeof AGENT_TOOLS[number]['name'];
