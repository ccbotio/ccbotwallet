CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"amount" varchar(64) NOT NULL,
	"token" varchar(32) NOT NULL,
	"from_party" varchar(256),
	"to_party" varchar(256),
	"tx_hash" varchar(256),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" varchar(32) NOT NULL,
	"telegram_username" varchar(64),
	"canton_party_id" varchar(256),
	"tier" varchar(16) DEFAULT 'bronze' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"streak_count" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"metadata" jsonb,
	"verified_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"party_id" varchar(256) NOT NULL,
	"public_key" varchar(512),
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_party_id_unique" UNIQUE("party_id")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;