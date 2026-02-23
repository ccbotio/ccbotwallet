export {
  splitSecret,
  reconstructSecret,
  reconstructSecretSafe,
  generate2of3Shares,
  shareToHex,
  shareFromHex,
  FIELD_PRIME,
  MAX_SECRET,
  type Share,
  type ShareSet,
} from './shamir.js';

export {
  reconstructEd25519Key,
  reconstructEd25519KeyPair,
  signWithEd25519Shares,
  signCantonHash,
  verifyCantonSignature,
  generateEd25519TSSKeyPair,
  secureZero,
  withReconstructedKey,
  withReconstructedKeySync,
  createSecureHex,
  type SecureHex,
} from './tss.js';

export {
  createSession,
  isSessionValid,
  collectShare,
  completeSession,
  failSession,
  SessionStore,
  type MPCSession,
  type SessionStatus,
} from './session.js';
