# Data Retention Policy (internal record)

This is an internal accountability record under GDPR Art. 5(2). It documents what
personal data we retain after a user requests deletion / deletes their account,
why, and for how long. It is not a public-facing document; the user-facing version
lives in the Privacy Policy (`apps/ui/src/content/legal/privacy.md` and
`apps/code/src/app/legal/privacy/page.tsx`).

**Last reviewed:** August 8, 2026

The programme-level accountability record lives in `docs/gdpr-compliance-plan.md`;
sub-processor DPA status is tracked in `legal/SUBPROCESSOR_DPAS.md`.

## Principle

The GDPR right to erasure (Art. 17) is not absolute. Art. 17(3)(b) permits
continued retention where processing is necessary for compliance with a legal
obligation under Union or Member State law. Tax and accounting law is such an
obligation. We therefore delete personal/identity data on request but retain the
financial record of credits purchased and spent for the statutory period.

## Retention schedule

| Data category | Examples (tables/fields) | Basis | Retention | Action on account deletion |
| --- | --- | --- | --- | --- |
| Identity & profile | `user` (name, email), `session`, `account`, `passkey`, `apiKey`, `masterKey`, chats | Contract (Art. 6(1)(b)) | Life of account | Hard-deleted (cascade from `user`) |
| Request/usage logs | `log` (prompts, responses, raw req/resp) | Legitimate interest / contract | Content nullified after 30 days | Content already removed by worker; cost/token metadata retained |
| Billing & accounting | `transaction` (credit_topup/refund/gift, amounts, currency, Stripe IDs), `paymentMethod`, `paymentFailure`, `organization.credits` | Legal obligation (Art. 6(1)(c)) — tax & accounting law | 10 years | Retained; personal identifiers not required for the accounting record are anonymized (see "Erasure flow" below) |
| Closed organizations | `organization` rows marked `status: "deleted"` | Legal obligation (Art. 6(1)(c)) — the `transaction` rows reference them | 10 years | `name`, `billingEmail` and `logo` overwritten; `billingCompany`, `billingAddress`, `billingTaxId` retained as the statutory bill-to identity |

## Retention period rationale

We are established in Germany, where HGB §257 / AO §147 require invoices and
accounting records to be kept for **10 years**. The retention period for
billing/accounting records is therefore fixed at 10 years.

## Erasure flow

Account deletion (`DELETE /user/me`, `apps/api/src/routes/user.ts`, backed by
`apps/api/src/lib/account-deletion.ts`) is an erasure-with-retention flow:
identity is hard-deleted, accounting facts are kept, and the personal identifiers
sitting in the retained tables are overwritten. In order:

1. **Cancel subscriptions.** Every Stripe subscription held by an organization the
   user is the last member of, with `invoice_now: false` / `prorate: false`.
2. **Delete the Stripe customer** (`DELETE /v1/customers/:id`). Permanently
   deletes the customer object — the name, email and billing address Stripe held
   on it — and detaches saved payment methods. Charges and invoices Stripe issued
   survive under its own accounting obligation, and the identity snapshot on an
   already-issued invoice is **not** removed by this call; that residue mirrors
   the statutory bill-to record we retain ourselves. Removing it too would need
   Stripe's separate redaction process. `organization.stripeCustomerId` is nulled
   locally.
3. **Close and anonymize those organizations.** `status: "deleted"`, all plan
   state cleared, and `name` / `billingEmail` / `logo` overwritten with the
   placeholders in `account-deletion.ts`.
4. **Null the account email on retained billing rows.** `paymentFailure.userEmail`
   is cleared wherever it matches the account email, and across every closing
   organization regardless of the address on the row. `payment_failure` stores
   the email as it was at the time of the failure and has no user foreign key, so
   the org sweep is what catches rows written before an email change. **Known
   residue:** a stale address on a *shared* organization that survives the
   deletion, written before an email change, is not matched — closing that needs
   a stable user reference on the table.
5. **Hard-delete the user**, cascading `session`, `account`, `passkey`, `apiKey`,
   `masterKey` and chats.
6. **Attempt to delete the Resend contact** — best effort; it is skipped when
   `RESEND_API_KEY` is unset and logs a warning on a provider error, in neither
   case failing the deletion. A contact can survive at Resend after erasure.

Every Stripe call for every closing organization runs before the first local
write, so a Stripe failure aborts with the account intact and retryable —
strictly better than erasing locally while a card keeps being charged or while
personal data stays at the sub-processor. Past that point the local writes are
sequential, not transactional: a database failure mid-way can leave some
organizations closed while the user row survives. That is retryable but **not
atomic**, and should not be described as such.

Covered by `apps/api/src/lib/account-deletion.spec.ts`.

### What is deliberately kept

- `billingCompany`, `billingAddress`, `billingTaxId` on a closed organization —
  these are the "bill to" identity that appears on the invoices we already issued
  and that §14 UStG requires the invoice to carry. Anonymizing them would destroy
  the accounting record we are retaining them for.
- `transaction` rows in full, including amounts, currency and Stripe IDs.
- The amount, decline code and Stripe payment-intent id on `paymentFailure` —
  only the contact email is removed.

## Access and portability

`GET /user/me/export` (`apps/api/src/lib/data-export.ts`) lets a user download
the account-scoped records we hold about them as JSON, so Art. 15/20 requests no
longer depend on someone running a query by hand. It never includes credentials,
it embeds a list of what was withheld and why, and it caps the chats section —
stating any truncation in the payload so a partial export is not mistaken for a
complete one. Covered by
`apps/api/src/lib/data-export.spec.ts`, including a test that fails if any seeded
secret appears anywhere in the payload.

## Operational duties

- When refusing/limiting an erasure request, tell the data subject which data is
  retained, the legal basis, and their right to lodge a complaint with a
  supervisory authority. (Reflected in the Privacy Policy "Your Rights" section.)
- After the retention period expires, billing/accounting records are deleted or
  anonymized.

> This is an engineering accountability note. The 10-year period is fixed by our
> German establishment (HGB §257 / AO §147).
