CREATE TABLE "org_limit_hit_daily" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"day" timestamp NOT NULL,
	"limit_type" text NOT NULL,
	"endpoint_key" text DEFAULT '' NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"blocked_usd" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "org_limit_hit_daily_organization_id_day_limit_type_endpoint_key_unique" UNIQUE("organization_id","day","limit_type","endpoint_key")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "trust_tier_override" integer;--> statement-breakpoint
CREATE INDEX "org_limit_hit_daily_day_idx" ON "org_limit_hit_daily" ("day");--> statement-breakpoint
CREATE INDEX "transaction_org_topup_created_at_idx" ON "transaction" ("organization_id","created_at") WHERE "type" = 'credit_topup';--> statement-breakpoint
ALTER TABLE "org_limit_hit_daily" ADD CONSTRAINT "org_limit_hit_daily_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;