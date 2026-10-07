CREATE TABLE "dev_plan_cancellation_feedback" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"dev_plan_stripe_subscription_id" text NOT NULL,
	"previous_dev_plan" text,
	"reason" text NOT NULL,
	"comments" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dev_plan_cancellation_feedback_org_sub_unique" ON "dev_plan_cancellation_feedback" ("organization_id","dev_plan_stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "dev_plan_cancellation_feedback_organization_id_idx" ON "dev_plan_cancellation_feedback" ("organization_id");--> statement-breakpoint
ALTER TABLE "dev_plan_cancellation_feedback" ADD CONSTRAINT "dev_plan_cancellation_feedback_FlmxK90wrnKv_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dev_plan_cancellation_feedback" ADD CONSTRAINT "dev_plan_cancellation_feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;