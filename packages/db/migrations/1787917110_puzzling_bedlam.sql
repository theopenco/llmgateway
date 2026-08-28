CREATE TABLE "dev_plan_card_fingerprint_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "dev_plan_card_fingerprint_history_org_fingerprint_unique" UNIQUE("organization_id","fingerprint")
);
--> statement-breakpoint
CREATE INDEX "dev_plan_card_fingerprint_history_fingerprint_idx" ON "dev_plan_card_fingerprint_history" ("fingerprint");--> statement-breakpoint
ALTER TABLE "dev_plan_card_fingerprint_history" ADD CONSTRAINT "dev_plan_card_fingerprint_history_mCpvRy5VxjMM_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "dev_plan_card_fingerprint_history" ("id", "organization_id", "fingerprint")
SELECT "id" || ':devpass-card:' || md5("dev_plan_card_fingerprint"), "id", "dev_plan_card_fingerprint"
FROM "organization"
WHERE "dev_plan_card_fingerprint" IS NOT NULL
ON CONFLICT ("organization_id", "fingerprint") DO NOTHING;
