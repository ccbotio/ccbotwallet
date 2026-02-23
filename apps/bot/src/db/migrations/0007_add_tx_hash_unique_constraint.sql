-- Add unique constraint on tx_hash for idempotent transaction sync
-- This enables ON CONFLICT DO UPDATE for upserts

-- First, clean up any duplicate transactions (keep the oldest one)
DELETE FROM transactions t1
USING transactions t2
WHERE t1.tx_hash = t2.tx_hash
  AND t1.tx_hash IS NOT NULL
  AND t1.created_at > t2.created_at;

-- Now add the unique constraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tx_hash_unique" UNIQUE("tx_hash");
