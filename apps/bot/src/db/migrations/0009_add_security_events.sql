-- Migration: Add security_events table for audit trail
-- This table stores security-related events for audit purposes

CREATE TABLE IF NOT EXISTS "security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "event_type" varchar(64) NOT NULL,
  "event_status" varchar(16) NOT NULL,
  "ip_address" varchar(64),
  "user_agent" varchar(512),
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create index on user_id for efficient user event lookups
CREATE INDEX IF NOT EXISTS "security_events_user_id_idx" ON "security_events" ("user_id");

-- Create index on event_type for filtering by event type
CREATE INDEX IF NOT EXISTS "security_events_event_type_idx" ON "security_events" ("event_type");

-- Create index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS "security_events_created_at_idx" ON "security_events" ("created_at");
