CREATE TYPE "public"."connection_status" AS ENUM('active', 'paused', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('live', 'replay');--> statement-breakpoint
CREATE TYPE "public"."exchange_order_status" AS ENUM('pending', 'open', 'filled', 'canceled', 'untriggered', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."intent_state" AS ENUM('prepared', 'blocked', 'reserved', 'submitted', 'unknown', 'rejected', 'unfilled', 'canceled', 'expired', 'open_verifying', 'open_verified', 'recovery_required', 'closed');--> statement-breakpoint
CREATE TYPE "public"."order_role" AS ENUM('entry', 'stop', 'target', 'recovery_close');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."outbox_kind" AS ENUM('submit', 'reconcile', 'cancel_entry');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'claimed', 'done');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'published', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "communities_telegram_chat_id_unique" UNIQUE("telegram_chat_id"),
	CONSTRAINT "communities_name_present" CHECK (length(trim("communities"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "community_publishers" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "community_publishers_pk" PRIMARY KEY("community_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"display_name" text NOT NULL,
	"telegram_username" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id"),
	CONSTRAINT "users_telegram_user_id_positive" CHECK ("users"."telegram_user_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"digest" text NOT NULL,
	"published_at" bigint NOT NULL,
	"entry_expires_at" bigint NOT NULL,
	CONSTRAINT "plan_versions_plan_version_unique" UNIQUE("plan_id","version"),
	CONSTRAINT "plan_versions_version_positive" CHECK ("plan_versions"."version" >= 1),
	CONSTRAINT "plan_versions_digest_is_sha256" CHECK ("plan_versions"."digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"community_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "plans_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "plans_current_version_not_negative" CHECK ("plans"."current_version" >= 0),
	CONSTRAINT "plans_draft_has_no_version" CHECK ("plans"."status" <> 'draft' or "plans"."current_version" = 0),
	CONSTRAINT "plans_published_has_a_version" CHECK ("plans"."status" <> 'published' or "plans"."current_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "account_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"strike_account_id" text NOT NULL,
	"public_key" text,
	"key_ciphertext" text,
	"key_iv" text,
	"key_tag" text,
	"key_version" integer,
	"replay_scenario" text,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "account_connections_environment_account_unique" UNIQUE("environment","strike_account_id"),
	CONSTRAINT "account_connections_credentials_match_environment" CHECK (("account_connections"."environment" = 'live'
        and "account_connections"."public_key" is not null and "account_connections"."key_ciphertext" is not null
        and "account_connections"."key_iv" is not null and "account_connections"."key_tag" is not null
        and "account_connections"."key_version" is not null and "account_connections"."replay_scenario" is null)
      or ("account_connections"."environment" = 'replay'
        and "account_connections"."public_key" is null and "account_connections"."key_ciphertext" is null
        and "account_connections"."key_iv" is null and "account_connections"."key_tag" is null
        and "account_connections"."key_version" is null and "account_connections"."replay_scenario" is not null))
);
--> statement-breakpoint
CREATE TABLE "risk_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "risk_policies_user_version_unique" UNIQUE("user_id","version"),
	CONSTRAINT "risk_policies_version_positive" CHECK ("risk_policies"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "execution_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_connection_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"market" text NOT NULL,
	"approved" jsonb NOT NULL,
	"approved_digest" text NOT NULL,
	"state" "intent_state" NOT NULL,
	"strategy_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "execution_intents_strategy_id_unique" UNIQUE("strategy_id"),
	CONSTRAINT "execution_intents_account_plan_version_unique" UNIQUE("account_connection_id","plan_version_id"),
	CONSTRAINT "execution_intents_approved_digest_is_sha256" CHECK ("execution_intents"."approved_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "execution_intents_updated_after_creation" CHECK ("execution_intents"."updated_at" >= "execution_intents"."created_at")
);
--> statement-breakpoint
CREATE TABLE "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_connection_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"quantity_ceiling" numeric,
	"decision" jsonb NOT NULL,
	"input_digest" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "previews_expire_after_creation" CHECK ("previews"."expires_at" > "previews"."created_at"),
	CONSTRAINT "previews_quantity_ceiling_positive" CHECK ("previews"."quantity_ceiling" is null or "previews"."quantity_ceiling" > 0),
	CONSTRAINT "previews_input_digest_is_sha256" CHECK ("previews"."input_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"built_at" bigint NOT NULL,
	CONSTRAINT "receipts_intent_unique" UNIQUE("intent_id")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"account_connection_id" uuid NOT NULL,
	"planned_loss" numeric NOT NULL,
	"initial_margin" numeric NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"released_at" bigint,
	CONSTRAINT "reservations_intent_unique" UNIQUE("intent_id"),
	CONSTRAINT "reservations_planned_loss_not_negative" CHECK ("reservations"."planned_loss" >= 0),
	CONSTRAINT "reservations_initial_margin_not_negative" CHECK ("reservations"."initial_margin" >= 0),
	CONSTRAINT "reservations_released_when_released" CHECK (("reservations"."status" = 'released') = ("reservations"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "exchange_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"role" "order_role" NOT NULL,
	"client_order_id" text NOT NULL,
	"exchange_order_id" text,
	"payload" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"last_status" "exchange_order_status",
	"filled_size" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "exchange_orders_client_order_id_unique" UNIQUE("client_order_id"),
	CONSTRAINT "exchange_orders_intent_role_unique" UNIQUE("intent_id","role"),
	CONSTRAINT "exchange_orders_exchange_order_id_unique" UNIQUE("exchange_order_id"),
	CONSTRAINT "exchange_orders_payload_digest_is_sha256" CHECK ("exchange_orders"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "exchange_orders_filled_size_not_negative" CHECK ("exchange_orders"."filled_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange_fill_id" text NOT NULL,
	"client_order_id" text NOT NULL,
	"intent_id" uuid NOT NULL,
	"role" "order_role" NOT NULL,
	"side" "order_side" NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	"fee" numeric NOT NULL,
	"filled_at" bigint NOT NULL,
	CONSTRAINT "fills_exchange_fill_id_unique" UNIQUE("exchange_fill_id"),
	CONSTRAINT "fills_price_positive" CHECK ("fills"."price" > 0),
	CONSTRAINT "fills_size_positive" CHECK ("fills"."size" > 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL,
	"actor" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"environment" "environment",
	"type" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "outbox_kind" NOT NULL,
	"intent_id" uuid NOT NULL,
	"account_connection_id" uuid NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"claimed_at" bigint,
	CONSTRAINT "outbox_attempts_not_negative" CHECK ("outbox"."attempts" >= 0),
	CONSTRAINT "outbox_claimed_has_claim_time" CHECK ("outbox"."status" <> 'claimed' or "outbox"."claimed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_publishers" ADD CONSTRAINT "community_publishers_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_publishers" ADD CONSTRAINT "community_publishers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_policies" ADD CONSTRAINT "risk_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_intents" ADD CONSTRAINT "execution_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_intents" ADD CONSTRAINT "execution_intents_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_intents" ADD CONSTRAINT "execution_intents_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_intents" ADD CONSTRAINT "execution_intents_policy_id_risk_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."risk_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_intents" ADD CONSTRAINT "execution_intents_account_connection_fk" FOREIGN KEY ("account_connection_id") REFERENCES "public"."account_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_account_connection_id_account_connections_id_fk" FOREIGN KEY ("account_connection_id") REFERENCES "public"."account_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_policy_id_risk_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."risk_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_account_connection_id_account_connections_id_fk" FOREIGN KEY ("account_connection_id") REFERENCES "public"."account_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_orders" ADD CONSTRAINT "exchange_orders_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_client_order_id_exchange_orders_client_order_id_fk" FOREIGN KEY ("client_order_id") REFERENCES "public"."exchange_orders"("client_order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_account_connection_id_account_connections_id_fk" FOREIGN KEY ("account_connection_id") REFERENCES "public"."account_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_connections_user_idx" ON "account_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_intents_account_market_open_unique" ON "execution_intents" USING btree ("account_connection_id","market") WHERE not ("execution_intents"."state" in ('blocked', 'rejected', 'unfilled', 'canceled', 'expired', 'closed'));--> statement-breakpoint
CREATE INDEX "execution_intents_user_idx" ON "execution_intents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_account_active_idx" ON "reservations" USING btree ("account_connection_id") WHERE "reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "fills_intent_idx" ON "fills" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "events_correlation_idx" ON "events" USING btree ("correlation_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_intent_kind_open_unique" ON "outbox" USING btree ("intent_id","kind") WHERE "outbox"."status" <> 'done';--> statement-breakpoint
CREATE INDEX "outbox_pending_due_idx" ON "outbox" USING btree ("next_attempt_at") WHERE "outbox"."status" = 'pending';