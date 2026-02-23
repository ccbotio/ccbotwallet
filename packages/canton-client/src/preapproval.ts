import type { CantonConfig, TransferPreapproval } from './types/index.js';
import { AuthTokenProvider } from './auth.js';

/**
 * TransferPreapproval management for Canton Network.
 * Preapprovals allow a party to receive transfers without confirming each one.
 */
export class PreapprovalManager {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth: AuthTokenProvider) {
    this.config = config;
    this.auth = auth;
  }

  /**
   * Create a TransferPreapproval for a party.
   * This enables the party to receive CC without manual confirmation.
   */
  async createPreapproval(
    partyId: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string
  ): Promise<TransferPreapproval> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Step 1: Prepare the preapproval creation
    const prepareResponse = await fetch(
      `${jsonApiUrl}/api/validator/v0/wallet/preapproval/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ party_id: partyId }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare preapproval: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = (await prepareResponse.json()) as {
      submission_id: string;
      hash: string;
    };

    // Step 2: Sign the hash
    const hashBytes = hexToBytes(prepareData.hash);
    const signatureBytes = signHash(hashBytes);

    // Step 3: Execute the preapproval
    const executeResponse = await fetch(
      `${jsonApiUrl}/api/validator/v0/wallet/preapproval/execute`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          submission_id: prepareData.submission_id,
          signature: {
            public_key: publicKeyHex,
            signature: bytesToHex(signatureBytes),
            format: 'ed25519',
          },
        }),
      }
    );

    if (!executeResponse.ok) {
      const errorText = await executeResponse.text();
      throw new Error(`Failed to execute preapproval: ${executeResponse.status} ${errorText}`);
    }

    const result = (await executeResponse.json()) as {
      contract_id: string;
      provider: string;
    };

    return {
      contractId: result.contract_id,
      receiver: partyId,
      provider: result.provider,
    };
  }

  /**
   * Get the current preapproval for a party (if any).
   */
  async getPreapproval(partyId: string): Promise<TransferPreapproval | null> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) return null;

    const headers = await this.auth.getHeaders();

    try {
      const response = await fetch(
        `${jsonApiUrl}/api/validator/v0/wallet/preapproval?party_id=${encodeURIComponent(partyId)}`,
        { headers }
      );

      if (!response.ok) return null;

      const data = (await response.json()) as {
        contract_id: string;
        provider: string;
        expires_at?: string;
      };

      const result: TransferPreapproval = {
        contractId: data.contract_id,
        receiver: partyId,
        provider: data.provider,
      };
      if (data.expires_at) result.expiresAt = data.expires_at;
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Cancel an existing preapproval.
   */
  async cancelPreapproval(
    contractId: string,
    partyId: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string
  ): Promise<void> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    const prepareResponse = await fetch(
      `${jsonApiUrl}/api/validator/v0/wallet/preapproval/cancel/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contract_id: contractId,
          party_id: partyId,
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare preapproval cancel: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = (await prepareResponse.json()) as {
      submission_id: string;
      hash: string;
    };

    const hashBytes = hexToBytes(prepareData.hash);
    const signatureBytes = signHash(hashBytes);

    const executeResponse = await fetch(
      `${jsonApiUrl}/api/validator/v0/wallet/preapproval/cancel/execute`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          submission_id: prepareData.submission_id,
          signature: {
            public_key: publicKeyHex,
            signature: bytesToHex(signatureBytes),
            format: 'ed25519',
          },
        }),
      }
    );

    if (!executeResponse.ok) {
      const errorText = await executeResponse.text();
      throw new Error(`Failed to execute preapproval cancel: ${executeResponse.status} ${errorText}`);
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
