/**
 * Script to create TransferPreapproval for CC Bot wallet
 * Run: node scripts/create-preapproval.mjs
 */
import 'dotenv/config';

// Direct import from dist
import { OfficialSDKClient } from '../packages/canton-client/dist/official-sdk.js';
import { deriveEd25519PrivateKey, bytesToHex, secureZero } from '../packages/crypto/dist/index.js';

// Configuration
const TELEGRAM_ID = '555666777';
const PARTY_ID = 'ccbot-555666777::1220a6ab04f5264144186882422418f6bfc0cfd5acc0f47355ba8816c063cca35c4d';
const APP_SECRET = process.env.APP_SECRET;

// DevNet parties (from Chrome DevTools testing)
const DSO_PARTY_ID = 'DSO::1220c3ccbf1d987f10689588246a9f0433fdfc5282cd3ba368d4d1c52ee21b29e14f';
const PROVIDER_PARTY_ID = 'ccbot-validator::12202f4c90635782a8a4f0ba2a3aeaae919bbb35220b937d70235d739f2ca54619ec';

async function main() {
  console.log('🔧 Creating TransferPreapproval for CC Bot wallet...\n');
  console.log(`   Receiver (CC Bot): ${PARTY_ID}`);
  console.log(`   Provider (Validator): ${PROVIDER_PARTY_ID}`);
  console.log(`   DSO Party: ${DSO_PARTY_ID}`);

  // Initialize SDK with both dsoPartyId AND providerPartyId
  const isDevnet = process.env.CANTON_NETWORK === 'devnet' || process.env.NODE_ENV !== 'production';

  const config = {
    network: process.env.CANTON_NETWORK || 'devnet',
    ledgerApiUrl: process.env.CANTON_LEDGER_API_URL || '',
    jsonApiUrl: process.env.CANTON_LEDGER_API_URL || '',
    participantId: process.env.CANTON_PARTICIPANT_ID || '',
    validatorUrl: process.env.CANTON_VALIDATOR_API_URL || '',
    ledgerApiUser: process.env.CANTON_LEDGER_API_USER || 'ledger-api-user',
    validatorAudience: process.env.CANTON_VALIDATOR_AUDIENCE || 'https://validator.example.com',
    useUnsafeAuth: isDevnet,
    unsafeSecret: isDevnet ? 'unsafe' : APP_SECRET,
    dsoPartyId: DSO_PARTY_ID,
    providerPartyId: PROVIDER_PARTY_ID,  // <-- Bypass getValidatorUser()
  };

  console.log('\n🔌 Initializing SDK...');
  const sdk = new OfficialSDKClient(config);
  await sdk.initialize();
  console.log('   SDK initialized ✅');

  // Derive private key for signing
  console.log('\n🔑 Deriving private key...');
  const privateKey = deriveEd25519PrivateKey(TELEGRAM_ID, APP_SECRET);
  const privateKeyHex = bytesToHex(privateKey);
  console.log('   Private key derived ✅');

  try {
    console.log('\n📝 Creating TransferPreapproval...');
    const result = await sdk.createPreapproval(PARTY_ID, privateKeyHex);

    console.log('\n✅ TransferPreapproval created successfully!');
    console.log(`   Contract ID: ${result.contractId}`);
    console.log(`   Receiver: ${result.receiver}`);
    console.log(`   Provider: ${result.provider}`);

    console.log('\n🎉 CC Bot can now receive DIRECT transfers!');
    console.log('   Next: Send CC to CC Bot and verify it arrives instantly.');
  } catch (error) {
    console.error('\n❌ Failed to create preapproval:', error.message || error);
    throw error;
  } finally {
    // Security: zero private key
    secureZero(privateKey);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
