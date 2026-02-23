import type { LedgerApi } from '../ledger-api/index.js';
import type { TokenBalance, TransferRequest, TransferResult } from '../types/index.js';

export class TokenStandard {
  private ledgerApi: LedgerApi;

  constructor(ledgerApi: LedgerApi) {
    this.ledgerApi = ledgerApi;
  }

  async getBalance(partyId: string, token: string): Promise<TokenBalance> {
    const contracts = await this.ledgerApi.queryContracts('Splice.Amulet:Amulet', {
      party: partyId,
    });

    const total = contracts.reduce((sum, c) => {
      const amount = (c.payload as { amount?: { amount?: string } }).amount?.amount;
      return sum + parseFloat(amount ?? '0');
    }, 0);

    return {
      token,
      amount: total.toString(),
      locked: '0',
    };
  }

  async getAllBalances(partyId: string): Promise<TokenBalance[]> {
    const balance = await this.getBalance(partyId, 'CC');

    if (parseFloat(balance.amount) === 0) {
      return [];
    }

    return [balance];
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    // Basic transfer through ledger API exercise choice
    const events = await this.ledgerApi.exerciseChoice(
      '', // Will be resolved by the ledger
      'Splice.Amulet:Transfer',
      {
        sender: request.fromParty,
        receiver: request.toParty,
        amount: request.amount,
      }
    );

    const txHash = events.length > 0
      ? events[0]!.contractId
      : `tx-${Date.now()}`;

    return {
      txHash,
      status: 'pending',
    };
  }
}
