---
id: "blog-portkey-alternatives"
slug: "portkey-alternatives"
date: "2026-08-04"
title: "8 Best Portkey Alternatives in 2026 (Compared)"
summary: "The 8 best Portkey alternatives in 2026, compared honestly — open-source gateways, managed routers, and VPC platforms — with fees, self-hosting, governance, and who each option genuinely fits after the Palo Alto Networks acquisition."
categories: ["Guides"]
faqs:
  - question: "What is the best Portkey alternative in 2026?"
    answer: "LLM Gateway is the strongest overall alternative: fully open source (AGPLv3), self-hostable, offered as a managed cloud, with governance — compliance policies, audit logs, guardrails — built in rather than metered per log. The right choice depends on what you used Portkey for: governance (LLM Gateway, TrueFoundry, Kong) or routing (Vercel AI Gateway, OpenRouter)."
  - question: "Is Portkey still an independent company?"
    answer: "No. Palo Alto Networks' acquisition of Portkey closed in May 2026, and the product is being folded into Prisma AIRS. Existing deployments keep working; the roadmap and sales motion now run through Palo Alto Networks."
  - question: "Is there a fully open-source Portkey alternative?"
    answer: "Portkey's Gateway 2.0 open-sourced much of the stack under MIT, but persistent storage and compliance features remain cloud-only. LLM Gateway (AGPLv3), LiteLLM, and Bifrost are self-hostable end to end — LLM Gateway is the one that ships the dashboard, analytics, and governance rather than just a proxy."
  - question: "How hard is it to migrate off Portkey?"
    answer: "The API change is minutes — both sides speak the OpenAI format. Budget the real time for recreating routing configs, budgets, guardrails, and permissions in the new platform, and for updating any code that used Portkey-specific headers or the Portkey SDK wrapper."
image:
  src: "/blog/portkey-alternatives.png"
  alt: "The best Portkey alternatives in 2026 — gateway routes diverging from a central hub on a circuit board"
  width: 1536
  height: 1024
---

Portkey earned its place in a lot of AI stacks: deep request tracing, guardrails, budgets, and compliance controls, wrapped around a capable gateway. Gateway 2.0 even open-sourced most of the governance and observability stack under MIT in March 2026.

Then Palo Alto Networks acquired Portkey in May 2026 and folded it into Prisma AIRS. For some buyers that's reassurance; for many teams it's the trigger for a vendor review — a developer tool becoming a line item in a large security vendor's portfolio changes the roadmap, the sales motion, and the exit cost. Add the usage-based pricing (Production from $49/month plus $9 per 100k logs, which compounds exactly when your traffic does) and the fact that persistent storage and compliance features still require their cloud, and "Portkey alternatives" became one of the most-searched gateway queries of the summer.

We compared the 8 best Portkey alternatives in 2026 on what actually differs: cost on top of provider prices, self-hosting, governance depth, and who each option genuinely fits. We build one of them, so we're biased — but we'll tell you where each option wins.

## Why Teams Look for Portkey Alternatives

The reasons are consistent:

- **The acquisition changed the calculus.** Buying from Prisma AIRS means enterprise security procurement, not a developer-tool signup — and a roadmap now set inside a security portfolio.
- **Log fees scale with success.** $9 per 100k logs is invisible in a prototype and very visible in an agent loop pushing millions of requests a month.
- **The open-source core isn't the whole product.** Gateway 2.0's MIT release was real, but persistent storage and compliance features stay in their cloud — the parts compliance teams adopted Portkey for.
- **Some teams just need routing.** Portkey is governance-first; if what you need is one API for many models with failover, you're paying for a platform you don't use.

If none of that bothers you, Portkey remains a mature product. If it does, here are the alternatives.

## What to Look for in a Portkey Alternative

