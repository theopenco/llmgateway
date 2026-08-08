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
- `legal/TRANSFER_MECHANISM_ACTIONS.md` — the open legal items as executable
  steps, with a command that prints the currently-exposed providers rather than
  a list that rots

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

`GET /user/me/export` returns the account-scoped records we hold about the
caller as a single JSON document, reachable from **Account settings → Download
Your Data**. It is not literally everything — see the exclusions below, and note
that the chats section is capped, with any truncation stated in the payload. Two
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
2. Deletes the Stripe customer with `DELETE /v1/customers/:id`, which permanently
   deletes the customer object — including the name, email and billing address
   Stripe held on it — and detaches its saved payment methods. Charges and
   invoices Stripe issued survive under Stripe's own retention obligation, and
   the identity snapshot on an already-issued invoice is not removed by this
   call; that residue is the same statutory bill-to record we retain ourselves
   (see `legal/DATA_RETENTION_POLICY.md`). If a request ever requires that
   snapshot removed too, it needs Stripe's separate redaction process.
3. Marks those organizations deleted and overwrites their display name, billing
   contact email and logo with placeholders.
4. Hard-deletes the `user` row, cascading sessions, accounts, passkeys, API keys
   and chats.
5. Nulls the account email on retained `payment_failure` rows.
6. Attempts to delete the Resend contact.

**Partial-failure boundary.** Every Stripe call for every closing organization
runs before the first local write, so a Stripe failure aborts with the account
intact and retryable. Past that point the local writes are sequential rather than
transactional: a database failure mid-way can leave some organizations closed
while the `user` row survives. That state is still retryable — the deletion
endpoint is idempotent over already-closed organizations — but it is not atomic,
and it is not claimed to be.

Step 6 is **best effort**: `deleteResendContact` skips silently when
`RESEND_API_KEY` is unset and logs a warning on a provider error, in both cases
without failing the deletion. A contact can therefore survive at Resend after
erasure. That is a deliberate trade — failing an otherwise-complete erasure on a
marketing-list call would be worse — but it means Resend cleanup is not
guaranteed, and a failed attempt is currently only visible in logs rather than
tracked for retry.

See `legal/DATA_RETENTION_POLICY.md` for the field-level retention schedule.

## 4. Open items

Ordered by urgency. Items with an owner of "engineering" have a code path; the
rest are commercial/legal work that cannot be closed in this repository.

### High

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | Execute and file DPAs for Stripe, PostHog, Resend, Google Cloud | ops / legal | **Two of four in place.** Stripe and Resend incorporate their DPAs (with SCCs) automatically on accepting their service agreement. **Google Cloud is `unconfirmed`** — incorporated only from the point we accepted it, which has not been evidenced on the production billing account — and **PostHog is `action required`**, binding only once generated and countersigned at app.posthog.com/legal. Both must be read as no DPA in force. See `legal/SUBPROCESSOR_DPAS.md` |
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

## 6. Guard against the exposure growing

`packages/models/src/data-protection-baseline.spec.ts` fails the build when a
provider is added without a `dataPolicy`, without a stated `gdpr` position, or
without disclosed `headquarters`. The providers that are undocumented today are
listed as an explicit baseline and tolerated; anything new is not.

This exists because the Q3 2026 audit found a provider had been added
mid-quarter with none of that information and nobody noticed until the quarterly
review. The baselines are expected to shrink — a fourth test fails if an entry
becomes stale, so they cannot silently loosen as providers get documented.

## 7. Review cadence

- **Quarterly** — the sub-processor audit routine files an issue enumerating the
  catalogue, the changes since the last quarter, and the open gaps. Reconcile this
  document against it.
- **On every new operational sub-processor** — update
  `apps/ui/src/content/legal/sub-processors.md`, bump its version date, send the
  30-day notice, and add a row to `legal/SUBPROCESSOR_DPAS.md`.
- **On any change to the erasure path** — update `legal/DATA_RETENTION_POLICY.md`
  and §3 above in the same pull request.
