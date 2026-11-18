CREATE TABLE "content_filter_flagged_payload" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"classifier" text NOT NULL,
	"tier" integer NOT NULL,
	"level" text NOT NULL,
	"action" text NOT NULL,
	"matched_groups" jsonb NOT NULL,
	"matched_categories" jsonb NOT NULL,
	"category_scores" jsonb NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"payload_bytes" integer NOT NULL,
	"payload_truncated" boolean DEFAULT false NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"reported_at" timestamp,
	"report_reference" text,
	"reported_by_user_id" text
);
--> statement-breakpoint
CREATE INDEX "content_filter_flagged_payload_org_created_at_idx" ON "content_filter_flagged_payload" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "content_filter_flagged_payload_created_at_idx" ON "content_filter_flagged_payload" ("created_at");--> statement-breakpoint
CREATE INDEX "content_filter_flagged_payload_expires_at_idx" ON "content_filter_flagged_payload" ("expires_at");--> statement-breakpoint
CREATE INDEX "content_filter_flagged_payload_request_id_idx" ON "content_filter_flagged_payload" ("request_id");