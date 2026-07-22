CREATE TABLE "model_survey_response" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"model_id" text NOT NULL,
	"value_score" integer NOT NULL,
	"quality_score" integer NOT NULL,
	"speed_score" integer NOT NULL,
	"would_recommend" boolean NOT NULL,
	"primary_use_case" text NOT NULL,
	"comment" text,
	"request_count" integer NOT NULL,
	"dev_plan_tier" text NOT NULL,
	"reward_tier" text,
	CONSTRAINT "model_survey_response_quarter_check" CHECK ("quarter" >= 1 AND "quarter" <= 4),
	CONSTRAINT "model_survey_response_value_score_check" CHECK ("value_score" >= 1 AND "value_score" <= 5),
	CONSTRAINT "model_survey_response_quality_score_check" CHECK ("quality_score" >= 1 AND "quality_score" <= 5),
	CONSTRAINT "model_survey_response_speed_score_check" CHECK ("speed_score" >= 1 AND "speed_score" <= 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_survey_response_user_model_period_unique" ON "model_survey_response" ("user_id","model_id","year","quarter");--> statement-breakpoint
CREATE UNIQUE INDEX "model_survey_response_org_period_reward_unique" ON "model_survey_response" ("organization_id","year","quarter") WHERE "reward_tier" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "model_survey_response_year_model_idx" ON "model_survey_response" ("year","model_id");--> statement-breakpoint
CREATE INDEX "model_survey_response_organization_id_idx" ON "model_survey_response" ("organization_id");--> statement-breakpoint
ALTER TABLE "model_survey_response" ADD CONSTRAINT "model_survey_response_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_survey_response" ADD CONSTRAINT "model_survey_response_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;