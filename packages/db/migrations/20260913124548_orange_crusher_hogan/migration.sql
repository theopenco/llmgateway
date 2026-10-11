CREATE TABLE "lounge_connection" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"credentials" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lounge_connector_authorization" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"connector_id" text NOT NULL,
	"credentials" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lounge_connection_user_connector_idx" ON "lounge_connection" ("user_id","connector_id");--> statement-breakpoint
CREATE INDEX "lounge_connector_authorization_user_idx" ON "lounge_connector_authorization" ("user_id");--> statement-breakpoint
CREATE INDEX "lounge_connector_authorization_expiry_idx" ON "lounge_connector_authorization" ("expires_at");--> statement-breakpoint
ALTER TABLE "lounge_connection" ADD CONSTRAINT "lounge_connection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lounge_connector_authorization" ADD CONSTRAINT "lounge_connector_authorization_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;