CREATE TYPE "public"."notification_status" AS ENUM('pending', 'claimed', 'sent', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" "intent_state" NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"claimed_at" bigint,
	"sent_at" bigint,
	"telegram_message_id" bigint,
	"failure" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "notifications_intent_state_unique" UNIQUE("intent_id","state"),
	CONSTRAINT "notifications_attempts_not_negative" CHECK ("notifications"."attempts" >= 0),
	CONSTRAINT "notifications_claimed_has_claim_time" CHECK ("notifications"."status" <> 'claimed' or "notifications"."claimed_at" is not null),
	CONSTRAINT "notifications_sent_when_sent" CHECK (("notifications"."status" = 'sent') = ("notifications"."sent_at" is not null and "notifications"."telegram_message_id" is not null)),
	CONSTRAINT "notifications_failed_has_failure" CHECK ("notifications"."status" <> 'failed' or "notifications"."failure" is not null)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot_started_at" bigint;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_intent_id_execution_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."execution_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_pending_due_idx" ON "notifications" USING btree ("next_attempt_at") WHERE "notifications"."status" = 'pending';