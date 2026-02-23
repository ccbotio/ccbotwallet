-- Make wallet-related fields nullable for passkey-only flow
-- This allows creating passkey sessions BEFORE wallet creation

ALTER TABLE passkey_sessions 
  ALTER COLUMN wallet_id DROP NOT NULL,
  ALTER COLUMN party_id DROP NOT NULL,
  ALTER COLUMN encrypted_user_share DROP NOT NULL;

-- Also extend status field to accommodate longer status values
ALTER TABLE passkey_sessions 
  ALTER COLUMN status TYPE varchar(20);
