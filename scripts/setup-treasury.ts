#!/usr/bin/env npx tsx
/**
 * Treasury Party Setup Script
 *
 * Creates a new Canton party for the Treasury and outputs the configuration.
 * The Treasury holds liquidity for CC <-> USDCx swaps.
 *
 * Usage:
 *   npx tsx scripts/setup-treasury.ts
 *
 * Output:
 *   - TREASURY_PARTY_ID
 *   - TREASURY_PRIVATE_KEY (hex)
 *   - TREASURY_PUBLIC_KEY (hex)
 *
 * After running, add these to your .env file and fund the treasury with tokens.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

// Configuration
const CANTON_LEDGER_API_URL = process.env.CANTON_LEDGER_API_URL || 'http://json-ledger-api.localhost';
const CANTON_VALIDATOR_API_URL = process.env.CANTON_VALIDATOR_API_URL || 'http://wallet.localhost/api/validator';

interface TreasurySetupResult {
  partyId: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

async function generateKeyPair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

async function createTreasuryParty(): Promise<TreasurySetupResult> {
  console.log('🏦 Treasury Party Setup');
  console.log('========================\n');

  // Step 1: Generate Ed25519 keypair
  console.log('1️⃣  Generating Ed25519 keypair...');
  const { privateKey, publicKey } = await generateKeyPair();
  const privateKeyHex = bytesToHex(privateKey);
  const publicKeyHex = bytesToHex(publicKey);

  console.log(`   Private Key: ${privateKeyHex.slice(0, 16)}...`);
  console.log(`   Public Key:  ${publicKeyHex.slice(0, 16)}...\n`);

  // Step 2: Try to create party on Canton (if SDK available)
  console.log('2️⃣  Creating Canton party...');

  let partyId = '';

  try {
    // Dynamic import to handle cases where SDK might not be available
    const { OfficialSDKClient } = await import('@repo/canton-client');

    const sdk = new OfficialSDKClient({
      ledgerApiUrl: CANTON_LEDGER_API_URL,
      validatorApiUrl: CANTON_VALIDATOR_API_URL,
      userId: 'treasury-setup',
    });

    await sdk.connect();
    console.log('   Connected to Canton Network');

    // Create external party
    const result = await sdk.createExternalParty(privateKeyHex, 'treasury');
    partyId = result.partyId;

    console.log(`   ✅ Party created: ${partyId}\n`);
  } catch (error) {
    // If SDK fails, generate a placeholder party ID
    console.log('   ⚠️  Could not connect to Canton Network');
    console.log('   Generating placeholder party ID (update after manual creation)\n');

    // Generate a deterministic party hint from public key
    const partyHint = `treasury-${publicKeyHex.slice(0, 8)}`;
    partyId = `PAR::${partyHint}::placeholder`;
  }

  return {
    partyId,
    privateKeyHex,
    publicKeyHex,
  };
}

async function main() {
  try {
    const result = await createTreasuryParty();

    console.log('3️⃣  Treasury Configuration');
    console.log('============================\n');

    console.log('Add these to your .env file:\n');
    console.log('```');
    console.log(`TREASURY_PARTY_ID=${result.partyId}`);
    console.log(`TREASURY_PRIVATE_KEY=${result.privateKeyHex}`);
    console.log('```\n');

    console.log('⚠️  SECURITY NOTES:');
    console.log('   - Store the private key securely');
    console.log('   - Use HSM in production');
    console.log('   - Never commit to git\n');

    console.log('4️⃣  Next Steps');
    console.log('===============');
    console.log('   1. Add env vars to docker/.env.production');
    console.log('   2. Fund treasury with CC (from validator wallet or faucet)');
    console.log('   3. Fund treasury with USDCx (via bridge from Ethereum)');
    console.log('   4. Restart bot service');
    console.log('   5. Test swap via API\n');

    // Output as JSON for programmatic use
    console.log('📋 JSON Output:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
