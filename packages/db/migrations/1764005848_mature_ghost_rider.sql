ALTER TABLE "log" ADD COLUMN "storage_cost" real;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "retention_level" SET DEFAULT 'metadata';