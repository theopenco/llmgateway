CREATE TABLE "routing_score_multiplier" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider" text,
	"model" text,
	"score_multiplier" numeric NOT NULL,
	"reason" text,
	"expires_at" timestamp,
	CONSTRAINT "routing_score_multiplier_provider_model_unique" UNIQUE("provider","model")
);
--> statement-breakpoint
CREATE INDEX "routing_score_multiplier_provider_idx" ON "routing_score_multiplier" ("provider");--> statement-breakpoint
CREATE INDEX "routing_score_multiplier_model_idx" ON "routing_score_multiplier" ("model");