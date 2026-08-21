CREATE TABLE "lounge_point_event" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lounge_point_event_user_id_idx" ON "lounge_point_event" ("user_id");--> statement-breakpoint
CREATE INDEX "lounge_point_event_user_id_created_at_idx" ON "lounge_point_event" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "lounge_point_event" ADD CONSTRAINT "lounge_point_event_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;