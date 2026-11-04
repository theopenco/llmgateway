# Sub-processor DPA Tracker (internal record)

Tracks the data-processing agreement in force with each **operational**
sub-processor — the ones engaged for every customer regardless of which models
they route to. Maintained alongside `docs/gdpr-compliance-plan.md` and the public
list at `apps/ui/src/content/legal/sub-processors.md`.

This is an internal accountability record. Do not publish it; the customer-facing
list is the Sub-processor page.

**Last reviewed:** August 8, 2026

## Status legend

| Status | Meaning |
| --- | --- |
| `incorporated` | The published terms incorporate the DPA on acceptance of the service agreement. Account acceptance and the applicable version still need evidence. |
| `executed` | Actively signed or accepted by us, and a copy is filed. The date below is the execution date. |
| `unconfirmed` | The vendor's terms say it is incorporated, but only from the point *we* accepted it, and that acceptance has not been evidenced on our own account. **Treat as not in place until confirmed.** |
| `action required` | The DPA only binds once someone actively generates, signs or accepts it. **Not in place until that is done.** |
| `unknown` | Not yet checked — treat as **not in place**. |

## Operational sub-processors

| Sub-processor | Purpose | DPA status | SCCs | Source |
| --- | --- | --- | --- | --- |
| Stripe, Inc. | Payments, subscriptions, invoicing | `incorporated` | Yes — EEA SCCs (Modules 1 and 2, EU 2021/914) via the Data Transfers Addendum | [stripe.com/legal/dpa](https://stripe.com/legal/dpa) |
| Resend (Plus Five Five, Inc.) | Transactional and product email | `incorporated` | Yes — EU SCCs "deemed entered into", plus UK Addendum and Swiss modifications | [resend.com/legal/dpa](https://resend.com/legal/dpa) |
| Google Cloud | Hosting, PostgreSQL, Redis, object storage, tracing | **`unconfirmed`** | Yes — in Appendix 3 (Specific Privacy Laws) | [cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum) |
| PostHog, Inc. | Product analytics, feature flags | **`unconfirmed`** | Yes — EU + UK SCCs and Swiss FADP adaptations, but only in the countersigned copy | [posthog.com/dpa](https://posthog.com/dpa) |

### What each row still needs

- **Stripe** — the published DPA "forms part of the Agreement". Verify account
  acceptance and file the applicable dated terms; no separate signature is
  described by those terms.
- **Resend** — the published DPA "becomes legally binding upon Customer's
  acceptance of the Agreement". Verify that acceptance and file the applicable
  dated terms.
- **Google Cloud** — the Cloud DPA is incorporated into the Cloud agreement, but
  its effective date is "the date on which Customer accepted, or the parties
  otherwise agreed to, this Addendum". **Confirm it is accepted on the billing
  account actually serving production**, then save a dated copy. This is the one
  row where incorporation is conditional on our own account state.
- **PostHog** — the published page describes generating and countersigning a
  binding copy through **app.posthog.com/legal**. An authorized account holder
  must first check for an existing executed agreement and file it; if absent,
  complete the vendor procedure. Public terms do not establish whether this
  account has already done so.

**Account-specific coverage is unverified, not proven absent.** Google Cloud
and PostHog remain blocked pending acceptance or execution evidence. Stripe
and Resend publish incorporated terms, but their account acceptance and
applicable versions must also be evidenced before the tracker is closed.

> These findings are read from each vendor's published DPA terms on the date
> above. They establish what the vendor offers and how it takes effect — they do
> **not** confirm the acceptance or execution state of any account.

Owner and cadence: whoever holds the vendor account (ops for PostHog and Google
Cloud, finance for Stripe, ops for Resend). Re-verified each quarter as part of
the sub-processor audit, and immediately whenever a vendor announces DPA changes.
Evidence for every row is a dated PDF or acceptance record in the compliance
folder — a status here without a filed artifact does not count as closed.

## AI provider sub-processors

Not tracked row-by-row in this file. The provider catalogue changes continuously,
so a table here would be stale within days and would contradict the live data.

The authoritative source is `packages/models/src/providers.ts`, rendered publicly
on the [Providers page](https://llmgateway.io/providers). Each provider entry
carries its `headquarters`, `dataPolicy` (including `gdpr`, `apiTraining`,
`consumerTraining`, retention) and links to its terms and privacy policy. To audit
the current position, read the catalogue — do not trust a copy in a document.

The unresolved question for these providers is the Art. 46 transfer mechanism,
tracked as item 2 in `docs/gdpr-compliance-plan.md` §4 and discussed in §5 there.

### Ownership, evidence and cadence

Deferring to the catalogue keeps the *posture* current, but a live field is not a
record of a contract. So:

- **Owner:** legal, with engineering support for recording outcomes in the
  catalogue. Tracked in the open issue rather than only in this file, so it has an
  assignee.
- **Source of truth for posture:** `dataPolicy.gdpr` on the provider entry. When a
  provider supplies a DPA or SCCs, set it and remove the provider from the
  baseline in `packages/models/src/data-protection-baseline.spec.ts`. Both are
  code-reviewed, so the change is dated and attributable through git history.
- **Source of truth for the executed agreement:** the per-provider DPA record in
  the admin dashboard (**Provider DPAs** → `provider.dpaSignedAt` /
  `dpaSignedBy` / `dpaNote`), confirmed one provider at a time as agreements are
  evidenced. When the `REQUIRE_PROVIDER_DPA_FOR_GDPR` environment flag is on,
  the gateway's `requireGdpr` compliance control only routes to providers with
  this record — so the record is enforcement state, not just bookkeeping. Only
  mark a provider signed once the artifact is filed in the compliance folder.
- **Evidence:** the provider's DPA/SCCs filed in the compliance folder under the
  provider id. Setting `gdpr: true` without a filed agreement is not acceptable —
  the flag drives routing decisions customers rely on.
- **Cadence:** reviewed each quarter with the sub-processor audit, and whenever a
  provider is added (the baseline test forces the question at that point).

## Procedure when adding an operational sub-processor

1. Establish how the vendor's DPA takes effect and record it here with a real
   status **before** it processes any personal data. If it is `action required`,
   do the action first.
2. Add it to `apps/ui/src/content/legal/sub-processors.md` §1 and bump the
   version date at the top of that page.
3. Add it to the Privacy Policy §5 sub-processor list.
4. Send the 30-day change notice to the notification list, and do not enable it in
   production until the notice period has run.
5. Note the change in the next quarterly audit.
