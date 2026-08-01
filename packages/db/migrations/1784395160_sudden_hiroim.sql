CREATE TABLE "ignored_error_matcher" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"pattern" text,
	"status_code" integer,
	CONSTRAINT "ignored_error_matcher_target_check" CHECK ("pattern" IS NOT NULL OR "status_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ignored_error_matcher_pattern_status_code_unique" ON "ignored_error_matcher" (coalesce("pattern", ''),coalesce("status_code", -1));