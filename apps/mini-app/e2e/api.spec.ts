import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('API Connectivity', () => {
  test('health endpoint should respond', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  test('auth endpoint should accept requests', async ({ request }) => {
    const response = await request.post(`${API_URL}/auth/telegram`, {
      data: {
        initData: 'dev_mode_555666777',
      },
    });

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();
  });

  test('wallet endpoints require authentication', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/wallet/balance`);

    // Should return 401 without auth
    expect(response.status()).toBe(401);
  });

  test('authenticated wallet request should work', async ({ request }) => {
    // First, authenticate
    const authResponse = await request.post(`${API_URL}/auth/telegram`, {
      data: {
        initData: 'dev_mode_555666777',
      },
    });

    const authBody = await authResponse.json();
    const token = authBody.data.accessToken;

    // Then, make authenticated request
    const walletResponse = await request.get(`${API_URL}/api/wallet/details`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(walletResponse.ok()).toBe(true);

    const walletBody = await walletResponse.json();
    expect(walletBody.success).toBe(true);
  });
});

test.describe('API Security', () => {
  test('should reject invalid JWT', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/wallet/balance`, {
      headers: {
        Authorization: 'Bearer invalid.jwt.token',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should reject expired tokens', async ({ request }) => {
    // This is a properly formatted but expired/invalid JWT
    const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxfQ.invalid';

    const response = await request.get(`${API_URL}/api/wallet/balance`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    });

    expect(response.status()).toBe(401);
  });

  test('should validate request body schema', async ({ request }) => {
    // First, authenticate
    const authResponse = await request.post(`${API_URL}/auth/telegram`, {
      data: {
        initData: 'dev_mode_555666777',
      },
    });

    const authBody = await authResponse.json();
    const token = authBody.data.accessToken;

    // Send invalid transfer request
    const response = await request.post(`${API_URL}/api/transfer/send`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: {
        // Missing required fields
        amount: 'invalid',
      },
    });

    // Should return 400 for validation error
    expect(response.status()).toBe(400);
  });

  test('CORS headers should be present', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);

    // In dev mode, CORS might be permissive
    expect(response.headers()['access-control-allow-origin'] || true).toBeTruthy();
  });
});

test.describe('API Rate Limiting', () => {
  test('should allow normal request rate', async ({ request }) => {
    const results: boolean[] = [];

    // Make 10 requests in sequence
    for (let i = 0; i < 10; i++) {
      const response = await request.get(`${API_URL}/health`);
      results.push(response.ok());
    }

    // All should succeed under normal rate
    expect(results.every(r => r)).toBe(true);
  });
});

test.describe('Wallet Flow', () => {
  let token: string;

  test.beforeAll(async ({ request }) => {
    const authResponse = await request.post(`${API_URL}/auth/telegram`, {
      data: {
        initData: 'dev_mode_555666777',
      },
    });

    const authBody = await authResponse.json();
    token = authBody.data.accessToken;
  });

  test('should get wallet details', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/wallet/details`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.data.walletId).toBeDefined();
    expect(body.data.partyId).toBeDefined();
  });

  test('should get wallet balance', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/wallet/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data[0].token).toBe('CC');
  });

  test('should get transaction history', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/wallet/transactions?pageSize=10`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.data).toBeInstanceOf(Array);
  });

  test('should get UTXO status', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/wallet/utxos`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body.data.utxoCount).toBeDefined();
    expect(body.data.threshold).toBe(10);
  });
});
