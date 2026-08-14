ALTER TABLE "organization" ADD COLUMN "pro_seats" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_extra_api_keys" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_extra_projects" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_sso_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_scim_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "amount_breakdown" json;