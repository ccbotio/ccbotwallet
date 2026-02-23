import type {
  CantonConfig,
  TransferRequest,
  TransferResult,
  SignatureEntry,
} from './types/index.js';
import { AuthTokenProvider } from './auth.js';

/**
 * Transfer management for Canton Network.
 * Creates and submits CC transfers with Ed25519 signatures.
 * Supports both wallet API (for validator-managed parties) and
 * external party API (for externally-signed parties).
 */
export class TransferManager {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth: AuthTokenProvider) {
    this.config = config;
    this.auth = auth;
  }

  /**
   * Create a transfer, prepare for signing, sign, and submit.
   * Full transfer flow with Ed25519 signing.
   * Uses external party transfer API which is the correct endpoint for external parties.
   *
   * @param request - Transfer details
   * @param signHash - Function to sign the transaction hash with Ed25519
   * @param publicKeyHex - The sender's Ed25519 public key
   * @param nonce - Optional nonce (if not provided, will try to query from API)
   */
  async sendCC(
    request: TransferRequest,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string,
    nonce?: number
  ): Promise<TransferResult> {
    // Use external party transfer API
    return this.sendCCExternalParty(request, signHash, publicKeyHex, nonce);
  }

  /**
   * External party transfer using the transfer-preapproval API.
   * This is the correct API for parties created via external-party/topology endpoints.
   * Uses /v0/admin/external-party/transfer-preapproval/prepare-send and submit-send.
   *
   * @param request - Transfer details
   * @param signHash - Function to sign the transaction hash with Ed25519
   * @param publicKeyHex - The sender's Ed25519 public key
   * @param providedNonce - Optional nonce (if not provided, will try to query from API)
   */
  async sendCCExternalParty(
    request: TransferRequest,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string,
    providedNonce?: number
  ): Promise<TransferResult> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Calculate expiration time (10 minutes from now in ISO format)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Use provided nonce or try to get from API
    const nonce = providedNonce ?? (await this.getTransferNonce(request.fromParty));

    // Step 1: Prepare transfer using transfer-preapproval API
    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/transfer-preapproval/prepare-send`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sender_party_id: request.fromParty,
          receiver_party_id: request.toParty,
          amount: request.amount,
          expires_at: expiresAt,
          nonce: nonce,
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare transfer: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = (await prepareResponse.json()) as {
      transaction: string;
      tx_hash: string;
    };

    // Step 2: Sign the tx_hash
    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    // Step 3: Submit transfer with signature using submit-send
    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/transfer-preapproval/submit-send`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          submission: {
            party_id: request.fromParty,
            public_key: publicKeyHex,
            transaction: prepareData.transaction,
            signed_tx_hash: bytesToHex(signatureBytes),
          },
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit transfer: ${submitResponse.status} ${errorText}`);
    }

    const submitData = (await submitResponse.json()) as {
      update_id: string;
    };

    return {
      txHash: submitData.update_id,
      status: 'confirmed',
      updateId: submitData.update_id,
    };
  }

  /**
   * Legacy wallet API transfer (for validator-managed parties).
   * Note: This does not work for external parties.
   */
  async sendCCWalletApi(
    request: TransferRequest,
    signHash: (hash: Uint8Array) => Uint8Array,
    publicKeyHex: string
  ): Promise<TransferResult> {
    // Step 1: Create the transfer and get the hash to sign
    const prepared = await this.prepareTransfer(request);

    // Step 2: Sign the transaction hash
    const hashBytes = hexToBytes(prepared.hashToSign);
    const signatureBytes = signHash(hashBytes);
    const signatureHex = bytesToHex(signatureBytes);

    // Step 3: Submit with signature
    return this.executeTransfer(prepared.submissionId, {
      publicKey: publicKeyHex,
      signature: signatureHex,
      format: 'ed25519',
    });
  }

  /**
   * Step 1: Prepare a transfer - creates the transaction and returns the hash to sign.
   * Note: This is for wallet API only, not for external parties.
   */
  async prepareTransfer(request: TransferRequest): Promise<{
    submissionId: string;
    hashToSign: string;
    expiresAt: number;
  }> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    const response = await fetch(`${jsonApiUrl}/api/validator/v0/wallet/transfer/prepare`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sender: request.fromParty,
        receiver: request.toParty,
        amount: request.amount,
        memo: request.memo,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to prepare transfer: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      submission_id: string;
      hash: string;
      expires_at: string;
    };

    return {
      submissionId: data.submission_id,
      hashToSign: data.hash,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  }

  /**
   * Step 2: Execute a prepared transfer with the Ed25519 signature.
   * Note: This is for wallet API only, not for external parties.
   */
  async executeTransfer(
    submissionId: string,
    signature: SignatureEntry
  ): Promise<TransferResult> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    const response = await fetch(`${jsonApiUrl}/api/validator/v0/wallet/transfer/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        submission_id: submissionId,
        signature: {
          public_key: signature.publicKey,
          signature: signature.signature,
          format: signature.format,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute transfer: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      update_id: string;
      status: string;
    };

    return {
      txHash: data.update_id,
      status: data.status === 'confirmed' ? 'confirmed' : 'pending',
      updateId: data.update_id,
    };
  }

  /**
   * Get the current nonce counter for transfer commands.
   * The nonce must equal the current counter value (starting at 0).
   */
  async getTransferNonce(partyId: string): Promise<number> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    try {
      // Query the TransferCommandCounter for this party
      const response = await fetch(
        `${validatorUrl}/api/validator/v0/admin/external-party/transfer-command-counter?party_id=${encodeURIComponent(partyId)}`,
        { headers }
      );

      if (!response.ok) {
        // If not found, start at 0
        return 0;
      }

      const data = (await response.json()) as { counter?: number };
      return data.counter ?? 0;
    } catch {
      // Default to 0 if we can't get the counter
      return 0;
    }
  }

  /**
   * Get transfer history from the ledger.
   * Parses Canton TransferCommand events to extract transfer details.
   */
  async getTransferHistory(
    partyId: string,
    limit: number = 20,
    after?: string
  ): Promise<Array<{
    updateId: string;
    type: 'send' | 'receive';
    amount: string;
    counterparty: string;
    fromParty: string;
    toParty: string;
    timestamp: string;
  }>> {
    const jsonApiUrl = this.config.jsonApiUrl || this.config.ledgerApiUrl;
    if (!jsonApiUrl) return [];

    const headers = await this.auth.getHeaders();

    try {
      const body: Record<string, unknown> = {
        party: partyId,
        page_size: limit,
      };
      if (after) {
        body.after = after;
      }

      const response = await fetch(`${jsonApiUrl}/v2/updates/flats`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        updates: Array<{
          update_id: string;
          events: Array<{
            created?: {
              template_id: string;
              payload: {
                sender?: string;
                receiver?: string;
                amount?: { amount: string };
                owner?: string;
                provider?: string;
              };
            };
            archived?: { contract_id: string };
          }>;
          effective_at: string;
        }>;
      };

      const transfers: Array<{
        updateId: string;
        type: 'send' | 'receive';
        amount: string;
        counterparty: string;
        fromParty: string;
        toParty: string;
        timestamp: string;
      }> = [];

      for (const update of data.updates ?? []) {
        // Look for TransferCommand or Amulet transfer events
        for (const event of update.events) {
          if (event.created?.payload) {
            const payload = event.created.payload;
            const templateId = event.created.template_id || '';

            // Check if this is a transfer-related event
            if (
              templateId.includes('TransferCommand') ||
              templateId.includes('Transfer') ||
              (payload.sender && payload.receiver)
            ) {
              const sender = payload.sender || '';
              const receiver = payload.receiver || '';
              const amount = payload.amount?.amount || '0';

              // Determine if we're the sender or receiver
              const isSend = sender === partyId || sender.includes(partyId);
              const isReceive = receiver === partyId || receiver.includes(partyId);

              if (isSend || isReceive) {
                transfers.push({
                  updateId: update.update_id,
                  type: isSend ? 'send' : 'receive',
                  amount,
                  counterparty: isSend ? receiver : sender,
                  fromParty: sender,
                  toParty: receiver,
                  timestamp: update.effective_at,
                });
              }
            }

            // Also check for Amulet holding events (receiving CC)
            if (
              templateId.includes('Amulet') &&
              payload.owner &&
              (payload.owner === partyId || payload.owner.includes(partyId))
            ) {
              const amount = payload.amount?.amount || '0';
              // This is a holding being created (receiving)
              if (!transfers.find(t => t.updateId === update.update_id)) {
                transfers.push({
                  updateId: update.update_id,
                  type: 'receive',
                  amount,
                  counterparty: payload.provider || 'unknown',
                  fromParty: payload.provider || 'unknown',
                  toParty: payload.owner,
                  timestamp: update.effective_at,
                });
              }
            }
          }
        }
      }

      return transfers;
    } catch {
      return [];
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
