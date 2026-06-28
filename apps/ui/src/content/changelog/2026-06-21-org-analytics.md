---
id: "60"
slug: "org-analytics"
date: "2026-06-21"
title: "Usage Analytics by Model, Key and Member"
summary: "See exactly where your spend goes. Every project gets a Cost by Model analytics page, every API key gets its own statistics page, and Enterprise orgs get per-member usage breakdowns — all on the date-range picker you already use. Member analytics are available on Enterprise."
image:
  src: "/changelog/org-analytics.png"
  alt: "Usage analytics on LLM Gateway: cost by model, per-API-key statistics, and per-member spend breakdowns"
  width: 1536
  height: 1024
---

The dashboard could already tell you how much you spent and how many requests you sent — but not where it actually went. Which model is eating the budget? Which API key drives the traffic? Which person on the team? **Analytics** answers all three, with cost, request, and token breakdowns by model, by key, and by member.

## Cost by model, on every project

Each project now has an **Analytics** page in the sidebar with two charts:

- **Cost by Model** — a horizontal bar chart ranking your models, with **Cost / Requests / Tokens** tabs.
- **Cost by Model Over Time** — a stacked area chart over your selected range, with the same tabs plus a **Mappings / Canonical** toggle that collapses provider-tagged variants (e.g. `openai/gpt-5.5` and a custom mapping of the same model) into one canonical model.

Both derive from the same activity data the dashboard already reads, so they're timezone-correct, respect the shared date-range picker, and need no new data to populate.

## Per-API-key statistics

Every API key gets a dedicated statistics page: summary cards for **cost, tokens, requests, and error rate**, plus the two cost-by-model charts scoped to that single key. The **View Statistics** action in the API-keys list now opens it directly, so you can see at a glance whether a key is healthy and what it's spending on.

## Member analytics

Enterprise organizations also get usage broken down by person. The **Members** page adds a per-member table sorted by spend, and each member has a detail view:

| Surface           | What it shows                                                       |
| ----------------- | ------------------------------------------------------------------- |
| **Members table** | Per member: cost, tokens, requests, error rate, and API-key count.  |
| **Summary cards** | That member's cost, tokens, requests, and error rate for the range. |
| **Most used**     | Their top model, provider, and app.                                 |
| **Breakdowns**    | Cost by model, plus top providers and top apps tables.              |

Usage is attributed by who created each API key, so spend lands on the member who owns the key. Member analytics are exposed through new `GET /analytics/members` and `GET /analytics/members/{userId}` endpoints, restricted to organization owners and admins on the **Enterprise plan** — non-enterprise orgs see an upgrade card, and non-admins see an access notice.

---

**[Cost breakdown docs →](https://docs.llmgateway.io/features/cost-breakdown)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