1. **What does it cost on top of provider prices?** In 2026 the serious gateways don't mark up tokens — compare platform fees, log fees, and BYOK terms instead.
2. **Can you actually self-host it?** "Partially open source" and "fully self-hostable" are different answers to a compliance questionnaire.
3. **How deep is governance?** Budgets, RBAC, audit logs, guardrails, and compliance policies — and which of them cost extra.
4. **Is routing smart or just a fallback list?** Weighted routing on live uptime, latency, and price beats a static provider order.

## Comparison Table

| Alternative       | Open source  | Self-host | Managed cloud | BYOK fee            | Gateway fee            | Best for                |
| ----------------- | ------------ | --------- | ------------- | ------------------- | ---------------------- | ----------------------- |
| LLM Gateway       | Yes (AGPLv3) | Yes       | Yes           | 0%                  | 5% on credits          | Best overall            |
| Kong AI Gateway   | Partial      | Yes       | Yes           | No billing          | OSS free; Konnect paid | Kong platform teams     |
| TrueFoundry       | No           | Yes (VPC) | Yes           | 0%                  | Enterprise quote       | VPC-only enterprises    |
| LiteLLM           | Yes          | Yes       | No            | 0%                  | Free (you run it)      | Python-first self-host  |
| Bifrost           | Yes          | Yes       | No            | 0%                  | Free (you run it)      | High-throughput proxy   |
| Vercel AI Gateway | No           | No        | Yes           | 0%                  | None on tokens         | AI SDK teams            |
| Cloudflare AI GW  | No           | No        | Yes           | No billing          | Free core              | Cloudflare shops        |
| OpenRouter        | No           | No        | Yes           | 1M free/mo, then 5% | 5.5% on credits        | Largest managed catalog |

## 1. LLM Gateway

**Best overall. Open source, self-hostable, governance without per-log fees.**

