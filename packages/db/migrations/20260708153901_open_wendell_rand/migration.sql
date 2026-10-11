ALTER TABLE "project" ADD COLUMN "end_user_top_up_bonus_percent" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet" ADD COLUMN "bonus_percent_override" numeric;