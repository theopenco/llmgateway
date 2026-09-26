CREATE TABLE "benchmark_run" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"requested_by" text,
	"model_id" text NOT NULL,
	"mappings" json DEFAULT '[]' NOT NULL,
	"profile" text DEFAULT 'smoke' NOT NULL,
	"budget_ms" integer DEFAULT 120000 NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"runs" integer,
	"seed" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"targets" json,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "benchmark_run_queue_idx" ON "benchmark_run" ("status","created_at");--> statement-breakpoint
CREATE INDEX "benchmark_run_model_idx" ON "benchmark_run" ("model_id","created_at");--> statement-breakpoint
ALTER TABLE "benchmark_run" ADD CONSTRAINT "benchmark_run_requested_by_user_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE SET NULL;