-- Existing databases: follow README.md before deploying. Quiesce fulfillment,
-- reconcile duplicate completed intents with authorization, then build outside
-- a transaction to avoid blocking billing writes during the history-table scan:
-- CREATE UNIQUE INDEX CONCURRENTLY "transaction_credit_topup_payment_intent_unique" ON "transaction" ("stripe_payment_intent_id") WHERE "type" = 'credit_topup' AND "status" = 'completed';
-- IF NOT EXISTS adopts that verified index; fresh databases build inline.
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_credit_topup_payment_intent_unique" ON "transaction" ("stripe_payment_intent_id") WHERE "type" = 'credit_topup' AND "status" = 'completed';
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_index
		WHERE indexrelid = 'transaction_credit_topup_payment_intent_unique'::regclass
			AND indrelid = 'transaction'::regclass
			AND indisvalid AND indisunique AND indnatts = 1
			AND pg_get_indexdef(indexrelid, 1, true) = 'stripe_payment_intent_id'
			AND pg_get_expr(indpred, indrelid) = '((type = ''credit_topup''::text) AND (status = ''completed''::text))'
	) THEN
		RAISE EXCEPTION 'Credit top-up idempotency index is invalid or has the wrong definition; see migration README.md';
	END IF;
END $$;
