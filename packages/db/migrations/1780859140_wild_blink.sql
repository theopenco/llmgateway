CREATE INDEX IF NOT EXISTS "log_end_customer_wallet_id_created_at_idx" ON "log" ("end_customer_wallet_id","created_at") WHERE end_customer_wallet_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_end_user_session_id_created_at_idx" ON "log" ("end_user_session_id","created_at") WHERE end_user_session_id IS NOT NULL;
