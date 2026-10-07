CREATE TABLE "discount" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text,
	"provider" text,
	"model" text,
	"discount_percent" numeric NOT NULL,
	"reason" text,
	"expires_at" timestamp,
	CONSTRAINT "discount_org_provider_model_unique" UNIQUE("organization_id","provider","model")
);
--> statement-breakpoint
CREATE INDEX "discount_organization_id_idx" ON "discount" ("organization_id");--> statement-breakpoint
CREATE INDEX "discount_provider_idx" ON "discount" ("provider");--> statement-breakpoint
CREATE INDEX "discount_model_idx" ON "discount" ("model");--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;