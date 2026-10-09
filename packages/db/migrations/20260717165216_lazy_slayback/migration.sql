ALTER TABLE "organization" ADD COLUMN "dev_plan_reset_passes_lite" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_reset_passes_pro" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_reset_passes_max" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_included_reset_passes_used" integer DEFAULT 0 NOT NULL;