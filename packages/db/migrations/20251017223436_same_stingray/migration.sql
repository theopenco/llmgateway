-- Add role column to user_organization first
ALTER TABLE "user_organization" ADD COLUMN "role" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint

-- Add created_by column as nullable first to handle existing data
ALTER TABLE "api_key" ADD COLUMN "created_by" text;--> statement-breakpoint

-- Set creator for existing API keys: assign to the first user in the organization
UPDATE "api_key"
SET "created_by" = (
	SELECT uo."user_id"
	FROM "project" p
				 JOIN "user_organization" uo ON uo."organization_id" = p."organization_id"
	WHERE p."id" = "api_key"."project_id"
	ORDER BY uo."created_at" ASC
	LIMIT 1
	)
WHERE "created_by" IS NULL;--> statement-breakpoint

-- Now make the column NOT NULL after all existing rows have been updated
ALTER TABLE "api_key" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint

-- Add foreign key constraint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Create index for better query performance
CREATE INDEX "api_key_created_by_idx" ON "api_key" USING btree ("created_by");
