import type { CantonConfig, Contract, LedgerEvent, Party } from '../types/index.js';
import { AuthTokenProvider } from '../auth.js';
import { fetchWithRetry, fetchWithTimeout } from '../utils/fetch-with-retry.js';
import { CANTON_TIMEOUTS, RETRY_CONFIG } from '@repo/shared/constants';

export class LedgerApi {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth?: AuthTokenProvider) {
    this.config = config;
    this.auth = auth ?? new AuthTokenProvider(config);
  }

  async getParty(partyId: string): Promise<Party | null> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) return { id: partyId };

    try {
      const headers = await this.auth.getHeaders();
      // Safe to retry GET requests
      const response = await fetchWithRetry(`${jsonApiUrl}/v2/parties/${encodeURIComponent(partyId)}`, {
        headers,
        timeout: CANTON_TIMEOUTS.ledger,
        retries: 2,
        backoffBase: RETRY_CONFIG.backoffBase,
        backoffMax: RETRY_CONFIG.backoffMax,
        retryOnStatus: RETRY_CONFIG.retryableStatus,
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { party_id: string; display_name?: string };
      const result: Party = { id: data.party_id };
      if (data.display_name) result.displayName = data.display_name;
      return result;
    } catch {
      return { id: partyId };
    }
  }

  async createContract(templateId: string, payload: Record<string, unknown>): Promise<Contract> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) {
      return { contractId: `contract-${Date.now()}`, templateId, payload };
    }

    const headers = await this.auth.getHeaders();
    // CRITICAL: NO RETRY - duplicate contract creation risk!
    const response = await fetchWithTimeout(`${jsonApiUrl}/v2/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commands: [{ create: { template_id: templateId, payload } }],
      }),
      timeout: CANTON_TIMEOUTS.preapproval,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create contract: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { contract_id: string };

    return {
      contractId: data.contract_id,
      templateId,
      payload,
    };
  }

  async exerciseChoice(
    contractId: string,
    choice: string,
    argument: Record<string, unknown>
  ): Promise<LedgerEvent[]> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) return [];

    const headers = await this.auth.getHeaders();
    // CRITICAL: NO RETRY - duplicate choice exercise risk!
    const response = await fetchWithTimeout(`${jsonApiUrl}/v2/commands`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commands: [
          {
            exercise: {
              contract_id: contractId,
              choice,
              argument,
            },
          },
        ],
      }),
      timeout: CANTON_TIMEOUTS.preapproval,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to exercise choice: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      events: Array<{
        type: string;
        contract_id: string;
        template_id: string;
        payload: Record<string, unknown>;
      }>;
    };

    return (data.events ?? []).map((e) => ({
      type: e.type as 'created' | 'archived',
      contractId: e.contract_id,
      templateId: e.template_id,
      payload: e.payload,
    }));
  }

  async queryContracts(
    templateId: string,
    filter?: Record<string, unknown>
  ): Promise<Contract[]> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) return [];

    const headers = await this.auth.getHeaders();
    // Safe to retry query requests
    const response = await fetchWithRetry(`${jsonApiUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          template_filter: { filters_by_template_id: { [templateId]: {} } },
          ...filter,
        },
      }),
      timeout: CANTON_TIMEOUTS.ledger,
      retries: 2,
      backoffBase: RETRY_CONFIG.backoffBase,
      backoffMax: RETRY_CONFIG.backoffMax,
      retryOnStatus: RETRY_CONFIG.retryableStatus,
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      active_contracts: Array<{
        contract_id: string;
        template_id: string;
        payload: Record<string, unknown>;
      }>;
    };

    return (data.active_contracts ?? []).map((c) => ({
      contractId: c.contract_id,
      templateId: c.template_id,
      payload: c.payload,
    }));
  }

  async subscribeToEvents(
    partyId: string,
    callback: (event: LedgerEvent) => void
  ): Promise<() => void> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) return () => {};

    // Use Server-Sent Events for real-time updates
    const headers = await this.auth.getHeaders();
    const controller = new AbortController();

    const streamEvents = async () => {
      try {
        const response = await fetch(
          `${jsonApiUrl}/v2/updates/flats?party=${encodeURIComponent(partyId)}&stream=true`,
          { headers, signal: controller.signal }
        );

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          try {
            const event = JSON.parse(text) as LedgerEvent;
            callback(event);
          } catch {
            // Partial JSON, wait for more data
          }
        }
      } catch {
        // Stream closed or aborted
      }
    };

    void streamEvents();

    return () => controller.abort();
  }

  getConfig(): CantonConfig {
    return this.config;
  }
}
