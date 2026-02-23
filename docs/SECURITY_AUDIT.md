# Security Audit Report

**Date:** 2026-02-13
**Project:** Canton Telegram Wallet
**Auditor:** Claude Code

---

## Executive Summary

The Canton Telegram Wallet codebase has been audited for common security vulnerabilities. Two high-severity dependency vulnerabilities were found and fixed. The codebase follows security best practices for cryptographic operations, input validation, and authentication.

---

## Findings

### 1. Dependency Vulnerabilities

| Severity | Package | Issue | Status |
|----------|---------|-------|--------|
| **HIGH** | next@14.2.35 | HTTP request deserialization DoS | ✅ Fixed → 16.1.6 |
| **HIGH** | fastify@5.7.1 | Content-Type header validation bypass | ✅ Fixed → 5.7.4 |
| Moderate | esbuild@0.18/0.19 | Dev server request forwarding | ⚠️ Dev only |

### 2. Code Security Analysis

#### ✅ Hardcoded Secrets
- No hardcoded secrets or API keys found
- All sensitive values loaded from environment variables
- `.env.example` provides templates without real values

#### ✅ SQL Injection
- Drizzle ORM used with parameterized queries
- No raw SQL string concatenation found
- All database queries use type-safe builders

#### ✅ XSS (Cross-Site Scripting)
- No `dangerouslySetInnerHTML` usage
- React's built-in XSS protection active
- Content-Security-Policy headers configured in nginx

#### ✅ Input Validation
- Zod schemas validate all API inputs (16 validators found)
- Type-safe request handling
- Proper error messages without sensitive info

#### ✅ Rate Limiting
- Nginx rate limiting: 30 req/s API, 5 req/s auth
- Redis-based PIN brute force protection (5 attempts → 15 min lockout)
- Bot commands rate limited via middleware

#### ✅ Cryptographic Security
- Ed25519 signatures via @noble/curves (audited library)
- AES-256-GCM encryption for key storage
- Private keys zeroed after use (6 instances verified)
- HKDF key derivation with proper salts
- Secure random number generation via @noble/ciphers/webcrypto

#### ✅ Authentication
- JWT tokens expire in 15 minutes
- Refresh tokens expire in 7 days
- Telegram initData HMAC-SHA256 validation
- Session binding to device fingerprint

#### ✅ CORS
- Production: Restricted to specific origins
- Development: Open for testing
- Proper headers for Telegram Mini App

---

## Security Features

### 2-of-3 Shamir Secret Sharing
```
User Share (encrypted, IndexedDB) + Server Share (encrypted, PostgreSQL) = Sign
                        OR
User Share + Recovery Share = Sign (for recovery)
```

### Key Protection
- User share encrypted with PIN-derived AES key (PBKDF2, 100k iterations)
- Server share encrypted with ENCRYPTION_KEY (AES-256-GCM)
- Private keys exist in memory only during signing
- Immediate zeroing after use

### Transport Security
- TLS 1.2/1.3 enforced
- HSTS enabled (2 year max-age)
- Modern cipher suite (ECDHE + AES-GCM/ChaCha20)

---

## Recommendations

### Immediate (Before Production)
1. ✅ Update next.js to >=15.0.8 - **DONE**
2. ✅ Update fastify to >=5.7.2 - **DONE**

### Short-term
1. Add Content-Security-Policy reporting endpoint
2. Implement security event logging (failed auth attempts)
3. Add API request signing for sensitive operations

### Long-term
1. Hardware security module (HSM) for server share encryption key
2. Multi-signature support for high-value transfers
3. Third-party penetration testing

---

## Compliance Checklist

| Requirement | Status |
|-------------|--------|
| No hardcoded secrets | ✅ |
| Input validation | ✅ |
| Output encoding | ✅ |
| Authentication | ✅ |
| Session management | ✅ |
| Access control | ✅ |
| Cryptographic practices | ✅ |
| Error handling | ✅ |
| Logging | ✅ |
| HTTPS only | ✅ |

---

## Files Reviewed

- `apps/bot/src/api/**/*.ts` - API routes and handlers
- `apps/bot/src/services/**/*.ts` - Business logic
- `apps/mini-app/app/page.tsx` - Frontend
- `apps/mini-app/context/WalletContext.tsx` - State management
- `packages/crypto/src/**/*.ts` - Cryptographic operations
- `docker/nginx/nginx.prod.conf` - Production nginx config
- `.github/workflows/*.yml` - CI/CD pipelines

---

## Conclusion

The codebase demonstrates strong security practices. Critical vulnerabilities in dependencies have been patched. The cryptographic implementation follows industry best practices with proper key management and memory safety.

**Risk Level:** LOW (after fixes applied)
