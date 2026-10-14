---
id: "blog-litellm-vs-openrouter-vs-llm-gateway"
slug: "litellm-vs-openrouter-vs-llm-gateway"
date: "2026-10-11"
title: "LiteLLM vs OpenRouter vs LLM Gateway: Which Proxy for Production?"
summary: "LiteLLM vs OpenRouter vs LLM Gateway compared on the decisions that matter in production: who runs the proxy, what you pay on your own keys, how routing and failover work, what you get for observability, and how the three score on an independent latency benchmark."
categories: ["Guides"]
faqs:
  - question: "Is LiteLLM a gateway or an SDK?"
    answer: "Both. LiteLLM is a Python SDK that normalizes 100+ provider APIs behind an OpenAI-style call, and a proxy server you self-host to expose that as an OpenAI-compatible endpoint with virtual keys and budgets. There is no hosted LiteLLM endpoint; you run and scale it yourself."
  - question: "What is the difference between OpenRouter and LiteLLM?"
    answer: "OpenRouter is a hosted service: one API key, 400+ models, nothing to run, with a fee on credit purchases (5.5% on Standard, 8% on Business) and a 5% fee on bring-your-own-key traffic above a $25,000-per-month allowance of list-price inference; Enterprise terms are custom. LiteLLM is open-source software you deploy and operate; it charges nothing but you pay for the infrastructure and the on-call."
  - question: "When should I pick LLM Gateway over LiteLLM or OpenRouter?"
    answer: "When you want the hosted convenience of OpenRouter with the self-hosting option and zero-markup BYOK of LiteLLM in one product. LLM Gateway is open source (AGPLv3), runs as a managed service or one Docker command, charges 0% on your own keys, and scores providers on uptime, throughput, price and latency instead of static fallback lists."
  - question: "Which LLM proxy adds the least latency?"
    answer: "In computesdk's independent AI gateway benchmark (August 7, 2026 run), LLM Gateway ranked first of six gateways with a composite score of 90.8 and a warm p95 time-to-first-token of 1,151 ms, ahead of OpenRouter at 88.3. LiteLLM was not in that run; as self-hosted software its overhead depends on where you deploy it."
image:
  src: "/blog/litellm-vs-openrouter-vs-llm-gateway.png"
  alt: "A glowing three-way junction on the central chip of a dark circuit board where one light trace splits toward three smaller chips, surrounded by balance scale, server rack, cloud, gauge and coin-stack icons, representing a LiteLLM vs OpenRouter vs LLM Gateway comparison"
  width: 1536
  height: 1024
---

Three names come up in every "which LLM proxy" thread: **LiteLLM**, the Python proxy you self-host; **OpenRouter**, the hosted catalog with one key for everything; and **LLM Gateway**, the open-source gateway you can run yourself or use hosted. They solve the same problem, one OpenAI-compatible endpoint in front of many providers, with different trade-offs on who operates it, what it costs on your own keys, and how much it does for you once a provider fails.

This comparison sticks to the decisions that matter once traffic is real. Figures are from each product's public pricing and docs as of October 11, 2026; LLM Gateway numbers are from the [model catalog](https://llmgateway.io/models) and [docs](https://docs.llmgateway.io).

## LiteLLM vs OpenRouter vs LLM Gateway at a glance

| Decision                      | LiteLLM                         | OpenRouter                                                                                  | LLM Gateway                                              |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| What it is                    | Python SDK + self-hosted proxy  | Hosted API                                                                                  | Open-source gateway, hosted or self-hosted               |
| Who runs it                   | You                             | OpenRouter                                                                                  | LLM Gateway (managed) or you (Docker)                    |
| Open source                   | Yes                             | No                                                                                          | Yes (AGPLv3)                                             |
| Models                        | 100+ providers via SDK          | 400+ models, 80+ providers                                                                  | 250+ models, 40+ providers                               |
| Bring your own keys           | Yes, no fee                     | $25k/month of list-price inference free (Standard and Business), then 5%; Enterprise custom | Yes, 0% fee                                              |
| Platform credits              | None                            | Fee on purchases: 5.5% Standard, 8% Business; no token markup                               | 5% platform fee                                          |
| Routing                       | Manual fallback lists per model | Provider-based routing                                                                      | Weighted scoring on uptime, throughput, price, latency   |
| Failover                      | Configured per model            | Yes                                                                                         | Automatic, up to 2 retries, listed in response metadata  |
| Response caching              | Built in, needs config          | Beta                                                                                        | Built in, 10 s to 1 year TTL                             |
| Guardrails                    | External integrations           | Enterprise                                                                                  | Enterprise (prompt injection, PII, jailbreak, secrets)   |
| Analytics                     | Dashboard + spend logs          | Dashboard, logs, OpenTelemetry export                                                       | Per-request cost, latency, cache hits; 90-day audit logs |
| Image and video generation    | Image yes, video limited        | Image yes, video limited                                                                    | Image and video (`/v1/images/generations`, `/v1/videos`) |
| Independent latency benchmark | Not measured                    | 88.3 composite (5th of 6)                                                                   | 90.8 composite (1st of 6)                                |

## Who operates the proxy

This is the first fork in the road.

