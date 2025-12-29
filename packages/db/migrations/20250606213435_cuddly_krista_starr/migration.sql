ALTER TABLE "log" ALTER COLUMN "mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "log" ALTER COLUMN "used_mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "mode" SET DEFAULT 'credits';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "plan_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "subscription_cancelled" boolean DEFAULT false NOT NULL;