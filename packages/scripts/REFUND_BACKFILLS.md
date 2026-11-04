# Refund history repair

Deploy readers that support both refund types before writing `subscription_refund`. These optional scripts repair transaction history, not balances, pass inventory or subscription entitlements. They make Stripe reads only.

- Reclassification: dry-run with `--organization-id=<id>`, then use the same scope with `--commit`. Only completed, positive plan refunds linked to a completed positive purchase in the same organization with zero credit deduction qualify.
- Stripe reconciliation: dry-run with `--payment-intent=<id>`, then use the same scope with `--commit`. Apply without a payment scope is rejected. Missing top-up and Reset Pass refunds, active subscriptions, unverifiable linkage and invalid amounts require manual reconciliation.
- Before apply, approve the exact cohort, preserve all original transaction rows and related organization state, and coordinate with webhook delivery and other history writers. Reconcile Stripe refund IDs, amounts, currency, ownership and plan state before and after each payment. Do not treat skipped rows as repaired.
- Legacy replacement deletes cumulative rows inside a per-payment transaction. An error rolls that payment back, not earlier successful payments. Reruns deduplicate by Stripe refund ID.
- Code rollback does not restore deleted rows or reverse subsequent tier-dependent activity. Retain preimages and test a restoration procedure before authorizing apply; never blindly reinsert cumulative rows alongside their replacements.
