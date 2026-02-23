-- Passkey sessions for OAuth+PKCE flow (secure external browser auth)
CREATE TABLE IF NOT EXISTS passkey_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Session identifier (public, passed in URL)
  session_id VARCHAR(64) NOT NULL UNIQUE,

  -- PKCE code challenge (SHA256 hash of code_verifier)
  code_challenge VARCHAR(128) NOT NULL,

  -- User/wallet info
  telegram_id VARCHAR(32) NOT NULL,
  wallet_id UUID NOT NULL,
  party_id VARCHAR(256) NOT NULL,

  -- Encrypted user share (stored securely, never in URL)
  encrypted_user_share VARCHAR(1024) NOT NULL,

  -- User display name for passkey
  display_name VARCHAR(128),

  -- Session state: pending, completed, expired, used
  status VARCHAR(16) NOT NULL DEFAULT 'pending',

  -- Passkey credential ID (set after successful registration)
  completed_credential_id VARCHAR(512),

  -- Timestamps
  expires_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fast session lookup
CREATE INDEX idx_passkey_sessions_session_id ON passkey_sessions(session_id);
CREATE INDEX idx_passkey_sessions_telegram_id ON passkey_sessions(telegram_id);
CREATE INDEX idx_passkey_sessions_status ON passkey_sessions(status);
