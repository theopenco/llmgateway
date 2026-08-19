---
id: "blog-gdpr-compliant-llm-routing"
slug: "gdpr-compliant-llm-routing"
date: "2026-08-04"
title: "GDPR-Compliant LLM Routing, Enforced at the Gateway"
summary: "How to keep LLM traffic GDPR-compliant in practice: restrict routing to GDPR-compliant providers, filter by provider headquarters, pin regions, and block non-compliant requests before any data leaves your gateway."
categories: ["Guides"]
faqs:
  - question: "Can I force LLM traffic to stay with GDPR-compliant providers?"
    answer: "Yes. LLM Gateway's provider compliance policies (Enterprise plan) include a GDPR requirement that removes non-compliant providers from routing entirely. Requests that would otherwise reach a non-compliant provider are rejected with a `403` before any data leaves the gateway."
  - question: "What happens when a provider's GDPR status is unknown?"
    answer: "It's treated as non-compliant. Every requirement in a compliance policy is fail-closed: a provider passes only when its published data policy explicitly satisfies the requirement."
  - question: "Can I restrict routing to providers headquartered in specific countries?"
    answer: "Yes. The Provider Headquarters filter allows only providers based in your selected countries, composes with the certification and data-policy requirements, and blocks providers with unknown headquarters while active."
  - question: "Does GDPR compliance require self-hosting the gateway?"
    answer: "No — the compliance policy, headquarters filter, and retention controls all work on the managed cloud. Self-hosting the AGPLv3 core is the option for teams whose policy requires the gateway itself, not just the providers, to run inside their own boundary."
image:
  src: "/blog/gdpr-compliant-llm-routing.png"
  alt: "GDPR-compliant LLM routing concept — a glowing shield gate on a circuit board filtering request traces"
  width: 1536
  height: 1024
---

If your users are in Europe, every LLM request is a data transfer decision. A prompt that contains personal data — a support ticket, a CV, a medical note — leaves your infrastructure, lands on a model provider's servers, and becomes subject to whatever that provider does with API traffic: where it processes it, whether it logs it, and whether it trains on it.

GDPR-compliant LLM routing means making those decisions once, as policy, instead of trusting every engineer to remember which providers are safe for which workloads. The failure mode is rarely malice; it's a fallback. Your primary provider has an outage, a retry path routes to a cheaper deployment in another jurisdiction, and nobody notices until the vendor review.

**LLM Gateway** enforces the policy at the routing layer, where the decision actually happens.

## What GDPR requires from your LLM stack

GDPR doesn't name LLMs, but three of its requirements land directly on model routing:

- **Knowing your processors.** A provider that receives personal data typically acts as your processor — though the actual role (processor, subprocessor, or independent controller) depends on its contract and on who determines the purposes and means of processing, so check each provider's DPA. Either way, you need to know who receives the data — which is harder than it sounds when a gateway silently fails over between deployments.
- **Controlling transfers.** Where a provider processes data, and under what safeguards, determines whether you can lawfully send personal data there at all.
- **Data minimization and storage limitation.** Prompts you or your provider retain are personal data you're accountable for.

A gateway is the natural enforcement point for all three, because it's the last hop before data leaves your boundary.

## Restrict routing to GDPR-compliant providers

LLM Gateway's [provider compliance policies](https://docs.llmgateway.io/features/compliance) (Enterprise plan) let you toggle a **GDPR compliant** requirement: requests are only routed to providers whose published data policy is GDPR compliant. When no eligible provider for a model meets the policy, the gateway returns a `403` **before any data leaves the gateway** — the request never reaches a non-compliant provider, on either automatic routing or pinned-provider requests.

Every requirement is fail-closed. If a provider's GDPR status is unknown, it's treated as non-compliant. The same policy screen offers the toggles that usually travel with GDPR reviews:

- **No training on prompts** — providers that train on API traffic are excluded
- **No prompt logging** — providers that log prompts are excluded
- **No stealth providers** — undisclosed platforms with unknown data policies are excluded explicitly
- **SOC 2 / ISO 27001** — certification requirements composable with the rest

Each blocked request is recorded as a security event, so your audit trail shows not just what was allowed but what was refused and why.

## Filter by provider headquarters

Certifications answer "does this provider handle data properly?" Headquarters answers "which jurisdiction does this provider answer to?" — often the question your DPO actually asks.

The **Provider Headquarters** filter restricts routing to providers based in the countries you select. It's fail-closed like everything else: with a country filter active, a provider with unknown headquarters is blocked. The selector offers every country referenced in the catalogue — browse the [providers directory](https://llmgateway.io/providers) to see each provider's headquarters before you commit.

The dashboard's compliance page shows a live Provider Impact preview — green for allowed, red for blocked — and every provider picker in the dashboard carries the same green/red shields, with the failing requirements ("May log prompts", "Headquartered in a non-allowed country") listed under each incompatible provider before you add it to anything.

## Pin regions when the provider offers them

Some providers expose the same model in multiple regions. LLM Gateway supports both routing modes:

```bash
# Let the gateway choose the best eligible region for the provider
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"aws-bedrock/claude-sonnet-4-6","messages":[{"role":"user","content":"Hallo"}]}'

# Pin the request to one exact region
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"aws-bedrock/claude-sonnet-4-6:eu-west-2","messages":[{"role":"user","content":"Hallo"}]}'
```

If your provider key stores an explicit region, that region acts as a lock for provider-specific requests. Regional availability varies by provider and model — check the [models page](https://llmgateway.io/models) for what each mapping supports.

## Keep your own copies minimal

The other half of GDPR exposure is what you retain. LLM Gateway's default is metadata-only — no prompts or responses stored, just usage records — and full payload retention is a per-organization opt-in with automatic deletion after the retention period. Our [LLM data retention guide](/blog/llm-data-retention) covers the levels, costs, and deletion behavior.

For teams that need the gateway itself inside their boundary, the core is AGPLv3 and self-hostable: routing decisions, logs, and stored data all stay in your own infrastructure.

## Custom providers and self-attestation

If you route to deployments you operate yourself — an EU-region deployment in your own cloud account, for instance — those [custom providers](https://docs.llmgateway.io/features/custom-providers) have no published data policy, so an active compliance policy blocks them by default. An organization owner can record a self-attestation of the deployment's posture (GDPR status, logging, training, operating country), which the gateway evaluates with the same fail-closed rules. Attestation changes are recorded in the audit log.

<BlogCta variant="enterprise" location="bottom" />

## Related reading

- **[The LLM compliance checklist](/blog/llm-compliance-checklist)** — the full pre-production review, beyond GDPR
- **[LLM data retention](/blog/llm-data-retention)** — what to store, for how long, and what it costs
- **[LLM Gateway is SOC 2 Type II compliant](/blog/soc2-type-ii)** — the gateway's own audit posture
