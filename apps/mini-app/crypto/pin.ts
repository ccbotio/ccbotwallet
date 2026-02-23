// PIN-based encryption using Web Crypto API

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const pinBytes = encoder.encode(pin);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    pinBytes as BufferSource,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptWithPin(
  data: string,
  pin: string
): Promise<{ ciphertext: string; iv: string; salt: string }> {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    dataBytes as BufferSource
  );

  return {
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    iv: bytesToHex(iv),
    salt: bytesToHex(salt),
  };
}

export async function decryptWithPin(
  ciphertext: string,
  iv: string,
  salt: string,
  pin: string
): Promise<string> {
  const key = await deriveKey(pin, hexToBytes(salt));

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(iv) as BufferSource },
    key,
    hexToBytes(ciphertext) as BufferSource
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
