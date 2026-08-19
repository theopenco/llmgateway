---
id: "blog-helicone-alternatives"
slug: "helicone-alternatives"
date: "2026-08-04"
title: "8 Best Helicone Alternatives in 2026 (Compared)"
summary: "Helicone entered maintenance mode after the Mintlify acquisition in March 2026. The 8 best Helicone alternatives in 2026, compared honestly — gateways with built-in analytics and dedicated LLM observability platforms — and how to pick between them."
categories: ["Guides"]
faqs:
  - question: "Is Helicone still maintained in 2026?"
    answer: "Helicone is in maintenance mode following its acquisition by Mintlify in March 2026 — existing deployments keep working, but there's no active feature development. That's workable for current users and the wrong bet for new deployments."
  - question: "What is the best Helicone alternative?"
    answer: "For the way most teams actually used Helicone — a proxy that made costs and latency visible — LLM Gateway is the closest one-for-one replacement: the same base-URL adoption with analytics included, plus multi-provider routing Helicone never had. For deep traces and evals, Langfuse is the open-source standard."
  - question: "Do I need a gateway or an observability platform?"
    answer: "Ask what you'd lose tomorrow if Helicone vanished. If it's cost/latency visibility, a gateway with built-in analytics replaces it and improves your routing. If it's span-level agent traces and evals, you want a dedicated platform — and the two work together."
  - question: "How hard is it to migrate off Helicone?"
    answer: "If you adopted Helicone via its proxy URL, migrating to another proxy-style tool is the same one-line change. Moving to an SDK-based platform (Langfuse, LangSmith) is a bigger step: you're adding instrumentation, not just redirecting traffic."
image:
  src: "/blog/helicone-alternatives.png"
  alt: "The best Helicone alternatives in 2026 — a glowing analytics dashboard chip observing request traces on a circuit board"
  width: 1536
  height: 1024
---

Helicone had one of the best adoption stories in LLM tooling: change your base URL, and every request suddenly had logs, costs, latency, and cache hits attached. Thousands of teams got their first real look at their LLM spend through it.

That story ended in March 2026, when Mintlify acquired Helicone and the product entered maintenance mode. Existing deployments keep running, but there's no active development — which, for the layer that watches your production traffic, is a polite way of saying it's time to move. "Helicone alternatives" searches have climbed ever since.

The good news: the market has split into two mature camps, and both are better than what Helicone offered at its peak. We compared the 8 best Helicone alternatives in 2026 across them. We build one of them, so we're biased — but we'll tell you where each option genuinely wins.

## What Happened to Helicone?

The short version: Mintlify (the documentation platform) acquired Helicone in March 2026, and Helicone moved to maintenance mode — security patches, no roadmap. If you're running it today, nothing breaks tomorrow. But observability is the tool you need most when models, providers, and price schedules churn, and a frozen product falls behind that churn within quarters. Fine if you already run it and it does the job; the wrong choice for a new deployment.

## Gateway or Observability Platform? Decide This First

Helicone sat in the middle: a proxy that observed. Its replacements are better at one side or the other:

- **Gateways with built-in analytics** (LLM Gateway, Cloudflare AI Gateway, Portkey) keep the proxy-style adoption — change a base URL, get cost and latency data per request — and add routing, failover, and caching that Helicone never had.
- **Dedicated observability platforms** (Langfuse, LangSmith, Arize Phoenix, W&B Weave) skip the proxy: you instrument with an SDK or OpenTelemetry, and get deeper traces, evals, and prompt management than any proxy can see.

If Helicone was your _only_ window into LLM traffic, a gateway replaces it one-for-one and upgrades your routing at the same time. If you're building agent pipelines that need span-level traces and evals, add a dedicated platform — the two camps compose.

## Comparison Table

| Alternative           | Type                    | Open source  | Self-host       | Adoption        | Best for                      |
| --------------------- | ----------------------- | ------------ | --------------- | --------------- | ----------------------------- |
| LLM Gateway           | Gateway + analytics     | Yes (AGPLv3) | Yes             | Base URL change | Best overall proxy-style swap |
| Langfuse              | Observability           | Yes          | Yes             | SDK / OTel      | OSS tracing standard          |
| LangSmith             | Observability           | No           | Enterprise only | SDK / OTel      | LangChain-first teams         |
| Arize Phoenix         | Observability           | Yes          | Yes             | SDK / OTel      | Notebook-driven evals         |
| Cloudflare AI GW      | Gateway + analytics     | No           | No              | Base URL change | Cloudflare shops              |
| Portkey               | Gateway + observability | Partial      | Partial         | SDK / base URL  | Enterprise suites             |
| W&B Weave             | Observability           | Partial      | Via W&B         | SDK             | Teams already on W&B          |
| PostHog LLM analytics | Product analytics       | Yes          | Yes             | SDK             | Product + LLM data in one     |

