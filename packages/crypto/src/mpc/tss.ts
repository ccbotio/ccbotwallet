import { randomBytes } from '@noble/ciphers/webcrypto';
import { ed25519GetPublicKey, ed25519Sign, ed25519Verify } from '../signing.js';
import {
  reconstructSecretSafe,
  generate2of3Shares,
  MAX_SECRET,
  type Share,
} from './shamir.js';

/**
 * Securely zero a Uint8Array in memory.
 * Uses volatile-like pattern to prevent compiler optimizations from removing the zeroing.
 */
export function secureZero(buffer: Uint8Array): void {
  // Fill with zeros
  buffer.fill(0);
  // Additional volatile-like write to prevent optimization removal
  // Reading after write makes it harder for optimizers to eliminate
  if (buffer.length > 0 && buffer[0] !== 0) {
    buffer[0] = 0;
  }
}

/**
 * Securely zero a hex string by overwriting with zeros.
 * Note: JavaScript strings are immutable, so we can only zero the intermediate buffers.
 * This function provides a wrapper that tracks usage and warns if the hex is used after disposal.
 *
 * IMPORTANT: In JavaScript, strings cannot be truly zeroed from memory.
 * The best practice is to minimize the lifetime of hex string variables and
 * avoid storing them in long-lived scopes.
 */
export interface SecureHex {
  /** Get the hex value. Throws if already disposed. */
  readonly value: string;
  /** Mark as disposed. The hex value should no longer be accessed. */
  dispose(): void;
  /** Check if disposed */
  readonly isDisposed: boolean;
}

/**
 * Create a secure hex wrapper that tracks disposal.
 * Note: This does NOT actually zero the string (impossible in JS), but helps
 * track usage and catch bugs where hex strings are used after they should be disposed.
 */
export function createSecureHex(hex: string): SecureHex {
  let disposed = false;
  return {
    get value(): string {
      if (disposed) {
        throw new Error('Attempted to access disposed secure hex value');
      }
      return hex;
    },
    dispose(): void {
      disposed = true;
    },
    get isDisposed(): boolean {
      return disposed;
    },
  };
}

/**
 * Reconstruct Ed25519 private key from Shamir shares.
 * SECURITY: Caller MUST call secureZero() on the returned Uint8Array after use.
 * Consider using signWithShares() instead which handles cleanup automatically.
 *
 * @throws Error if reconstructed value exceeds 256 bits (indicates corrupted shares)
 */
export function reconstructEd25519Key(shares: Share[]): Uint8Array {
  // Use safe reconstruction that validates the result fits in 256 bits
  const secretBigInt = reconstructSecretSafe(shares);
  return bigintToBytes32Secure(secretBigInt);
}

/**
 * Reconstruct Ed25519 private key from shares and derive the public key.
 * SECURITY: Caller MUST call secureZero() on privateKey after use.
 * Consider using signWithShares() instead which handles cleanup automatically.
 */
export function reconstructEd25519KeyPair(shares: Share[]): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const privateKey = reconstructEd25519Key(shares);
  const publicKey = ed25519GetPublicKey(privateKey);

  return { privateKey, publicKey };
}

/**
 * Execute a signing operation with automatic key cleanup.
 * This is the RECOMMENDED way to sign with reconstructed keys.
 *
 * @param shares - Shamir shares to reconstruct the key from
 * @param operation - Async function that receives the private key hex and performs signing
 * @returns The result of the operation
 *
 * SECURITY: The private key is automatically zeroed after the operation completes,
 * regardless of success or failure.
 */
export async function withReconstructedKey<T>(
  shares: Share[],
  operation: (privateKeyHex: string) => Promise<T>
): Promise<T> {
  const privateKey = reconstructEd25519Key(shares);
  const secureHex = createSecureHex(bytesToHex(privateKey));

  try {
    return await operation(secureHex.value);
  } finally {
    // Zero the Uint8Array (actually effective)
    secureZero(privateKey);
    // Mark hex as disposed (helps catch bugs, but can't actually zero the string)
    secureHex.dispose();
  }
}

/**
 * Synchronous version of withReconstructedKey for operations that don't need async.
 */
export function withReconstructedKeySync<T>(
  shares: Share[],
  operation: (privateKeyHex: string) => T
): T {
  const privateKey = reconstructEd25519Key(shares);
  const secureHex = createSecureHex(bytesToHex(privateKey));

  try {
    return operation(secureHex.value);
  } finally {
    // Zero the Uint8Array (actually effective)
    secureZero(privateKey);
    // Mark hex as disposed (helps catch bugs, but can't actually zero the string)
    secureHex.dispose();
  }
}

/**
 * Sign a message using Ed25519 with key reconstructed from Shamir shares.
 * SECURITY: Zeros the private key from memory after signing using secure zeroing.
 */
export function signWithEd25519Shares(
  message: Uint8Array,
  shares: Share[]
): { signature: Uint8Array; publicKey: Uint8Array } {
  const { privateKey, publicKey } = reconstructEd25519KeyPair(shares);

  try {
    const signature = ed25519Sign(message, privateKey);
    return { signature, publicKey };
  } finally {
    // Securely zero private key memory
    secureZero(privateKey);
  }
}

/**
 * Sign a Canton transaction hash using Ed25519 with key reconstructed from shares.
 * Returns hex-encoded signature + public key for submission.
 */
export function signCantonHash(
  txHash: Uint8Array,
  shares: Share[]
): { signatureHex: string; publicKeyHex: string } {
  const { signature, publicKey } = signWithEd25519Shares(txHash, shares);

  return {
    signatureHex: bytesToHex(signature),
    publicKeyHex: bytesToHex(publicKey),
  };
}

/**
 * Verify a Canton signature produced by TSS signing.
 */
export function verifyCantonSignature(
  txHash: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return ed25519Verify(txHash, signature, publicKey);
}

/**
 * Generate an Ed25519 key pair and split into 2-of-3 Shamir shares.
 * Returns shares + public key.
 * SECURITY: Private key is securely zeroed after splitting.
 */
export function generateEd25519TSSKeyPair(): {
  publicKey: Uint8Array;
  userShare: Share;
  serverShare: Share;
  recoveryShare: Share;
} {
  const privateKey = randomBytes(32);
  const publicKey = ed25519GetPublicKey(privateKey);
  const { userShare, serverShare, recoveryShare } = generate2of3Shares(privateKey);

  // Securely zero the original private key
  secureZero(privateKey);

  return { publicKey, userShare, serverShare, recoveryShare };
}

// --- Helpers ---

/**
 * Convert bigint to 32-byte Uint8Array using secure method.
 * SECURITY: Avoids creating intermediate hex string that cannot be zeroed.
 * Uses direct byte manipulation instead.
 *
 * @throws Error if the value exceeds 256 bits (cannot fit in 32 bytes)
 */
function bigintToBytes32Secure(n: bigint): Uint8Array {
  // CRITICAL: Validate the value fits in 32 bytes before conversion
  // This prevents silent truncation of values >= 2^256
  if (n > MAX_SECRET) {
    throw new Error(
      'Value exceeds 256 bits and cannot be safely converted to 32 bytes. ' +
        'This indicates corrupted or invalid data.'
    );
  }

  if (n < 0n) {
    throw new Error('Cannot convert negative bigint to bytes');
  }

  const bytes = new Uint8Array(32);
  let value = n;

  // Convert bigint to bytes directly (big-endian)
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value = value >> 8n;
  }

  return bytes;
}

/**
 * Convert bytes to hex string.
 * SECURITY WARNING: The returned string cannot be zeroed in JavaScript.
 * Minimize the lifetime of hex string variables.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
