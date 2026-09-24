CREATE TABLE "email_unsubscribe" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"category" text NOT NULL,
	"source" text DEFAULT 'one_click' NOT NULL,
	CONSTRAINT "email_unsubscribe_email_category_unique" UNIQUE("email","category")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "email_preferences" json;--> statement-breakpoint
CREATE INDEX "email_unsubscribe_email_idx" ON "email_unsubscribe" ("email");