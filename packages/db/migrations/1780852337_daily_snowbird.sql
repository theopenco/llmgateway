DROP INDEX "api_key_project_end_user_sessions_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_end_user_customer_wallet_unique" ON "api_key" ("end_customer_wallet_id") WHERE "key_type" = 'end_user_customer' AND "status" = 'active';
