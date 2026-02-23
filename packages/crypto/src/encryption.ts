import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

const IV_LENGTH = 12;

export function encrypt(plaintext: string, key: Uint8Array): string {
  const iv = randomBytes(IV_LENGTH);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const aes = gcm(key, iv);
  const ciphertext = aes.encrypt(plaintextBytes);

  const result = new Uint8Array(iv.length + ciphertext.length);
  result.set(iv);
  result.set(ciphertext, iv.length);

  return bytesToHex(result);
}

export function decrypt(encrypted: string, key: Uint8Array): string {
  const data = hexToBytes(encrypted);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const aes = gcm(key, iv);
  const plaintext = aes.decrypt(ciphertext);

  return new TextDecoder().decode(plaintext);
}

export function generateKey(): Uint8Array {
  return randomBytes(32);
}

export function keyFromHex(hex: string): Uint8Array {
  return hexToBytes(hex);
}

export function keyToHex(key: Uint8Array): string {
  return bytesToHex(key);
}
