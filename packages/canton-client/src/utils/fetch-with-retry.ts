/**
 * Fetch utility with timeout and retry support for Canton Network API calls.
 * Implements exponential backoff for transient failures.
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** Request timeout in milliseconds. Default: 30000 */
  timeout?: number;
  /** Maximum retry attempts. Default: 3 */
  retries?: number;
  /** Base delay for exponential backoff in milliseconds. Default: 1000 */
  backoffBase?: number;
  /** Maximum backoff delay in milliseconds. Default: 10000 */
  backoffMax?: number;
  /** HTTP status codes that should trigger a retry. Default: [408, 429, 500, 502, 503, 504] */
  retryOnStatus?: readonly number[];
  /** Callback invoked before each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export class FetchTimeoutError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

export class FetchRetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'FetchRetryExhaustedError';
  }
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_BASE = 1000;
const DEFAULT_BACKOFF_MAX = 10000;
const DEFAULT_RETRY_STATUS = [408, 429, 500, 502, 503, 504];

/**
 * Calculate exponential backoff delay with jitter.
 */
function calculateBackoff(
  attempt: number,
  base: number,
  max: number
): number {
  // Exponential backoff: base * 2^attempt
  const exponentialDelay = base * Math.pow(2, attempt);
  // Add jitter (±25%)
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  // Cap at max
  return Math.min(exponentialDelay + jitter, max);
}

/**
 * Determine if an error is retryable.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors (connection refused, DNS failure, etc.)
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }
    // AbortError from timeout should not be retried automatically
    // but network abort errors should be
    if (error.name === 'AbortError') {
      return false;
    }
  }
  return true;
}

/**
 * Determine if an HTTP status code is retryable.
 */
function isRetryableStatus(status: number, retryOnStatus: readonly number[]): boolean {
  return retryOnStatus.includes(status);
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout, retry, and exponential backoff.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with retry configuration
 * @returns The Response object
 * @throws FetchTimeoutError if the request times out
 * @throws FetchRetryExhaustedError if all retries are exhausted
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    backoffBase = DEFAULT_BACKOFF_BASE,
    backoffMax = DEFAULT_BACKOFF_MAX,
    retryOnStatus = DEFAULT_RETRY_STATUS,
    onRetry,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  let lastError: Error = new Error('No attempts made');
  let attempt = 0;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine external signal with our timeout signal
    const combinedSignal = externalSignal
      ? combineSignals(externalSignal, controller.signal)
      : controller.signal;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      // Check if status is retryable
      if (!response.ok && isRetryableStatus(response.status, retryOnStatus)) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);

        if (attempt < retries) {
          const delay = calculateBackoff(attempt, backoffBase, backoffMax);
          onRetry?.(attempt + 1, error, delay);
          await sleep(delay);
          attempt++;
          lastError = error;
          continue;
        }

        throw new FetchRetryExhaustedError(
          `Request failed after ${attempt + 1} attempts: ${error.message}`,
          url,
          attempt + 1,
          error
        );
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Check if it was external signal or our timeout
        if (externalSignal?.aborted) {
          throw error; // External abort, don't retry
        }

        const timeoutError = new FetchTimeoutError(
          `Request timed out after ${timeout}ms`,
          url,
          timeout
        );

        if (attempt < retries) {
          const delay = calculateBackoff(attempt, backoffBase, backoffMax);
          onRetry?.(attempt + 1, timeoutError, delay);
          await sleep(delay);
          attempt++;
          lastError = timeoutError;
          continue;
        }

        throw timeoutError;
      }

      // Handle other errors
      const err = error instanceof Error ? error : new Error(String(error));

      if (isRetryableError(error) && attempt < retries) {
        const delay = calculateBackoff(attempt, backoffBase, backoffMax);
        onRetry?.(attempt + 1, err, delay);
        await sleep(delay);
        attempt++;
        lastError = err;
        continue;
      }

      // Non-retryable error or retries exhausted
      if (attempt >= retries) {
        throw new FetchRetryExhaustedError(
          `Request failed after ${attempt + 1} attempts: ${err.message}`,
          url,
          attempt + 1,
          err
        );
      }

      throw err;
    }
  }

  throw new FetchRetryExhaustedError(
    `Request failed after ${retries + 1} attempts`,
    url,
    retries + 1,
    lastError
  );
}

/**
 * Fetch with timeout only (no retry).
 * Use this for operations that MUST NOT be retried (e.g., transfers, allocations).
 */
export async function fetchWithTimeout(
  url: string,
  options: Omit<FetchWithRetryOptions, 'retries' | 'backoffBase' | 'backoffMax' | 'retryOnStatus' | 'onRetry'> = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, signal: externalSignal, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const combinedSignal = externalSignal
    ? combineSignals(externalSignal, controller.signal)
    : controller.signal;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: combinedSignal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw error;
      }
      throw new FetchTimeoutError(
        `Request timed out after ${timeout}ms`,
        url,
        timeout
      );
    }

    throw error;
  }
}

/**
 * Combine multiple abort signals into one.
 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }

    signal.addEventListener('abort', () => {
      controller.abort(signal.reason);
    }, { once: true });
  }

  return controller.signal;
}
