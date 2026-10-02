CREATE TABLE "platform_audit_log" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE INDEX "platform_audit_log_resource_idx" ON "platform_audit_log" ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_log_created_at_idx" ON "platform_audit_log" ("created_at");--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;