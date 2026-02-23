-- Add transfer_nonce column to wallets table
-- Used to track sequential nonces for Canton TransferCommand
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS transfer_nonce INTEGER NOT NULL DEFAULT 0;
