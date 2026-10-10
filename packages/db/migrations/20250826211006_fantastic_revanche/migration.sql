ALTER TABLE "message" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "images" text;