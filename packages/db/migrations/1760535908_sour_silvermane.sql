ALTER TABLE "api_key" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "role" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_created_by_idx" ON "api_key" USING btree ("created_by");