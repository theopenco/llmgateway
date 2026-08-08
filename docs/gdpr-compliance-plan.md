# GDPR Compliance Plan (internal record)

This is the central accountability document for the GDPR compliance programme,
maintained under Art. 5(2) ("the controller shall be responsible for, and be able
to demonstrate compliance with" the principles of Art. 5(1)). It is the document
the quarterly sub-processor audit routine references on every run.

It is **not** a public-facing document. The user-facing surfaces are:

| Surface | File |
| --- | --- |
| Privacy Policy | `apps/ui/src/content/legal/privacy.md` |
| Sub-processor list | `apps/ui/src/content/legal/sub-processors.md` |
| DevPass supplemental privacy policy | `apps/code/src/app/legal/privacy/page.tsx` |
| Terms of Use | `apps/ui/src/content/legal/terms.md` |

Related internal records:

- `legal/DATA_RETENTION_POLICY.md` — what survives erasure, why, and for how long
- `legal/SUBPROCESSOR_DPAS.md` — DPA status per sub-processor

**Last reviewed:** August 8, 2026

---

## 1. Roles

We act in two capacities, and the distinction drives most of the obligations
below:

- **Controller** — for account, billing, website and usage-analytics data. We
  decide the purposes and means.
- **Processor** — for Customer Data (prompts, inputs, and the responses returned).
  The customer is the controller; we process on their documented instructions,
  which for this Service means "route this request to the model I selected".

Enterprise customers may sign a DPA that governs the processor relationship; where
one exists it controls over the Privacy Policy for Customer Data.

## 2. Lawful bases (controller-side)

| Processing | Basis |
| --- | --- |
| Providing the Service, account management, billing | Contract — Art. 6(1)(b) |
| Security, abuse prevention, service improvement, product analytics | Legitimate interests — Art. 6(1)(f) |
| Retaining invoices and accounting records | Legal obligation — Art. 6(1)(c) |
| Marketing email, non-essential cookies | Consent — Art. 6(1)(a) |

## 3. Data-subject rights — implementation status

| Right | Article | Status | Where |
| --- | --- | --- | --- |
| Access / portability | 15, 20 | Self-serve JSON export | `apps/api/src/lib/data-export.ts`, `GET /user/me/export` |
| Rectification | 16 | Self-serve in the dashboard | Account settings |
| Erasure | 17 | Self-serve, with documented retention carve-out | `apps/api/src/lib/account-deletion.ts`, `DELETE /user/me` |
| Restriction | 18 | Manual | — |
| Objection | 21 | Manual | — |
| Complaint to a supervisory authority | 77 | Disclosed in the Privacy Policy §9 | — |

### Access and portability

`GET /user/me/export` returns everything we hold about the caller as a single
JSON document, reachable from **Account settings → Download Your Data**. Two
constraints shape it:

- **It never contains a credential.** API key tokens, master keys, provider
  keys, password hashes, session tokens and passkey credentials are all
  excluded. Art. 15 is a right to know what is held, not a mechanism for
  extracting live secrets, and an export file is far more likely to be
  mishandled than the credential store. A spec asserts this
  (`data-export.spec.ts`) by seeding known secrets and failing if any appears
  anywhere in the payload.
- **It says what it withheld and why.** `EXCLUDED_FROM_EXPORT` is embedded in
  the payload, so a data subject sees the exclusions rather than inferring them
  from absence.

Request/response logs are excluded because they belong to the organization that
submitted them — that organization is the controller for that data, and its
retention setting governs it.

### Erasure

Erasure is deliberately an *erasure-with-retention* flow, because the accounting
record has to survive (Art. 17(3)(b) + HGB §257 / AO §147). What it does today:

1. Cancels every Stripe subscription the closing organizations hold.
2. Deletes the Stripe customer, so the name/email/billing address Stripe held is
   erased at the sub-processor rather than only in our database.
3. Marks those organizations deleted and overwrites their display name, billing
   contact email and logo with placeholders.
4. Hard-deletes the `user` row, cascading sessions, accounts, passkeys, API keys
   and chats.
5. Nulls the account email on retained `payment_failure` rows.
6. Deletes the Resend contact.

Stripe calls happen before any local write, so a Stripe failure aborts the whole
deletion with the account intact and retryable — better than erasing locally while
a card keeps being charged or while personal data stays at the sub-processor.

See `legal/DATA_RETENTION_POLICY.md` for the field-level retention schedule.

## 4. Open items

Ordered by urgency. Items with an owner of "engineering" have a code path; the
rest are commercial/legal work that cannot be closed in this repository.

### High

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | Execute and file DPAs for Stripe, PostHog, Resend, Google Cloud | legal | **Mostly resolved** — Stripe and Resend incorporate their DPAs (with SCCs) automatically on accepting their service agreement, so those are in force; Google Cloud's is incorporated but needs account-level confirmation. **PostHog is the one real gap**: its DPA only binds once generated and countersigned at app.posthog.com/legal, which takes minutes. See `legal/SUBPROCESSOR_DPAS.md` |
| 2 | Document the Art. 46 transfer mechanism for providers headquartered in countries without an adequacy decision, or restrict EU personal data from reaching them | legal | Open — see §5 |
| 3 | Publish a versioned sub-processor list with 30-day change notice | engineering | **Done** — `apps/ui/src/content/legal/sub-processors.md` |
| 4 | Disclose PostHog as a sub-processor | engineering | **Done** — Privacy Policy §5 |

### Medium

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 5 | Warn at model-selection time when a provider trains on API inputs | engineering | **Done** — icon + explanatory warning in the playground model picker, and a "Trains on your prompts" badge on the Providers page |
| 6 | Obtain data-processing terms for the undisclosed ("stealth") providers before routing EU personal data to them | legal | Open — mitigated by disclosure + provider pinning, not resolved |
| 7 | Remediate the three known erasure gaps | engineering | **Done** — see §3 |
| 8 | Build a self-serve data export (Art. 15/20) instead of handling requests by email | engineering | **Done** — see §3 |

### Low

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 9 | Maintain this document as the Art. 30 ROPA anchor | engineering | **Done** — this file |
| 10 | Set up a sub-processor change-notification mailing list | ops | Open — the Sub-processor page currently asks customers to email in |

## 5. Third-country transfers

The provider catalogue includes providers headquartered in countries with no EU
adequacy decision. This is a known, unresolved exposure and is the single largest
open GDPR risk in the product.

We do **not** enumerate those providers here — the catalogue changes continuously
and any copy in this document rots. The authoritative, live view is the
[Providers page](https://llmgateway.io/providers), which renders `headquarters`
and the GDPR posture from `packages/models/src/providers.ts`. To audit the current
set, read that file's provider entries rather than trusting a list in a document.

Current mitigations, in order of strength:

1. **Compliance policies, on every plan** — an organization can restrict routing
   by GDPR posture, prompt training, prompt logging, undisclosed identity and
   provider headquarters. Non-compliant requests are rejected, not silently
   rerouted. Enforced server-side in the gateway
   (`apps/gateway/src/chat/chat.ts`, `filterCompliantProviders`), not in the UI.

   These five controls are deliberately **not** gated on plan
   (`DATA_PROTECTION_POLICY_KEYS`, `narrowPolicyToDataProtection`). They used to
   be Enterprise-only, which meant a free or pro customer had no way to stop
   their EU personal data reaching a provider with no adequacy decision — while
   still carrying the Art. 44-49 obligation for that transfer as the controller.
   Paywalling a customer's only means of discharging a legal obligation is not
   defensible, so the data-protection subset is honoured on every plan.
   Certification requirements and the fine-grained allow/block lists remain
   Enterprise: those are governance tooling, not a lawful-basis mechanism.
2. **Provider pinning** — `provider/model` plus `x-no-fallback: true` sends a
   request to exactly one provider and fails rather than falling back.
3. **Disclosure** — the Privacy Policy §11 and the Sub-processor page §4 both
   state plainly that not every provider is covered by an adequacy decision or by
   SCCs executed with us, and tell customers to check before routing.

Mitigations 1 and 2 place the transfer decision with the customer, who is the
controller for Customer Data, and — since the data-protection controls were
ungated — every customer can now actually exercise it. That is a defensible
allocation of responsibility for a routing service, but it is **not a
substitute** for executing SCCs with the providers we ourselves engage. Item 2 in
§4 stays open until either SCCs are on file or those providers are excluded from
default routing.

Note that these controls are **opt-in**: an organization that never opens the
Compliance page still routes to every provider. Making the restriction the
default would break every customer currently using a provider in a non-adequacy
country, so it is a product decision rather than something to change silently.

## 6. Review cadence

- **Quarterly** — the sub-processor audit routine files an issue enumerating the
  catalogue, the changes since the last quarter, and the open gaps. Reconcile this
  document against it.
- **On every new operational sub-processor** — update
  `apps/ui/src/content/legal/sub-processors.md`, bump its version date, send the
  30-day notice, and add a row to `legal/SUBPROCESSOR_DPAS.md`.
- **On any change to the erasure path** — update `legal/DATA_RETENTION_POLICY.md`
  and §3 above in the same pull request.
