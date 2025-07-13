ALTER TABLE "organization" ADD COLUMN "trial_start_date" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "trial_end_date" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "is_trial_active" boolean DEFAULT false NOT NULL;