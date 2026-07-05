---
id: "63"
slug: "team-budgets-product-roundup"
date: "2026-07-03"
title: "Per-Member Budgets, Developer Role & PDF Invoices"
summary: "Cap any teammate's spend and API keys with per-member budgets, give contractors project-scoped developer access on Enterprise, download a PDF invoice for any purchase, and see analytics bucketed in your own timezone. Plus Claude Sonnet 5 at introductory pricing, Claude Fable 5 back online, and DevPass Code on npm."
image:
  src: "/changelog/team-budgets-product-roundup.png"
  alt: "Product roundup: per-member budgets, developer role, PDF invoices, and timezone-aware analytics on LLM Gateway"
  width: 1536
  height: 1024
---

Everyone in an organization used to draw from one pool of credits with no per-person guard rails — one over-eager script could spend the whole team's budget. This roundup is about per-member control: budgets, a scoped developer role, clearer billing, and steadier streams.

## One Team Page for People and Spend

**Team** and **Members** are now a single page. **Organization → Team** handles invites, roles, and budgets, and — for admins on the **Enterprise plan** — adds per-member cost, tokens, requests, and API-key columns. Open a member's detail page for their spend against each cap, a usage-over-time chart by model, and their top models and providers. An info card next to the role picker spells out exactly what Owner, Admin, and Developer can do.

## Per-Member Budgets

Give each member their own guard rails from **Manage budget** on any Team row:

| Limit                   | What it caps                                     |
| ----------------------- | ------------------------------------------------ |
| **Max active API keys** | How many keys the member can have active at once |
| **Total spend limit**   | Lifetime spend across all of the member's keys   |
| **Period spend limit**  | Spend per rolling hour, day, week, or month      |

The gateway enforces spend caps at request time across chat, embeddings, OCR, speech, and video — an over-budget request is rejected with `403` ("Member has reached their total spend budget.") before it reaches a provider, and key creation past the cap fails with a clear `400`. You can also set org-wide **default developer limits** that cover every developer without a personal override, and each member sees their remaining allowance on their own dashboard. Budgets are available to admins on every plan.

## Project-Scoped Developer Role

The new **Developer** role grants access to exactly the projects you pick — nothing else. Developers get a minimal dashboard with their own usage and API keys, and the rest of the org UI stays out of reach. Pair it with default developer limits and a contractor is productive, and capped, in one invite. Available on the **Enterprise plan**.

## PDF Invoices for Every Purchase

Every completed charge in **Organization → Transactions** now has a download button — an **Invoice** for charges, a **Credit note** for refunds:

```
GET /orgs/{orgId}/transactions/{transactionId}/invoice
```

The same download is available for DevPass invoices and from the chat billing history.

## Analytics in Your Timezone

Daily charts used to bucket by UTC midnight, so late-evening traffic landed on "tomorrow". Every analytics endpoint now accepts an IANA `timezone` parameter and buckets by your local day — the dashboard passes your browser's timezone automatically, so charts line up with your wall clock:

```
GET /analytics/activity?organizationId=<org>&groupBy=model&timezone=Europe/Paris
```

## Key Usage and Reset Times in the API

The Master Keys API and the payments SDK's `getBalance()` now report consumed usage next to the configured limits — including when the current window resets — so platforms can show end users exactly how much headroom a key has left:

```json
{
  "usageLimit": "100",
  "usage": "42.13",
  "periodUsageLimit": "10",
  "currentPeriodUsage": "3.20",
  "currentPeriodResetAt": "2026-07-04T00:00:00.000Z"
}
```

## Streams That Don't Drop

Long streaming responses — extended thinking especially — could sit quiet long enough for a proxy or client to time out. The gateway now sends an SSE keepalive comment (`: ping`) every 15 seconds on the Anthropic and Responses endpoints, and a mid-stream failure ends with a proper terminal event (`error` + `message_stop`, or `response.failed`) instead of a silently truncated response.

## New Models

- **Claude Sonnet 5** — a 1M-token context window, adaptive reasoning, and 128k output, at introductory pricing of **$2 / $10 per million input/output tokens through August 31** (then $3 / $15). Available via Anthropic, Google Vertex, and AWS Bedrock.
- **Claude Fable 5 is back** — reactivated on Anthropic and AWS Bedrock (global and US regions) after [June's suspension](https://llmgateway.io/blog/claude-fable-5-access-suspended).
- **Gemini 3.1 Flash Lite Image** — Google's smallest image generation and editing model, built for at-scale usage, on AI Studio and Vertex.
- **Gemma 4 31B on Cerebras** — a new high-speed mapping at $0.99 / $1.49 per million tokens.

## Product Polish

- **Support widget redesign** — suggested starter questions, one-click "Talk to a human" escalation with email follow-up, and conversation ratings.
- **DevPass Code on npm** — the [terminal coding agent](https://llmgateway.io/blog/devpass-code) now installs with `npm i -g devpass-code`.

---

**[Team & budgets docs →](https://docs.llmgateway.io/learn/team)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
