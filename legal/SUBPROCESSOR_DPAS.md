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
| `in force` | DPA executed or self-serve DPA accepted; a copy is filed and the date below is accurate |
| `pending` | Identified and available, not yet executed or filed |
| `unknown` | Not yet checked — treat as **not in place** |

## Operational sub-processors

| Sub-processor | Purpose | DPA status | SCCs | Executed | Copy filed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Stripe, Inc. | Payments, subscriptions, invoicing | `unknown` | `unknown` | — | — | Stripe publishes a standard DPA incorporating SCCs; confirm which version applies to our account and file it |
| Google Cloud | Hosting, PostgreSQL, Redis, object storage, tracing | `unknown` | `unknown` | — | — | Google's Cloud Data Processing Addendum is self-serve; confirm it is accepted on the billing account actually serving production |
| Resend (Plus Five Five, Inc.) | Transactional and product email | `unknown` | `unknown` | — | — | Confirm a DPA exists and covers the contact data we sync (`deleteResendContact` / `updateResendContact`) |
| PostHog, Inc. | Product analytics, feature flags | `unknown` | `unknown` | — | — | Newly disclosed in the Privacy Policy on 2026-08-08; DPA has never been checked |

Every row is `unknown` because no signed copy or acceptance record has been
located. **`unknown` must be read as "not in place"** — it is not a neutral
state. Closing these is item 1 in `docs/gdpr-compliance-plan.md` §4.

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

## Procedure when adding an operational sub-processor

1. Obtain and file the sub-processor's DPA **before** it processes any personal
   data, and add its row here with a real status.
2. Add it to `apps/ui/src/content/legal/sub-processors.md` §1 and bump the
   version date at the top of that page.
3. Add it to the Privacy Policy §5 sub-processor list.
4. Send the 30-day change notice to the notification list, and do not enable it in
   production until the notice period has run.
5. Note the change in the next quarterly audit.
