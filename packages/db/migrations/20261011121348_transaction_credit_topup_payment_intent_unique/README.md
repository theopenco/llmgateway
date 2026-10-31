# Credit top-up idempotency rollout

Existing databases require an authorized operator before deployment. Do not run
production queries, reconcile balances, or build the index without authorization.
Fresh databases apply the migration normally.

1. Pause credit-top-up webhook fulfillment and automatic top-up jobs; drain
   in-flight fulfillment. Keep deliveries retryable until the fixed API is live.
   The old code increments credits before inserting its transaction, so adding
   uniqueness while it is still fulfilling payments can leave unrecorded credits.
2. Run this read-only preflight (no payment identifiers in the output):

   ```sql
   BEGIN READ ONLY;
   SET LOCAL statement_timeout = '60s';
   SELECT count(*) AS duplicate_completed_intents
   FROM (
     SELECT stripe_payment_intent_id
     FROM "transaction"
     WHERE type = 'credit_topup' AND status = 'completed'
       AND stripe_payment_intent_id IS NOT NULL
     GROUP BY stripe_payment_intent_id
     HAVING count(*) > 1
   ) AS duplicates;
   COMMIT;
   ```

   A nonzero result or timeout blocks deployment. Reconcile the payment records
   and balances through a separately authorized procedure; never blindly delete
   transactions or adjust credits. Repeat the preflight after reconciliation.
3. Outside a transaction, build the index while fulfillment remains paused:

   ```sql
   CREATE UNIQUE INDEX CONCURRENTLY "transaction_credit_topup_payment_intent_unique"
     ON "transaction" ("stripe_payment_intent_id")
     WHERE "type" = 'credit_topup' AND "status" = 'completed';
   ```

   Confirm `pg_index.indisvalid` and `indisunique`, the indexed column and exact
   predicate before deployment. A failed concurrent build may leave an invalid
   index: investigate, then drop it concurrently and retry with authorization.
   The migration adopts a valid prebuilt index and rejects a mismatched one.
4. Apply migrations, deploy all API replicas with the fixed atomic fulfillment,
   then resume jobs and webhook deliveries. Verify retries credit each intent
   once. The key is the global Stripe PaymentIntent, not the event id or org;
   failed/pending rows and unrelated transaction types do not consume it. Null
   keys remain unconstrained; successful Stripe top-ups must carry an intent id.

Rollback: pause fulfillment before reverting the API. Keep the index and ledger
rows; do not drop uniqueness or reverse credited payments as an automatic rollback.
