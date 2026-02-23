import { describe, it, expect } from 'vitest';
import {
  ed25519GetPublicKey,
  ed25519Sign,
  ed25519Verify,
  ed25519SignHash,
  ed25519VerifyHash,
} from '../signing.js';
import {
  splitSecret,
  reconstructSecret,
  reconstructSecretSafe,
  generate2of3Shares,
  shareToHex,
  shareFromHex,
  FIELD_PRIME,
  MAX_SECRET,
} from '../mpc/shamir.js';
import {
  signWithEd25519Shares,
  reconstructEd25519KeyPair,
  generateEd25519TSSKeyPair,
  verifyCantonSignature,
  signCantonHash,
} from '../mpc/tss.js';
import { deriveEd25519PrivateKey, deriveEncryptionKeyFromPin } from '../key-derivation.js';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { sha256 } from '@noble/hashes/sha256';

describe('Ed25519 Signing', () => {
  it('should generate public key from private key', () => {
    const privateKey = randomBytes(32);
    const publicKey = ed25519GetPublicKey(privateKey);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
  });

  it('should sign and verify a message', () => {
    const privateKey = randomBytes(32);
    const publicKey = ed25519GetPublicKey(privateKey);
    const message = new TextEncoder().encode('hello canton');

    const signature = ed25519Sign(message, privateKey);
    expect(signature.length).toBe(64);

    const valid = ed25519Verify(message, signature, publicKey);
    expect(valid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const privateKey = randomBytes(32);
    const publicKey = ed25519GetPublicKey(privateKey);
    const message = new TextEncoder().encode('hello canton');
    const wrongMessage = new TextEncoder().encode('wrong message');

    const signature = ed25519Sign(message, privateKey);
    const valid = ed25519Verify(wrongMessage, signature, publicKey);
    expect(valid).toBe(false);
  });

  it('should sign and verify a hash', () => {
    const privateKey = randomBytes(32);
    const publicKey = ed25519GetPublicKey(privateKey);
    const txHash = sha256(new TextEncoder().encode('transaction-data'));

    const signature = ed25519SignHash(txHash, privateKey);
    const valid = ed25519VerifyHash(txHash, signature, publicKey);
    expect(valid).toBe(true);
  });
});

describe('Shamir Secret Sharing', () => {
  it('should use correct FIELD_PRIME for Ed25519', () => {
    expect(FIELD_PRIME).toBe(2n ** 256n + 297n);
    // FIELD_PRIME must be > 2^256 to cover all 256-bit values without reduction
    expect(FIELD_PRIME).toBeGreaterThan(2n ** 256n);
  });

  it('should have correct MAX_SECRET constant', () => {
    expect(MAX_SECRET).toBe(2n ** 256n - 1n);
    // MAX_SECRET must be < FIELD_PRIME
    expect(MAX_SECRET).toBeLessThan(FIELD_PRIME);
  });

  it('should split and reconstruct a secret with 2-of-3', () => {
    const secret = 12345678901234567890n;
    const { shares } = splitSecret(secret, 2, 3);

    expect(shares.length).toBe(3);

    // Any 2 shares should reconstruct
    expect(reconstructSecret([shares[0]!, shares[1]!])).toBe(secret);
    expect(reconstructSecret([shares[0]!, shares[2]!])).toBe(secret);
    expect(reconstructSecret([shares[1]!, shares[2]!])).toBe(secret);

    // All 3 shares should also work
    expect(reconstructSecret(shares)).toBe(secret);
  });

  it('should split and reconstruct a 32-byte key', () => {
    const keyBytes = randomBytes(32);
    let secret = 0n;
    for (const b of keyBytes) {
      secret = (secret << 8n) | BigInt(b);
    }

    const { shares } = splitSecret(secret, 2, 3);
    const reconstructed = reconstructSecret([shares[0]!, shares[2]!]);
    expect(reconstructed).toBe(secret);
  });

  it('should generate 2-of-3 shares from key bytes', () => {
    const key = randomBytes(32);
    const { userShare, serverShare, recoveryShare } = generate2of3Shares(key);

    expect(userShare.index).toBe(1);
    expect(serverShare.index).toBe(2);
    expect(recoveryShare.index).toBe(3);
  });

  it('should serialize and deserialize shares', () => {
    const key = randomBytes(32);
    const { userShare } = generate2of3Shares(key);

    const hex = shareToHex(userShare);
    const restored = shareFromHex(hex);

    expect(restored.index).toBe(userShare.index);
    expect(restored.value).toBe(userShare.value);
  });

  it('should handle maximum 256-bit secret (edge case)', () => {
    // Test with the maximum possible 256-bit value
    const maxSecret = MAX_SECRET; // 2^256 - 1
    const { shares } = splitSecret(maxSecret, 2, 3);

    // Reconstruct with different share combinations
    const reconstructed1 = reconstructSecret([shares[0]!, shares[1]!]);
    const reconstructed2 = reconstructSecretSafe([shares[1]!, shares[2]!]);

    expect(reconstructed1).toBe(maxSecret);
    expect(reconstructed2).toBe(maxSecret);
  });

  it('should serialize shares with values near FIELD_PRIME correctly', () => {
    // Test that share serialization handles values > 2^256
    // Share values can be up to FIELD_PRIME - 1
    const maxSecret = MAX_SECRET;
    const { shares } = splitSecret(maxSecret, 2, 3);

    // Serialize and deserialize each share
    for (const share of shares) {
      const hex = shareToHex(share);
      const restored = shareFromHex(hex);

      expect(restored.index).toBe(share.index);
      expect(restored.value).toBe(share.value);

      // Verify hex length: 2 chars for index + 66 chars for value = 68 total
      expect(hex.length).toBe(68);
    }
  });

  it('should reject invalid share values in shareFromHex', () => {
    // Create a hex string with value >= FIELD_PRIME (invalid)
    const invalidValue = FIELD_PRIME.toString(16).padStart(66, '0');
    const invalidHex = '01' + invalidValue; // index 1, invalid value

    expect(() => shareFromHex(invalidHex)).toThrow('Invalid share: value exceeds FIELD_PRIME');
  });

  it('should handle backward compatible 64-char share format', () => {
    // Old format used 64 chars for value, test backward compatibility
    const smallSecret = 12345n;
    const { shares } = splitSecret(smallSecret, 2, 3);

    // Create old-style hex (if value fits in 64 chars)
    const share = shares[0]!;
    if (share.value < 2n ** 256n) {
      // Simulate old format (64 chars)
      const oldStyleHex =
        share.index.toString(16).padStart(2, '0') + share.value.toString(16).padStart(64, '0');

      const restored = shareFromHex(oldStyleHex);
      expect(restored.index).toBe(share.index);
      expect(restored.value).toBe(share.value);
    }
  });
});

describe('Ed25519 TSS', () => {
  it('should generate key pair → split → reconstruct from any 2 → verify signature', () => {
    const { publicKey, userShare, serverShare, recoveryShare } = generateEd25519TSSKeyPair();

    const message = new TextEncoder().encode('test canton transaction');

    // Sign with user + server shares
    const result1 = signWithEd25519Shares(message, [userShare, serverShare]);
    expect(ed25519Verify(message, result1.signature, publicKey)).toBe(true);
    expect(result1.publicKey).toEqual(publicKey);

    // Sign with user + recovery shares
    const result2 = signWithEd25519Shares(message, [userShare, recoveryShare]);
    expect(ed25519Verify(message, result2.signature, publicKey)).toBe(true);

    // Sign with server + recovery shares
    const result3 = signWithEd25519Shares(message, [serverShare, recoveryShare]);
    expect(ed25519Verify(message, result3.signature, publicKey)).toBe(true);
  });

  it('should sign Canton-style transaction hash and verify', () => {
    const { publicKey, userShare, serverShare } = generateEd25519TSSKeyPair();

    // Simulate a Canton transaction hash
    const txData = JSON.stringify({ sender: 'party-abc', receiver: 'party-def', amount: '100' });
    const txHash = sha256(new TextEncoder().encode(txData));

    const { signatureHex, publicKeyHex } = signCantonHash(txHash, [userShare, serverShare]);

    // Verify
    const sigBytes = hexToBytes(signatureHex);
    const pubBytes = hexToBytes(publicKeyHex);
    expect(verifyCantonSignature(txHash, sigBytes, pubBytes)).toBe(true);

    // Public key should match
    expect(pubBytes).toEqual(publicKey);
  });

  it('should reconstruct same key pair from shares', () => {
    const { publicKey, userShare, serverShare, recoveryShare } = generateEd25519TSSKeyPair();

    const kp1 = reconstructEd25519KeyPair([userShare, serverShare]);
    const kp2 = reconstructEd25519KeyPair([userShare, recoveryShare]);
    const kp3 = reconstructEd25519KeyPair([serverShare, recoveryShare]);

    expect(kp1.publicKey).toEqual(publicKey);
    expect(kp2.publicKey).toEqual(publicKey);
    expect(kp3.publicKey).toEqual(publicKey);
  });
});

describe('Ed25519 Key Derivation', () => {
  it('should derive deterministic Ed25519 key', () => {
    const key1 = deriveEd25519PrivateKey('12345', 'secret'.repeat(11));
    const key2 = deriveEd25519PrivateKey('12345', 'secret'.repeat(11));

    expect(key1).toEqual(key2);
    expect(key1.length).toBe(32);
  });

  it('should derive different keys for different inputs', () => {
    const key1 = deriveEd25519PrivateKey('12345', 'secret'.repeat(11));
    const key2 = deriveEd25519PrivateKey('67890', 'secret'.repeat(11));

    expect(key1).not.toEqual(key2);
  });

  it('should derive valid Ed25519 signing key', () => {
    const privateKey = deriveEd25519PrivateKey('12345', 'secret'.repeat(11));
    const publicKey = ed25519GetPublicKey(privateKey);
    const message = new TextEncoder().encode('test');

    const sig = ed25519Sign(message, privateKey);
    expect(ed25519Verify(message, sig, publicKey)).toBe(true);
  });

  it('should derive PIN encryption key', () => {
    const salt = randomBytes(32);
    const key1 = deriveEncryptionKeyFromPin('1234', salt);
    const key2 = deriveEncryptionKeyFromPin('1234', salt);

    expect(key1).toEqual(key2);
    expect(key1.length).toBe(32);

    // Different PIN = different key
    const key3 = deriveEncryptionKeyFromPin('5678', salt);
    expect(key3).not.toEqual(key1);
  });
});

// Helper
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
