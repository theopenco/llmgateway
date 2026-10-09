CREATE TABLE "lock" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "lock_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "auto_top_up_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "auto_top_up_threshold" numeric DEFAULT '10';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "auto_top_up_amount" numeric DEFAULT '10';