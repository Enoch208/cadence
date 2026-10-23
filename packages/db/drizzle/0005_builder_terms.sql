ALTER TABLE "account_connections" ADD COLUMN "builder_code" text;--> statement-breakpoint
ALTER TABLE "account_connections" ADD COLUMN "builder_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "builder_challenges" ADD COLUMN "builder_code" text;--> statement-breakpoint
ALTER TABLE "builder_challenges" ADD COLUMN "builder_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_builder_approval_whole" CHECK (("account_connections"."builder_code" is null) = ("account_connections"."builder_fee_bps" is null));--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_builder_fee_bps_range" CHECK ("account_connections"."builder_fee_bps" is null or "account_connections"."builder_fee_bps" between 0 and 100);--> statement-breakpoint
ALTER TABLE "account_connections" ADD CONSTRAINT "account_connections_builder_code_needs_builder_connect" CHECK ("account_connections"."builder_code" is null or "account_connections"."environment" = 'replay'
        or "account_connections"."credential_source" = 'builder');--> statement-breakpoint
ALTER TABLE "builder_challenges" ADD CONSTRAINT "builder_challenges_builder_fee_bps_range" CHECK ("builder_challenges"."builder_fee_bps" between 0 and 100);