---
id: "87"
slug: "airside-provider-console"
date: "2026-09-01"
title: "Airside: Self-Serve Provider Listings"
summary: "Airside is the new carrier console where LLM providers list themselves on the gateway: claim your provider by verifying your company domain, register models, file prices for review, and tune the margin and discounts that win routed traffic. Listing costs a one-time $2,500 fee per provider company and goes live once we approve your claim."
image:
  src: "/changelog/airside-provider-console.png"
  alt: "Airside carrier console: a glowing control tower on a circuit board directing routes of light toward provider gates"
  width: 1536
  height: 1024
---

Getting a model provider listed on a gateway has meant sales calls, spreadsheets, and waiting — which kept smaller and local-model providers off the departure board entirely. **Airside** replaces that with a console: providers claim their listing, run their fleet, and file their own prices at [airside.llmgateway.io](https://airside.llmgateway.io).

## Claim Your Carrier

Sign up with your company email. When its registrable domain matches your API endpoint's domain (or published website), your provider is claimable — `ops@example.ai` claims the carrier serving `api.example.ai`, and that check is enforced server-side. Not in the catalogue yet? Register a new carrier by pointing Airside at your OpenAI-compatible endpoint on the same domain. Every claim and new registration is reviewed by our team before it goes live, and a listing covers your whole crew — invite up to 10 teammates.

## File Your Fleet and Fares

Under **Fleet**, register models with context size, capability flags, and launch pricing. Listed prices are what developers are billed, so pricing never changes silently: the initial filing activates the model on approval, and every later change is an update filing — drafted by you, approved by us, only then in effect. Approved listings are genuinely routable and billed at the filed prices, and **Traffic** shows requests, errors, tokens, and billed USD per model and per day.

Two knobs move routing itself:

| Knob                 | Range                | Effect                                                                               |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| **Traffic discount** | 0–50%                | Lowers your effective price in the routing election only — you win more traffic.     |
| **Landing fee**      | 5–50% (baseline 20%) | The gateway margin you accept. Accepting more boosts your score; less prices you up. |

The election scores every candidate on price after discount and margin, availability, prompt-cache support, throughput, and latency — the lowest score wins. No paid placement.

## What It Costs

Listing on llmgateway.io carries a one-time **$2,500 listing fee** per provider company, paid via Stripe during onboarding and due before your claim is approved. Providers we already work with receive an invite code that waives it. There is no subscription and no minimum volume: once listed, you only share the gateway margin you accept on traffic you win.

---

**[Airside docs →](https://docs.llmgateway.io/features/airside)** | **[Claim your carrier →](https://airside.llmgateway.io)**
