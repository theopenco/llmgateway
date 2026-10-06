CREATE TABLE "api_key_iam_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"api_key_id" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_value" json NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_iam_rule" ADD CONSTRAINT "api_key_iam_rule_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_iam_rule_api_key_id_idx" ON "api_key_iam_rule" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "api_key_iam_rule_rule_type_idx" ON "api_key_iam_rule" USING btree ("rule_type");