## 1. LLM Gateway

**Best overall. The same one-line adoption, plus routing Helicone never had.**

[LLM Gateway](https://llmgateway.io) is an open-source (AGPLv3) gateway that routes to 200+ models across 40+ providers through one OpenAI-compatible endpoint — with per-request cost, token, and latency analytics built into the dashboard. Adoption is exactly the motion Helicone taught everyone: point your base URL at it and every request is accounted for.

**What sets it apart:**

- **Analytics included, not metered** — per-request cost and latency breakdowns, per-model and per-provider usage, spend tracking per project and API key, with no per-log fees
- **It's also your router** — automatic failover, weighted routing on live uptime/latency/price, and Redis-backed response caching; Helicone observed problems, a gateway routes around them
- **Open source and self-hostable** — the AGPLv3 core runs inside your boundary, with data in your own Postgres
- **Payload retention is a policy, not a default** — metadata-only by default, full [data retention](/blog/llm-data-retention) opt-in when you need payload-level debugging
- **A migration that's one line again** — same trick that got you into Helicone gets you out

```diff
- const baseURL = "https://oai.helicone.ai/v1";
- const apiKey = process.env.OPENAI_API_KEY;
+ const baseURL = "https://api.llmgateway.io/v1";
+ const apiKey = process.env.LLM_GATEWAY_API_KEY;
```

**Pricing:** Free to self-host. Managed cloud is pay-as-you-go with a 5% platform fee on credits — or 0% with your own provider keys.

**Best for:** Teams that used Helicone as their window into LLM traffic and want that window plus routing, caching, and failover — without adopting an SDK. See the wider [best AI gateways](/blog/best-ai-gateways) comparison.

---

<BlogCta variant="gateway" location="mid_article" />

## 2. Langfuse

**The open-source LLM observability standard.**

Langfuse is the most widely adopted open-source LLM observability platform: traces, costs, evals, and prompt management, instrumented via its SDKs or OpenTelemetry, backed by Postgres and ClickHouse. ClickHouse acquired Langfuse in 2026, which reads as investment in exactly the data layer an observability product lives on — the opposite of Helicone's trajectory.

**Strengths:**

- Open source and self-hostable with no usage limits
- Framework-agnostic: any LLM SDK or agent framework via OTel
- Evals, prompt management, and annotation workflows beyond anything Helicone had

**Weaknesses:**

- SDK/OTel instrumentation, not a proxy — adoption is a code change, not a base URL change
- No routing, failover, or caching; it watches traffic, it doesn't carry it
- Self-hosting means operating Postgres + ClickHouse

**Pricing:** Self-hosting is free. Managed cloud has a free tier with paid plans.

**Best for:** Teams that want deep, open-source tracing and evals and are happy to instrument their code.

---

## 3. LangSmith

**The deepest platform if you live in the LangChain ecosystem.**

LangSmith is LangChain's proprietary observability and evals platform. It's polished and fast — but its client SDKs are the only open part, and self-hosting is an Enterprise-exclusive add-on.

**Strengths:**

- First-class tracing for LangChain and LangGraph, plus OTel ingestion for everything else
- Mature evals, datasets, and annotation queues
- Actively and heavily developed

**Weaknesses:**

- Closed source; self-hosting locked to Enterprise
- Strongest inside the LangChain ecosystem, less compelling outside it
- Another per-seat/per-trace platform bill to manage

**Pricing:** Free tier; paid plans per seat with usage-based trace pricing.

**Best for:** LangChain/LangGraph teams that want the native tooling and don't need open source.

---

## 4. Arize Phoenix

**Open-source, local-first tracing and evals.**

Phoenix (from Arize) is an open-source LLM tracing and evaluation tool with a famously low floor: one `pip install`, and a trace viewer is running on your laptop. The same Phoenix deploys as a self-hosted server when you outgrow the notebook.

**Strengths:**

- Fully open source, OTel-native
- Local-first workflow that's ideal for debugging sessions and notebook evals
- Scales from laptop to self-hosted server with the same tool

**Weaknesses:**

- Leans toward experimentation and offline analysis more than production dashboards
- No proxy mode, no routing, no cost accounting across providers
- Python-centric ergonomics

**Pricing:** Free and open source; Arize's commercial platform is separate.

**Best for:** ML engineers whose evals live in notebooks and pipelines.

---

## 5. Cloudflare AI Gateway

**The closest free proxy-style swap.**

Cloudflare AI Gateway is the most Helicone-like adoption story on this list: point your provider's base URL through it, get logs, caching, rate limiting, and per-request cost analytics at the edge, with a generous free tier.

**Strengths:**

- One-line setup, free core features
- Edge caching and rate limiting close to users
- Clean per-provider cost and latency analytics

**Weaknesses:**

- Observability is request-level, not trace-level — no spans, evals, or prompt management
- No smart multi-provider failover and no unified billing
- Managed only, tied to Cloudflare

**Pricing:** Free core features with a Cloudflare account; paid tiers for higher limits.

**Best for:** Cloudflare shops that want Helicone's visibility-and-caching slice for free.

---

## 6. Portkey

**A full enterprise suite — now inside Palo Alto Networks.**

Portkey pairs a gateway with the deepest observability of the gateway camp: traces, logs, cost attribution, guardrails, and budgets. Palo Alto Networks acquired it in May 2026 (now part of Prisma AIRS), which makes it a stronger enterprise-security story and a weaker developer-tool one.

**Strengths:**

- Mature request tracing and cost attribution
- Governance and guardrails suited to compliance-heavy teams
- Much of the stack open-sourced (MIT) with Gateway 2.0

**Weaknesses:**

- Log storage and compliance features still require their cloud
- Usage-based pricing (from $49/month plus per-log fees) scales against you
- Post-acquisition roadmap and procurement now run through a security vendor

**Pricing:** Free tier; Production from $49/month plus $9 per 100k logs; enterprise by quote.

**Best for:** Enterprises that want observability and governance in one vendor and are comfortable inside a security portfolio. See our full list of [Portkey alternatives](/blog/portkey-alternatives) if that's the part you're unsure about.

---

## 7. W&B Weave

**LLM observability inside the Weights & Biases platform.**

Weave brings LLM tracing, evals, and monitoring into W&B — a natural extension if your team already tracks training runs and experiments there.

**Strengths:**

- Tracing and evals integrated with the W&B workflow your ML team knows
- Strong experiment-comparison ergonomics
- Lightweight SDK instrumentation

**Weaknesses:**

- Gravity is the W&B platform; standalone adoption is less natural
- No proxy mode or gateway features
- Costs ride on your W&B plan

**Pricing:** Included with W&B plans; free tier available.

**Best for:** Teams already on Weights & Biases for ML experiment tracking.

---

## 8. PostHog LLM Analytics

**LLM costs next to your product analytics.**

PostHog added LLM analytics to its open-source product-analytics platform: token usage, costs, and latency per model, living beside the funnels and session data your product team already watches.

**Strengths:**

- LLM spend and product behavior in one tool — "which feature burns the tokens" is one query
- Open source and self-hostable
- No new vendor if you already run PostHog

**Weaknesses:**

- Analytics-first, not trace-first — thinner than Langfuse/LangSmith for debugging agent runs
- SDK instrumentation required
- Not a gateway; no routing or caching

**Pricing:** Usage-based with a free tier; self-hosting available.

**Best for:** Product teams on PostHog that want LLM costs in their existing analytics.

---

## How to Choose

**You used Helicone as a proxy and want the same motion, upgraded:** [LLM Gateway](https://llmgateway.io) — base URL change, analytics included, plus routing, failover, and caching.

**You want the open-source observability standard and will instrument code:** Langfuse.

**You're deep in LangChain:** LangSmith.

**Your evals live in notebooks:** Arize Phoenix.

**You want free request-level visibility on Cloudflare:** Cloudflare AI Gateway.

**You're buying one enterprise suite:** Portkey — after reading up on the acquisition.

And remember the camps compose: a gateway carrying your traffic and an observability platform tracing your agents is a normal 2026 stack, not a duplication.

## Try the Top Pick

If you want Helicone's visibility with a router underneath it:

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — no credit card required, point your SDK at `https://api.llmgateway.io/v1`
- **[See what the dashboard tracks](https://docs.llmgateway.io/features/cost-breakdown)** — per-request cost fields, storage costs, and usage analytics
- **[Best AI gateways in 2026](/blog/best-ai-gateways)** — the wider comparison if you're still mapping the space

<BlogCta variant="gateway" location="bottom" />
