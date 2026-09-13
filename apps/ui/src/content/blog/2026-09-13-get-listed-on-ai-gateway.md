---
id: "blog-get-listed-on-ai-gateway"
slug: "get-listed-on-ai-gateway"
date: "2026-09-13"
title: "How to Get Your LLM API Listed on an AI Gateway"
summary: "A checklist for inference providers who want their LLM API listed on an AI gateway: domain ownership, an OpenAI-compatible endpoint the gateway can actually call, honest capability flags, streaming that reports usage, flat per-million pricing, and rate limits you can sustain. Written against LLM Gateway's Airside listing process."
categories: ["Guides", "Engineering"]
faqs:
  - question: "What do I need to list my LLM API on LLM Gateway?"
    answer: "A company email on the same registrable domain as your API endpoint or published website, an OpenAI-compatible endpoint you operate, and a one-time $2,500 listing fee or an invite code. You then register each model with its capabilities and pricing, pass a live preflight against your endpoint, and wait for the LLM Gateway team to approve the claim and the initial price filing."
  - question: "Does my API have to be OpenAI-compatible?"
    answer: "The carrier default is OpenAI Chat Completions, and the gateway calls your base URL plus /v1/chat/completions. Each model can instead declare the OpenAI Responses API or Google Vertex generateContent as its upstream format, and preflight verification runs through whichever format you pick."
  - question: "Why was my base URL rejected?"
    answer: "The gateway appends the endpoint path itself. A base URL that already ends in /v1 or /v1/chat/completions would produce a doubled path and fail every request, so registration rejects it. Enter only the host and any path prefix before /v1."
  - question: "Can I list tiered or context-length pricing?"
    answer: "No. A listing holds one flat set of per-million rates per region: input, output, optional cached input, and an optional per-request charge. File the rate you can sustain at your highest band, and use regional fares if a specific region is priced differently."
image:
  src: "/blog/get-listed-on-ai-gateway.png"
  alt: "A glowing boarding-gate arch on a central chip with a lit checklist beside it and light traces leading in from the edge of a circuit board, surrounded by a key, a plug, and a document icon"
  width: 1536
  height: 1024
---

