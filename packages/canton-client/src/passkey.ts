import type { CantonConfig } from './types/index.js';
import { AuthTokenProvider } from './auth.js';

/**
 * WebAuthn assertion data from the client
 */
export interface WebAuthnAssertion {
  credentialId: string;       // Base64 credential ID
  authenticatorData: string;  // Base64 authenticator data
  clientDataJson: string;     // Base64 client data JSON
  signature: string;          // Base64 signature
  userHandle?: string | undefined;  // Base64 user handle (optional)
}

/**
 * Passkey credential stored on Canton
 */
export interface PasskeyContract {
  contractId: string;
  owner: string;
  credentialId: string;
  publicKeySpki: string;
  encryptedRecoveryShare: string;
  encryptionNonce: string;
  registeredAt: string;
  deviceName?: string | undefined;
}

/**
 * Result of creating a passkey contract
 */
export interface CreatePasskeyResult {
  contractId: string;
  partyId: string;
}

/**
 * Result of recovery request
 */
export interface RecoveryResult {
  encryptedShare: string;
  nonce: string;
}

/**
 * Recovery challenge for WebAuthn
 */
export interface RecoveryChallenge {
  challenge: string;          // Base64 random challenge
  credentialIds: string[];    // Allowed credential IDs
  expiresAt: number;          // Unix timestamp
}

/**
 * Manages Passkey recovery contracts on Canton Network.
 *
 * This manager handles:
 * - Creating PasskeyCredential contracts to store encrypted recovery shares
 * - Querying passkey contracts for a party
 * - Exercising RequestRecovery choice to retrieve encrypted shares
 * - Adding backup credentials and revoking compromised ones
 */
