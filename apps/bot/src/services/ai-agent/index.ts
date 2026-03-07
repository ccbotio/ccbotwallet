/**
 * AI Agent Service
 *
 * Claude-powered conversational AI agent for Canton wallet operations.
 * Supports multi-language input and provides secure transaction handling
 * with PIN confirmation flow.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { db, users, wallets, transactions } from '../../db/index.js';
import { getCantonAgent } from '../canton/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import ansService from '../ans/index.js';
import {
  TYPED_AGENT_TOOLS,
  parseSendCCParams,
  parseSwapParams,
  type AgentResponse,
  type ConversationContext,
  type PendingAction,
  type SendCCParams,
  type SwapParams,
} from './types.js';
import { checkRateLimit, getUsageStats as getRateLimitStats } from './rate-limit.js';

// Pending actions storage (in production, use Redis)
const pendingActions = new Map<string, PendingAction>();

// Conversation contexts (in production, use Redis)
const conversationContexts = new Map<string, ConversationContext>();

// Action expiry time (5 minutes)
const ACTION_EXPIRY_MS = 5 * 60 * 1000;

// System prompt for the AI agent
const SYSTEM_PROMPT = `You are CC Bot, an AI assistant for a Canton Network cryptocurrency wallet. You are an expert on the Canton Network ecosystem and help users manage their Canton Coin (CC) tokens.

## Your Capabilities:
1. **Transactions** (require PIN):
   - Send CC tokens to wallets or Canton Names
   - Swap tokens between different assets

2. **Wallet Info**:
   - Check balance (with USD value, locked amount)
   - View transaction history (with filters)
   - Get wallet address (Party ID)
   - Check UTXO count

3. **Canton Names (.canton)**:
   - Register new names (11 CC fee)
   - Check name availability
   - Look up names/addresses
   - List your registered names

4. **Market & Network Data**:
   - Get CC price and market info
   - Get network status and open rounds
   - View Amulet rules (fees, configs)
   - Explain transactions

5. **Canton Ecosystem Knowledge**:
   - Explain DSO (Decentralized Synchronization Organization)
   - Validators and how they work
   - Synchronizers and consensus
   - Governance and network rules
   - Transfer fees and holding fees

## Canton Network Knowledge:

### What is Canton Network?
Canton Network is a privacy-enabled blockchain network designed for institutional finance. It uses a unique architecture with:
- **Synchronizers**: Coordinate transactions across participants
- **Validators**: Operate nodes that validate and process transactions
- **DSO (Decentralized Synchronization Organization)**: Governs the network collectively

### Key Concepts:
- **Party ID**: Your unique wallet address on Canton (starts with "PAR...")
- **Canton Coin (CC)**: Also known as Amulet, the native token
- **Canton Name (.canton)**: Human-readable addresses like @alice.canton
- **UTXOs**: Unspent transaction outputs (your token holdings)
- **Open Rounds**: Mining/issuance periods for CC tokens
- **Transfer Preapproval**: Authorization to receive tokens

### Fees:
- **Transfer Fee**: Small fee for sending tokens (~0.0001 CC)
- **Holding Fee**: Ongoing fee for holding tokens (incentivizes circulation)
- **Name Registration**: 11 CC to register a .canton name

## Rules:
1. ALWAYS respond in English
2. For send/swap/register, use the tool first - user confirms with PIN
3. Be concise and helpful
4. Format amounts clearly (e.g., "10 CC")
5. Include explorer links for transactions
6. When asked about Canton ecosystem, use explain_canton tool

## Examples:
- "Send 10 CC to @alice.canton" → use send_cc tool
- "What's my balance?" → use check_balance tool
- "Is bob.canton available?" → use check_canton_name tool
- "Register myname" → use register_canton_name tool
- "Show my address" → use get_wallet_address tool
- "What is DSO?" → use explain_canton tool with topic "dso"
- "How do validators work?" → use explain_canton tool with topic "validators"
- "Network status" → use get_network_info tool`;

class AIAgentService {
  private client: Anthropic | null = null;

  constructor() {
    if (env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
      });
      logger.info('AI Agent service initialized with Claude API');
    } else {
      logger.warn('AI Agent service running in mock mode (no ANTHROPIC_API_KEY)');
    }
  }

  /**
   * Process a user message and return an agent response.
   */
  async chat(
    telegramId: string,
    message: string
  ): Promise<AgentResponse> {
    // Check chat rate limit
    const rateLimit = await checkRateLimit(telegramId, 'chat');
    if (!rateLimit.allowed) {
      const minutes = Math.ceil(rateLimit.resetIn / 60);
      return {
        message: `Rate limit reached. You can send ${rateLimit.limit} messages per hour. Try again in ${minutes} minutes.`,
      };
    }

    // Get or create conversation context
    let context = conversationContexts.get(telegramId);
    if (!context) {
      context = await this.createContext(telegramId);
      conversationContexts.set(telegramId, context);
    }

    // Add user message to context
    context.messages.push({ role: 'user', content: message });

    // Keep only last 20 messages for context window
    if (context.messages.length > 20) {
      context.messages = context.messages.slice(-20);
    }

    try {
      // If no API key, use mock response
      if (!this.client) {
        return this.getMockResponse(message, context);
      }

      // Call Claude API with tools
      const response = await this.client.messages.create({
        model: env.AI_AGENT_MODEL,
        max_tokens: env.AI_AGENT_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TYPED_AGENT_TOOLS,
        messages: context.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      });

      // Process response
      return await this.processClaudeResponse(response, context);
    } catch (error) {
      logger.error({ err: error, telegramId }, 'AI Agent chat error');
      throw error;
    }
  }

  /**
   * Confirm a pending action with PIN and execute it.
   */
  async confirmAction(
    telegramId: string,
    actionId: string,
    userShareHex: string
  ): Promise<AgentResponse> {
    const action = pendingActions.get(actionId);

    if (!action) {
      return {
        message: 'Action not found or expired. Please try again.',
      };
    }

    if (action.expiresAt < Date.now()) {
      pendingActions.delete(actionId);
      return {
        message: 'Action expired. Please start a new transaction.',
      };
    }

    // Get user context
    const context = conversationContexts.get(telegramId);
    if (!context?.walletId) {
      return {
        message: 'Wallet not found. Please set up your wallet first.',
      };
    }

    try {
      if (action.type === 'send') {
        return await this.executeSend(action.params as SendCCParams, context, userShareHex, actionId);
      } else if (action.type === 'swap') {
        return await this.executeSwap(action.params as SwapParams, context, actionId);
      }

      return { message: 'Unknown action type.' };
    } finally {
      pendingActions.delete(actionId);
    }
  }

  /**
   * Get pending action for a user.
   */
  getPendingAction(telegramId: string): PendingAction | undefined {
    const context = conversationContexts.get(telegramId);
    if (!context?.pendingAction) return undefined;

    const action = pendingActions.get(context.pendingAction.id);
    if (!action || action.expiresAt < Date.now()) {
      if (action) pendingActions.delete(action.id);
      return undefined;
    }

    return action;
  }

  /**
   * Clear conversation context.
   */
  clearContext(telegramId: string): void {
    const context = conversationContexts.get(telegramId);
    if (context?.pendingAction) {
      pendingActions.delete(context.pendingAction.id);
    }
    conversationContexts.delete(telegramId);
  }

  /**
   * Get usage stats for a user (rate limits)
   */
  async getUsageStats(telegramId: string) {
    return getRateLimitStats(telegramId);
  }

  // ==================== PRIVATE METHODS ====================

  private async createContext(telegramId: string): Promise<ConversationContext> {
    const context: ConversationContext = {
      telegramId,
      messages: [],
    };

    // Fetch user wallet info
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (user) {
      const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
      if (wallet) {
        context.walletId = wallet.id;
        context.partyId = wallet.partyId;
      }
    }

    return context;
  }

  private async processClaudeResponse(
    response: Anthropic.Message,
    context: ConversationContext
  ): Promise<AgentResponse> {
    let textContent = '';
    let pendingAction: PendingAction | undefined;
    let txResult: AgentResponse['txResult'];
    let balance: AgentResponse['balance'];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        // Execute tool
        const toolResult = await this.executeTool(block.name, block.input as Record<string, unknown>, context);

        if (toolResult.pendingAction) {
          pendingAction = toolResult.pendingAction;
          context.pendingAction = pendingAction;
        }
        if (toolResult.txResult) {
          txResult = toolResult.txResult;
        }
        if (toolResult.balance) {
          balance = toolResult.balance;
        }
        if (toolResult.message) {
          textContent += toolResult.message;
        }
      }
    }

    // Add assistant response to context
    if (textContent) {
      context.messages.push({ role: 'assistant', content: textContent });
    }

    return {
      message: textContent,
      pendingAction,
      txResult,
      balance,
    };
  }

  private async executeTool(
    toolName: string,
    params: Record<string, unknown>,
    context: ConversationContext
  ): Promise<Partial<AgentResponse>> {
    logger.info({ toolName, params, telegramId: context.telegramId }, 'Executing AI agent tool');

    switch (toolName) {
      case 'send_cc':
        return this.handleSendCC(parseSendCCParams(params), context);

      case 'swap_tokens':
        return this.handleSwap(parseSwapParams(params), context);

      case 'check_balance':
        return this.handleCheckBalance(context, params.detailed as boolean);

      case 'get_transaction_history': {
        const historyOptions: {
          limit?: number;
          recipient?: string;
          type?: string;
          days?: number;
        } = { limit: (params.limit as number) || 10 };
        if (params.recipient) historyOptions.recipient = params.recipient as string;
        if (params.type) historyOptions.type = params.type as string;
        if (params.days) historyOptions.days = params.days as number;
        return this.handleGetHistory(context, historyOptions);
      }

      case 'get_transaction_summary':
        return this.handleTransactionSummary(context, params.address as string);

      case 'lookup_address':
        return this.handleLookup(params.query as string);

      case 'get_cc_price':
        return this.handleGetPrice();

      case 'register_canton_name':
        return this.handleRegisterName(params.name as string, context);

      case 'check_canton_name':
        return this.handleCheckName(params.name as string);

      case 'get_my_canton_names':
        return this.handleGetMyNames(context);

      case 'check_utxos':
        return this.handleCheckUtxos(context);

      case 'get_wallet_address':
        return this.handleGetAddress(context);

      case 'explain_transaction':
        return this.handleExplainTx(params.txHash as string, context);

      case 'get_network_info':
        return this.handleGetNetworkInfo();

      case 'get_open_rounds':
        return this.handleGetOpenRounds();

      case 'get_amulet_rules':
        return this.handleGetAmuletRules();

      case 'explain_canton':
        return this.handleExplainCanton(params.topic as string);

      default:
        return { message: `Unknown tool: ${toolName}` };
    }
  }

  private async handleSendCC(
    params: SendCCParams,
    context: ConversationContext
  ): Promise<Partial<AgentResponse>> {
    if (!context.walletId) {
      return { message: 'Wallet not found. Please set up your wallet first.' };
    }

    // Check transaction rate limit (5/day)
    const rateLimit = await checkRateLimit(context.telegramId, 'transaction');
    if (!rateLimit.allowed) {
      const hours = Math.ceil(rateLimit.resetIn / 3600);
      return {
        message: `Daily transaction limit reached (${rateLimit.limit}/day). Try again in ${hours} hours.`,
      };
    }

    // Resolve Canton Name to Party ID if needed
    let recipientPartyId = params.recipient;
    let recipientDisplay = params.recipient;

    if (params.recipient.startsWith('@') || params.recipient.includes('.canton')) {
      const name = params.recipient.replace('@', '').replace('.canton', '');
      const lookup = await ansService.lookupName(name);
      if (lookup.found && lookup.partyId) {
        recipientPartyId = lookup.partyId;
        recipientDisplay = `@${name}.canton`;
      } else {
        return { message: `Could not find Canton Name: ${params.recipient}` };
      }
    }

    // Create pending action
    const sendParams: SendCCParams = {
      amount: params.amount,
      recipient: recipientPartyId,
    };
    if (params.memo) {
      sendParams.memo = params.memo;
    }

    const action: PendingAction = {
      id: randomUUID(),
      type: 'send',
      params: sendParams,
      createdAt: Date.now(),
      expiresAt: Date.now() + ACTION_EXPIRY_MS,
    };

    pendingActions.set(action.id, action);

    return {
      message: `Ready to send **${params.amount} CC** to **${recipientDisplay}**${params.memo ? ` with memo: "${params.memo}"` : ''}.\n\nPlease confirm with your PIN.`,
      pendingAction: action,
    };
  }

  private async handleSwap(
    params: SwapParams,
    context: ConversationContext
  ): Promise<Partial<AgentResponse>> {
    if (!context.walletId) {
      return { message: 'Wallet not found. Please set up your wallet first.' };
    }

    // Check transaction rate limit (5/day)
    const rateLimit = await checkRateLimit(context.telegramId, 'transaction');
    if (!rateLimit.allowed) {
      const hours = Math.ceil(rateLimit.resetIn / 3600);
      return {
        message: `Daily transaction limit reached (${rateLimit.limit}/day). Try again in ${hours} hours.`,
      };
    }

    // Create pending action
    const action: PendingAction = {
      id: randomUUID(),
      type: 'swap',
      params,
      createdAt: Date.now(),
      expiresAt: Date.now() + ACTION_EXPIRY_MS,
    };

    pendingActions.set(action.id, action);

    return {
      message: `Ready to swap **${params.amount} ${params.fromToken}** to **${params.toToken}**.\n\nPlease confirm with your PIN.`,
      pendingAction: action,
    };
  }

  private async handleCheckBalance(
    context: ConversationContext,
    detailed?: boolean
  ): Promise<Partial<AgentResponse>> {
    if (!context.partyId || !context.walletId) {
      return { message: 'Wallet not found. Please set up your wallet first.' };
    }

    try {
      const agent = getCantonAgent();

      // Fetch balance and live price in parallel
      const [balance, price] = await Promise.all([
        agent.getBalance(context.partyId),
        agent.getCCPrice(),
      ]);

      // Calculate USD value
      const ccAmount = parseFloat(balance.amount);
      const usdValue = ccAmount * price.amuletPriceUsd;
      const formattedUsd = usdValue.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      if (!detailed) {
        return {
          message: `**Your Balance**\n\n**${balance.amount} CC** (~${formattedUsd})${balance.locked !== '0' ? `\nLocked: ${balance.locked} CC` : ''}`,
          balance: {
            token: 'CC',
            amount: balance.amount,
            usdValue: formattedUsd,
          },
        };
      }

      // Detailed balance with recent activity
      const recentTxs = await db
        .select()
        .from(transactions)
        .where(eq(transactions.walletId, context.walletId))
        .orderBy(desc(transactions.createdAt))
        .limit(5);

      const sent = recentTxs.filter(tx => tx.type === 'send').reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
      const received = recentTxs.filter(tx => tx.type === 'receive').reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

      // Calculate locked USD
      const lockedAmount = parseFloat(balance.locked);
      const lockedUsd = (lockedAmount * price.amuletPriceUsd).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      });

      let message = `**Wallet Balance - Detailed**\n\n`;
      message += `**Available:** ${balance.amount} CC (~${formattedUsd})\n`;
      if (balance.locked !== '0') {
        message += `**Locked:** ${balance.locked} CC (~${lockedUsd})\n`;
      }
      message += `\n**Live Price:** $${price.amuletPriceUsd.toFixed(4)} USD\n`;
      message += `**Round:** #${price.round.toLocaleString()}\n`;
      message += `\n**Recent Activity (last 5 txs)**\n`;
      message += `Sent: ${sent.toFixed(2)} CC\n`;
      message += `Received: ${received.toFixed(2)} CC\n`;
      message += `Net: ${(received - sent) >= 0 ? '+' : ''}${(received - sent).toFixed(2)} CC`;

      return {
        message,
        balance: {
          token: 'CC',
          amount: balance.amount,
          usdValue: formattedUsd,
        },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch balance');
      return { message: 'Could not fetch balance from Canton Network. Please try again.' };
    }
  }

  private async handleGetHistory(
    context: ConversationContext,
    options: {
      limit?: number;
      recipient?: string;
      type?: string;
      days?: number;
    }
  ): Promise<Partial<AgentResponse>> {
    if (!context.walletId) {
      return { message: 'Wallet not found. Please set up your wallet first.' };
    }

    const { limit = 10, recipient, type, days } = options;

    // Build query
    let query = db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, context.walletId))
      .orderBy(desc(transactions.createdAt))
      .limit(Math.min(limit, 50));

    let txs = await query;

    // Apply filters in memory (for simplicity)
    if (recipient) {
      const recipientLower = recipient.toLowerCase().replace('@', '').replace('.canton', '');
      txs = txs.filter(tx => {
        const toParty = tx.toParty?.toLowerCase() || '';
        const fromParty = tx.fromParty?.toLowerCase() || '';
        return toParty.includes(recipientLower) || fromParty.includes(recipientLower);
      });
    }

    if (type && type !== 'all') {
      txs = txs.filter(tx => tx.type === type);
    }

    if (days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      txs = txs.filter(tx => tx.createdAt >= cutoff);
    }

    if (txs.length === 0) {
      let msg = 'No transactions found';
      if (recipient) msg += ` with ${recipient}`;
      if (days) msg += ` in the last ${days} days`;
      return { message: msg + '.' };
    }

    const txList = txs.map((tx, i) => {
      const direction = tx.type === 'send' ? 'Sent' : 'Received';
      const status = tx.status === 'confirmed' ? 'Confirmed' : tx.status === 'pending' ? 'Pending' : 'Failed';
      const counterparty = tx.type === 'send'
        ? (tx.toParty?.slice(0, 12) + '...')
        : (tx.fromParty?.slice(0, 12) + '...');
      const date = tx.createdAt.toLocaleDateString();
      return `${i + 1}. ${direction} **${tx.amount} ${tx.token}** ${status}\n   To/From: \`${counterparty}\` • ${date}`;
    }).join('\n\n');

    let header = '**Transaction History**';
    if (recipient) header += ` with ${recipient}`;
    if (days) header += ` (last ${days} days)`;

    return {
      message: `${header}\n\n${txList}`,
    };
  }

  private async handleTransactionSummary(
    context: ConversationContext,
    address: string
  ): Promise<Partial<AgentResponse>> {
    if (!context.walletId) {
      return { message: 'Wallet not found. Please set up your wallet first.' };
    }

    // Resolve Canton Name if needed
    let partyId = address;
    let displayName = address;

    if (address.startsWith('@') || address.includes('.canton')) {
      const name = address.replace('@', '').replace('.canton', '');
      const lookup = await ansService.lookupName(name);
      if (lookup.found && lookup.partyId) {
        partyId = lookup.partyId;
        displayName = `@${name}.canton`;
      }
    }

    // Get all transactions with this address
    const allTxs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, context.walletId))
      .orderBy(desc(transactions.createdAt));

    const addressLower = partyId.toLowerCase();
    const relatedTxs = allTxs.filter(tx => {
      const toParty = tx.toParty?.toLowerCase() || '';
      const fromParty = tx.fromParty?.toLowerCase() || '';
      return toParty.includes(addressLower) || fromParty.includes(addressLower);
    });

    if (relatedTxs.length === 0) {
      return { message: `No transactions found with ${displayName}.` };
    }

    // Calculate totals
    let totalSent = 0;
    let totalReceived = 0;
    let sendCount = 0;
    let receiveCount = 0;

    for (const tx of relatedTxs) {
      const amount = parseFloat(tx.amount);
      if (tx.type === 'send') {
        totalSent += amount;
        sendCount++;
      } else {
        totalReceived += amount;
        receiveCount++;
      }
    }

    const firstTx = relatedTxs[relatedTxs.length - 1];
    const lastTx = relatedTxs[0];

    let message = `**Transaction Summary with ${displayName}**\n\n`;
    message += `Total Sent: **${totalSent.toFixed(2)} CC** (${sendCount} txs)\n`;
    message += `Total Received: **${totalReceived.toFixed(2)} CC** (${receiveCount} txs)\n`;
    message += `Net: **${(totalReceived - totalSent).toFixed(2)} CC**\n\n`;
    message += `First Transaction: ${firstTx?.createdAt.toLocaleDateString()}\n`;
    message += `Last Transaction: ${lastTx?.createdAt.toLocaleDateString()}`;

    return { message };
  }

  private async handleLookup(query: string): Promise<Partial<AgentResponse>> {
    const name = query.replace('@', '').replace('.canton', '');

    try {
      const lookup = await ansService.lookupName(name);
      if (lookup.found) {
        return {
          message: `**@${name}.canton**\n\nParty ID: \`${lookup.partyId?.slice(0, 20)}...\``,
        };
      } else {
        return { message: `Canton Name @${name}.canton not found.` };
      }
    } catch {
      return { message: 'Could not perform lookup. Please try again.' };
    }
  }

  private async handleGetPrice(): Promise<Partial<AgentResponse>> {
    try {
      const agent = getCantonAgent();
      const price = await agent.getCCPrice();

      // Format price with proper decimals
      const formattedPrice = price.amuletPriceUsd.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      });

      // Calculate holding fee per day (approx 720 rounds/day)
      const dailyHoldingFee = (price.rewardRate * 720 * 100).toFixed(4);

      return {
        message: `**Canton Coin (CC) - Live Price**

**Price:** ${formattedPrice}
**Round:** #${price.round.toLocaleString()}
**Holding Fee:** ${(price.rewardRate * 100).toFixed(6)}% per round (~${dailyHoldingFee}%/day)

_Data fetched live from Canton Network_
_Last updated: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}_`,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch CC price');
      return { message: 'Could not fetch price from Canton Network. Please try again.' };
    }
  }

  private async handleRegisterName(
    name: string,
    context: ConversationContext
  ): Promise<Partial<AgentResponse>> {
    if (!context.walletId) {
      return { message: 'Wallet not found. Please set up your wallet first.' };
    }

    // Check transaction rate limit (5/day)
    const rateLimit = await checkRateLimit(context.telegramId, 'transaction');
    if (!rateLimit.allowed) {
      const hours = Math.ceil(rateLimit.resetIn / 3600);
      return {
        message: `Daily transaction limit reached (${rateLimit.limit}/day). Try again in ${hours} hours.`,
      };
    }

    // Check availability first
    const availability = await ansService.checkNameAvailability(name);
    if (!availability.available) {
      return { message: `@${name}.canton is not available. ${availability.error || 'Try another name.'}` };
    }

    // Create pending action for registration
    const action: PendingAction = {
      id: randomUUID(),
      type: 'send', // Reuse send type for now
      params: {
        amount: '11', // Registration fee
        recipient: `register:${name}`,
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + ACTION_EXPIRY_MS,
    };

    pendingActions.set(action.id, action);

    return {
      message: `**@${name}.canton** is available!\n\n**Registration Fee:** 11 CC\n**Network Fee:** ~0.001 CC\n\nPlease confirm with your PIN to register.`,
      pendingAction: action,
    };
  }

  private async handleCheckName(name: string): Promise<Partial<AgentResponse>> {
    try {
      const validation = ansService.validateName(name);
      if (!validation.valid) {
        return { message: `Invalid name: ${validation.error}` };
      }

      const availability = await ansService.checkNameAvailability(name);
      if (availability.available) {
        return { message: `**@${name}.canton** is available! Say "register ${name}" to claim it.` };
      } else {
        return { message: `**@${name}.canton** is already taken.` };
      }
    } catch {
      return { message: 'Could not check name availability. Please try again.' };
    }
  }

  private async handleGetMyNames(context: ConversationContext): Promise<Partial<AgentResponse>> {
    if (!context.partyId) {
      return { message: 'Wallet not found.' };
    }

    try {
      const result = await ansService.listUserEntries(context.partyId);
      if (!result.success || !result.entries?.length) {
        return { message: 'You have no registered Canton Names.' };
      }

      const nameList = result.entries.map(e => `• @${ansService.getBaseName(e.name)}.canton`).join('\n');
      return {
        message: `**Your Canton Names:**\n\n${nameList}`,
      };
    } catch {
      return { message: 'Could not fetch your names. Please try again.' };
    }
  }

  private async handleCheckUtxos(context: ConversationContext): Promise<Partial<AgentResponse>> {
    if (!context.partyId) {
      return { message: 'Wallet not found.' };
    }

    try {
      const { WalletService } = await import('../wallet/index.js');
      const agent = getCantonAgent();
      const walletService = new WalletService(agent.getSDK());
      const count = await walletService.getUtxoCount(context.partyId);

      if (count > 10) {
        return {
          message: `**UTXO Count:** ${count}\n\nYou have many UTXOs. Consider merging them to reduce transaction fees.`,
        };
      }
      return {
        message: `**UTXO Count:** ${count}\n\nYour wallet is optimized.`,
      };
    } catch {
      return { message: 'Could not check UTXOs. Please try again.' };
    }
  }

  private async handleGetAddress(context: ConversationContext): Promise<Partial<AgentResponse>> {
    if (!context.partyId) {
      return { message: 'Wallet not found.' };
    }

    return {
      message: `**Your Wallet Address:**\n\n\`${context.partyId}\`\n\nShare this Party ID to receive CC tokens.`,
    };
  }

  private async handleExplainTx(
    txHash: string,
    context: ConversationContext
  ): Promise<Partial<AgentResponse>> {
    if (!context.walletId) {
      return { message: 'Wallet not found.' };
    }

    try {
      // Find transaction in DB
      const [tx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.txHash, txHash))
        .limit(1);

      if (!tx) {
        return { message: `Transaction ${txHash.slice(0, 15)}... not found in your history.` };
      }

      const direction = tx.type === 'send' ? 'Sent' : 'Received';
      const status = tx.status === 'confirmed' ? 'Confirmed' : tx.status === 'pending' ? 'Pending' : 'Failed';

      return {
        message: `**Transaction Details:**\n\n**Type:** ${direction}\n**Amount:** ${tx.amount} ${tx.token}\n**Status:** ${status}\n**Date:** ${tx.createdAt.toLocaleDateString()}\n\n[View on Explorer](https://scan.canton.network/tx/${txHash})`,
      };
    } catch {
      return { message: 'Could not fetch transaction details. Please try again.' };
    }
  }

  private async handleGetNetworkInfo(): Promise<Partial<AgentResponse>> {
    try {
      const agent = getCantonAgent();
      const [health, price] = await Promise.all([
        agent.getHealthStatus(),
        agent.getCCPrice(),
      ]);

      const network = env.CANTON_NETWORK.charAt(0).toUpperCase() + env.CANTON_NETWORK.slice(1);

      // Format price
      const formattedPrice = price.amuletPriceUsd.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 4,
      });

      return {
        message: `**Canton Network - Live Status**

**Network Status:** ${health.isHealthy ? 'Operational' : 'Degraded'}
**Environment:** ${network}
**Current Round:** #${price.round.toLocaleString()}
**CC Price:** ${formattedPrice}
**Holding Fee Rate:** ${(price.rewardRate * 100).toFixed(4)}%/round
**API Latency:** ${health.latencyMs ? `${health.latencyMs}ms` : 'N/A'}

**Infrastructure:**
- Ledger API: ${health.ledgerConnected ? 'Connected' : 'Disconnected'}
- Validator: ${health.validatorAccessible ? 'Accessible' : 'Unavailable'}
- Last Check: ${health.lastCheckAt ? new Date(health.lastCheckAt).toLocaleTimeString('en-US') : 'N/A'}

_Live data from Canton scan-proxy API_`,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get network info');
      return { message: 'Could not fetch network status from Canton API. Please try again.' };
    }
  }

  private async handleGetOpenRounds(): Promise<Partial<AgentResponse>> {
    try {
      const agent = getCantonAgent();
      const price = await agent.getCCPrice();

      // Format price
      const formattedPrice = price.amuletPriceUsd.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 4,
      });

      // Estimate rounds per day (~720 based on 2-minute rounds)
      const roundsPerDay = 720;
      const dailyHoldingFee = (price.rewardRate * roundsPerDay * 100).toFixed(4);

      return {
        message: `**Open Mining Rounds - Live Data**

**Current Round:** #${price.round.toLocaleString()}
**Amulet Price:** ${formattedPrice}
**Holding Fee:** ${(price.rewardRate * 100).toFixed(6)}%/round
**Daily Fee Rate:** ~${dailyHoldingFee}%

**About Mining Rounds:**
- Rounds are ~2 minute periods
- ~720 rounds per day
- Price is set by DSO governance
- Holding fees are applied per round

_Fetched from: /api/validator/v0/scan-proxy/open-and-issuing-mining-rounds_`,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get open rounds');
      return { message: 'Could not fetch open rounds from Canton API. Please try again.' };
    }
  }

  private async handleGetAmuletRules(): Promise<Partial<AgentResponse>> {
    try {
      const agent = getCantonAgent();
      const price = await agent.getCCPrice();

      // Format price
      const formattedPrice = price.amuletPriceUsd.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 4,
      });

      // Calculate fees
      const holdingFeePerRound = (price.rewardRate * 100).toFixed(6);
      const dailyHoldingFee = (price.rewardRate * 720 * 100).toFixed(4);
      const yearlyHoldingFee = (price.rewardRate * 720 * 365 * 100).toFixed(2);

      return {
        message: `**Amulet (CC) Rules - Live Config**

**Current Market Data:**
**Price:** ${formattedPrice}
**Round:** #${price.round.toLocaleString()}

**Holding Fee (Demurrage):**
- Per Round: ${holdingFeePerRound}%
- Daily: ~${dailyHoldingFee}%
- Yearly: ~${yearlyHoldingFee}%

**Transaction Fees:**
- Transfer: ~0.0001 CC base fee
- Name Registration: 11 CC
- UTXO Merge: ~0.0001 CC

**Network Rules:**
- Transfers require recipient preapproval
- Merge UTXOs when count > 10
- Fees are burned (deflationary)

_Config fetched from Canton Network amulet-rules_`,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get amulet rules');
      return { message: 'Could not fetch amulet rules from Canton API. Please try again.' };
    }
  }

  private handleExplainCanton(topic: string): Partial<AgentResponse> {
    const lowerTopic = topic.toLowerCase();

    const explanations: Record<string, string> = {
      dso: `**DSO (Decentralized Synchronization Organization)**

The DSO is the governance body of Canton Network. It's a collective of validators who together manage the network.

**Key Functions:**
• Sets network parameters (fees, prices, rewards)
• Manages validator membership
• Coordinates synchronizer operations
• Governs protocol upgrades

**Governance:**
• Decisions made collectively by validators
• Changes require consensus
• Transparent and decentralized

The DSO ensures Canton Network operates fairly and securely without a single point of control.`,

      validators: `**Canton Validators**

Validators are node operators who secure and process transactions on Canton Network.

**What Validators Do:**
• Run synchronizer nodes
• Validate transactions
• Earn rewards for participation
• Vote on governance proposals

**Validator Requirements:**
• Operate reliable infrastructure
• Stake collateral (if required)
• Follow network rules
• Maintain uptime

**Rewards:**
• Validators earn a percentage of transaction fees
• Additional rewards from network issuance

Validators are the backbone of Canton's decentralized architecture.`,

      synchronizer: `**Canton Synchronizers**

Synchronizers are the coordination layer of Canton Network.

**What Synchronizers Do:**
• Order and sequence transactions
• Ensure consistency across participants
• Enable privacy through selective disclosure
• Coordinate multi-party transactions

**Key Features:**
• **Privacy:** Only relevant parties see transaction details
• **Atomicity:** Transactions succeed or fail completely
• **Finality:** Once confirmed, transactions are permanent

**Architecture:**
• Multiple synchronizers can exist
• Participants choose which synchronizers to use
• DSO manages the primary synchronizer

This design enables both privacy and interoperability across institutions.`,

      amulet: `**Amulet (Canton Coin / CC)**

Amulet is the native token of Canton Network, also known as CC (Canton Coin).

**Token Properties:**
• Used for transaction fees
• Required for Canton Name registration
• Has a holding fee (incentivizes circulation)
• Price set by DSO governance

**Holding Fee:**
• Small fee applied per round
• Encourages token usage over hoarding
• Fee rate set by DSO

**Transfer Mechanics:**
• Requires Transfer Preapproval from recipient
• Small transfer fee (~0.0001 CC)
• Atomic transfers (instant settlement)

Check current price with "What's the CC price?"`,

      transfers: `**Canton Transfers**

Transfers on Canton Network are atomic and privacy-preserving.

**Transfer Flow:**
1. **Preapproval:** Recipient creates Transfer Preapproval
2. **Prepare:** Sender prepares transfer transaction
3. **Sign:** Transaction signed with Ed25519 key
4. **Execute:** Submitted to synchronizer
5. **Confirm:** Instant finality once accepted

**Transfer Types:**
• Direct transfers (Party ID)
• Canton Name transfers (@name.canton)
• Multi-party atomic transfers

**Fees:**
• Small transfer fee (~0.0001 CC)
• Included in transaction amount

**Privacy:**
• Only sender/receiver see details
• Amounts hidden from network`,

      fees: `**Canton Network Fees**

**Transfer Fee:**
• ~0.0001 CC per transfer
• Varies slightly by amount and complexity
• Paid by sender

**Holding Fee:**
• Applied per round to all holdings
• Rate: ~0.01-0.05% per round
• Incentivizes circulation

**Canton Name Registration:**
• 11 CC per name registration
• One-time fee
• No renewal required

**UTXO Merge:**
• Small fee to consolidate holdings
• Recommended when UTXO count > 10

**Fee Destination:**
• Fees are burned (destroyed)
• Reduces total supply over time
• Deflationary mechanism`,

      governance: `**Canton Network Governance**

Canton Network is governed by the DSO (Decentralized Synchronization Organization).

**Governance Structure:**
• DSO members are validators
• Decisions made collectively
• Transparent voting process

**What Can Be Changed:**
• Fee parameters
• Amulet/CC price
• Reward rates
• Validator membership
• Protocol upgrades

**Proposal Process:**
1. Validator submits proposal
2. Discussion period
3. Voting by validators
4. Implementation if approved

**Key Principles:**
• No single party controls network
• Changes require consensus
• Transparent decision-making
• Community-driven evolution`,
    };

    // Find matching explanation
    for (const [key, explanation] of Object.entries(explanations)) {
      if (lowerTopic.includes(key)) {
        return { message: explanation };
      }
    }

    // Default explanation for general questions
    return {
      message: `**Canton Network Overview**

Canton is a privacy-enabled blockchain for institutional finance.

**Core Components:**
• **Synchronizers:** Coordinate transactions
• **Validators:** Secure the network
• **DSO:** Decentralized governance

**Key Features:**
• Privacy-preserving transactions
• Instant finality
• Sub-ledger privacy
• Smart contract support (Daml)

**Native Token:**
• Canton Coin (CC) / Amulet
• Used for fees and staking

Ask me about specific topics:
• "What is DSO?"
• "How do validators work?"
• "Explain synchronizers"
• "What are the fees?"
• "How does governance work?"`,
    };
  }

  private async executeSend(
    params: SendCCParams,
    context: ConversationContext,
    userShareHex: string,
    actionId: string
  ): Promise<AgentResponse> {
    try {
      const { TransferService } = await import('../transfer/index.js');
      const { WalletService } = await import('../wallet/index.js');
      const agent = getCantonAgent();
      const walletService = new WalletService(agent.getSDK());
      const transferService = new TransferService(agent.getSDK(), walletService);

      const result = await transferService.sendCC(
        context.walletId!,
        params.recipient,
        params.amount,
        userShareHex,
        params.memo
      );

      const explorerUrl = `https://scan.canton.network/tx/${result.txHash}`;

      return {
        message: `Transaction successful!\n\n**Amount:** ${params.amount} CC\n**To:** ${params.recipient.slice(0, 20)}...\n**Status:** ${result.status}\n\n[View on Explorer](${explorerUrl})`,
        txResult: {
          txHash: result.txHash,
          explorerUrl,
          amount: params.amount,
          recipient: params.recipient,
          status: result.status,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      logger.error({ err: error, actionId }, 'AI Agent send execution failed');
      return {
        message: `Transaction failed: ${message}`,
      };
    }
  }

  private async executeSwap(
    params: SwapParams,
    _context: ConversationContext,
    _actionId: string
  ): Promise<AgentResponse> {
    // Swap is not yet implemented - return message
    return {
      message: `Swap feature coming soon! You requested to swap ${params.amount} ${params.fromToken} to ${params.toToken}.`,
    };
  }

  private getMockResponse(message: string, context: ConversationContext): AgentResponse {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('send')) {
      // Parse amount and recipient
      const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:cc|CC)/i);
      const recipientMatch = message.match(/@[\w.-]+|PAR[A-Za-z0-9]+/);

      if (amountMatch?.[1] && recipientMatch?.[0]) {
        const amount = amountMatch[1];
        const recipient = recipientMatch[0];
        const action: PendingAction = {
          id: randomUUID(),
          type: 'send',
          params: {
            amount,
            recipient,
          },
          createdAt: Date.now(),
          expiresAt: Date.now() + ACTION_EXPIRY_MS,
        };
        pendingActions.set(action.id, action);
        context.pendingAction = action;

        return {
          message: `Ready to send **${amount} CC** to **${recipient}**\n\nPlease confirm with your PIN.`,
          pendingAction: action,
        };
      }

      return {
        message: 'To send CC, tell me the amount and recipient. Example: "Send 10 CC to @alice.canton"',
      };
    }

    if (lowerMessage.includes('balance')) {
      return {
        message: 'Your balance: **100.00 CC**',
        balance: { token: 'CC', amount: '100.00' },
      };
    }

    if (lowerMessage.includes('swap')) {
      return {
        message: 'Swap feature coming soon!',
      };
    }

    if (lowerMessage.includes('history') || lowerMessage.includes('transaction')) {
      return {
        message: '**Recent Transactions:**\n\n1. Sent 10 CC - Confirmed\n2. Received 25 CC - Confirmed\n3. Sent 5 CC - Confirmed',
      };
    }

    // Default greeting
    return {
      message: "Hello! I'm CC Bot. I can help you:\n\n• Send CC tokens\n• Check balance\n• View transactions\n• Look up Canton Names\n\nWhat would you like to do?",
    };
  }
}

// Singleton instance
export const aiAgentService = new AIAgentService();
