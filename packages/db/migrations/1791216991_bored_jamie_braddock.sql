CREATE TABLE "prompt" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"latest_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "prompt_project_id_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "prompt_label" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"prompt_id" text NOT NULL,
	"label" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "prompt_label_prompt_id_label_unique" UNIQUE("prompt_id","label")
);
--> statement-breakpoint
CREATE TABLE "prompt_version" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"prompt_id" text NOT NULL,
	"version" integer NOT NULL,
	"messages" jsonb NOT NULL,
	"model" text,
	"parameters" jsonb DEFAULT '{}' NOT NULL,
	"variables" jsonb DEFAULT '[]' NOT NULL,
	"commit_message" text,
	"created_by" text,
	CONSTRAINT "prompt_version_prompt_id_version_unique" UNIQUE("prompt_id","version")
);
--> statement-breakpoint
CREATE INDEX "prompt_project_id_idx" ON "prompt" ("project_id");--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt_label" ADD CONSTRAINT "prompt_label_prompt_id_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompt"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_prompt_id_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompt"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;