[LLM Gateway](https://llmgateway.io) is an open-source (AGPLv3) gateway that routes to 200+ models across 40+ providers through one OpenAI-compatible endpoint — available as a managed cloud or fully self-hosted, same codebase. Where Portkey leads with observability and wraps a gateway around it, LLM Gateway leads with routing and builds the governance in.

**What sets it apart:**

- **The whole product is self-hostable** — routing, dashboard, analytics, and governance in the AGPLv3 core, not a gateway-shaped subset with the platform held back
- **No per-log pricing** — per-request cost and latency analytics are included; usage-based fees never scale against your request volume
- **Zero markup on BYOK** — bring provider keys and pay nothing on top of provider prices
- **Smart routing, not provider lists** — providers scored on live uptime, throughput, price, and latency, with transparent retries and failover
- **Enterprise governance where you'd expect it** — [provider compliance policies](https://docs.llmgateway.io/features/compliance) (SOC 2 / ISO 27001 / GDPR / no-training requirements, enforced fail-closed before data leaves the gateway), audit logs, guardrails, and SSO on the Enterprise plan

Both sides speak the OpenAI API, so the mechanical migration is a base URL change:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});
```

**Pricing:** Free to self-host. Managed cloud is pay-as-you-go with a 5% platform fee on credits — or 0% with your own provider keys.

**Best for:** Teams that adopted Portkey for governance but want the whole platform open, self-hostable, and free of per-log fees. See the full [LLM Gateway vs Portkey](/blog/llm-gateway-vs-portkey) breakdown or the [feature-by-feature comparison](/compare/portkey).

---

<BlogCta variant="gateway" location="mid_article" />

## 2. Kong AI Gateway

**LLM governance as plugins on API infrastructure you may already run.**

Kong AI Gateway extends Kong's API gateway with AI plugins: multi-LLM routing, semantic caching, prompt guarding, and token-based rate limiting. For platform teams already running Kong, it's governance with tooling they know.

**Strengths:**

- One gateway layer for APIs and LLMs — same plugins, observability, and team
- Semantic caching and prompt-security plugins
- Self-hostable open-source core plus the managed Konnect platform

**Weaknesses:**

- Heavyweight if you don't already run Kong
- LLM features are plugins on a general-purpose gateway, not a purpose-built product
- No provider billing layer; keys and spend live elsewhere

**Pricing:** Open-source gateway free; AI features expand under paid Konnect and Enterprise tiers.

**Best for:** Platform teams standardized on Kong that want LLM traffic under the same roof.

---

## 3. TrueFoundry

**Enterprise governance inside your own VPC.**

TrueFoundry ships an AI gateway as part of its ML platform, deployed Kubernetes-native in your own cloud account with RBAC, budgets, quotas, and audit — the closest match for buyers who liked Portkey's governance but need everything inside their boundary.

**Strengths:**

- Runs entirely in your VPC — data never leaves your account
- Enterprise controls: RBAC, quotas, audit, cost attribution
- Part of a full ML platform if you also need training and deployment tooling

**Weaknesses:**

- Not open source, and buying it is an enterprise sales motion
- Overkill if you need a gateway rather than an ML platform
- You operate the Kubernetes footprint it runs on

**Pricing:** Enterprise; by quote.

**Best for:** Enterprises with strict data-residency requirements and an existing Kubernetes practice.

---

## 4. LiteLLM

**The default open-source proxy, if you'll operate it.**

LiteLLM is an open-source Python proxy speaking the OpenAI format to 100+ providers, with virtual keys, budgets, and spend tracking — a real subset of Portkey's governance, at the price of running it yourself.

**Strengths:**

- Open source, self-hosted, huge provider coverage
- Virtual keys, budgets, and spend tracking built in
- Works in-process as a Python library, not just as a proxy

**Weaknesses:**

- You become the platform team for the proxy plus its Redis and Postgres dependencies
- SSO, audit logs, and admin controls sit behind the paid enterprise tier
- Python runtime becomes the bottleneck at high request volumes

**Pricing:** Free and open source; paid enterprise tier for governance features.

**Best for:** Python-first teams staffed to run their own gateway. See [LiteLLM alternatives](/blog/litellm-alternatives) if the ops load is the concern.

---

## 5. Bifrost

**A fast open-source proxy from an observability company.**

Bifrost (from Maxim AI) is a self-hosted, open-source gateway written in Go, benchmarking its routing overhead in microseconds per request. Governance basics — virtual keys, budgets — live in the open-source core.

**Strengths:**

- Single Go binary, very low overhead at high request volumes
- Open source with governance features in the core
- Pairs naturally with Maxim's evaluation and observability tooling

**Weaknesses:**

- No managed cloud — you take on the operations
- Younger project, smaller ecosystem
- Observability thinner than the platform gateways unless you add Maxim

**Pricing:** Free and open source; paid support via Maxim.

**Best for:** Teams that want maximum throughput per node and full control.

---

## 6. Vercel AI Gateway

**Zero markup, native to the AI SDK.**

Vercel AI Gateway routes to hundreds of models across 45+ providers, GA since 2025, and is the default provider for the Vercel AI SDK — a strong swap for product teams whose Portkey usage was mostly routing and failover.

**Strengths:**

- Zero markup on tokens, including BYOK
- First-class AI SDK integration
- Failover, caching, and spend monitoring built in

**Weaknesses:**

- Managed only — no open source, no self-hosting
- Governance is thin compared to Portkey; some features tied to Vercel team plans
- Least compelling outside the Vercel ecosystem

**Pricing:** Pay-as-you-go credits with no token markup.

**Best for:** AI SDK teams that used Portkey for routing rather than governance.

---

## 7. Cloudflare AI Gateway

**Caching, rate limiting, and cost visibility at the edge.**

Cloudflare AI Gateway proxies LLM requests through Cloudflare's edge with caching, retries, rate limiting, and per-request analytics — a lightweight slice of what Portkey does, for free, if visibility is what you actually needed.

**Strengths:**

- Trivial setup on Cloudflare; generous free tier
- Edge caching and rate limiting close to users
- Useful per-provider cost and latency analytics

**Weaknesses:**

- A visibility-and-caching layer, not a governance platform — no budgets-per-team, no compliance policies
- No unified billing; you still manage every provider account
- No smart multi-provider failover

**Pricing:** Free core features; paid tiers for higher limits.

**Best for:** Cloudflare shops that need observability and caching, not governance.

---

## 8. OpenRouter

**The largest managed catalog, if governance isn't the point.**

OpenRouter is the best-known managed router: one key, roughly 400+ models across 70+ providers. It sits at the opposite pole from Portkey — maximal model access, minimal governance — which is exactly right for some teams leaving a platform they never fully used.

**Strengths:**

- The largest model catalog in the space, zero deployment
- Response caching and request-level analytics
- BYOK supported (1M requests free per month, then 5%)

**Weaknesses:**

- 5.5% fee on credit purchases
- Cloud-only, no self-hosting — a hard stop for the compliance teams Portkey serves
- Governance and audit depth arrive late and gated

**Pricing:** Pay-as-you-go with a 5.5% fee on credits; BYOK free up to a monthly cap, then 5%.

**Best for:** Teams that want maximum model choice and accept a managed-only, governance-light router. See our [OpenRouter alternatives](/blog/openrouter-alternatives) list for that side of the market.

---

## Two Names You Can Skip in 2026

Older "Portkey alternatives" lists still recommend two products you should no longer adopt:

- **Helicone** was acquired by Mintlify in March 2026 and is in maintenance mode — see our [Helicone alternatives](/blog/helicone-alternatives) list for what to use instead.
- **Unify** shut down its LLM router and pivoted to AI agents. It's no longer a gateway.

If a comparison article lists either as an active option, check its publish date.

## How to Choose

**You want Portkey's governance without the vendor risk or log fees:** [LLM Gateway](https://llmgateway.io) — open source end to end, self-hostable, compliance policies enforced at the gateway.

**You already run Kong:** Kong AI Gateway adds LLM controls with the least new vendor surface.

**Everything must live in your VPC:** TrueFoundry, if you have the Kubernetes practice and the budget.

**You want a free proxy and can operate it:** LiteLLM for coverage, Bifrost for throughput.

**You mostly needed routing:** Vercel AI Gateway inside the AI SDK ecosystem, OpenRouter for the biggest catalog.

**You mostly needed visibility:** Cloudflare AI Gateway covers caching and cost analytics for free.

Whatever you pick, check the fee structure before you commit — see [who marks up your tokens](/blog/ai-gateway-fees-compared) and the wider [best AI gateways](/blog/best-ai-gateways) comparison.

## Migrating Off Portkey

Portkey's gateway speaks the OpenAI format, so the mechanical change is small — swap the Portkey client or base URL for your new gateway's endpoint and remove the Portkey-specific config headers:

```diff
- const baseURL = "https://api.portkey.ai/v1";
- const apiKey = process.env.PORTKEY_API_KEY;
+ const baseURL = "https://api.llmgateway.io/v1";
+ const apiKey = process.env.LLM_GATEWAY_API_KEY;
```

The real work is recreating what lived in Portkey's dashboard: routing configs, budgets, guardrails, and team permissions. Map each to the new platform before you cut over — on LLM Gateway that's [routing](https://docs.llmgateway.io/features/routing), per-key limits, [guardrails](https://llmgateway.io/enterprise/guardrails), and [compliance policies](https://docs.llmgateway.io/features/compliance).

## Try the Top Pick

If you want Portkey-grade governance on a gateway you can own:

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — no credit card required, point your SDK at `https://api.llmgateway.io/v1`
- **[Read the compliance policy docs](https://docs.llmgateway.io/features/compliance)** — fail-closed provider requirements, enforced before data leaves the gateway
- **[LLM Gateway vs Portkey](/blog/llm-gateway-vs-portkey)** — the detailed head-to-head if you're still deciding

<BlogCta variant="gateway" location="bottom" />
