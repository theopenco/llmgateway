CREATE TABLE "sandbox_escape_run" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"level_id" integer NOT NULL,
	"model" text NOT NULL,
	"used_model" text,
	"used_provider" text,
	"outcome" text NOT NULL,
	"steps" integer NOT NULL,
	"par" integer NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"moves" jsonb NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_escape_run_level_id_idx" ON "sandbox_escape_run" ("level_id");--> statement-breakpoint
CREATE INDEX "sandbox_escape_run_model_idx" ON "sandbox_escape_run" ("model");--> statement-breakpoint
CREATE INDEX "sandbox_escape_run_user_id_idx" ON "sandbox_escape_run" ("user_id");--> statement-breakpoint
CREATE INDEX "sandbox_escape_run_created_at_idx" ON "sandbox_escape_run" ("created_at");--> statement-breakpoint
ALTER TABLE "sandbox_escape_run" ADD CONSTRAINT "sandbox_escape_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox_escape_run" ADD CONSTRAINT "sandbox_escape_run_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;