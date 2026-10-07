CREATE TABLE "crm_account" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"display_name" text,
	"stage" text,
	"owner_email" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"deal_value" numeric,
	"close_date" timestamp,
	"website" text,
	"industry" text,
	"employee_count" text,
	"headquarters" text,
	"linkedin_url" text,
	"use_case" text,
	"competitors" text,
	"tags" json DEFAULT '[]' NOT NULL,
	"notes" text,
	"lost_reason" text,
	"manual" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_activity" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"contact_email" text,
	"author_email" text,
	"due_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "crm_contact" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"title" text,
	"role" text,
	"phone" text,
	"linkedin_url" text,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "crm_activity_account_id_idx" ON "crm_activity" ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activity_due_at_idx" ON "crm_activity" ("due_at") WHERE completed_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contact_account_email_idx" ON "crm_contact" ("account_id","email");--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_account_id_crm_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_account"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_contact" ADD CONSTRAINT "crm_contact_account_id_crm_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "crm_account"("id") ON DELETE CASCADE;