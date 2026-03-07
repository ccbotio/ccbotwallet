/**
 * Script to create TransferPreapproval for CC Bot wallet
 * Run: npx tsx scripts/create-preapproval.ts
 */
import 'dotenv/config';
import { OfficialSDKClient, type OfficialSDKConfig } from '@repo/canton-client';
import { deriveEd25519PrivateKey, bytesToHex, secureZero } from '@repo/crypto';

// Configuration from .env
const TELEGRAM_ID = '555666777'; // CC Bot test user
const PARTY_ID = 'ccbot-555666777::1220a6ab04f5264144186882422418f6bfc0cfd5acc0f47355ba8816c063cca35c4d';
const APP_SECRET = process.env.APP_SECRET!;

async function main() {
  console.log('🔧 Creating TransferPreapproval for CC Bot wallet...\n');
  console.log(`   Party ID: ${PARTY_ID}`);
  console.log(`   Telegram ID: ${TELEGRAM_ID}`);

  // Initialize SDK
  const isDevnet = process.env.CANTON_NETWORK === 'devnet' || process.env.NODE_ENV !== 'production';

  const config: OfficialSDKConfig = {
    network: process.env.CANTON_NETWORK || 'devnet',
    ledgerApiUrl: process.env.CANTON_LEDGER_API_URL || '',
    jsonApiUrl: process.env.CANTON_LEDGER_API_URL || '',
    participantId: process.env.CANTON_PARTICIPANT_ID || '',
    validatorUrl: process.env.CANTON_VALIDATOR_API_URL || '',
    ledgerApiUser: process.env.CANTON_LEDGER_API_USER || 'ledger-api-user',
    validatorAudience: process.env.CANTON_VALIDATOR_AUDIENCE || 'https://validator.example.com',
    useUnsafeAuth: isDevnet,
    unsafeSecret: isDevnet ? 'unsafe' : APP_SECRET,
  };

  console.log('\n🔌 Initializing SDK...');
  console.log(`   Network: ${config.network}`);
  console.log(`   Validator URL: ${config.validatorUrl}`);
  console.log(`   Ledger API URL: ${config.ledgerApiUrl}`);

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
  } catch (error) {
    console.error('\n❌ Failed to create preapproval:', error);
    throw error;
  } finally {
    // Security: zero private key
    secureZero(privateKey);
  }

  console.log('\n🎉 Done! CC Bot can now receive direct transfers.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
