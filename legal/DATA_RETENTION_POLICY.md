# Data Retention Policy (internal record)

This is an internal accountability record under GDPR Art. 5(2). It documents what
personal data we retain after a user requests deletion / deletes their account,
why, and for how long. It is not a public-facing document; the user-facing version
lives in the Privacy Policy (`apps/ui/src/content/legal/privacy.md` and
`apps/code/src/app/legal/privacy/page.tsx`).

**Last reviewed:** June 5, 2026

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
| Billing & accounting | `transaction` (credit_topup/refund/gift, amounts, currency, Stripe IDs), `paymentMethod`, `paymentFailure`, `organization.credits` | Legal obligation (Art. 6(1)(c)) — tax & accounting law | Up to 10 years | Retained; personal identifiers not required for the accounting record are anonymized |

## Retention period rationale

We use **10 years** as the retention period because it is the longest applicable
statutory period among the jurisdictions we bill in (Germany, HGB §257 / AO §147,
mandates 10 years for invoices and accounting records). Most other EU member states
require 6–7 years; 10 years safely covers all of them.

## Known gaps to remediate (not yet implemented)

These are accepted, tracked gaps where personal data currently survives deletion in
a retained table and should later be anonymized rather than retained verbatim:

- `paymentFailure.userEmail` — raw email persists in a retained billing table; not
  required for the accounting record. Should be nulled/anonymized on user deletion.
- Personal-organization `name` — may contain the user's name; should be replaced
  with a neutral placeholder on deletion.
- Stripe customer — name/email/billing address held by Stripe is not yet
  deleted/anonymized on erasure. Should propagate a Stripe customer delete (Stripe
  retains its own charge/invoice records under its own legal obligation).

When these are implemented, account deletion becomes a true
erasure-with-retention flow: identity hard-deleted, accounting facts kept,
personal identifiers in retained tables anonymized.

## Operational duties

- When refusing/limiting an erasure request, tell the data subject which data is
  retained, the legal basis, and their right to lodge a complaint with a
  supervisory authority. (Reflected in the Privacy Policy "Your Rights" section.)
- After the retention period expires, billing/accounting records are deleted or
  anonymized.

> This is an engineering accountability note, not legal advice. Confirm the exact
> retention period and the set of fields that qualify as "accounting data" with a
> DPO / lawyer for each jurisdiction in which we bill.
