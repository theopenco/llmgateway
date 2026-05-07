CREATE TABLE "global_daily_aggregation_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"last_processed_hour" timestamp,
	"last_safety_net_day" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
