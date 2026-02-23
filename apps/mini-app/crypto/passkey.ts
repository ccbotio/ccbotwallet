/**
 * WebAuthn Passkey utilities for wallet recovery.
 *
 * This module provides:
 * - Passkey registration (create credential)
 * - Passkey authentication (sign with credential)
 * - Key derivation from passkey for share encryption
 * - Recovery share encryption/decryption
 */

// Relying Party configuration
const RP_NAME = 'CC Bot Wallet';
const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'ccbot.app';

/**
 * Check if WebAuthn is supported in this environment.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.PublicKeyCredential !== undefined &&
    typeof window.PublicKeyCredential === 'function'
  );
}

/**
 * Check if platform authenticator is available (Touch ID, Face ID, Windows Hello).
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Registered passkey credential data.
 */
export interface PasskeyCredential {
  credentialId: string;     // Base64url encoded
  publicKeySpki: string;    // Base64 encoded SPKI public key
  attestation: string;      // Base64 encoded attestation object
}

/**
 * WebAuthn assertion result for authentication.
 */
export interface PasskeyAssertion {
  credentialId: string;
  authenticatorData: string;
  clientDataJson: string;
  signature: string;
  userHandle?: string;
}

/**
 * Encrypted recovery share data.
 */
export interface EncryptedShare {
  ciphertext: string;  // Base64 encoded
  nonce: string;       // Base64 encoded
}

/**
 * Register a new passkey for the user.
 *
 * @param userId - Unique user identifier (e.g., wallet ID)
 * @param challenge - Server-generated challenge (base64)
 * @param displayName - User display name
 */
export async function registerPasskey(
  userId: string,
  challenge: string,
  displayName: string = 'CC Bot Wallet'
): Promise<PasskeyCredential> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const challengeBytes = base64ToBytes(challenge);
  const userIdBytes = new TextEncoder().encode(userId);

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge: challengeBytes,
    rp: {
      name: RP_NAME,
      id: RP_ID,
    },
    user: {
      id: userIdBytes,
      name: `CC Bot User`,
      displayName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256 (ECDSA w/ P-256)
      { alg: -257, type: 'public-key' }, // RS256 (RSASSA-PKCS1-v1_5)
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',  // Built-in (Face ID, fingerprint)
      residentKey: 'required',              // Discoverable credential
      userVerification: 'required',
    },
    timeout: 60000,
    attestation: 'none', // We don't need attestation for this use case
    extensions: {
      // PRF extension for key derivation (Chrome 116+, Safari 17+)
      // @ts-ignore - PRF extension not in standard types yet
      prf: {
        eval: {
          first: new TextEncoder().encode('cc-bot-recovery-key'),
        },
      },
    },
  };

  const credential = await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  }) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Failed to create passkey credential');
  }

  const response = credential.response as AuthenticatorAttestationResponse;

  // Get public key in SPKI format
  const publicKey = response.getPublicKey();
  if (!publicKey) {
    throw new Error('Failed to get public key from credential');
  }

  return {
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    publicKeySpki: bytesToBase64(new Uint8Array(publicKey)),
    attestation: bytesToBase64(new Uint8Array(response.attestationObject)),
  };
}

/**
 * Authenticate with a passkey.
 *
 * @param challenge - Server-generated challenge (base64)
 * @param allowCredentials - Optional list of credential IDs to allow
 */
export async function authenticateWithPasskey(
  challenge: string,
  allowCredentials?: Array<{ credentialId: string }>
): Promise<PasskeyAssertion> {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not supported in this browser');
  }

  const challengeBytes = base64ToBytes(challenge);

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: challengeBytes,
    rpId: RP_ID,
    userVerification: 'required',
    timeout: 60000,
    allowCredentials: allowCredentials?.map((c) => ({
      id: base64ToBytes(c.credentialId),
      type: 'public-key' as const,
      transports: ['internal', 'hybrid'] as AuthenticatorTransport[],
    })),
    extensions: {
      // PRF extension for key derivation
      // @ts-ignore - PRF extension not in standard types yet
      prf: {
        eval: {
          first: new TextEncoder().encode('cc-bot-recovery-key'),
        },
      },
    },
  };

  const assertion = await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  }) as PublicKeyCredential;

  if (!assertion) {
    throw new Error('Passkey authentication failed');
  }

  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    credentialId: bytesToBase64Url(new Uint8Array(assertion.rawId)),
    authenticatorData: bytesToBase64(new Uint8Array(response.authenticatorData)),
    clientDataJson: bytesToBase64(new Uint8Array(response.clientDataJSON)),
    signature: bytesToBase64(new Uint8Array(response.signature)),
    userHandle: response.userHandle
      ? bytesToBase64(new Uint8Array(response.userHandle))
      : undefined,
  };
}

/**
 * Derive an encryption key from a passkey credential.
 * Uses PRF extension if available, otherwise falls back to credential ID hash.
 *
 * @param credential - The passkey credential (from registration or authentication)
 * @param userId - User identifier for additional entropy
 */
