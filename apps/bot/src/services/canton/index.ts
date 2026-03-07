import { OfficialSDKClient, type OfficialSDKConfig } from '@repo/canton-client';
import { env } from '../../config/env.js';

// Re-export agent service
export {
  CantonAgentService,
  getCantonAgent,
  initCantonAgent,
  shutdownCantonAgent,
  resetCantonAgent,
  type AgentHealthStatus,
  type AgentMetrics,
  type DevnetSetupStatus,
} from './agent.js';

let sdkClient: OfficialSDKClient | null = null;

/**
 * @deprecated Use getCantonAgent() instead for better error handling and retry support.
 */
export function getCantonSDK(): OfficialSDKClient {
  if (!sdkClient) {
    // Determine if using unsafe auth (devnet/localnet or explicit CANTON_UNSAFE_SECRET)
    const hasUnsafeSecret = !!env.CANTON_UNSAFE_SECRET;
    const isDevnet = env.CANTON_NETWORK === 'devnet' || env.NODE_ENV !== 'production';
    const useUnsafeAuth = isDevnet || hasUnsafeSecret;

    const config: OfficialSDKConfig = {
      network: env.CANTON_NETWORK,
      ledgerApiUrl: env.CANTON_LEDGER_API_URL ?? '',
      jsonApiUrl: env.CANTON_LEDGER_API_URL ?? '',
      participantId: env.CANTON_PARTICIPANT_ID ?? '',
      validatorUrl: env.CANTON_VALIDATOR_API_URL ?? env.CANTON_LEDGER_API_URL ?? '',
      scanUrl: env.CANTON_SCAN_URL,
      ledgerApiUser: env.CANTON_LEDGER_API_USER ?? 'ledger-api-user',
      validatorAudience: env.CANTON_VALIDATOR_AUDIENCE ?? 'https://validator.example.com',
      // Use unsafe auth if devnet or CANTON_UNSAFE_SECRET is set
      useUnsafeAuth,
      // Use CANTON_UNSAFE_SECRET if set, otherwise 'unsafe' for devnet or APP_SECRET for production
      unsafeSecret: env.CANTON_UNSAFE_SECRET || (isDevnet ? 'unsafe' : env.APP_SECRET),
      ...(env.CANTON_DSO_PARTY_ID && { dsoPartyId: env.CANTON_DSO_PARTY_ID }),
      ...(env.CANTON_PROVIDER_PARTY_ID && { providerPartyId: env.CANTON_PROVIDER_PARTY_ID }),
    };
    sdkClient = new OfficialSDKClient(config);
  }
  return sdkClient;
}

/**
 * @deprecated Use initCantonAgent() instead.
 */
export async function initCantonSDK(): Promise<void> {
  const sdk = getCantonSDK();
  await sdk.initialize();
}

/**
 * Reset the singleton - useful for testing or config changes.
 */
export function resetCantonSDK(): void {
  sdkClient = null;
}

export { OfficialSDKClient };

/**
 * Canton service helper functions
 * @deprecated Use getCantonAgent() instead for better error handling.
 */
export const cantonService = {
  /**
   * Get CC/Amulet price from Canton Network
   */
  async getCCPrice() {
    const sdk = getCantonSDK();
    return sdk.getCCPrice();
  },

  /**
   * Get balance for a party
   */
  async getBalance(partyId: string) {
    const sdk = getCantonSDK();
    return sdk.getBalance(partyId);
  },
};
