CREATE TABLE "scim_group" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"external_id" text,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_group_member" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"scim_group_id" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_token" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"masked_token" text NOT NULL,
	"organization_id" text NOT NULL,
	"sso_provider_id" text,
	"created_by" text,
	"last_used_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"issuer" text NOT NULL,
	"domain" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text,
	"provider_id" text NOT NULL UNIQUE,
	"organization_id" text,
	"enforced" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_role_mapping" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"group_name" text NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "scim_external_id" text;--> statement-breakpoint
CREATE INDEX "scim_group_organization_id_idx" ON "scim_group" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_org_display_name_unique" ON "scim_group" ("organization_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_group_member_group_user_unique" ON "scim_group_member" ("scim_group_id","user_id");--> statement-breakpoint
CREATE INDEX "scim_group_member_user_id_idx" ON "scim_group_member" ("user_id");--> statement-breakpoint
CREATE INDEX "scim_token_organization_id_idx" ON "scim_token" ("organization_id");--> statement-breakpoint
CREATE INDEX "scim_token_token_hash_idx" ON "scim_token" ("token_hash");--> statement-breakpoint
CREATE INDEX "sso_provider_organization_id_idx" ON "sso_provider" ("organization_id");--> statement-breakpoint
CREATE INDEX "sso_provider_domain_idx" ON "sso_provider" ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sso_role_mapping_org_group_unique" ON "sso_role_mapping" ("organization_id","group_name");--> statement-breakpoint
CREATE INDEX "user_organization_scim_external_id_idx" ON "user_organization" ("organization_id","scim_external_id");--> statement-breakpoint
ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_scim_group_id_scim_group_id_fkey" FOREIGN KEY ("scim_group_id") REFERENCES "scim_group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sso_role_mapping" ADD CONSTRAINT "sso_role_mapping_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;