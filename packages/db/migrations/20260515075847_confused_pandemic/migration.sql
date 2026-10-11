CREATE TABLE "user_favorite_model" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_favorite_model_user_id_model_id_unique" ON "user_favorite_model" ("user_id","model_id");--> statement-breakpoint
ALTER TABLE "user_favorite_model" ADD CONSTRAINT "user_favorite_model_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;