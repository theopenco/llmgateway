CREATE TABLE "routing_election_hourly" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"selection_reason" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"service_tier_explicit_count" integer DEFAULT 0 NOT NULL,
	"service_tier_implicit_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "routing_election_hourly_hour_timestamp_model_id_provider_id_selection_reason_unique" UNIQUE("hour_timestamp","model_id","provider_id","selection_reason")
);
--> statement-breakpoint
CREATE TABLE "routing_exclusion_hourly" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"reason" text NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "routing_exclusion_hourly_hour_timestamp_model_id_provider_id_reason_unique" UNIQUE("hour_timestamp","model_id","provider_id","reason")
);
--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "service_tier_explicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "service_tier_implicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "service_tier_served_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "service_tier_unconfirmed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "service_tier_explicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "service_tier_implicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "service_tier_served_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "service_tier_unconfirmed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "service_tier_explicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "service_tier_implicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "service_tier_served_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "service_tier_unconfirmed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "service_tier_explicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "service_tier_implicit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "service_tier_served_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "service_tier_unconfirmed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "routing_election_hourly_model_ts_idx" ON "routing_election_hourly" ("model_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "routing_election_hourly_ts_idx" ON "routing_election_hourly" ("hour_timestamp");--> statement-breakpoint
CREATE INDEX "routing_exclusion_hourly_model_ts_idx" ON "routing_exclusion_hourly" ("model_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "routing_exclusion_hourly_ts_reason_idx" ON "routing_exclusion_hourly" ("hour_timestamp","reason");