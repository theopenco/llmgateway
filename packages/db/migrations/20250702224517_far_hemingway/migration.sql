CREATE TABLE "installation" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"uuid" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "installation_uuid_unique" UNIQUE("uuid")
);