export class PasskeyContractManager {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth: AuthTokenProvider) {
    this.config = config;
    this.auth = auth;
  }

  /**
   * Create a passkey credential contract on Canton.
   * Stores the encrypted recovery share on-chain.
   *
   * @param partyId - Canton party ID (wallet owner)
   * @param credentialId - WebAuthn credential ID (base64)
   * @param publicKeySpki - Passkey public key in SPKI format (base64)
   * @param encryptedShare - Recovery share encrypted with passkey-derived key (base64)
   * @param nonce - AES-GCM nonce used for encryption (base64)
   * @param signHash - Function to sign transaction hashes with Ed25519
   * @param deviceName - Optional device name for identification
   */
  async createPasskeyContract(
    partyId: string,
    credentialId: string,
    publicKeySpki: string,
    encryptedShare: string,
    nonce: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    deviceName?: string
  ): Promise<CreatePasskeyResult> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Step 1: Prepare the contract creation
    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/passkey/prepare-create`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          credential_id: credentialId,
          public_key_spki: publicKeySpki,
          encrypted_recovery_share: encryptedShare,
          encryption_nonce: nonce,
          device_name: deviceName,
        }),
      }
    );

    // If passkey-specific endpoint doesn't exist, fall back to generic contract creation
    if (prepareResponse.status === 404) {
      return this.createPasskeyContractFallback(
        partyId,
        credentialId,
        publicKeySpki,
        encryptedShare,
        nonce,
        signHash,
        deviceName
      );
    }

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare passkey contract: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = await prepareResponse.json() as {
      transaction: string;
      tx_hash: string;
    };

    // Step 2: Sign the transaction hash
    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    // Step 3: Submit the signed transaction
    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/passkey/submit-create`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          transaction: prepareData.transaction,
          signed_tx_hash: bytesToHex(signatureBytes),
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit passkey contract: ${submitResponse.status} ${errorText}`);
    }

    const submitData = await submitResponse.json() as {
      contract_id: string;
    };

    return {
      contractId: submitData.contract_id,
      partyId,
    };
  }

  /**
   * Fallback method using generic ledger API for contract creation.
   * Used when passkey-specific endpoints are not available.
   */
  private async createPasskeyContractFallback(
    partyId: string,
    credentialId: string,
    publicKeySpki: string,
    encryptedShare: string,
    nonce: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    deviceName?: string
  ): Promise<CreatePasskeyResult> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Use the generic external party submission endpoint
    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          commands: [
            {
              type: 'create',
              template_id: 'PasskeyRecovery:PasskeyCredential',
              payload: {
                owner: partyId,
                credentialId,
                publicKeySpki,
                encryptedRecoveryShare: encryptedShare,
                encryptionNonce: nonce,
                registeredAt: new Date().toISOString(),
                deviceName: deviceName || null,
                validator: this.config.participantId,
              },
            },
          ],
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare passkey contract (fallback): ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = await prepareResponse.json() as {
      transaction: string;
      tx_hash: string;
    };

    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/submit`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          transaction: prepareData.transaction,
          signed_tx_hash: bytesToHex(signatureBytes),
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit passkey contract (fallback): ${submitResponse.status} ${errorText}`);
    }

    const submitData = await submitResponse.json() as {
      contract_id?: string;
      update_id: string;
    };

    return {
      contractId: submitData.contract_id || `passkey-${Date.now()}`,
      partyId,
    };
  }

  /**
   * Query all passkey contracts for a party.
   *
   * @param partyId - Canton party ID
   */
  async getPasskeyContracts(partyId: string): Promise<PasskeyContract[]> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Try passkey-specific endpoint first
    const response = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/passkey/list?party_id=${encodeURIComponent(partyId)}`,
      {
        method: 'GET',
        headers,
      }
    );

    // Fallback to generic contract query
    if (response.status === 404) {
      return this.getPasskeyContractsFallback(partyId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to query passkey contracts: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      contracts: Array<{
        contract_id: string;
        payload: {
          owner: string;
          credentialId: string;
          publicKeySpki: string;
          encryptedRecoveryShare: string;
          encryptionNonce: string;
          registeredAt: string;
          deviceName?: string;
        };
      }>;
    };

    return data.contracts.map((c) => ({
      contractId: c.contract_id,
      owner: c.payload.owner,
      credentialId: c.payload.credentialId,
      publicKeySpki: c.payload.publicKeySpki,
      encryptedRecoveryShare: c.payload.encryptedRecoveryShare,
      encryptionNonce: c.payload.encryptionNonce,
      registeredAt: c.payload.registeredAt,
      deviceName: c.payload.deviceName,
    }));
  }

  /**
   * Fallback query using generic ledger API.
   */
  private async getPasskeyContractsFallback(partyId: string): Promise<PasskeyContract[]> {
    const ledgerUrl = this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    const response = await fetch(
      `${ledgerUrl}/v1/query`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          templateIds: ['PasskeyRecovery:PasskeyCredential'],
          query: { owner: partyId },
        }),
      }
    );

    if (!response.ok) {
      // If query fails, return empty array (contract might not be deployed)
      return [];
    }

    const data = await response.json() as {
      result: Array<{
        contractId: string;
        payload: {
          owner: string;
          credentialId: string;
          publicKeySpki: string;
          encryptedRecoveryShare: string;
          encryptionNonce: string;
          registeredAt: string;
          deviceName?: string;
        };
      }>;
    };

    return (data.result || []).map((c) => ({
      contractId: c.contractId,
      owner: c.payload.owner,
      credentialId: c.payload.credentialId,
      publicKeySpki: c.payload.publicKeySpki,
      encryptedRecoveryShare: c.payload.encryptedRecoveryShare,
      encryptionNonce: c.payload.encryptionNonce,
      registeredAt: c.payload.registeredAt,
      deviceName: c.payload.deviceName,
    }));
  }

  /**
   * Exercise RequestRecovery choice on a passkey contract.
   * Returns the encrypted recovery share after WebAuthn verification.
   *
   * Note: WebAuthn signature verification should be done by the backend
   * before calling this method. The Daml contract acts as an audit log.
   *
   * @param contractId - PasskeyCredential contract ID
   * @param partyId - Canton party ID
   * @param assertion - WebAuthn assertion from client
   * @param signHash - Function to sign transaction hash
   */
  async requestRecovery(
    contractId: string,
    partyId: string,
    assertion: WebAuthnAssertion,
    signHash: (hash: Uint8Array) => Uint8Array
  ): Promise<RecoveryResult> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Prepare the choice exercise
    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          commands: [
            {
              type: 'exercise',
              contract_id: contractId,
              template_id: 'PasskeyRecovery:PasskeyCredential',
              choice: 'RequestRecovery',
              argument: {
                challenge: assertion.clientDataJson, // Challenge is in clientDataJson
                authenticatorData: assertion.authenticatorData,
                clientDataJson: assertion.clientDataJson,
                signature: assertion.signature,
              },
            },
          ],
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare recovery request: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = await prepareResponse.json() as {
      transaction: string;
      tx_hash: string;
    };

    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/submit`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          transaction: prepareData.transaction,
          signed_tx_hash: bytesToHex(signatureBytes),
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit recovery request: ${submitResponse.status} ${errorText}`);
    }

    const submitData = await submitResponse.json() as {
      result?: {
        encryptedShare: string;
        nonce: string;
      };
    };

    // If no result in response, fetch from contract directly
    if (!submitData.result) {
      const contracts = await this.getPasskeyContracts(partyId);
      const contract = contracts.find((c) => c.contractId === contractId);
      if (!contract) {
        throw new Error('Passkey contract not found after recovery request');
      }
      return {
        encryptedShare: contract.encryptedRecoveryShare,
        nonce: contract.encryptionNonce,
      };
    }

    return submitData.result;
  }

  /**
   * Add a backup passkey credential.
   * Creates a new PasskeyCredential with the same encrypted share.
   *
   * @param originalContractId - Original PasskeyCredential contract ID
   * @param partyId - Canton party ID
   * @param newCredentialId - New WebAuthn credential ID
   * @param newPublicKey - New passkey public key (SPKI format)
   * @param attestation - WebAuthn attestation object
   * @param signHash - Function to sign transaction hash
   * @param deviceName - Optional device name
   */
  async addBackupCredential(
    originalContractId: string,
    partyId: string,
    newCredentialId: string,
    newPublicKey: string,
    attestation: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    deviceName?: string
  ): Promise<CreatePasskeyResult> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          commands: [
            {
              type: 'exercise',
              contract_id: originalContractId,
              template_id: 'PasskeyRecovery:PasskeyCredential',
              choice: 'AddBackupCredential',
              argument: {
                newCredentialId,
                newPublicKey,
                newDeviceName: deviceName || null,
                attestation,
              },
            },
          ],
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare backup credential: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = await prepareResponse.json() as {
      transaction: string;
      tx_hash: string;
    };

    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/submit`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          transaction: prepareData.transaction,
          signed_tx_hash: bytesToHex(signatureBytes),
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit backup credential: ${submitResponse.status} ${errorText}`);
    }

    const submitData = await submitResponse.json() as {
      contract_id?: string;
      update_id: string;
    };

    return {
      contractId: submitData.contract_id || `passkey-backup-${Date.now()}`,
      partyId,
    };
  }

  /**
   * Revoke a passkey credential (archives the contract).
   * Use when a device is lost or compromised.
   *
   * @param contractId - PasskeyCredential contract ID to revoke
   * @param partyId - Canton party ID
   * @param signHash - Function to sign transaction hash
   */
  async revokeCredential(
    contractId: string,
    partyId: string,
    signHash: (hash: Uint8Array) => Uint8Array
  ): Promise<void> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          commands: [
            {
              type: 'exercise',
              contract_id: contractId,
              template_id: 'PasskeyRecovery:PasskeyCredential',
              choice: 'RevokeCredential',
              argument: {},
            },
          ],
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare credential revocation: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = await prepareResponse.json() as {
      transaction: string;
      tx_hash: string;
    };

    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/external-party/submission/submit`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          party_id: partyId,
          transaction: prepareData.transaction,
          signed_tx_hash: bytesToHex(signatureBytes),
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit credential revocation: ${submitResponse.status} ${errorText}`);
    }
  }

  /**
   * Generate a recovery challenge for WebAuthn.
   * The challenge should be stored temporarily and verified during recovery.
   */
  generateChallenge(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
  }
}

// Utility functions

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

function bytesToBase64(bytes: Uint8Array): string {
  // Use base64url encoding (safe for URLs)
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
