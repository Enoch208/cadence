CREATE TYPE "public"."credential_source" AS ENUM('api_key', 'builder');--> statement-breakpoint
CREATE TYPE "public"."wallet_chain" AS ENUM('ethereum', 'solana', 'cardano');--> statement-breakpoint
CREATE TABLE "builder_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_chain" "wallet_chain" NOT NULL,
	"wallet_address" text NOT NULL,
	"public_key" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_iv" text NOT NULL,
	"key_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"strike_nonce" text NOT NULL,
	"consent_message" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "builder_challenges_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "builder_challenges_strike_nonce_unique" UNIQUE("strike_nonce"),
	CONSTRAINT "builder_challenges_public_key_hex" CHECK ("builder_challenges"."public_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "builder_challenges_expires_after_creation" CHECK ("builder_challenges"."expires_at" > "builder_challenges"."created_at")
);
--> statement-breakpoint
ALTER TABLE "account_connections" DROP CONSTRAINT "account_connections_credentials_match_environment";--> statement-breakpoint
ALTER TABLE "account_connections" ADD COLUMN "credential_source" "credential_source";--> statement-breakpoint
UPDATE "account_connections" SET "credential_source" = 'api_key' WHERE "environment" = 'live';--> statement-breakpoint
ALTER TABLE "builder_challenges" ADD CONSTRAINT "builder_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builder_challenges_user_idx" ON "builder_challenges" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_credentials_match_environment" CHECK (("account_connections"."environment" = 'live'
        and "account_connections"."public_key" is not null and "account_connections"."key_ciphertext" is not null
        and "account_connections"."key_iv" is not null and "account_connections"."key_tag" is not null
        and "account_connections"."key_version" is not null and "account_connections"."credential_source" is not null
        and "account_connections"."replay_scenario" is null)
      or ("account_connections"."environment" = 'replay'
        and "account_connections"."public_key" is null and "account_connections"."key_ciphertext" is null
        and "account_connections"."key_iv" is null and "account_connections"."key_tag" is null
        and "account_connections"."key_version" is null and "account_connections"."credential_source" is null
        and "account_connections"."replay_scenario" is not null));