ALTER TABLE "organization" ADD COLUMN "risk_flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_flagged_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_flag_source" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_flag_ip" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_flag_details" json;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "risk_reviewed_by" text;--> statement-breakpoint
CREATE INDEX "user_risk_status_idx" ON "user" ("risk_status","risk_flagged_at") WHERE risk_status <> 'none';