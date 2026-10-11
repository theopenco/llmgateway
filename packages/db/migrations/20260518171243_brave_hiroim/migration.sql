CREATE TABLE "master_key" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"masked_token" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'active',
	"last_used_at" timestamp,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "master_key_organization_id_idx" ON "master_key" ("organization_id");--> statement-breakpoint
CREATE INDEX "master_key_token_hash_idx" ON "master_key" ("token_hash");--> statement-breakpoint
CREATE INDEX "master_key_created_by_idx" ON "master_key" ("created_by");--> statement-breakpoint
ALTER TABLE "master_key" ADD CONSTRAINT "master_key_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "master_key" ADD CONSTRAINT "master_key_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;