**LiteLLM** is software. You deploy the proxy, give it a database for keys and spend, put it behind a load balancer, upgrade it, and page someone when it falls over. In return you own everything: the config, the logs, the network path. Teams with a platform group and strict data-residency rules often prefer this.

**OpenRouter** is a service. There is nothing to run; you get one key and a catalog of 400+ models. You also get nothing to configure beyond the request, and no option to keep traffic inside your own network.

**LLM Gateway** does both. The hosted endpoint at `https://api.llmgateway.io/v1` works like OpenRouter: one key, no infrastructure. The same code is open source under AGPLv3 and runs with one Docker command when you need it inside your VPC. You can start hosted and move to self-hosted later without changing the API your application calls. See [self-hosting LLM Gateway](/blog/self-host-llm-gateway).

## What you pay on your own keys

If you already have provider accounts, the question is what the proxy charges on top.

- **LiteLLM:** nothing. The software is free; you pay for compute, the database and the people.
- **OpenRouter:** on the Standard and Business plans, BYOK traffic is free up to $25,000 of list-price inference a month, then 5%, measured against what the same requests would cost at OpenRouter list prices. Credit purchases carry a 5.5% fee on Standard and 8% on Business; token prices themselves pass through without markup. Enterprise terms are custom.
- **LLM Gateway:** 0% on your own keys, hosted or self-hosted. If you use platform credits instead, a 5% platform fee applies.

For a team whose BYOK traffic amounts to $40,000 a month of list-price-equivalent inference, that is $0 on LiteLLM and LLM Gateway, and $750 a month on OpenRouter Standard or Business for the $15,000 above the allowance.

## Routing and failover when a provider fails

Open-weight models such as `deepseek-v3.2` or `kimi-k3` are served by several providers at different prices and uptime. How the proxy picks one, and what it does when the pick fails, decides your error rate.

**LiteLLM** routes with fallback lists you write per model. It works, and it is explicit, but the list does not know that one provider has been returning 529s for ten minutes unless you add health checks and tune them.

**OpenRouter** routes by provider preference and reroutes on failure.

**LLM Gateway** scores every healthy provider for the requested model on uptime, throughput, price and time to first token, sends to the best, and retries on another when the first fails. The response's `metadata.routing` lists every attempt, so a failover is visible per request instead of inferred from a spike in latency. Send `"routing": "price"` or `"routing": "throughput"` to bias the choice, or prefix a provider (`deepinfra/deepseek-v3.2`) to pin it. For multi-turn work, an `x-session-id` header pins the session to one provider so the upstream prompt cache stays warm. Details in the [routing docs](https://docs.llmgateway.io/features/routing).

## Observability

LiteLLM ships a dashboard and spend logs per virtual key; audit logs are an Enterprise feature. OpenRouter has improved its request logs, exports and OpenTelemetry support, all inside its own dashboard. LLM Gateway logs every request with the provider that served it, cost, latency and cache hit, broken down by project and key, keeps 90 days of audit logs, and exposes the same data over the API for your own dashboards; see [enterprise LLM analytics](/blog/enterprise-llm-analytics).

## Latency: the independent numbers

In the August 7, 2026 run of computesdk's open AI gateway benchmark, LLM Gateway ranked first of six gateways with a composite score of 90.8, driven by the tightest tail latency in the field (warm TTFT p95 of 1,151 ms, cold end-to-end p95 of 1,262 ms). OpenRouter scored 88.3, fifth. LiteLLM was not in the run, which measures hosted gateways. The full breakdown and how to rerun it are in [our benchmark write-up](/blog/ai-gateway-benchmark).

## Migrating between them

All three are OpenAI-compatible, so migration is a base URL change and, for provider-prefixed IDs, a model string change:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

// LiteLLM "gemini/gemini-3.8-flash" or OpenRouter "google/gemini-3.8-flash"
// become a bare catalog ID; add a provider prefix only to pin it.
const completion = await client.chat.completions.create({
  model: "gemini-3.8-flash",
  messages: [{ role: "user", content: "Hello" }],
});
```

Per-product details are in [LLM Gateway vs LiteLLM](/blog/llm-gateway-vs-litellm) and [LLM Gateway vs OpenRouter](/blog/llm-gateway-vs-openrouter).

## Verdict

- **Pick LiteLLM** if you have a platform team that wants to own the proxy end to end, traffic must never leave your network, and you are comfortable writing and maintaining fallback config.
- **Pick OpenRouter** if you want the largest hosted catalog, will never self-host, and the credit fee (5.5% Standard, 8% Business) or the 5% BYOK fee above the $25k monthly allowance is acceptable.
- **Pick LLM Gateway** if you want hosted convenience today with a self-hosting exit, 0% on your own keys, scored routing with visible failover, and the lowest tail latency on the one public benchmark that compares gateways.

## Next steps

- **[Try LLM Gateway free](https://llmgateway.io/signup)**: point your OpenAI SDK at `https://api.llmgateway.io/v1`.
- Read the [self-hosting guide](https://docs.llmgateway.io/self-host) if you need it inside your VPC.
- See [the best LLM gateways in 2026](/blog/best-ai-gateways) for Portkey, Helicone, Vercel, Cloudflare and Bedrock.
