ALTER TABLE "log" ADD COLUMN "data_storage_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "retention_level" SET DEFAULT 'none';