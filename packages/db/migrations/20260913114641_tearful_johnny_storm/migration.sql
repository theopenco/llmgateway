CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text,
	"type" text NOT NULL,
	"event_key" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"href" text NOT NULL,
	"in_app" boolean NOT NULL,
	"email" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp,
	"email_sent_at" timestamp,
	CONSTRAINT "notification_user_id_event_key_unique" UNIQUE("user_id","event_key")
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"budget_threshold" integer DEFAULT 80 NOT NULL,
	CONSTRAINT "notification_preference_user_id_type_unique" UNIQUE("user_id","type")
);
--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_pending_email_idx" ON "notification" ("created_at") WHERE "email" = true AND "email_sent_at" IS NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;