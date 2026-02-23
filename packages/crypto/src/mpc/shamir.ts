import { randomBytes } from '@noble/ciphers/webcrypto';

// Safe prime that covers all 32-byte Ed25519 private keys (2^256 + 297)
// IMPORTANT: This prime is > 2^256, which means:
// 1. All 256-bit secrets can be encoded without reduction
// 2. Share values can be up to 257 bits (requiring 33 bytes or 66 hex chars for storage)
// 3. Reconstructed secrets are guaranteed to be < FIELD_PRIME, but we must verify < 2^256 before use
export const FIELD_PRIME = 2n ** 256n + 297n;

// Maximum value for a 256-bit (32-byte) secret
export const MAX_SECRET = 2n ** 256n - 1n;

export interface Share {
  index: number; // 1-based share index
  value: bigint;
}

export interface ShareSet {
  shares: Share[];
  threshold: number;
  totalShares: number;
}

function mod(a: bigint, p: bigint): bigint {
  return ((a % p) + p) % p;
}

function modInverse(a: bigint, p: bigint): bigint {
  let [old_r, r] = [a, p];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }

  return mod(old_s, p);
}

function randomFieldElement(): bigint {
  const bytes = randomBytes(33); // Extra byte to reduce bias
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return mod(value, FIELD_PRIME);
}

function evaluatePolynomial(coefficients: bigint[], x: bigint, prime: bigint): bigint {
  let result = 0n;
  let power = 1n;

  for (const coeff of coefficients) {
    result = mod(result + mod(coeff * power, prime), prime);
    power = mod(power * x, prime);
  }

  return result;
}

/**
 * Split a secret into n shares with threshold t using Shamir's Secret Sharing.
 * Uses FIELD_PRIME suitable for Ed25519 private keys.
 */
export function splitSecret(
  secret: bigint,
  threshold: number,
  totalShares: number
): ShareSet {
  if (threshold < 2) throw new Error('Threshold must be at least 2');
  if (totalShares < threshold) throw new Error('Total shares must be >= threshold');
  if (secret >= FIELD_PRIME) throw new Error('Secret must be less than FIELD_PRIME');

  // coefficients[0] = secret, rest are random
  const coefficients: bigint[] = [secret];
  for (let i = 1; i < threshold; i++) {
    coefficients.push(randomFieldElement());
  }

  const shares: Share[] = [];
  for (let i = 1; i <= totalShares; i++) {
    shares.push({
      index: i,
      value: evaluatePolynomial(coefficients, BigInt(i), FIELD_PRIME),
    });
  }

  return { shares, threshold, totalShares };
}

/**
 * Reconstruct the secret from t or more shares using Lagrange interpolation.
 *
 * IMPORTANT: The returned value is guaranteed to be < FIELD_PRIME, but for
 * Ed25519 keys, callers should verify the result is < 2^256 (MAX_SECRET) before
 * converting to bytes. Use reconstructSecretSafe() for automatic validation.
 */
export function reconstructSecret(shares: Share[]): bigint {
  if (shares.length < 2) throw new Error('Need at least 2 shares to reconstruct');

  let secret = 0n;

  for (let i = 0; i < shares.length; i++) {
    let numerator = 1n;
    let denominator = 1n;

    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;

      const xi = BigInt(shares[i]!.index);
      const xj = BigInt(shares[j]!.index);

      // Evaluate at x = 0
      numerator = mod(numerator * (0n - xj), FIELD_PRIME);
      denominator = mod(denominator * (xi - xj), FIELD_PRIME);
    }

    const lagrangeCoeff = mod(numerator * modInverse(denominator, FIELD_PRIME), FIELD_PRIME);
    secret = mod(secret + mod(shares[i]!.value * lagrangeCoeff, FIELD_PRIME), FIELD_PRIME);
  }

  return secret;
}

/**
 * Reconstruct the secret from shares with validation that it fits in 256 bits.
 * Use this for Ed25519 keys where the secret must be < 2^256.
 *
 * @throws Error if reconstructed value exceeds 256 bits (should never happen with valid shares)
 */
export function reconstructSecretSafe(shares: Share[]): bigint {
  const secret = reconstructSecret(shares);

  // Validate the reconstructed secret fits in 256 bits
  // This should always be true if the original secret was < 2^256,
  // but we check to catch corruption or invalid share combinations
  if (secret > MAX_SECRET) {
    throw new Error(
      'Reconstructed secret exceeds 256 bits. This indicates corrupted or invalid shares.'
    );
  }

  return secret;
}

/**
 * Generate a 2-of-3 share set for a secret key.
 * Returns { userShare, serverShare, recoveryShare }
 */
export function generate2of3Shares(secretKey: Uint8Array): {
  userShare: Share;
  serverShare: Share;
  recoveryShare: Share;
} {
  let secret = 0n;
  for (const b of secretKey) {
    secret = (secret << 8n) | BigInt(b);
  }

  const { shares } = splitSecret(secret, 2, 3);

  return {
    userShare: shares[0]!,
    serverShare: shares[1]!,
    recoveryShare: shares[2]!,
  };
}

/**
 * Convert a share value to a hex string for storage.
 *
 * NOTE: Share values can be up to FIELD_PRIME - 1, which is > 2^256.
 * This requires up to 66 hex characters (257 bits = 33 bytes).
 * We use padStart(66) to ensure consistent format.
 */
export function shareToHex(share: Share): string {
  // Share values can be up to 257 bits (FIELD_PRIME > 2^256)
  // So we need 66 hex characters (33 bytes) to store them safely
  const hex = share.value.toString(16).padStart(66, '0');
  return `${share.index.toString(16).padStart(2, '0')}${hex}`;
}

/**
 * Restore a share from hex string.
 * Handles both old 64-char format and new 66-char format for backward compatibility.
 */
export function shareFromHex(hex: string): Share {
  const index = parseInt(hex.slice(0, 2), 16);
  const valueHex = hex.slice(2);
  const value = BigInt('0x' + valueHex);

  // Validate the share value is within field bounds
  if (value >= FIELD_PRIME) {
    throw new Error('Invalid share: value exceeds FIELD_PRIME');
  }

  return { index, value };
}
