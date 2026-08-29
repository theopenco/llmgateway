CREATE TABLE "dev_plan_card_fingerprint_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"fingerprint" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE INDEX "dev_plan_card_fingerprint_history_organization_id_idx" ON "dev_plan_card_fingerprint_history" ("organization_id");--> statement-breakpoint
ALTER TABLE "dev_plan_card_fingerprint_history" ADD CONSTRAINT "dev_plan_card_fingerprint_history_mCpvRy5VxjMM_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "dev_plan_card_fingerprint_history" ("id", "organization_id", "fingerprint")
SELECT 'backfill_' || "id", "id", "dev_plan_card_fingerprint"
FROM "organization"
WHERE "dev_plan_card_fingerprint" IS NOT NULL
ON CONFLICT ("fingerprint") DO NOTHING;
