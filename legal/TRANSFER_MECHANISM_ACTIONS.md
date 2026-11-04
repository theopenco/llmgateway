# Transfer-mechanism actions (internal record)

The GDPR items that cannot be closed in code, reduced to steps someone can
actually execute. Each one needs a person with account access or signing
authority — none needs an engineer.

Tracked against `docs/gdpr-compliance-plan.md` §4. Update both when an item
closes.

**Last reviewed:** August 8, 2026

---

## 1. PostHog DPA — the only operational sub-processor with no DPA in force

PostHog's published DPA is explicitly non-binding: *"It's not binding on its own
— only the one you generate and countersign through the app counts."* Until this
is done there is **no data processing agreement with PostHog**, and PostHog
receives account identifiers, email addresses and IP addresses.

1. Sign in to PostHog as an organization admin.
2. Go to **app.posthog.com/legal**.
3. Generate the DPA, sign it, and download the countersigned copy.
4. File the PDF in the compliance folder.
5. Set the PostHog row in `legal/SUBPROCESSOR_DPAS.md` to `executed` with the
   execution date.

Estimated time: minutes. This is the highest value-per-effort item on the list.

## 2. Google Cloud DPA — confirm acceptance

The Cloud Data Processing Addendum is incorporated into the Cloud agreement, but
its effective date is *"the date on which Customer accepted, or the parties
otherwise agreed to"* it. That makes it conditional on our own account state.

1. In the Google Cloud console, confirm the Cloud Data Processing Addendum is
   accepted on the **billing account serving production** (not a personal or
   sandbox project).
2. Confirm the data-region configuration matches what the Sub-processor page
   claims (European Union / United States).
3. File a dated screenshot or export of the acceptance record.
4. Update the Google Cloud row in `legal/SUBPROCESSOR_DPAS.md`.

## 3. Stripe and Resend — file copies

Both incorporate their DPA automatically on acceptance of the service agreement,
so there is nothing to sign. For the Art. 30 record, save a dated PDF of the
version in force and note the date in `legal/SUBPROCESSOR_DPAS.md`.

## 4. Review AI-provider transfer mechanisms

Generate candidates from the live catalogue; headquarters and a GDPR claim do
not establish whether a particular transfer is covered by an adequacy decision:

```bash
pnpm exec turbo run build --filter=@llmgateway/models --concurrency=1
node --input-type=module -e '
import { providers } from "./packages/models/dist/index.js";
const exempt = new Set(["llmgateway", "custom"]);
console.log(providers.filter((p) => !exempt.has(p.id) && p.dataPolicy?.gdpr !== true)
  .map((p) => [p.id, p.headquarters ?? "undisclosed"].join("\t")).join("\n"));
'
```

Check each recipient and transfer against the [Commission’s current adequacy
decisions](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en),
including the decision’s scope. The list includes Brazil; Canada covers
commercial organisations subject to PIPEDA, and US coverage requires the
recipient’s participation in the EU–US Data Privacy Framework. Do not infer
coverage from a country code alone. This is a review queue, not a legal verdict.

For each provider the command prints, one of these has to happen:

- **Obtain their DPA/SCCs.** Many inference providers publish one; ask their
  support or legal contact. Where they do, record the GDPR position on the
  provider entry in `packages/models/src/providers.ts` (`dataPolicy.gdpr`) so the
  catalogue, the Providers page and the compliance controls all reflect it, and
  remove the provider from the baseline in
  `packages/models/src/data-protection-baseline.spec.ts`.
- **Or accept that it stays available only to customers who have opted into
  routing to it**, with the exposure disclosed. This is the current position, and
  it is now genuinely available to every customer rather than Enterprise only.
- **Or exclude it from default routing.** This breaks existing traffic to that
  provider and is a product decision — see `docs/gdpr-compliance-plan.md` §5.

### Draft request

> Subject: Data Processing Agreement / Standard Contractual Clauses
>
> Hello,
>
> We route customer inference requests to your API through LLM Gateway. Those
> requests can contain personal data of EU/UK data subjects, for which our
> customers are the controller and we and you are processors.
>
> Could you send:
>
> 1. Your standard Data Processing Agreement, and how it is executed.
> 2. Whether it incorporates the EU Standard Contractual Clauses (2021/914) and
>    the UK International Data Transfer Addendum, and which modules.
> 3. Your sub-processor list and change-notification terms.
> 4. Confirmation of whether API inputs are used to train or improve models, and
>    your retention period for request content.
>
> We publish each provider's data-protection posture to our customers, so an
> answer to (4) is reflected there directly.
>
> Thank you,

## 5. Undisclosed ("stealth") providers

Same request as above, routed through whoever holds the relationship. If the
operator's identity cannot be disclosed, get a legal opinion on whether an
Art. 46 mechanism can be satisfied without disclosure, and record the conclusion
in `docs/gdpr-compliance-plan.md` §5. Until then the mitigations are the public
disclosure in the Privacy Policy §10 and the Sub-processor page §2, and the
`blockStealthProviders` control — which is now available on every plan.
