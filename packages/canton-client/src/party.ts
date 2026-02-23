import type { CantonConfig, ExternalPartyResult } from './types/index.js';
import { AuthTokenProvider } from './auth.js';

interface TopologyTx {
  topology_tx: string;
  hash: string;
}

interface GenerateResponse {
  party_id: string;
  topology_txs: TopologyTx[];
}

interface SignedTopologyTx {
  topology_tx: string;
  signed_hash: string;
}

/**
 * External party management for Canton Network.
 * Creates external parties by submitting topology transactions.
 */
export class PartyManager {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth: AuthTokenProvider) {
    this.config = config;
    this.auth = auth;
  }

  /**
   * Generate topology configuration for an external party.
   * Returns the party_id and topology transactions to be signed.
   *
   * @param publicKeyHex - Ed25519 public key in hex format
   * @param partyHint - Unique hint for the party (used to derive party_id)
   */
  async generateTopology(
    publicKeyHex: string,
    partyHint: string
  ): Promise<{ partyId: string; topologyTxs: TopologyTx[] }> {
    const headers = await this.auth.getHeaders();
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;

    const response = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/topology/generate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          public_key: publicKeyHex,
          party_hint: partyHint,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to generate topology: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as GenerateResponse;

    return {
      partyId: data.party_id,
      topologyTxs: data.topology_txs,
    };
  }

  /**
   * Submit signed topology transactions to complete party creation.
   *
   * @param publicKeyHex - Ed25519 public key in hex format
   * @param signedTxs - Topology transactions with Ed25519 signatures
   */
  async submitTopology(publicKeyHex: string, signedTxs: SignedTopologyTx[]): Promise<string> {
    const headers = await this.auth.getHeaders();
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;

    const response = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/topology/submit`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          public_key: publicKeyHex,
          signed_topology_txs: signedTxs,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to submit topology: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { party_id: string };
    return data.party_id;
  }

  /**
   * Create an external party on the Canton network (legacy interface).
   */
  async createExternalParty(
    publicKeyHex: string,
    displayName?: string
  ): Promise<ExternalPartyResult> {
    const partyHint = displayName || `ext-${publicKeyHex.slice(0, 16)}`;
    const { partyId, topologyTxs } = await this.generateTopology(publicKeyHex, partyHint);

    return {
      partyId,
      publicKey: publicKeyHex,
      topologyTxHashes: topologyTxs.map((tx) => tx.hash),
    };
  }

  /**
   * Allocate the external party after topology transactions are signed (legacy).
   */
  async allocateExternalParty(
    publicKeyHex: string,
    signedTransactions: Array<{ hash: string; signature: string; topologyTx?: string }>
  ): Promise<void> {
    // Convert to new format
    const signedTxs: SignedTopologyTx[] = signedTransactions.map((tx) => ({
      topology_tx: tx.topologyTx || '',
      signed_hash: tx.signature,
    }));

    await this.submitTopology(publicKeyHex, signedTxs);
  }

  /**
   * Full party creation flow: generate + sign + submit.
   * Takes a signing function that signs hashes with the party's Ed25519 key.
   */
  async createAndAllocateParty(
    publicKeyHex: string,
    signHash: (hash: Uint8Array) => Uint8Array,
    displayName?: string
  ): Promise<ExternalPartyResult> {
    const partyHint = displayName || `ext-${publicKeyHex.slice(0, 16)}`;
    const { partyId, topologyTxs } = await this.generateTopology(publicKeyHex, partyHint);

    // Sign each topology transaction hash
    const signedTxs: SignedTopologyTx[] = topologyTxs.map((tx) => {
      const hashBytes = hexToBytes(tx.hash);
      const signatureBytes = signHash(hashBytes);
      return {
        topology_tx: tx.topology_tx,
        signed_hash: bytesToHex(signatureBytes),
      };
    });

    const confirmedPartyId = await this.submitTopology(publicKeyHex, signedTxs);

    return {
      partyId: confirmedPartyId || partyId,
      publicKey: publicKeyHex,
      topologyTxHashes: topologyTxs.map((tx) => tx.hash),
    };
  }
}

/**
 * Setup proposal workflow for external parties.
 * Creates ValidatorRight + TransferPreapproval contracts in one atomic operation.
 */
export interface SetupProposalResult {
  transferPreapprovalContractId: string;
  updateId: string;
}

export class SetupProposalManager {
  private config: CantonConfig;
  private auth: AuthTokenProvider;

  constructor(config: CantonConfig, auth: AuthTokenProvider) {
    this.config = config;
    this.auth = auth;
  }

  /**
   * Create and accept a setup proposal for an external party.
   * This creates ValidatorRight + TransferPreapproval contracts.
   */
  async createAndAcceptProposal(
    partyId: string,
    publicKeyHex: string,
    signHash: (hash: Uint8Array) => Uint8Array
  ): Promise<SetupProposalResult> {
    const validatorUrl = this.config.validatorUrl || this.config.ledgerApiUrl;
    const headers = await this.auth.getHeaders();

    // Step 1: Create setup proposal
    const createResponse = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/setup-proposal`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_party_id: partyId }),
      }
    );

    let contractId: string;
    if (createResponse.ok) {
      const createData = (await createResponse.json()) as { contract_id: string };
      contractId = createData.contract_id;
    } else {
      // Check if proposal already exists
      const errorText = await createResponse.text();
      const match = errorText.match(/ContractId\(([^)]+)\)/);
      if (match && match[1]) {
        contractId = match[1];
      } else {
        throw new Error(`Failed to create setup proposal: ${createResponse.status} ${errorText}`);
      }
    }

    // Step 2: Prepare acceptance
    const prepareResponse = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/setup-proposal/prepare-accept`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contract_id: contractId,
          user_party_id: partyId,
        }),
      }
    );

    if (!prepareResponse.ok) {
      const errorText = await prepareResponse.text();
      throw new Error(`Failed to prepare setup proposal acceptance: ${prepareResponse.status} ${errorText}`);
    }

    const prepareData = (await prepareResponse.json()) as {
      transaction: string;
      tx_hash: string;
    };

    // Step 3: Sign the tx_hash
    const hashBytes = hexToBytes(prepareData.tx_hash);
    const signatureBytes = signHash(hashBytes);

    // Step 4: Submit acceptance
    const submitResponse = await fetch(
      `${validatorUrl}/api/validator/v0/admin/external-party/setup-proposal/submit-accept`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contract_id: contractId,
          submission: {
            party_id: partyId,
            public_key: publicKeyHex,
            transaction: prepareData.transaction,
            signed_tx_hash: bytesToHex(signatureBytes),
          },
        }),
      }
    );

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(`Failed to submit setup proposal acceptance: ${submitResponse.status} ${errorText}`);
    }

    const submitData = (await submitResponse.json()) as {
      transfer_preapproval_contract_id: string;
      update_id: string;
    };

    return {
      transferPreapprovalContractId: submitData.transfer_preapproval_contract_id,
      updateId: submitData.update_id,
    };
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
