CREATE TABLE "blocked_email_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(256) NOT NULL,
	"reason" varchar(256),
	"added_by" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_email_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "email_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(256),
	"ip_address" varchar(64),
	"user_id" uuid,
	"send_count" integer DEFAULT 0 NOT NULL,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"last_send_at" timestamp,
	"blocked_until" timestamp,
	"window_start" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" varchar(32),
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"success" boolean DEFAULT false NOT NULL,
	"failure_reason" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"challenge" varchar(256) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_challenges_challenge_unique" UNIQUE("challenge")
);
--> statement-breakpoint
CREATE TABLE "passkey_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"credential_id" varchar(512) NOT NULL,
	"public_key_spki" varchar(1024) NOT NULL,
	"email_at_registration" varchar(256) NOT NULL,
	"canton_contract_id" varchar(256),
	"device_name" varchar(128),
	"device_fingerprint" varchar(256),
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"revoked_reason" varchar(256),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "passkey_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_id" varchar(32) NOT NULL,
	"wallet_id" uuid NOT NULL,
	"party_id" varchar(256) NOT NULL,
	"email_at_creation" varchar(256) NOT NULL,
	"encrypted_user_share" varchar(1024) NOT NULL,
	"display_name" varchar(128),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"completed_credential_id" varchar(512),
	"request_ip" varchar(64),
	"user_agent" varchar(512),
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" varchar(64) NOT NULL,
	"event_status" varchar(16) NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"session_id" varchar(128),
	"request_id" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"lock_timeout_seconds" integer DEFAULT 300 NOT NULL,
	"failed_unlock_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_locks_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "email_codes" DROP CONSTRAINT "email_codes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "server_shares" DROP CONSTRAINT "server_shares_wallet_id_wallets_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_wallet_id_wallets_id_fk";
--> statement-breakpoint
ALTER TABLE "verifications" DROP CONSTRAINT "verifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "code_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "email_codes" ADD COLUMN "request_ip" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_fingerprint" varchar(256);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" varchar(64);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_used_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_rate_limits" ADD CONSTRAINT "email_rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_sessions" ADD CONSTRAINT "passkey_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_sessions" ADD CONSTRAINT "passkey_sessions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_locks" ADD CONSTRAINT "session_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_rate_email" ON "email_rate_limits" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_email_rate_ip" ON "email_rate_limits" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "idx_login_telegram" ON "login_attempts" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "idx_login_ip" ON "login_attempts" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "idx_login_created" ON "login_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_passkey_user" ON "passkey_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_passkey_email" ON "passkey_credentials" USING btree ("email_at_registration");--> statement-breakpoint
CREATE INDEX "idx_passkey_session_user" ON "passkey_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_passkey_session_expires" ON "passkey_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_security_user" ON "security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_security_type" ON "security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_security_created" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_security_severity" ON "security_events" USING btree ("severity");--> statement-breakpoint
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_shares" ADD CONSTRAINT "server_shares_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_code_user" ON "email_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_email_code_email" ON "email_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_notification_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_tx_wallet" ON "transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_tx_created" ON "transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_wallet_user" ON "wallets" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tx_hash_unique" UNIQUE("tx_hash");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");