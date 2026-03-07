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

describe('Network Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('timeout scenarios', () => {
    it('should timeout on DNS resolution failure', async () => {
      // Simulate DNS failure by making fetch hang
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
        fetchWithRetry('https://invalid-domain-xyz.example.com', {
          timeout: 100,
          retries: 0,
        })
      ).rejects.toThrow(FetchTimeoutError);
    }, 5000);

    it('should timeout on connection refused', async () => {
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
        fetchWithTimeout('http://localhost:99999', {
          timeout: 100,
        })
      ).rejects.toThrow(FetchTimeoutError);
    }, 5000);

    it('should timeout on slow response', async () => {
      mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
        const signal = options?.signal;
        return new Promise((resolve, reject) => {
          // Slow response - 5 seconds
          const timeoutId = setTimeout(() => {
            resolve(new Response('OK', { status: 200 }));
          }, 5000);

          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              reject(new DOMException('The operation was aborted', 'AbortError'));
            });
          }
        });
      });

      await expect(
        fetchWithTimeout('https://api.example.com/slow', {
          timeout: 100, // Will timeout before response
        })
      ).rejects.toThrow(FetchTimeoutError);
    }, 5000);
  });

  describe('retry scenarios', () => {
    it('should retry on temporary network failure', async () => {
      const networkError = new TypeError('Failed to fetch');
      const successResponse = new Response('OK', { status: 200 });

      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(successResponse);

      const response = await fetchWithRetry('https://api.example.com', {
        retries: 2,
        backoffBase: 10,
      });

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 5000);

    it('should use exponential backoff', async () => {
      const error503 = new Response('Service Unavailable', { status: 503 });
      const successResponse = new Response('OK', { status: 200 });

      mockFetch
        .mockResolvedValueOnce(error503)
        .mockResolvedValueOnce(error503)
        .mockResolvedValueOnce(successResponse);

      const delays: number[] = [];
      const onRetry = vi.fn((_attempt, _error, delay) => {
        delays.push(delay);
      });

      await fetchWithRetry('https://api.example.com', {
        retries: 3,
        backoffBase: 50,
        onRetry,
      });

      expect(delays.length).toBe(2);
      // Second delay should be roughly 2x first (exponential backoff)
      expect(delays[1]).toBeGreaterThan(delays[0]! * 1.5);
    }, 10000);

    it('should respect maxRetries limit', async () => {
      const error503 = new Response('Service Unavailable', { status: 503 });
      mockFetch.mockResolvedValue(error503);

      await expect(
        fetchWithRetry('https://api.example.com', {
          retries: 2,
          backoffBase: 10,
        })
      ).rejects.toThrow(FetchRetryExhaustedError);

      // Initial + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 5000);
  });

  describe('error scenarios', () => {
    it('should handle partial response / connection reset', async () => {
      const connectionError = new Error('Connection reset by peer');
      const successResponse = new Response('OK', { status: 200 });

      mockFetch
        .mockRejectedValueOnce(connectionError)
        .mockResolvedValueOnce(successResponse);

      const response = await fetchWithRetry('https://api.example.com', {
        retries: 2,
        backoffBase: 10,
      });

      expect(response.ok).toBe(true);
    }, 5000);

    it('should handle rate limit (429) with retry', async () => {
      const rateLimitResponse = new Response('Too Many Requests', {
        status: 429,
        statusText: 'Too Many Requests',
      });
      const successResponse = new Response('OK', { status: 200 });

      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);

      const response = await fetchWithRetry('https://api.example.com', {
        retries: 2,
        backoffBase: 10,
        retryOnStatus: [429, 503],
      });

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 5000);

    it('should NOT retry on client errors (4xx except 408, 429)', async () => {
      const clientErrors = [
        { status: 400, statusText: 'Bad Request' },
        { status: 401, statusText: 'Unauthorized' },
        { status: 403, statusText: 'Forbidden' },
        { status: 404, statusText: 'Not Found' },
        { status: 422, statusText: 'Unprocessable Entity' },
      ];

      for (const error of clientErrors) {
        vi.clearAllMocks();
        mockFetch.mockResolvedValueOnce(new Response('Error', error));

        const response = await fetchWithRetry('https://api.example.com', {
          retries: 3,
          backoffBase: 10,
        });

        // Should return immediately without retry
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(error.status);
      }
    });
  });
});
