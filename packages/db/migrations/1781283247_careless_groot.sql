CREATE TABLE "model_rating" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	CONSTRAINT "model_rating_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_rating_user_id_model_id_unique" ON "model_rating" ("user_id","model_id");--> statement-breakpoint
CREATE INDEX "model_rating_model_id_idx" ON "model_rating" ("model_id");--> statement-breakpoint
ALTER TABLE "model_rating" ADD CONSTRAINT "model_rating_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;