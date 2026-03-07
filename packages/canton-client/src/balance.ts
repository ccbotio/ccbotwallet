import type { CantonConfig, HoldingUtxo, TokenBalance } from './types/index.js';
import { AuthTokenProvider } from './auth.js';
import { fetchWithRetry } from './utils/fetch-with-retry.js';
import { CANTON_TIMEOUTS, RETRY_CONFIG } from '@repo/shared/constants';

/**
 * Balance and UTXO management for Canton Network.
 */
export class BalanceManager {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth: AuthTokenProvider) {
    this.config = config;
    this.auth = auth;
  }

  /**
   * Get balance for an external party using the external-party balance API.
   * This is the preferred method for parties created via topology endpoints.
   */
  async getExternalPartyBalance(partyId: string): Promise<TokenBalance> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    try {
      // Safe to retry balance queries
      const response = await fetchWithRetry(
        `${validatorUrl}/api/validator/v0/admin/external-party/balance?party_id=${encodeURIComponent(partyId)}`,
        {
          headers,
          timeout: CANTON_TIMEOUTS.balance,
          retries: 2,
          backoffBase: RETRY_CONFIG.backoffBase,
          backoffMax: RETRY_CONFIG.backoffMax,
          retryOnStatus: RETRY_CONFIG.retryableStatus,
        }
      );

      if (!response.ok) {
        // Fall back to UTXO-based balance
        return this.getBalance(partyId, 'CC');
      }

      const data = (await response.json()) as {
        total_unlocked_coin?: string;
        total_locked_coin?: string;
        total_unlocked_cc?: string;
        total_locked_cc?: string;
        round?: number;
      };

      return {
        token: 'CC',
        amount: data.total_unlocked_coin || data.total_unlocked_cc || '0',
        locked: data.total_locked_coin || data.total_locked_cc || '0',
      };
    } catch {
      // Fall back to UTXO-based balance
      return this.getBalance(partyId, 'CC');
    }
  }

  /**
   * Get balance for a specific token by summing holding UTXOs.
   */
  async getBalance(partyId: string, token: string): Promise<TokenBalance> {
    const utxos = await this.listHoldingUtxos(partyId);
    const tokenUtxos = utxos.filter((u) => this.getTokenFromUtxo(u) === token);

    const total = tokenUtxos.reduce((sum, u) => {
      return sum + parseFloat(u.amount);
    }, 0);

    return {
      token,
      amount: total.toString(),
      locked: '0',
    };
  }

  /**
   * Get balances for all tokens held by a party.
   */
  async getAllBalances(partyId: string): Promise<TokenBalance[]> {
    const utxos = await this.listHoldingUtxos(partyId);

    const balancesByToken = new Map<string, number>();
    for (const utxo of utxos) {
      const token = this.getTokenFromUtxo(utxo);
      const current = balancesByToken.get(token) ?? 0;
      balancesByToken.set(token, current + parseFloat(utxo.amount));
    }

    return Array.from(balancesByToken.entries()).map(([token, amount]) => ({
      token,
      amount: amount.toString(),
      locked: '0',
    }));
  }

  /**
   * List all holding UTXOs for a party.
   * Queries the Canton JSON API for active holding contracts.
   */
  async listHoldingUtxos(partyId: string): Promise<HoldingUtxo[]> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) {
      return [];
    }

    const headers = await this.auth.getHeaders();

    try {
      // Safe to retry UTXO queries
      const response = await fetchWithRetry(`${jsonApiUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            party: partyId,
            template_filter: {
              filters_by_module_name: {
                'Splice.Amulet': {
                  include_interfaces: true,
                },
              },
            },
          },
        }),
        timeout: CANTON_TIMEOUTS.balance,
        retries: 2,
        backoffBase: RETRY_CONFIG.backoffBase,
        backoffMax: RETRY_CONFIG.backoffMax,
        retryOnStatus: RETRY_CONFIG.retryableStatus,
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        active_contracts: Array<{
          contract_id: string;
          payload: {
            amount: { amount: string };
            owner: string;
            provider?: string;
          };
        }>;
      };

      return (data.active_contracts ?? []).map((c) => ({
        contractId: c.contract_id,
        amount: c.payload.amount?.amount ?? '0',
        owner: c.payload.owner ?? partyId,
        provider: c.payload.provider ?? '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Merge multiple small UTXOs into fewer larger ones.
   * Useful when UTXO count exceeds threshold (e.g., > 10).
   */
  async mergeHoldingUtxos(
    partyId: string,
    maxUtxos: number = 10
  ): Promise<{ merged: boolean; newUtxoCount: number }> {
    const utxos = await this.listHoldingUtxos(partyId);

    if (utxos.length <= maxUtxos) {
      return { merged: false, newUtxoCount: utxos.length };
    }

    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) {
      return { merged: false, newUtxoCount: utxos.length };
    }

    const headers = await this.auth.getHeaders();

    try {
      // Merge is partially idempotent - retry with caution (1 retry)
      const response = await fetchWithRetry(`${jsonApiUrl}/api/validator/v0/wallet/merge-utxos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          contract_ids: utxos.map((u) => u.contractId),
        }),
        timeout: CANTON_TIMEOUTS.preapproval,
        retries: 1, // Limited retry for merge
        backoffBase: RETRY_CONFIG.backoffBase,
        backoffMax: RETRY_CONFIG.backoffMax,
        retryOnStatus: RETRY_CONFIG.retryableStatus,
      });

      if (!response.ok) {
        return { merged: false, newUtxoCount: utxos.length };
      }

      const updatedUtxos = await this.listHoldingUtxos(partyId);
      return { merged: true, newUtxoCount: updatedUtxos.length };
    } catch {
      return { merged: false, newUtxoCount: utxos.length };
    }
  }

  private getTokenFromUtxo(_utxo: HoldingUtxo): string {
    // Canton Coin (CC) is the default token on the Canton Network
    return 'CC';
  }
}
