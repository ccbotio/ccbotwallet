import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchWithRetry,
  fetchWithTimeout,
  FetchTimeoutError,
  FetchRetryExhaustedError,
} from '../utils/fetch-with-retry.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return response on success', async () => {
    const mockResponse = new Response(JSON.stringify({ data: 'test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const response = await fetchWithRetry('https://api.example.com/test');

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should timeout after configured duration', async () => {
    // Make fetch abort when signal is aborted
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
      fetchWithRetry('https://api.example.com/slow', {
        timeout: 100, // Very short timeout
        retries: 0, // No retries to test timeout directly
      })
    ).rejects.toThrow(FetchTimeoutError);
  }, 5000);

  it('should retry on network failure with backoff', async () => {
    const networkError = new TypeError('Failed to fetch');
    const mockResponse = new Response('OK', { status: 200 });

    mockFetch
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(mockResponse);

    const onRetry = vi.fn();
    const response = await fetchWithRetry('https://api.example.com/test', {
      retries: 3,
      backoffBase: 10, // Very short for tests
      onRetry,
    });

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    // First retry should have delay >= base
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), expect.any(Number));
  }, 5000);

  it('should retry on 503 and succeed on 3rd attempt', async () => {
    const errorResponse1 = new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    const errorResponse2 = new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });

    mockFetch
      .mockResolvedValueOnce(errorResponse1)
      .mockResolvedValueOnce(errorResponse2)
      .mockResolvedValueOnce(successResponse);

    const onRetry = vi.fn();
    const response = await fetchWithRetry('https://api.example.com/test', {
      retries: 3,
      backoffBase: 10, // Very short for tests
      onRetry,
    });

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  }, 5000);

  it('should NOT retry on 400/401/404', async () => {
    const errorResponses = [
      { status: 400, statusText: 'Bad Request' },
      { status: 401, statusText: 'Unauthorized' },
      { status: 404, statusText: 'Not Found' },
    ];

    for (const error of errorResponses) {
      vi.clearAllMocks();
      const errorResponse = new Response('Error', error);
      mockFetch.mockResolvedValueOnce(errorResponse);

      const onRetry = vi.fn();
      const response = await fetchWithRetry('https://api.example.com/test', {
        retries: 3,
        onRetry,
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(error.status);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    }
  });

  it('should call onRetry callback with attempt info', async () => {
    const errorResponse = new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    const successResponse = new Response('OK', { status: 200 });

    mockFetch
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse);

    const onRetry = vi.fn();
    await fetchWithRetry('https://api.example.com/test', {
      retries: 2,
      backoffBase: 10,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      1, // attempt number
      expect.any(Error), // the error
      expect.any(Number) // delay in ms
    );
  }, 5000);

  it('should throw after max retries exceeded', async () => {
    const errorResponse = new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });

    mockFetch.mockResolvedValue(errorResponse);

    const onRetry = vi.fn();

    await expect(
      fetchWithRetry('https://api.example.com/test', {
        retries: 2,
        backoffBase: 10,
        onRetry,
      })
    ).rejects.toThrow(FetchRetryExhaustedError);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  }, 5000);

  it('should respect external abort signal', async () => {
    const controller = new AbortController();

    // Abort before making the request
    controller.abort();

    mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
      const signal = options?.signal;
      return new Promise((_, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }
      });
    });

    await expect(
      fetchWithRetry('https://api.example.com/test', {
        signal: controller.signal,
        retries: 3,
      })
    ).rejects.toThrow(DOMException);

    // Should not retry when externally aborted
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should use exponential backoff with jitter', async () => {
    const errorResponse = new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    const successResponse = new Response('OK', { status: 200 });

    mockFetch
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse);

    const delays: number[] = [];
    const onRetry = vi.fn((_attempt, _error, delay) => {
      delays.push(delay);
    });

    await fetchWithRetry('https://api.example.com/test', {
      retries: 3,
      backoffBase: 100,
      backoffMax: 10000,
      onRetry,
    });

    // First retry should be ~100ms (base * 2^0)
    expect(delays[0]).toBeGreaterThanOrEqual(75); // 100 - 25% jitter
    expect(delays[0]).toBeLessThanOrEqual(125); // 100 + 25% jitter

    // Second retry should be ~200ms (base * 2^1)
    expect(delays[1]).toBeGreaterThanOrEqual(150); // 200 - 25% jitter
    expect(delays[1]).toBeLessThanOrEqual(250); // 200 + 25% jitter
  }, 10000);
});

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return response on success', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const response = await fetchWithTimeout('https://api.example.com/test');

    expect(response.ok).toBe(true);
  });

  it('should timeout without retry', async () => {
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
      fetchWithTimeout('https://api.example.com/slow', {
        timeout: 100, // Very short timeout
      })
    ).rejects.toThrow(FetchTimeoutError);

    expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
  }, 5000);

  it('should not retry on error status', async () => {
    const errorResponse = new Response('Error', { status: 503 });
    mockFetch.mockResolvedValueOnce(errorResponse);

    const response = await fetchWithTimeout('https://api.example.com/test');

    // Should return error response without retry
    expect(response.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
