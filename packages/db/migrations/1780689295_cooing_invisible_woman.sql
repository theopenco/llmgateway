CREATE TABLE "chat_plan_cancellation_feedback" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chat_plan_stripe_subscription_id" text NOT NULL,
	"previous_chat_plan" text,
	"reason" text NOT NULL,
	"comments" text
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "is_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_credits_used" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_credits_limit" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_billing_cycle_start" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_cancelled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_cycle" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "chat_plan_card_fingerprint" text;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_chat_plan_stripe_subscription_id_key" UNIQUE("chat_plan_stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_plan_cancellation_feedback_org_sub_unique" ON "chat_plan_cancellation_feedback" ("organization_id","chat_plan_stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "chat_plan_cancellation_feedback_organization_id_idx" ON "chat_plan_cancellation_feedback" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_chat_plan_card_fingerprint_uidx" ON "organization" ("chat_plan_card_fingerprint");--> statement-breakpoint
ALTER TABLE "chat_plan_cancellation_feedback" ADD CONSTRAINT "chat_plan_cancellation_feedback_lggQrHrJo0rO_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_plan_cancellation_feedback" ADD CONSTRAINT "chat_plan_cancellation_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;