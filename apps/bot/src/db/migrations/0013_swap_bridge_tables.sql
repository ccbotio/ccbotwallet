CREATE TABLE "bridge_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid,
	"type" varchar(16) NOT NULL,
	"from_chain" varchar(16) NOT NULL,
	"to_chain" varchar(16) NOT NULL,
	"from_amount" varchar(64) NOT NULL,
	"to_amount" varchar(64),
	"fee" varchar(64),
	"from_address" varchar(256),
	"to_address" varchar(256),
	"canton_party_id" varchar(256) NOT NULL,
	"eth_tx_hash" varchar(128),
	"eth_block_number" integer,
	"eth_confirmations" integer DEFAULT 0,
	"canton_tx_hash" varchar(256),
	"canton_update_id" varchar(256),
	"attestation_hash" varchar(256),
	"attestation_status" varchar(32),
	"attestation_received_at" timestamp,
	"deposit_attestation_cid" varchar(256),
	"burn_intent_cid" varchar(256),
	"status" varchar(32) DEFAULT 'initiated' NOT NULL,
	"failure_reason" varchar(512),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "swap_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_token" varchar(16) NOT NULL,
	"to_token" varchar(16) NOT NULL,
	"from_amount" varchar(64) NOT NULL,
	"to_amount" varchar(64) NOT NULL,
	"rate" varchar(64) NOT NULL,
	"fee" varchar(64) NOT NULL,
	"fee_percentage" varchar(16) NOT NULL,
	"cc_price_usd" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quote_id" uuid,
	"from_token" varchar(16) NOT NULL,
	"to_token" varchar(16) NOT NULL,
	"from_amount" varchar(64) NOT NULL,
	"to_amount" varchar(64) NOT NULL,
	"fee" varchar(64) NOT NULL,
	"user_party_id" varchar(256),
	"user_to_treasury_tx_hash" varchar(256),
	"treasury_to_user_tx_hash" varchar(256),
	"refund_tx_hash" varchar(256),
	"refund_amount" varchar(64),
	"refunded_at" timestamp,
	"refund_reason" varchar(512),
	"refund_attempts" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"failure_reason" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "treasury_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"party_id" varchar(256) NOT NULL,
	"cc_reserve" varchar(64) DEFAULT '0' NOT NULL,
	"usdcx_reserve" varchar(64) DEFAULT '0' NOT NULL,
	"fee_percentage" varchar(16) DEFAULT '0.3' NOT NULL,
	"max_swap_amount_cc" varchar(64) DEFAULT '10000' NOT NULL,
	"max_swap_amount_usdcx" varchar(64) DEFAULT '10000' NOT NULL,
	"min_swap_amount_cc" varchar(64) DEFAULT '1' NOT NULL,
	"min_swap_amount_usdcx" varchar(64) DEFAULT '0.1' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"paused_reason" varchar(256),
	"total_swaps_count" integer DEFAULT 0 NOT NULL,
	"total_fees_collected_cc" varchar(64) DEFAULT '0' NOT NULL,
	"total_fees_collected_usdcx" varchar(64) DEFAULT '0' NOT NULL,
	"last_swap_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_state_party_id_unique" UNIQUE("party_id")
);
--> statement-breakpoint
ALTER TABLE "passkey_sessions" ALTER COLUMN "wallet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_sessions" ALTER COLUMN "party_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey_sessions" ALTER COLUMN "encrypted_user_share" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_merge_utxo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "one_step_transfers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "merge_delegation_cid" varchar(256);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "transfer_preapproval_cid" varchar(256);--> statement-breakpoint
ALTER TABLE "bridge_transactions" ADD CONSTRAINT "bridge_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_transactions" ADD CONSTRAINT "bridge_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_quotes" ADD CONSTRAINT "swap_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD CONSTRAINT "swap_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_transactions" ADD CONSTRAINT "swap_transactions_quote_id_swap_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."swap_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bridge_tx_user" ON "bridge_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_bridge_tx_status" ON "bridge_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_bridge_tx_type" ON "bridge_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_bridge_tx_eth_hash" ON "bridge_transactions" USING btree ("eth_tx_hash");--> statement-breakpoint
CREATE INDEX "idx_bridge_tx_attestation_pending" ON "bridge_transactions" USING btree ("attestation_status");--> statement-breakpoint
CREATE INDEX "idx_bridge_tx_created" ON "bridge_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_swap_quote_user" ON "swap_quotes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_swap_quote_status" ON "swap_quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_swap_quote_expires" ON "swap_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_swap_tx_user" ON "swap_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_swap_tx_status" ON "swap_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_swap_tx_created" ON "swap_transactions" USING btree ("created_at");