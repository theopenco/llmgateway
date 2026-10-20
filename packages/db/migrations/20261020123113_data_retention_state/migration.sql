CREATE TABLE "data_retention_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"cursor_created_at" text NOT NULL,
	"cursor_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
