# DevPass refund history repair

Run from the repository root with an explicitly selected database and Stripe account:

```sh
pnpm --filter @llmgateway/scripts backfill-stripe-refunds --org="$ORG_ID" --payment-intent="$PAYMENT_INTENT_ID"
```

Dry-run is the default. Unknown, duplicate, positional and empty scope arguments fail. Add "--commit" only after reviewing the scoped plan and separately approving the write. Omitting scope selects all eligible DevPass organizations; prefer bounded organization/payment-intent runs.

- Repairs completed positive USD plan-payment history using succeeded Stripe refunds. Legacy cumulative rows are replaced atomically per source payment; missing refund rows use the current "credit_refund" transaction kind and zero credit amount.
- Does not create Stripe refunds/payments, cancel subscriptions, change balances, plans or pass inventory. Active subscriptions and Reset Pass misses require manual entitlement/inventory reconciliation first, so a history row cannot suppress pending webhook work.
- Missing/mismatched originals, ambiguous payment/invoice ownership, currency/cap violations, conflicting recorded refunds and incomplete Stripe reads retain evidence and exit nonzero. Other source groups may already have committed: inspect the summary before retrying.
- Invoice/refund reads paginate fully. Concurrent runs lock and re-read each organization's ledger; refund-ID conflicts are accepted only when the persisted source, organization and financial fields agree.

Before any separately authorized apply, verify database payment metadata against the intended Stripe account/customer, coordinate other billing writers, export affected transaction rows with IDs/timestamps/metadata, and review a restoration procedure. A code revert stops future execution but cannot reconstruct deleted legacy history. No missing-source data is synthesized.

This remains a high-risk operational backfill. Merging code does not authorize running it. Any later refund-kind classification change must integrate both scripts together rather than replaying one over the other.

The package build/lint/format gates cover the refund-backfill entry point, helpers and CLI fixtures; unrelated legacy scripts are not added to those gates.
