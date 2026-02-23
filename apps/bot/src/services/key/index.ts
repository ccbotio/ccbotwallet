import {
  deriveKeyFromTelegramId,
  deriveEd25519PrivateKey,
  derivePartyId,
  getPublicKey,
  ed25519GetPublicKey,
  signTransaction,
  ed25519Sign,
  bytesToHex,
} from '@repo/crypto';
import { env } from '../../config/env.js';

export class KeyService {
  derivePartyId(telegramId: string): string {
    return derivePartyId(telegramId, env.APP_SECRET);
  }

  /** Legacy secp256k1 public key */
  getPublicKey(telegramId: string): string {
    const privateKey = deriveKeyFromTelegramId(telegramId, env.APP_SECRET);
    const publicKey = getPublicKey(privateKey);
    return bytesToHex(publicKey);
  }

  /** Ed25519 public key for Canton */
  getEd25519PublicKey(telegramId: string): string {
    const privateKey = deriveEd25519PrivateKey(telegramId, env.APP_SECRET);
    const publicKey = ed25519GetPublicKey(privateKey);
    return bytesToHex(publicKey);
  }

  /** Legacy secp256k1 transaction signing */
  signTransaction(telegramId: string, txPayload: Record<string, unknown>): string {
    const privateKey = deriveKeyFromTelegramId(telegramId, env.APP_SECRET);
    return signTransaction(txPayload, privateKey);
  }

  /** Ed25519 hash signing for Canton */
  signHashEd25519(telegramId: string, hash: Uint8Array): Uint8Array {
    const privateKey = deriveEd25519PrivateKey(telegramId, env.APP_SECRET);
    try {
      return ed25519Sign(hash, privateKey);
    } finally {
      privateKey.fill(0);
    }
  }
}

export const keyService = new KeyService();
