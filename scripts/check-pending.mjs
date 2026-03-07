/**
 * Script to check and accept pending transfers for CC Bot wallet
 * Run: node scripts/check-pending.mjs
 */
import 'dotenv/config';

// Direct import from dist
import { OfficialSDKClient } from '../packages/canton-client/dist/official-sdk.js';
import { deriveEd25519PrivateKey, bytesToHex, secureZero } from '../packages/crypto/dist/index.js';

// Configuration
const TELEGRAM_ID = '555666777';
const PARTY_ID = 'ccbot-555666777::1220a6ab04f5264144186882422418f6bfc0cfd5acc0f47355ba8816c063cca35c4d';
const APP_SECRET = process.env.APP_SECRET;
const DSO_PARTY_ID = 'DSO::1220c3ccbf1d987f10689588246a9f0433fdfc5282cd3ba368d4d1c52ee21b29e14f';

async function main() {
  console.log('🔍 Checking pending transfers for CC Bot wallet...\n');
  console.log(`   Party ID: ${PARTY_ID}`);

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
  };

  console.log('\n🔌 Initializing SDK...');
  const sdk = new OfficialSDKClient(config);
  await sdk.initialize();
  console.log('   SDK initialized ✅');

  // List pending transfers
  console.log('\n📋 Listing pending transfers...');
  try {
    const pending = await sdk.listPendingTransfers(PARTY_ID);

    if (pending.length === 0) {
      console.log('   No pending transfers found.');
    } else {
      console.log(`   Found ${pending.length} pending transfer(s):\n`);
      for (const p of pending) {
        console.log(`   📨 Contract ID: ${p.contractId}`);
        console.log(`      Sender: ${p.sender}`);
        console.log(`      Amount: ${p.amount}`);
        console.log('');
      }

      // Ask to accept
      console.log('\n🔑 Deriving private key to accept transfers...');
      const privateKey = deriveEd25519PrivateKey(TELEGRAM_ID, APP_SECRET);
      const privateKeyHex = bytesToHex(privateKey);

      try {
        console.log('\n✅ Accepting all pending transfers...');
        const result = await sdk.acceptAllPendingTransfers(PARTY_ID, privateKeyHex);
        console.log(`   Accepted: ${result.accepted}`);
        console.log(`   Failed: ${result.failed}`);
        if (result.errors.length > 0) {
          console.log(`   Errors: ${result.errors.join(', ')}`);
        }
      } finally {
        secureZero(privateKey);
      }
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }

  // Check balance
  console.log('\n💰 Checking balance...');
  try {
    const balance = await sdk.getBalance(PARTY_ID);
    console.log(`   Balance: ${balance.amount} CC`);
    console.log(`   Locked: ${balance.locked} CC`);
  } catch (error) {
    console.error('   Failed to get balance:', error.message);
  }

  console.log('\n✅ Done!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
