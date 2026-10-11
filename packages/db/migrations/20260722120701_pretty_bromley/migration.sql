CREATE TABLE "user_iam_rule" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_organization_id" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_value" json NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_iam_rule_user_organization_id_idx" ON "user_iam_rule" ("user_organization_id");--> statement-breakpoint
CREATE INDEX "user_iam_rule_user_organization_id_status_idx" ON "user_iam_rule" ("user_organization_id","status");--> statement-breakpoint
ALTER TABLE "user_iam_rule" ADD CONSTRAINT "user_iam_rule_user_organization_id_user_organization_id_fkey" FOREIGN KEY ("user_organization_id") REFERENCES "user_organization"("id") ON DELETE CASCADE;