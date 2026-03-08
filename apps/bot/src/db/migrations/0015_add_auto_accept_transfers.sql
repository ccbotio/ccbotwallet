-- Add auto_accept_transfers preference to users table
-- Default: true (enabled by default)

ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_accept_transfers BOOLEAN NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN users.auto_accept_transfers IS 'User preference: Auto-accept pending incoming transfers';