export async function deriveKeyFromPasskey(
  credential: PublicKeyCredential,
  userId: string
): Promise<CryptoKey> {
  // Try to get PRF result from extensions
  const extensions = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };

  let keyMaterial: ArrayBuffer;

  if (extensions.prf?.results?.first) {
    // Use PRF extension output directly
    keyMaterial = extensions.prf.results.first;
  } else {
    // Fallback: derive key from credential ID + user ID using HKDF
    const encoder = new TextEncoder();
    const inputData = encoder.encode(
      bytesToBase64Url(new Uint8Array(credential.rawId)) + userId
    );

    keyMaterial = await crypto.subtle.digest('SHA-256', inputData);
  }

  // Import as AES-GCM key
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a recovery share with a passkey-derived key.
 *
 * @param shareHex - The recovery share as a hex string
 * @param passkeyKey - The AES key derived from passkey
 */
export async function encryptShareForPasskey(
  shareHex: string,
  passkeyKey: CryptoKey
): Promise<EncryptedShare> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const shareBytes = encoder.encode(shareHex);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    passkeyKey,
    shareBytes
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
  };
}

/**
 * Decrypt a recovery share with a passkey-derived key.
 *
 * @param encryptedShare - The encrypted share data
 * @param passkeyKey - The AES key derived from passkey
 */
export async function decryptShareWithPasskey(
  encryptedShare: EncryptedShare,
  passkeyKey: CryptoKey
): Promise<string> {
  const ciphertext = base64ToBytes(encryptedShare.ciphertext);
  const nonce = base64ToBytes(encryptedShare.nonce);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    passkeyKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Full passkey registration flow with share encryption.
 *
 * @param userId - User/wallet identifier
 * @param challenge - Server challenge
 * @param recoveryShareHex - The recovery share to encrypt
 * @param displayName - User display name
 */
export async function registerPasskeyWithShare(
  userId: string,
  challenge: string,
  recoveryShareHex: string,
  displayName?: string
): Promise<{
  credential: PasskeyCredential;
  encryptedShare: EncryptedShare;
}> {
  // Create the passkey credential
  const credential = await registerPasskey(userId, challenge, displayName);

  // Get the credential again to derive key (need the full credential object)
  // For registration, we derive key from credential ID + user ID
  const keyMaterial = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(credential.credentialId + userId)
  );

  const passkeyKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Encrypt the recovery share
  const encryptedShare = await encryptShareForPasskey(recoveryShareHex, passkeyKey);

  return { credential, encryptedShare };
}

/**
 * Full passkey recovery flow.
 *
 * @param challenge - Server challenge
 * @param allowCredentials - Allowed credential IDs
 * @param encryptedShare - Encrypted recovery share from server
 * @param userId - User/wallet identifier for key derivation
 */
export async function recoverWithPasskey(
  challenge: string,
  allowCredentials: Array<{ credentialId: string }>,
  encryptedShare: EncryptedShare,
  userId: string
): Promise<{
  assertion: PasskeyAssertion;
  recoveryShareHex: string;
}> {
  // Authenticate with passkey
  const challengeBytes = base64ToBytes(challenge);

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: challengeBytes,
    rpId: RP_ID,
    userVerification: 'required',
    timeout: 60000,
    allowCredentials: allowCredentials.map((c) => ({
      id: base64ToBytes(c.credentialId),
      type: 'public-key' as const,
      transports: ['internal', 'hybrid'] as AuthenticatorTransport[],
    })),
    extensions: {
      // @ts-ignore
      prf: {
        eval: {
          first: new TextEncoder().encode('cc-bot-recovery-key'),
        },
      },
    },
  };

  const credential = await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  }) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Passkey authentication failed');
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  // Create assertion object
  const assertion: PasskeyAssertion = {
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    authenticatorData: bytesToBase64(new Uint8Array(response.authenticatorData)),
    clientDataJson: bytesToBase64(new Uint8Array(response.clientDataJSON)),
    signature: bytesToBase64(new Uint8Array(response.signature)),
    userHandle: response.userHandle
      ? bytesToBase64(new Uint8Array(response.userHandle))
      : undefined,
  };

  // Derive decryption key
  const passkeyKey = await deriveKeyFromPasskey(credential, userId);

  // Decrypt recovery share
  const recoveryShareHex = await decryptShareWithPasskey(encryptedShare, passkeyKey);

  return { assertion, recoveryShareHex };
}

/**
 * Open passkey flow in external browser (for Telegram Mini App fallback).
 *
 * @param action - 'register' or 'recover'
 * @param partyId - Canton party ID
 * @param walletId - Wallet ID for registration
 * @param userShareHex - User share hex for registration
 */
export function openPasskeyInBrowser(
  action: 'register' | 'recover',
  partyId: string,
  walletId?: string,
  userShareHex?: string
): void {
  // Use environment-based URL
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://ccbot.app';

  const callbackUrl = `tg://resolve?domain=ccbot&startapp=passkey_${action}_${partyId}`;

  // Build URL with parameters
  const params = new URLSearchParams({
    party: partyId,
    callback: callbackUrl,
    ...(walletId && { walletId }),
    ...(userShareHex && { userShare: userShareHex }),
  });

  const passkeyUrl = `${baseUrl}/passkey/${action}?${params.toString()}`;

  // Try Telegram WebApp API first
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    // Open in Telegram's internal browser (has better WebAuthn support than WebView)
    window.Telegram.WebApp.openLink(passkeyUrl);
  } else {
    // Fallback to regular navigation
    window.open(passkeyUrl, '_blank');
  }
}

// Utility functions

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  // Handle base64url encoding
  const base64Standard = base64.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64Standard.length % 4;
  const padded = padding ? base64Standard + '='.repeat(4 - padding) : base64Standard;
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Note: Window.Telegram is declared in app/page.tsx
