import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const KEY_INFO = 'canton-wallet-v1';
const ED25519_KEY_INFO = 'canton-wallet-ed25519-v1';

export interface DerivedKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function deriveKeyFromTelegramId(
  telegramId: string,
  appSecret: string,
  salt?: Uint8Array
): Uint8Array {
  const input = `${telegramId}:${appSecret}`;
  const inputBytes = new TextEncoder().encode(input);
  const actualSalt = salt ?? new Uint8Array(32);

  return hkdf(sha256, inputBytes, actualSalt, KEY_INFO, 32);
}

/**
 * Derive an Ed25519-compatible private key from Telegram ID and app secret.
 * Uses HKDF with Ed25519-specific info string.
 * The output is a raw 32-byte key suitable for Ed25519 signing.
 * (Ed25519 internally hashes the private key, so no clamping needed on the input.)
 */
export function deriveEd25519PrivateKey(
  telegramId: string,
  appSecret: string,
  salt?: Uint8Array
): Uint8Array {
  const input = `${telegramId}:${appSecret}`;
  const inputBytes = new TextEncoder().encode(input);
  const actualSalt = salt ?? new Uint8Array(32);

  return hkdf(sha256, inputBytes, actualSalt, ED25519_KEY_INFO, 32);
}

/**
 * Derive an Ed25519 key pair from a PIN + additional entropy.
 * Used for client-side key generation during onboarding.
 */
export function deriveEd25519KeyFromPin(
  pin: string,
  entropy: Uint8Array,
  salt?: Uint8Array
): Uint8Array {
  const input = new TextEncoder().encode(pin);
  const combined = new Uint8Array(input.length + entropy.length);
  combined.set(input);
  combined.set(entropy, input.length);
  const actualSalt = salt ?? new Uint8Array(32);

  return hkdf(sha256, combined, actualSalt, ED25519_KEY_INFO, 32);
}

export function derivePartyId(telegramId: string, appSecret: string): string {
  const key = deriveKeyFromTelegramId(telegramId, appSecret);
  const hash = sha256(key);
  return `party-${bytesToHex(hash).slice(0, 32)}`;
}

export function hashSecret(secret: string): string {
  const bytes = new TextEncoder().encode(secret);
  return bytesToHex(sha256(bytes));
}

/**
 * Derive an AES encryption key from a PIN for encrypting key shares.
 * Uses HKDF with PIN-specific info string and provided salt.
 */
export function deriveEncryptionKeyFromPin(
  pin: string,
  salt: Uint8Array
): Uint8Array {
  const pinBytes = new TextEncoder().encode(pin);
  return hkdf(sha256, pinBytes, salt, 'canton-wallet-pin-encryption-v1', 32);
}

export { bytesToHex, hexToBytes };
