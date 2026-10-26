CREATE TABLE "internal_classifier_check" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"used_model" text DEFAULT '' NOT NULL,
	"used_provider" text DEFAULT '' NOT NULL,
	"internal_scope" text DEFAULT '' NOT NULL,
	"tier" integer,
	"level" text,
	"action" text,
	"decision" text NOT NULL,
	"rule" text DEFAULT '' NOT NULL,
	"reasons" text[] NOT NULL,
	"tags" text[] NOT NULL,
	"score" real,
	"salt_id" text,
	"algo_version" integer,
	"fp_status" text,
	"prompt_bytes" integer,
	"simhash" text,
	"simhash_global" text,
	"exact_hash" text,
	"conversation_key" text,
	"minhash_b64" text,
	"band_keys" text[],
	CONSTRAINT "internal_classifier_check_request_chunk_unique" UNIQUE("request_id","chunk_index")
);
--> statement-breakpoint
CREATE INDEX "internal_classifier_check_created_at_idx" ON "internal_classifier_check" ("created_at");--> statement-breakpoint
CREATE INDEX "internal_classifier_check_block_created_at_idx" ON "internal_classifier_check" ("created_at") WHERE "decision" = 'block';