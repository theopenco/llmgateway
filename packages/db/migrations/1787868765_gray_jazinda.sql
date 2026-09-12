CREATE TABLE "organization_team" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"max_api_keys" integer,
	"usage_limit" numeric,
	"period_usage_limit" numeric,
	"period_usage_duration_value" integer,
	"period_usage_duration_unit" text
);
--> statement-breakpoint
CREATE TABLE "organization_team_iam_rule" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"team_id" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_value" json NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_team_project" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_team_mapping" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"group_name" text NOT NULL,
	"team_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "team_assignment_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_team_organization_id_idx" ON "organization_team" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_team_org_name_uidx" ON "organization_team" ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "organization_team_org_default_uidx" ON "organization_team" ("organization_id") WHERE "is_default";--> statement-breakpoint
CREATE INDEX "organization_team_iam_rule_team_id_idx" ON "organization_team_iam_rule" ("team_id");--> statement-breakpoint
CREATE INDEX "organization_team_iam_rule_team_id_status_idx" ON "organization_team_iam_rule" ("team_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_team_project_team_project_uidx" ON "organization_team_project" ("team_id","project_id");--> statement-breakpoint
CREATE INDEX "organization_team_project_team_id_idx" ON "organization_team_project" ("team_id");--> statement-breakpoint
CREATE INDEX "organization_team_project_project_id_idx" ON "organization_team_project" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_team_mapping_org_group_unique" ON "sso_team_mapping" ("organization_id","group_name");--> statement-breakpoint
CREATE INDEX "sso_team_mapping_team_id_idx" ON "sso_team_mapping" ("team_id");--> statement-breakpoint
CREATE INDEX "user_organization_team_id_idx" ON "user_organization" ("team_id");--> statement-breakpoint
ALTER TABLE "organization_team" ADD CONSTRAINT "organization_team_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_team_iam_rule" ADD CONSTRAINT "organization_team_iam_rule_team_id_organization_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "organization_team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_team_project" ADD CONSTRAINT "organization_team_project_team_id_organization_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "organization_team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_team_project" ADD CONSTRAINT "organization_team_project_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sso_team_mapping" ADD CONSTRAINT "sso_team_mapping_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sso_team_mapping" ADD CONSTRAINT "sso_team_mapping_team_id_organization_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "organization_team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_organization" ADD CONSTRAINT "user_organization_team_id_organization_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "organization_team"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "user_organization" ADD CONSTRAINT "user_organization_team_developer_check" CHECK ("team_id" IS NULL OR "role" = 'developer');--> statement-breakpoint
-- Backfill personal project grants for developer memberships that predate
-- project grants: user_project shipped without a backfill, and the gateway
-- now fail-closes developer keys whose creator lacks a grant for the key's
-- project. Only memberships with NO grant rows are touched — any existing
-- grant row means the membership has been managed since grants shipped, so
-- its missing grants are deliberate revocations and must stay revoked. Each
-- legacy membership receives exactly the projects of its own active developer
-- keys, preserving current traffic at least privilege.
INSERT INTO "user_project" ("id", "user_organization_id", "project_id")
SELECT gen_random_uuid()::text, "grants"."membership_id", "grants"."project_id"
FROM (
	SELECT DISTINCT "uo"."id" AS "membership_id", "ak"."project_id"
	FROM "user_organization" "uo"
	JOIN "api_key" "ak"
		ON "ak"."created_by" = "uo"."user_id"
		AND "ak"."key_type" = 'user'
		AND ("ak"."status" IS NULL OR "ak"."status" = 'active')
	JOIN "project" "p"
		ON "p"."id" = "ak"."project_id"
		AND "p"."organization_id" = "uo"."organization_id"
		AND "p"."status" <> 'deleted'
	WHERE "uo"."role" = 'developer'
		AND NOT EXISTS (
			SELECT 1 FROM "user_project" "up"
			WHERE "up"."user_organization_id" = "uo"."id"
		)
) AS "grants"
ON CONFLICT DO NOTHING;