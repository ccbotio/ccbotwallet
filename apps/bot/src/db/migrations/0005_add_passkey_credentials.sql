-- Add passkey credentials table for WebAuthn passkey recovery
CREATE TABLE IF NOT EXISTS passkey_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  credential_id VARCHAR(512) NOT NULL UNIQUE,
  public_key_spki VARCHAR(1024) NOT NULL,
  canton_contract_id VARCHAR(256),
  device_name VARCHAR(128),
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add passkey challenges table for replay protection
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  challenge VARCHAR(256) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_wallet_id ON passkey_credentials(wallet_id);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_credential_id ON passkey_credentials(credential_id);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_wallet_id ON passkey_challenges(wallet_id);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires_at ON passkey_challenges(expires_at);
