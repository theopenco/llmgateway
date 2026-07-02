CREATE TABLE "user_project" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_organization_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_project_membership_project_unique" ON "user_project" ("user_organization_id","project_id");--> statement-breakpoint
CREATE INDEX "user_project_user_organization_id_idx" ON "user_project" ("user_organization_id");--> statement-breakpoint
CREATE INDEX "user_project_project_id_idx" ON "user_project" ("project_id");--> statement-breakpoint
ALTER TABLE "user_project" ADD CONSTRAINT "user_project_user_organization_id_user_organization_id_fkey" FOREIGN KEY ("user_organization_id") REFERENCES "user_organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_project" ADD CONSTRAINT "user_project_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Backfill: existing developer members keep access to every current project in
-- their org so nobody loses access. Admins control new projects going forward.
INSERT INTO "user_project" ("id", "user_organization_id", "project_id")
SELECT substr(md5(uo.id || ':' || p.id), 1, 24), uo.id, p.id
FROM "user_organization" uo
JOIN "project" p ON p.organization_id = uo.organization_id
WHERE uo.role = 'developer' AND p.status != 'deleted';