An AI gateway is the shortest path between an inference provider and a large pool of developers who have already integrated one endpoint. Getting listed on one used to mean an email thread, a shared spreadsheet, and a wait. **LLM Gateway** replaced that with [Airside](https://airside.llmgateway.io), a self-serve console, but the underlying requirements did not go away: the gateway still has to prove you own the provider, call your API without surprises, bill the right amount, and trust your capability flags.

This is the checklist we wish every provider had before they signed up. It is written against Airside, and most of it is what any routing gateway needs from you.

## 1. Prove you own the provider

The gateway needs to know that the person claiming `acme` actually runs `api.acme.ai`. Airside checks this by domain:

- Sign up with a **company email**. Its registrable domain must match the registrable domain of your API endpoint or your published website. Subdomains collapse, so `ops@mail.acme.ai` claims the carrier serving `api.acme.ai`.
- If your API lives on a different domain than your email, prove the website instead by publishing a `_llmgateway-airside` DNS TXT record from onboarding.
- Free and disposable email domains are rejected, and only one live claim can exist per provider.

Claims are reviewed by the LLM Gateway team before the carrier goes live. Listing carries a one-time, non-refundable **$2,500 fee** per provider company, paid through Stripe before approval, or an invite code if we already work with you.

## 2. Give the gateway a base URL it can call

The carrier default upstream format is OpenAI Chat Completions, and the gateway calls `<base URL>/v1/chat/completions`. That has two consequences:

- Enter the **base URL only**. Registration rejects a URL whose path already contains `/v1` or `/chat/completions`, because the doubled path would fail every request.
- The endpoint must be on your verified domain, the same rule as the claim.

Not a Chat Completions shop? Each model declares its own **upstream API**: carrier default, OpenAI Chat Completions, OpenAI Responses, or Google Vertex `generateContent`. Preflight runs through the format you pick, so what passes verification is what serves traffic.

## 3. Declare only the capabilities you serve

Capability flags are not marketing. On LLM Gateway they decide which elections you enter: a request with tool calls only considers listings with tools enabled, and the same gate applies to vision, audio input, JSON output, JSON schema output, reasoning, reasoning budgets, and web search. Over-declare and you win candidacy followed by a `400`. Under-declare and you sit out requests you could have served.

Airside runs a **preflight** against your endpoint before a model can be filed. You paste a provider key that is used only for that run and erased afterward, and each declared capability gets its own live check:

| Check            | Runs when you declare    |
| ---------------- | ------------------------ |
| Basic completion | Always                   |
| Streaming        | Streaming                |
| Vision input     | Vision                   |
| Audio input      | Audio input              |
| Tool calls       | Tools                    |
| JSON output      | JSON output              |
| Structured JSON  | JSON schema output       |
| Reasoning        | Reasoning                |
| Reasoning budget | A reasoning token budget |
| Web search       | Web search               |

A failed check names the flag to fix rather than rejecting the listing. The verified set becomes the capability badges on your provider page, which is what developers and routing read.

## 4. Report usage on every stream

Billing on a gateway is only as accurate as the usage your API returns. For streaming requests the gateway sends `stream_options: { "include_usage": true }` and expects a final chunk carrying `usage`. A stream that finishes without reporting completion tokens is billed at **zero output**, with a warning in our logs rather than an estimate in your favor. If your server speaks SSE but drops usage, fix that before listing; it is the most expensive silent bug a provider can ship.

## 5. Describe the model honestly

Airside asks for the details developers use to compare deployments of the same model:

- **Canonical model ID.** If the model is already in the [catalogue](https://llmgateway.io/models), use its exact canonical ID so your deployment appears next to every other provider serving it. Your own upstream model ID is stored separately.
- **Context window and maximum output** as your endpoint actually enforces them.
- **Quantization** (`int4`, `int8`, `fp4`, `fp6`, `fp8`, `fp16`, `bf16`, or `fp32`). It is printed on your model card, and a low price with undisclosed quantization is the fastest way to lose a developer's trust.
- **Supported reasoning efforts** if the model exposes them.

Draft listings are editable freely. Once a model is active, metadata edits are filed for review so a public listing never changes without a second pair of eyes, and a pending edit can be replaced or withdrawn until it is reviewed.

## 6. File flat prices per million tokens

A listing holds four rates, all in USD: input and output per million tokens, an optional cached-input rate per million, and an optional flat charge per request. Listed prices are what developers are billed, so they enter service only through a reviewed **price filing**: the initial filing activates the model on approval, and every later change is an update filing that takes effect once approved. One filing can be pending per model at a time.

Two things to know before you type numbers:

- **Tiers are not supported.** If your own pricing has context-length bands, file the rate you can sustain at the top band. The console's "Use catalog price" shortcut only copies flat tariffs for the same reason.
- **Regions are.** A filing can carry per-region overrides that developers reach with `provider/model:region`, while all other traffic pays the default.

File a cached-input rate if your deployment supports prompt caching. Routing prices long prompts and coding sessions on a cache-aware blend, and a listing without a cached rate competes at its full input price. The [carrier's guide to routing](/blog/llm-routing-carriers-guide) has the formula.

## 7. Set rate limits you can hold

Each model carries optional caps on requests per minute and per day, with a scope of **global** (one counter across all organizations) or **per organization**. A listing at its cap is skipped by routing until the window resets, so a cap set below your real capacity is traffic handed to a competitor. Airside's [rate limit calculator](https://airside.llmgateway.io/tools/rate-limit-calculator) turns a throughput budget into a sensible pair of numbers.

## 8. Bring the boring assets

- **A logo as SVG.** It appears on your provider page and model cards; branding changes after approval are reviewed.
- **A public website and terms.** Developers check them before pinning a provider, and the website can double as your ownership proof.
- **Up to 10 crew members**, invited from the console so nobody shares a login.

## What happens after you submit

Every new carrier gets a shared Slack Connect channel with the LLM Gateway team, which is where claim questions, filing reviews, and routing questions go. Once the claim and the initial filing are approved, your models appear on the public [providers](https://llmgateway.io/providers) and models pages, requests for `provider/model` resolve to your endpoint, and the **Traffic** page shows requests, errors, tokens, and billed USD per model and per day. About 1% of requests are routed to random candidates so a fresh listing can build the uptime and latency history it needs to win the rest.

## Get listed

- **[Start your claim on Airside](https://airside.llmgateway.io)** with your company email
- **[Read the listing guide](https://airside.llmgateway.io/guides/list-your-llm-api)** for the console walkthrough
- **[See what listing earns](/blog/make-money-llm-inference)** with the fare math and a worked example
