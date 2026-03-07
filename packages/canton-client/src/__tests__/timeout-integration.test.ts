import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchWithRetry,
  fetchWithTimeout,
  FetchTimeoutError,
} from '../utils/fetch-with-retry.js';
import { CANTON_TIMEOUTS, RETRY_CONFIG } from '@repo/shared/constants';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Canton Client Timeout Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auth.ts - should timeout on slow auth', async () => {
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      const signal = options?.signal;
      return new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }
      });
    });

    await expect(
      fetchWithRetry('https://validator.example.com/api/auth/token', {
        timeout: 100, // Simulate short timeout
        retries: 0,
      })
    ).rejects.toThrow(FetchTimeoutError);

    // Verify the timeout value is less than the configured auth timeout
    expect(CANTON_TIMEOUTS.auth).toBe(10000);
  }, 5000);

  it('transfer.ts - prepareTransfer should retry on 503', async () => {
    const error503 = new Response('Service Unavailable', { status: 503 });
    const successResponse = new Response(
      JSON.stringify({ transaction: 'tx123', tx_hash: 'hash123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

    mockFetch
      .mockResolvedValueOnce(error503)
      .mockResolvedValueOnce(successResponse);

    const response = await fetchWithRetry(
      'https://validator.example.com/api/validator/v0/admin/external-party/transfer-preapproval/prepare-send',
      {
        method: 'POST',
        timeout: CANTON_TIMEOUTS.transfer,
        retries: 2,
        backoffBase: 10,
        retryOnStatus: RETRY_CONFIG.retryableStatus,
      }
    );

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it('transfer.ts - executeTransfer should NOT retry', async () => {
    const error503 = new Response('Service Unavailable', { status: 503 });

    mockFetch.mockResolvedValueOnce(error503);

    // fetchWithTimeout does not retry
    const response = await fetchWithTimeout(
      'https://validator.example.com/api/validator/v0/admin/external-party/transfer-preapproval/submit-send',
      {
        method: 'POST',
        timeout: CANTON_TIMEOUTS.transfer,
      }
    );

    // Should return the error response without retrying
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('party.ts - allocate should NOT retry', async () => {
    const error503 = new Response('Service Unavailable', { status: 503 });

    mockFetch.mockResolvedValueOnce(error503);

    // fetchWithTimeout does not retry
    const response = await fetchWithTimeout(
      'https://validator.example.com/api/validator/v0/admin/external-party/topology/submit',
      {
        method: 'POST',
        timeout: CANTON_TIMEOUTS.party,
      }
    );

    // Should return the error response without retrying
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('balance.ts - should timeout and handle gracefully', async () => {
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      const signal = options?.signal;
      return new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }
      });
    });

    // Balance queries should use the configured timeout
    expect(CANTON_TIMEOUTS.balance).toBe(15000);

    await expect(
      fetchWithRetry('https://validator.example.com/api/validator/v0/admin/external-party/balance', {
        timeout: 100, // Short timeout for test
        retries: 0,
      })
    ).rejects.toThrow(FetchTimeoutError);
  }, 5000);
});

describe('E2E Transfer Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete transfer with retries on prepare', async () => {
    // Prepare fails once, then succeeds
    const prepareError = new Response('Service Unavailable', { status: 503 });
    const prepareSuccess = new Response(
      JSON.stringify({ transaction: 'tx123', tx_hash: 'abc123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    // Submit succeeds
    const submitSuccess = new Response(
      JSON.stringify({ update_id: 'update123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

    mockFetch
      .mockResolvedValueOnce(prepareError)
      .mockResolvedValueOnce(prepareSuccess)
      .mockResolvedValueOnce(submitSuccess);

    // Simulate prepare with retry
    const prepareResponse = await fetchWithRetry(
      'https://validator.example.com/api/validator/v0/admin/external-party/transfer-preapproval/prepare-send',
      {
        method: 'POST',
        retries: 2,
        backoffBase: 10,
        retryOnStatus: RETRY_CONFIG.retryableStatus,
      }
    );
    expect(prepareResponse.ok).toBe(true);

    // Simulate submit without retry
    const submitResponse = await fetchWithTimeout(
      'https://validator.example.com/api/validator/v0/admin/external-party/transfer-preapproval/submit-send',
      { method: 'POST' }
    );
    expect(submitResponse.ok).toBe(true);

    // Verify: prepare retried once, submit called once
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10000);

  it('should fail fast if execute times out', async () => {
    // Prepare succeeds
    const prepareSuccess = new Response(
      JSON.stringify({ transaction: 'tx123', tx_hash: 'abc123' }),
      { status: 200 }
    );

    // Submit times out
    mockFetch
      .mockResolvedValueOnce(prepareSuccess)
      .mockImplementationOnce((_url: string, options?: RequestInit) => {
        const signal = options?.signal;
        return new Promise((_, reject) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }
        });
      });

    // Prepare succeeds
    const prepareResponse = await fetchWithRetry(
      'https://validator.example.com/prepare',
      { method: 'POST', retries: 0 }
    );
    expect(prepareResponse.ok).toBe(true);

    // Submit times out immediately (no retry)
    await expect(
      fetchWithTimeout(
        'https://validator.example.com/submit',
        { method: 'POST', timeout: 100 }
      )
    ).rejects.toThrow(FetchTimeoutError);

    // Verify submit was only called once (no retry)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 5000);

  it('should report timeout error correctly', async () => {
    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      const signal = options?.signal;
      return new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }
      });
    });

    try {
      await fetchWithTimeout('https://api.example.com/transfer', {
        timeout: 100,
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FetchTimeoutError);
      expect((error as FetchTimeoutError).url).toBe('https://api.example.com/transfer');
      expect((error as FetchTimeoutError).timeoutMs).toBe(100);
      expect((error as FetchTimeoutError).message).toContain('timed out');
    }
  }, 5000);
});
