ALTER TABLE "organization" ADD COLUMN "kind" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
UPDATE "organization" SET "kind" = 'devpass' WHERE "is_personal" = true;--> statement-breakpoint
UPDATE "organization" SET "kind" = 'chat' WHERE "is_chat" = true AND "is_personal" = false;--> statement-breakpoint
UPDATE "organization" SET "name" = 'DevPass' WHERE "kind" = 'devpass' AND "name" IN ('Personal', 'Default Organization');--> statement-breakpoint
UPDATE "organization" SET "name" = 'Chat' WHERE "kind" = 'chat' AND "name" IN ('Personal', 'Default Organization');--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "is_personal";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "is_chat";