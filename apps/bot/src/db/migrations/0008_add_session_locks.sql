-- Add session_locks table for automatic session timeout/lock functionality
-- Tracks user session activity and auto-locks after inactivity timeout

CREATE TABLE IF NOT EXISTS "session_locks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id"),
    "is_locked" boolean DEFAULT false NOT NULL,
    "last_activity_at" timestamp DEFAULT now() NOT NULL,
    "lock_timeout_seconds" integer DEFAULT 300 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Index for faster lookups by user_id (already covered by UNIQUE constraint but explicit for clarity)
CREATE INDEX IF NOT EXISTS "session_locks_user_id_idx" ON "session_locks" ("user_id");

-- Index for checking locked sessions
CREATE INDEX IF NOT EXISTS "session_locks_is_locked_idx" ON "session_locks" ("is_locked") WHERE "is_locked" = true;
