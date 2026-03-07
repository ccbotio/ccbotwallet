/**
 * Test validator API endpoints to find the correct one for getting validator user
 */
import 'dotenv/config';
import crypto from 'crypto';

const VALIDATOR_URL = process.env.CANTON_VALIDATOR_API_URL || 'http://wallet.localhost';

// Generate JWT token
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

async function testEndpoint(path, token) {
  try {
    const response = await fetch(`${VALIDATOR_URL}${path}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      status: response.status,
      ok: response.ok,
      isJson: json !== null,
      data: json || text.slice(0, 200),
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function main() {
  const token = generateToken();
  console.log('Testing validator API endpoints...\n');

  const endpoints = [
    '/api/validator/v0/admin/users',
    '/api/validator/v0/validator/user',
    '/api/validator/v0/user',
    '/api/validator/v0/admin/domain/users',
    '/api/validator/v0/scan-proxy/amulet-rules',
  ];

  for (const path of endpoints) {
    console.log(`📡 ${path}`);
    const result = await testEndpoint(path, token);
    if (result.error) {
      console.log(`   ❌ Error: ${result.error}\n`);
    } else if (result.ok) {
      console.log(`   ✅ ${result.status} - JSON: ${result.isJson}`);
      if (result.isJson) {
        console.log(`   ${JSON.stringify(result.data).slice(0, 150)}...\n`);
      }
    } else {
      console.log(`   ⚠️ ${result.status}`);
      console.log(`   ${JSON.stringify(result.data).slice(0, 150)}\n`);
    }
  }

  // Try to find validator user from amulet-rules
  console.log('\n🔍 Extracting validator user from amulet-rules...');
  const rulesResult = await testEndpoint('/api/validator/v0/scan-proxy/amulet-rules', token);
  if (rulesResult.ok && rulesResult.isJson) {
    const payload = rulesResult.data?.amulet_rules?.contract?.payload;
    if (payload) {
      console.log('   DSO:', payload.dso);
      // The validator user might be in a different field
    }
  }
}

main().catch(console.error);
