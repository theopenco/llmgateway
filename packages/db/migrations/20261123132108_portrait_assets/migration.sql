CREATE TABLE "portrait_asset" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL,
	"created_by" text,
	"name" text,
	"asset_type" text NOT NULL,
	"upstream_asset_id" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "portrait_group" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"credential_source" text NOT NULL,
	"provider_key_id" text,
	"project_name" text DEFAULT 'default' NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"upstream_group_id" text,
	"verification_token_ciphertext" text,
	"verified_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "provider_key_asset_credential" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_key_id" text NOT NULL UNIQUE,
	"organization_id" text,
	"access_key_id_masked" text NOT NULL,
	"credentials_ciphertext" text NOT NULL,
	"project_name" text DEFAULT 'default' NOT NULL,
	"region" text DEFAULT 'ap-southeast-1' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "portrait_asset_organization_id_idx" ON "portrait_asset" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portrait_asset_group_id_upstream_asset_id_idx" ON "portrait_asset" ("group_id","upstream_asset_id");--> statement-breakpoint
CREATE INDEX "portrait_group_organization_id_idx" ON "portrait_group" ("organization_id");--> statement-breakpoint
CREATE INDEX "portrait_group_provider_key_id_idx" ON "portrait_group" ("provider_key_id");--> statement-breakpoint
CREATE INDEX "provider_key_asset_credential_organization_id_idx" ON "provider_key_asset_credential" ("organization_id");--> statement-breakpoint
ALTER TABLE "portrait_asset" ADD CONSTRAINT "portrait_asset_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portrait_asset" ADD CONSTRAINT "portrait_asset_group_id_portrait_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "portrait_group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portrait_asset" ADD CONSTRAINT "portrait_asset_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "portrait_group" ADD CONSTRAINT "portrait_group_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portrait_group" ADD CONSTRAINT "portrait_group_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "portrait_group" ADD CONSTRAINT "portrait_group_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_key_asset_credential" ADD CONSTRAINT "provider_key_asset_credential_b3cZ4GCPxxyG_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_key_asset_credential" ADD CONSTRAINT "provider_key_asset_credential_BbilIoBM3ppI_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;