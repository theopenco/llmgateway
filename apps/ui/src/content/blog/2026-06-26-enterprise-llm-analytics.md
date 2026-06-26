---
id: "blog-enterprise-llm-analytics"
slug: "enterprise-llm-analytics"
date: "2026-06-26"
title: "Enterprise LLM Analytics: See Where Every Dollar Goes"
summary: "Most dashboards show what you spent, not where it went. LLM Gateway's enterprise LLM analytics break cost, requests, and tokens down by model, project, API key, and team member — no data warehouse to build. Member and organization-wide analytics are available on the Enterprise plan."
categories: ["Announcements", "Product"]
image:
  src: "/blog/enterprise-llm-analytics.png"
  alt: "Enterprise LLM analytics on LLM Gateway: cost, requests, and tokens broken down by model, project, API key, and team member"
  width: 1536
  height: 1024
---

Your monthly LLM bill went up 40%. Now answer three questions: which model drove it, which team, and which application. If the honest answer is "let me export the logs and build a spreadsheet," you already know the problem.

Most LLM dashboards are good at one number — total spend — and bad at the only question that matters when costs climb: where did it go? The usual workaround is a homegrown pipeline: ship request logs to a warehouse, write the aggregations, build the dashboards, keep them running. That's a quarter of platform work to answer a question your gateway should already know.

**LLM Gateway** answers it out of the box. Its enterprise LLM analytics break cost, requests, and tokens down by model, by project, by API key, and by person — over any date range, with no export pipeline to maintain.

## Cost by model, on every project

Every project gets an **Analytics** page with two views of the same spend:

- **Cost by Model** — a horizontal bar chart that ranks the models you actually use.
- **Cost by Model Over Time** — a stacked area chart across your selected range.

Both carry **Cost / Requests / Tokens** tabs, so you can switch from "what costs the most" to "what gets called the most" in a click. The over-time chart adds a **Mappings / Canonical** toggle: Mappings keeps each provider-tagged route separate (`openai/gpt-5.5` versus a custom mapping of the same model), while Canonical collapses them into one underlying model so you see the model's true footprint regardless of how it was routed.

This view is available on every plan. It's usually the first place a cost spike resolves itself — one model, one obvious line on the chart.

## Every API key gets its own statistics

Spend rarely maps cleanly to people. It maps to services, jobs, and integrations — and those run on API keys. So every key has its own statistics page: summary cards for **cost, tokens, requests, and error rate**, plus the same cost-by-model charts scoped to that single key. Open it from **View Statistics** in the API-keys list.

Now "the bill jumped" becomes "the nightly batch job on key `prod-etl` doubled its token usage on the 22nd" — a sentence you can act on.

## Organization-wide analytics, across every project

Per-project views are precise, but leadership thinks in portfolios, not projects. The new **Organization → Analytics** page rolls cost, requests, and tokens up across _every_ project in the organization, then lets you pivot the breakdown with a single control:

| Group by    | The question it answers                        |
| ----------- | ---------------------------------------------- |
| **Model**   | Which models carry our spend, org-wide?        |
| **Project** | Which team or workload is the cost center?     |
| **API key** | Which service or integration is driving usage? |

It's the chargeback/showback view: switch to **Project** and you have per-team cost attribution for the whole organization in one screen — the input FinOps has been asking AI teams for. The page is powered by a `GET /analytics/activity` endpoint that returns a daily series with the requested breakdown:

```json
{
  "groupBy": "project",
  "activity": [
    {
      "date": "2026-06-24",
      "cost": 251.94,
      "requestCount": 8363,
      "totalTokens": 16130591,
      "breakdown": [
        { "label": "Production API", "cost": 84.19, "requestCount": 2462 },
        { "label": "Internal Chatbot", "cost": 87.28, "requestCount": 2904 },
        { "label": "Staging", "cost": 80.47, "requestCount": 2997 }
      ]
    }
  ]
}
```

Organization-wide analytics are available on the **Enterprise plan**, to organization owners and admins.

## Cost and usage by team member

Attribution finishes at the person. Enterprise organizations get a **Members** analytics view: a per-member table sorted by spend, and a detail page for each person.

| Surface           | What it shows                                                       |
| ----------------- | ------------------------------------------------------------------- |
| **Members table** | Per member: cost, tokens, requests, error rate, and API-key count.  |
| **Summary cards** | That member's cost, tokens, requests, and error rate for the range. |
| **Most used**     | Their top model, provider, and application.                         |
| **Breakdowns**    | Cost by model, plus top-providers and top-apps tables.              |

Usage is attributed to whoever created each API key, so spend lands on the person who owns it — the accountability layer governance reviews need. Member analytics are served by `GET /analytics/members` and `GET /analytics/members/{userId}`, restricted to organization owners and admins on the **Enterprise plan**.

## Built on rollups, not a data warehouse

Here's why none of this needs a pipeline: every chart reads from pre-aggregated hourly rollups, not raw request logs. That has three consequences that matter in production.

- **It's fast over any window.** A year-long range scans rollups, not millions of log rows, so the page stays responsive.
- **The numbers reconcile.** Every view derives from the same aggregates and respects one shared, timezone-correct date-range picker, so per-model, per-project, and per-member totals line up for the same window.
- **There's nothing to maintain.** No export job, no warehouse schema, no dbt models — the analytics ship with the gateway.

Enterprise-only pages are flagged directly in the sidebar, so members can see what requires the plan before they click. Non-enterprise organizations see an upgrade prompt in place of the gated views.

## What's included on each plan

| Capability                           | Availability                   |
| ------------------------------------ | ------------------------------ |
| Cost-by-model analytics, per project | All plans                      |
| Per-API-key statistics               | All plans                      |
| Organization-wide analytics          | **Enterprise** (owners/admins) |
| Member analytics                     | **Enterprise** (owners/admins) |

For teams with compliance requirements, the same platform is [SOC 2 Type II](/blog/soc2-type-ii), so cost data and request metadata stay inside controls your security team can sign off on.

## Frequently Asked Questions

### What is enterprise LLM analytics?

Enterprise LLM analytics is the cost-and-usage reporting layer for AI traffic running through a gateway — breaking spend, requests, and tokens down by model, project, API key, and team member so an organization can attribute and govern its LLM costs. In LLM Gateway it's built in, with member and organization-wide views on the Enterprise plan.

### How do I attribute LLM costs to teams or people?

Group your projects by team and use **Organization → Analytics** with the **Project** breakdown for per-team chargeback, or the **Members** view for per-person attribution. Member spend is attributed to whoever created each API key.

### Do I need a data warehouse to analyze LLM usage?

No. LLM Gateway computes analytics from pre-aggregated hourly rollups, so cost, request, and token breakdowns are available in the dashboard without an export pipeline, a warehouse, or a separate BI tool.

### Which analytics require the Enterprise plan?

Per-project cost-by-model analytics and per-API-key statistics are available on every plan. Organization-wide analytics and member analytics are Enterprise-only and limited to organization owners and admins.

## Start measuring where your spend goes

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — route your traffic and watch the cost-by-model charts populate.
- **[Talk to us about Enterprise](https://llmgateway.io/enterprise)** — turn on member and organization-wide analytics for your team.
- **[Read how we handle SOC 2 Type II](/blog/soc2-type-ii)** — the compliance story behind the data.
