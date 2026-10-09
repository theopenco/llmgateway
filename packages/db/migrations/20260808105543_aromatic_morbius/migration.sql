CREATE TABLE "dynamic_route" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"draft_graph" jsonb,
	"published_version_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_route_project_id_name_idx" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "dynamic_route_version" (
	"id" text PRIMARY KEY,
	"route_id" text NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_route_version_route_id_version_idx" UNIQUE("route_id","version")
);
--> statement-breakpoint
CREATE INDEX "dynamic_route_project_id_idx" ON "dynamic_route" ("project_id");--> statement-breakpoint
CREATE INDEX "dynamic_route_version_route_id_idx" ON "dynamic_route_version" ("route_id");--> statement-breakpoint
ALTER TABLE "dynamic_route" ADD CONSTRAINT "dynamic_route_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dynamic_route" ADD CONSTRAINT "dynamic_route_apFAsROqctNK_fkey" FOREIGN KEY ("published_version_id") REFERENCES "dynamic_route_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dynamic_route_version" ADD CONSTRAINT "dynamic_route_version_route_id_dynamic_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "dynamic_route"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dynamic_route_version" ADD CONSTRAINT "dynamic_route_version_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;