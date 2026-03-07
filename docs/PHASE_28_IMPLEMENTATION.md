# Phase 28: Mainnet Production Hardening

**Status:** ✅ Completed
**Date:** March 2026
**Author:** Claude (Anthropic)

---

## Executive Summary

Phase 28 implements production-grade network resilience for the Canton Client SDK. This includes timeout handling, intelligent retry logic with exponential backoff, and critical idempotency safeguards to prevent double-spend and duplicate party allocation issues.

**Key Metrics:**
- 29 new tests added
- 6 Canton Client modules hardened
- 0 breaking changes

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Implementation Details](#implementation-details)
4. [Idempotency Rules](#idempotency-rules)
5. [Configuration](#configuration)
6. [Testing](#testing)
7. [Security Fixes](#security-fixes)
8. [Migration Guide](#migration-guide)

---

## Overview

### Problem Statement

The Canton Client SDK had 18+ fetch calls operating without timeout or retry mechanisms. This created several risks:

1. **Hanging requests** - No timeout meant requests could hang indefinitely
2. **Transient failures** - Network blips caused immediate failures instead of recovery
3. **No backoff** - Retry storms could overwhelm the validator during recovery
4. **Mock data in frontend** - Hardcoded values reduced mainnet readiness

### Solution

Implemented a comprehensive fetch utility with:
- Configurable timeouts per operation type
- Exponential backoff with jitter
- Selective retry based on HTTP status codes
- Special handling for non-idempotent operations

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Canton Client SDK                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   auth.ts    │  │ transfer.ts  │  │   party.ts   │       │
│  │  (retry ✓)   │  │ (mixed)      │  │  (mixed)     │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │                │
│  ┌──────┴─────────────────┴─────────────────┴───────┐       │
│  │              fetch-with-retry.ts                  │       │
│  │  ┌─────────────────┐  ┌─────────────────────┐    │       │
│  │  │ fetchWithRetry  │  │  fetchWithTimeout   │    │       │
│  │  │ (full retry)    │  │  (timeout only)     │    │       │
│  │  └─────────────────┘  └─────────────────────┘    │       │
│  └───────────────────────────────────────────────────┘       │
│                           │                                  │
│  ┌────────────────────────┴─────────────────────────┐       │
│  │           @repo/shared/constants                  │       │
│  │  CANTON_TIMEOUTS | RETRY_CONFIG | NETWORK_FEES   │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 28.1: Core Infrastructure

#### New Files Created

| File | Purpose |
|------|---------|
| `packages/canton-client/src/utils/fetch-with-retry.ts` | Fetch utility with timeout/retry |
| `packages/canton-client/src/utils/index.ts` | Module exports |
| `packages/canton-client/vitest.config.ts` | Test configuration |
| `packages/canton-client/src/__tests__/fetch-with-retry.test.ts` | Unit tests |
| `packages/canton-client/src/__tests__/network-resilience.test.ts` | Integration tests |
| `packages/canton-client/src/__tests__/timeout-integration.test.ts` | E2E tests |

#### fetchWithRetry API

```typescript
interface FetchWithRetryOptions extends RequestInit {
  timeout?: number;           // Default: 30000ms
  retries?: number;           // Default: 3
  backoffBase?: number;       // Default: 1000ms
  backoffMax?: number;        // Default: 10000ms
  retryOnStatus?: number[];   // Default: [408, 429, 500, 502, 503, 504]
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

// Full retry with exponential backoff
async function fetchWithRetry(url: string, options?: FetchWithRetryOptions): Promise<Response>

// Timeout only - NO retry (for non-idempotent operations)
async function fetchWithTimeout(url: string, options?: Omit<...>): Promise<Response>
```

#### Custom Error Types

```typescript
class FetchTimeoutError extends Error {
  url: string;
  timeoutMs: number;
}

class FetchRetryExhaustedError extends Error {
  url: string;
  attempts: number;
  lastError: Error;
}
```

### 28.2: Canton Client Hardening

#### Files Modified

| File | Changes |
|------|---------|
| `auth.ts` | Added retry for token refresh |
| `transfer.ts` | Prepare: retry ✓, Execute: NO retry |
| `party.ts` | Generate: retry ✓, Submit: NO retry |
| `preapproval.ts` | Prepare: retry ✓, Execute: NO retry |
| `balance.ts` | Balance queries: retry ✓, Merge: limited retry |
| `ledger-api/index.ts` | Queries: retry ✓, Create/Exercise: NO retry |

### 28.3: Frontend Updates

#### Constants Migration

```typescript
// Before (hardcoded in page.tsx)
const ESTIMATED_NETWORK_FEE = 0.001;

// After (from shared constants)
import { NETWORK_FEES } from "@repo/shared/constants";
const estimatedNetworkFee = parseFloat(NETWORK_FEES.estimatedTransferFee);
```

---

## Idempotency Rules

### Critical Safety Matrix

| Operation | Module | Retry Safe | Risk if Retried |
|-----------|--------|------------|-----------------|
| `refreshToken` | auth.ts | ✅ Yes | None |
| `prepare-send` | transfer.ts | ✅ Yes | None - returns same hash |
| `submit-send` | transfer.ts | ❌ **NO** | Double-spend |
| `prepareTransfer` | transfer.ts | ✅ Yes | None |
| `executeTransfer` | transfer.ts | ❌ **NO** | Double-spend |
| `getTransferNonce` | transfer.ts | ✅ Yes | None - read only |
| `getTransferHistory` | transfer.ts | ✅ Yes | None - read only |
| `generateTopology` | party.ts | ✅ Yes | None |
| `submitTopology` | party.ts | ❌ **NO** | Duplicate party |
| `createProposal` | party.ts | ✅ Yes | Idempotent |
| `prepareAccept` | party.ts | ✅ Yes | None |
| `submitAccept` | party.ts | ❌ **NO** | Duplicate contracts |
| `preparePreapproval` | preapproval.ts | ✅ Yes | None |
| `executePreapproval` | preapproval.ts | ❌ **NO** | Duplicate preapproval |
| `getPreapproval` | preapproval.ts | ✅ Yes | None - read only |
| `cancelPrepare` | preapproval.ts | ✅ Yes | None |
| `cancelExecute` | preapproval.ts | ❌ **NO** | Duplicate cancel |
| `getBalance` | balance.ts | ✅ Yes | None - read only |
| `listHoldingUtxos` | balance.ts | ✅ Yes | None - read only |
| `mergeHoldingUtxos` | balance.ts | ⚠️ Limited | Partial - 1 retry max |
| `getParty` | ledger-api | ✅ Yes | None - read only |
| `createContract` | ledger-api | ❌ **NO** | Duplicate contract |
| `exerciseChoice` | ledger-api | ❌ **NO** | Duplicate exercise |
| `queryContracts` | ledger-api | ✅ Yes | None - read only |

### Implementation Pattern

```typescript
// Safe to retry - read or prepare operations
const response = await fetchWithRetry(url, {
  timeout: CANTON_TIMEOUTS.transfer,
  retries: 2,
  retryOnStatus: RETRY_CONFIG.retryableStatus,
});

// NEVER retry - mutating operations
// CRITICAL: Double-spend or duplicate risk!
const response = await fetchWithTimeout(url, {
  timeout: CANTON_TIMEOUTS.transfer,
});
```

---

## Configuration

### Timeout Values

```typescript
export const CANTON_TIMEOUTS = {
  auth: 10000,        // 10s - Token refresh should be fast
  balance: 15000,     // 15s - Balance queries
  transfer: 60000,    // 60s - Transfers (includes signing time)
  history: 30000,     // 30s - Transaction history queries
  party: 45000,       // 45s - Party creation (topology txs)
  preapproval: 30000, // 30s - Preapproval operations
  ledger: 15000,      // 15s - Ledger API queries
  default: 30000,     // 30s - Default timeout
} as const;
```

### Retry Configuration

```typescript
export const RETRY_CONFIG = {
  maxRetries: 3,
  backoffBase: 1000,      // First retry: ~1s
  backoffMax: 10000,      // Maximum delay: 10s
  retryableStatus: [408, 429, 500, 502, 503, 504],
} as const;
```

### Network Fees

```typescript
export const NETWORK_FEES = {
  estimatedTransferFee: '0.001',  // CC
} as const;

export const EXCHANGE_RATES = {
  CC_TO_USD: 10,  // TODO: Phase 29 - price oracle integration
} as const;
```

---

## Testing

### Test Suites

| Suite | Tests | Coverage |
|-------|-------|----------|
| `fetch-with-retry.test.ts` | 12 | Core utility functions |
| `network-resilience.test.ts` | 9 | Timeout, retry, error scenarios |
| `timeout-integration.test.ts` | 8 | Canton-specific integration |
| **Total** | **29** | Full coverage |

### Running Tests

```bash
cd packages/canton-client

# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Run specific suite
pnpm test -- fetch-with-retry
```

### Test Categories

#### Timeout Scenarios
- DNS resolution failure
- Connection refused
- Slow response

#### Retry Scenarios
- Temporary network failure with recovery
- Exponential backoff verification
- Max retries limit enforcement

#### Error Scenarios
- Partial response / connection reset
- Rate limiting (429)
- Client errors (400, 401, 404) - no retry

---

## Security Fixes

### .gitignore Enhancements

```gitignore
# Added patterns
*.pem
*.key
credentials.json
secrets/
.env.production.local
apps/bot/.env
apps/bot/.env.*
!apps/bot/.env.example
```

### Action Required

⚠️ **CRITICAL**: The Telegram bot token has been exposed in local .env files.

**Steps to remediate:**
1. Go to Telegram @BotFather
2. Send `/revoke` to revoke the old token
3. Send `/token` to get a new token for your bot
4. Update the token in production secrets
5. Restart the bot service

---

## Migration Guide

### For Developers

No breaking changes. Existing code continues to work. However, to benefit from new resilience features:

```typescript
// Old code (still works but no retry)
const response = await fetch(url, options);

// New code (with retry)
import { fetchWithRetry } from './utils/fetch-with-retry.js';
const response = await fetchWithRetry(url, {
  ...options,
  timeout: 30000,
  retries: 2,
});
```

### For Operations

1. Monitor for `FetchTimeoutError` and `FetchRetryExhaustedError` in logs
2. Adjust timeout values in `@repo/shared/constants` if needed
3. Consider adding Prometheus metrics for retry counts (Phase 29)

---

## Appendix

### Exponential Backoff Formula

```
delay = min(backoffBase * 2^attempt + jitter, backoffMax)

where:
  - backoffBase = 1000ms
  - backoffMax = 10000ms
  - jitter = ±25% random variance
```

### Example Retry Sequence

| Attempt | Base Delay | With Jitter | Total Wait |
|---------|------------|-------------|------------|
| 1 | 1000ms | 750-1250ms | ~1s |
| 2 | 2000ms | 1500-2500ms | ~3s |
| 3 | 4000ms | 3000-5000ms | ~7s |
| 4 (max) | 8000ms | 6000-10000ms | ~15s |

---

## References

- [Canton Network Documentation](https://docs.canton.network)
- [Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Idempotency in Distributed Systems](https://stripe.com/docs/api/idempotent_requests)
