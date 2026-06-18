ALTER TABLE "organization" ADD COLUMN "kind" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
UPDATE "organization" SET "kind" = 'devpass' WHERE "is_personal" = true;--> statement-breakpoint
UPDATE "organization" SET "kind" = 'chat' WHERE "is_chat" = true;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "is_personal";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "is_chat";