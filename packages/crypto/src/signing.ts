import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// --- secp256k1 (legacy, backward compat) ---

export interface Signature {
  r: string;
  s: string;
  recovery: number;
}

export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privateKey, true);
}

export function signMessage(message: string, privateKey: Uint8Array): Signature {
  const messageBytes = new TextEncoder().encode(message);
  const hash = sha256(messageBytes);
  const sig = secp256k1.sign(hash, privateKey);

  return {
    r: bytesToHex(sig.toCompactRawBytes().slice(0, 32)),
    s: bytesToHex(sig.toCompactRawBytes().slice(32)),
    recovery: sig.recovery,
  };
}

export function verifySignature(
  message: string,
  signature: Signature,
  publicKey: Uint8Array
): boolean {
  const messageBytes = new TextEncoder().encode(message);
  const hash = sha256(messageBytes);
  const sigBytes = new Uint8Array([...hexToBytes(signature.r), ...hexToBytes(signature.s)]);

  return secp256k1.verify(sigBytes, hash, publicKey);
}

export function signTransaction(txPayload: Record<string, unknown>, privateKey: Uint8Array): string {
  const message = JSON.stringify(txPayload);
  const sig = signMessage(message, privateKey);
  return `${sig.r}${sig.s}${sig.recovery.toString(16).padStart(2, '0')}`;
}

// --- Ed25519 (Canton Network) ---

/**
 * Get Ed25519 public key from private key (32 bytes → 32 bytes).
 */
export function ed25519GetPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

/**
 * Sign a message with Ed25519. Returns 64-byte signature.
 */
export function ed25519Sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/**
 * Verify an Ed25519 signature.
 */
export function ed25519Verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return ed25519.verify(signature, message, publicKey);
}

/**
 * Sign a hash (e.g., Canton transaction hash) with Ed25519.
 * The hash should be the raw bytes to sign.
 */
export function ed25519SignHash(hash: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(hash, privateKey);
}

/**
 * Verify an Ed25519 signature over a hash.
 */
export function ed25519VerifyHash(
  hash: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return ed25519.verify(signature, hash, publicKey);
}
