CREATE TABLE "skill" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX "skill_user_id_idx" ON "skill" ("user_id");--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;