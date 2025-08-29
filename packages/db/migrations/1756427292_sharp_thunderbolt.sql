CREATE TABLE "model_provider_mapping_history" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"minute_timestamp" timestamp NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"error_rate" real DEFAULT 0 NOT NULL,
	"throughput" real DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "model_provider_mapping_history_modelId_providerId_minuteTimestamp_unique" UNIQUE("model_id","provider_id","minute_timestamp")
);
--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD CONSTRAINT "model_provider_mapping_history_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD CONSTRAINT "model_provider_mapping_history_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE cascade ON UPDATE no action;