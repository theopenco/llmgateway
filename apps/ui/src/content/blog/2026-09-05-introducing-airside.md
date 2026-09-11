---
id: "blog-introducing-airside"
slug: "introducing-airside"
date: "2026-09-05"
title: "Introducing Airside: List Your Models on LLM Gateway"
summary: "Airside is the self-serve carrier console where LLM providers claim their listing on LLM Gateway, register models, file prices for review, and tune the discount and margin that win routed traffic. Listing costs a one-time $2,500 fee per provider company, and every model is verified live before it goes on the departure board."
categories: ["Announcements"]
faqs:
  - question: "How do I list my LLM provider on LLM Gateway?"
    answer: "Sign up at airside.llmgateway.io with your company email. If its domain matches your API endpoint's domain or your published website, your existing catalogue entry is claimable; otherwise register a new carrier by pointing Airside at your API. Every claim is reviewed by the LLM Gateway team, and listing carries a one-time $2,500 fee per provider company unless you have an invite code."
  - question: "What does it cost to list a model on LLM Gateway?"
    answer: "A one-time $2,500 listing fee per provider company, paid through Stripe during onboarding. There is no subscription and no minimum volume. Once listed, you share the gateway margin you accept, called the landing fee, on the traffic you win, with a baseline of 20%."
  - question: "How does LLM Gateway decide which provider serves a request?"
    answer: "Every candidate provider is scored on price after its discount and landing fee, availability, prompt-cache support, throughput, and latency, and the lowest score wins. There is no paid placement. Offering a traffic discount or accepting a higher landing fee lowers your effective price in that election."
  - question: "Can I list a model that is not OpenAI-compatible?"
    answer: "Yes. Each model declares the upstream API the gateway should use: the carrier default, OpenAI Chat Completions, OpenAI Responses, or Google Vertex generateContent. Airside's preflight verification runs through that format, so what passes verification is what serves traffic."
image:
  src: "/blog/introducing-airside.png"
  alt: "A glowing airport control tower with a lit runway leading to it on a circuit board, surrounded by paper planes, luggage tags, coins, and a boarding-gate arch"
  width: 1536
  height: 1024
---

Getting a model provider listed on a gateway has meant sales calls, a shared spreadsheet of prices, and waiting. That process quietly favors the largest labs: a regional GPU cloud with a fast GLM deployment, or a lab shipping its first open-weight model, rarely makes it onto the departure board at all. Developers lose too, because every provider that never gets listed is one fewer competing on price and uptime for their traffic.

**Airside** replaces that process with a console. Providers claim their listing, register their models, file their prices, and watch traffic arrive, at [airside.llmgateway.io](https://airside.llmgateway.io). LLM Gateway is the airport, developers are passengers, and providers are **carriers**.

![The Airside landing page](/blog/airside/landing.png)

## Claim your carrier

Sign up with your company email and verify it. When its registrable domain matches your API endpoint's domain or your published website, your catalogue entry is claimable: `ops@example.ai` claims the carrier serving `api.example.ai`, and that check is enforced server-side, so nobody can squat a provider they do not run. Not in the catalogue yet? Register a **new carrier** from onboarding by pointing Airside at your API on the same domain.

Every claim and registration is reviewed by our team before it goes live. One company can operate several carriers, for regional deployments or separate brands, and a listing covers your whole **crew**: invite up to 10 teammates by email, and each new carrier gets a shared Slack channel with us.

## File your fleet

Under **Fleet**, register each model with its context size, maximum output, capability flags, supported reasoning efforts, and launch pricing. Carriers claiming an existing catalogue provider can import their catalogue models in one click; routing keeps using the static entry until we retire it, and from then on the Airside listing takes over.

![The Fleet page listing a carrier's models](/blog/airside/fleet.png)

Listed prices are what developers are billed, so pricing never changes silently. The initial filing activates the model once approved, and every later price change is an **update filing** that you draft and we approve before it takes effect. Approved listings are genuinely routable: a request for `<provider>/<model>` resolves against active Airside listings and is billed at the filed prices, with no extra configuration on the developer side.

## Every listing is verified before it flies

A listing is a set of claims, and a wrong claim costs developers a `400`. So before a model can be filed, Airside runs a **preflight verification** against your endpoint. You paste a provider API key that is used only by that run and erased when it finishes, pick the upstream API the gateway should speak (carrier default, OpenAI Chat Completions, OpenAI Responses, or Google Vertex `generateContent`), and every capability you declared gets its own live check:

![Registering a model with capability flags, upstream API, and preflight verification](/blog/airside/register-model.png)

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

Results come back per check, so a failure tells you which flag to fix rather than rejecting the listing. Editing a model after its preflight invalidates the run, and existing listings can be re-verified at any time. The verified capabilities appear as badges on the model's provider page on llmgateway.io, which is what developers and routing read.

## Fares: two knobs that move routing

Under **Fares**, each carrier controls how it competes:

| Knob                 | Range                | Effect                                                                                        |
| -------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| **Traffic discount** | 0–50%                | Lowers your effective price in the routing election only, so you win more traffic             |
| **Landing fee**      | 5–50% (baseline 20%) | The gateway margin you accept. Accepting more boosts your score; accepting less prices you up |

![The Fares page with the traffic discount and landing fee sliders](/blog/airside/fares.png)

Individual models can carry custom fares instead of inheriting the carrier's, and like price changes, fare changes are filed for review before they reach routing. The election itself scores every candidate on price after discount and margin, availability, prompt-cache support, throughput, and latency, and the lowest score wins. There is no paid placement, and a cheap but flaky deployment still loses to a slightly pricier stable one.

## Watch traffic arrive

**Traffic** shows what your claimed providers actually serve: requests, errors, input, output, and total tokens, and billed USD, as a daily series and per model. The numbers are cross-tenant aggregates, so you see your volume without seeing who the passengers are.

![The Traffic page with daily requests and billed USD per model](/blog/airside/traffic.png)

## A short tour

<video src="/blog/airside/airside-demo.webm" controls autoplay muted loop playsinline style="width: 100%; border-radius: 12px; margin: 1.5rem 0;"></video>

## What it costs

Listing on llmgateway.io carries a one-time **$2,500 listing fee** per provider company, paid through Stripe during onboarding and due before your claim is approved. Providers we already work with receive an invite code that waives it. There is no subscription and no minimum volume: once listed, you only share the landing fee you accept on the traffic you win. The full economics are on the [Airside pricing summary](https://airside.llmgateway.io/pricing.md).

## Why we built it this way

The gateway's promise to developers is that routing picks on price and reliability, not on who paid for placement. Airside keeps that promise while opening the door: prices are public and reviewed, discounts and margins feed the same election every provider competes in, and verification means a capability badge is something we checked rather than something a provider typed. More carriers competing on those terms is the whole point.

## Getting started

- **[Claim your carrier](https://airside.llmgateway.io)** with your company email
- **[Read the Airside docs](https://docs.llmgateway.io/features/airside)** for claiming, fleet, filings, fares, and the routing election
- **[Building on the passenger side?](https://llmgateway.io/signup)** Every approved carrier is one more provider your requests can land on

<BlogCta variant="gateway" location="bottom" />
