CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'active',
	"usage_limit" numeric,
	"usage" numeric DEFAULT '0' NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "api_key_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'active'
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"uuid" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "installation_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "lock" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "lock_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "log" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"duration" integer NOT NULL,
	"requested_model" text NOT NULL,
	"requested_provider" text,
	"used_model" text NOT NULL,
	"used_provider" text NOT NULL,
	"response_size" integer NOT NULL,
	"content" text,
	"reasoning_content" text,
	"tools" json,
	"tool_choice" json,
	"tool_results" json,
	"finish_reason" text,
	"unified_finish_reason" text,
	"prompt_tokens" numeric,
	"completion_tokens" numeric,
	"total_tokens" numeric,
	"reasoning_tokens" numeric,
	"cached_tokens" numeric,
	"messages" json,
	"temperature" real,
	"max_tokens" integer,
	"top_p" real,
	"frequency_penalty" real,
	"presence_penalty" real,
	"reasoning_effort" text,
	"has_error" boolean DEFAULT false,
	"error_details" json,
	"cost" real,
	"input_cost" real,
	"output_cost" real,
	"cached_input_cost" real,
	"request_cost" real,
	"estimated_cost" boolean DEFAULT false,
	"canceled" boolean DEFAULT false,
	"streamed" boolean DEFAULT false,
	"cached" boolean DEFAULT false,
	"mode" text NOT NULL,
	"used_mode" text NOT NULL,
	"source" text,
	"custom_headers" json,
	"processed_at" timestamp,
	"raw_request" jsonb,
	"raw_response" jsonb,
	"upstream_request" jsonb,
	"upstream_response" jsonb
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"images" text,
	"sequence" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"credits" numeric DEFAULT '0' NOT NULL,
	"auto_top_up_enabled" boolean DEFAULT false NOT NULL,
	"auto_top_up_threshold" numeric DEFAULT '10',
	"auto_top_up_amount" numeric DEFAULT '10',
	"plan" text DEFAULT 'free' NOT NULL,
	"plan_expires_at" timestamp,
	"subscription_cancelled" boolean DEFAULT false NOT NULL,
	"trial_start_date" timestamp,
	"trial_end_date" timestamp,
	"is_trial_active" boolean DEFAULT false NOT NULL,
	"retention_level" text DEFAULT 'retain' NOT NULL,
	"status" text DEFAULT 'active',
	CONSTRAINT "organization_stripeCustomerId_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "organization_stripeSubscriptionId_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "organization_action" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text,
	"backed_up" boolean,
	"transports" text
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"caching_enabled" boolean DEFAULT false NOT NULL,
	"cache_duration_seconds" integer DEFAULT 60 NOT NULL,
	"mode" text DEFAULT 'hybrid' NOT NULL,
	"status" text DEFAULT 'active'
);
--> statement-breakpoint
CREATE TABLE "provider_key" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token" text NOT NULL,
	"provider" text NOT NULL,
	"name" text,
	"base_url" text,
	"status" text DEFAULT 'active',
	"organization_id" text NOT NULL,
	CONSTRAINT "provider_key_organizationId_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp DEFAULT now() NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric,
	"credit_amount" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_invoice_id" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_organization" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_action" ADD CONSTRAINT "organization_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organization" ADD CONSTRAINT "user_organization_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organization" ADD CONSTRAINT "user_organization_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;