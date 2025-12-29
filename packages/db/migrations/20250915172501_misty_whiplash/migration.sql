CREATE TABLE "model" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text,
	"family" text NOT NULL,
	"json_output" boolean,
	"free" boolean,
	"deprecated_at" timestamp,
	"deactivated_at" timestamp,
	"output" json,
	"status" text DEFAULT 'active' NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"throughput" real DEFAULT 0 NOT NULL,
	"stats_updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "model_history" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	"minute_timestamp" timestamp NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"client_errors_count" integer DEFAULT 0 NOT NULL,
	"gateway_errors_count" integer DEFAULT 0 NOT NULL,
	"upstream_errors_count" integer DEFAULT 0 NOT NULL,
	"throughput" real DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_cached_tokens" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "model_history_modelId_minuteTimestamp_unique" UNIQUE("model_id","minute_timestamp")
);
--> statement-breakpoint
CREATE TABLE "model_provider_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_name" text NOT NULL,
	"input_price" numeric,
	"output_price" numeric,
	"cached_input_price" numeric,
	"image_input_price" numeric,
	"request_price" numeric,
	"context_size" integer,
	"max_output" integer,
	"streaming" boolean DEFAULT false NOT NULL,
	"vision" boolean,
	"reasoning" boolean,
	"reasoning_output" text,
	"tools" boolean,
	"supported_parameters" json,
	"test" text,
	"status" text DEFAULT 'active' NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"throughput" real DEFAULT 0 NOT NULL,
	"stats_updated_at" timestamp,
	CONSTRAINT "model_provider_mapping_modelId_providerId_unique" UNIQUE("model_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "model_provider_mapping_history" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_provider_mapping_id" text NOT NULL,
	"minute_timestamp" timestamp NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"client_errors_count" integer DEFAULT 0 NOT NULL,
	"gateway_errors_count" integer DEFAULT 0 NOT NULL,
	"upstream_errors_count" integer DEFAULT 0 NOT NULL,
	"throughput" real DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_cached_tokens" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "model_provider_mapping_history_modelProviderMappingId_minuteTimestamp_unique" UNIQUE("model_provider_mapping_id","minute_timestamp")
);
--> statement-breakpoint
CREATE TABLE "provider" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"streaming" boolean,
	"cancellation" boolean,
	"json_output" boolean,
	"color" text,
	"website" text,
	"announcement" text,
	"status" text DEFAULT 'active' NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"throughput" real DEFAULT 0 NOT NULL,
	"stats_updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD CONSTRAINT "model_provider_mapping_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD CONSTRAINT "model_provider_mapping_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE cascade ON UPDATE no action;