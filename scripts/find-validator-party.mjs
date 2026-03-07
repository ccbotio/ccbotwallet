/**
 * Find the validator operator party ID
 */
import 'dotenv/config';
import crypto from 'crypto';

const VALIDATOR_URL = process.env.CANTON_VALIDATOR_API_URL || 'http://wallet.localhost';

function generateToken(sub = 'administrator') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    aud: 'https://validator.example.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', 'unsafe').update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function main() {
  const token = generateToken();

  // Try to get validator party from different endpoints
  console.log('🔍 Searching for validator operator party...\n');

  // 1. Check wallet balance endpoint (might reveal party)
  const endpoints = [
    '/api/validator/v0/wallet/user-status',
    '/api/validator/v0/wallet/balance',
    '/api/validator/v0/admin/validator',
    '/api/validator/v0/validator',
  ];

  for (const path of endpoints) {
    try {
      const response = await fetch(`${VALIDATOR_URL}${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const text = await response.text();
      console.log(`📡 ${path}: ${response.status}`);
      if (response.ok) {
        try {
          const json = JSON.parse(text);
          console.log(`   ${JSON.stringify(json).slice(0, 200)}`);
          // Look for party_id in response
          if (json.party_id) console.log(`   🎯 FOUND party_id: ${json.party_id}`);
          if (json.user_party) console.log(`   🎯 FOUND user_party: ${json.user_party}`);
        } catch {
          console.log(`   ${text.slice(0, 100)}`);
        }
      }
      console.log('');
    } catch (error) {
      console.log(`📡 ${path}: ERROR - ${error.message}\n`);
    }
  }

  // 2. Check the ccbot-validator user from Chrome DevTools snapshot
  // Party was: ccbot-validator::12202f4c90635782a8a4f0ba2a3aeaae919bbb35220b937d70235d739f2ca54619ec
  const ccbotValidatorParty = 'ccbot-validator::12202f4c90635782a8a4f0ba2a3aeaae919bbb35220b937d70235d739f2ca54619ec';

  console.log('📋 Known parties from earlier testing:');
  console.log(`   ccbot-validator: ${ccbotValidatorParty}`);
  console.log('');

  // 3. Try to use the validator party directly for createPreapproval
  console.log('💡 For createPreapproval, we need:');
  console.log('   - providerParty: The validator operator (ccbot-validator)');
  console.log('   - receiverParty: The CC Bot wallet party');
  console.log('   - dsoParty: DSO::1220...');
  console.log('');
  console.log('🎯 Use providerPartyId in SDK config instead of relying on getValidatorUser()');
}

main().catch(console.error);
