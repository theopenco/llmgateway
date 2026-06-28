---
id: "61"
slug: "organization-analytics"
date: "2026-06-26"
title: "Organization-Wide Analytics"
summary: "Roll cost, requests, and tokens up across every project in your organization, then break the spend down by model, project, or API key over any date range. Read from pre-aggregated rollups, so it stays fast on any window. Available to owners and admins on the Enterprise plan."
image:
  src: "/changelog/organization-analytics.png"
  alt: "Organization-wide analytics on LLM Gateway: total spend, requests, and tokens across every project, broken down by model, project, and API key"
  width: 1536
  height: 1024
---

Per-project analytics answers "where did this project's spend go?" — but to understand the whole organization you had to open each project in turn and add the numbers up yourself. **Organization Analytics** does the rollup for you: one page that totals cost, requests, and tokens across every project, and lets you pivot the breakdown three ways.

## One page for the whole org

Open **Organization → Analytics**. Summary cards total **spend, requests, and tokens** for the selected range across all projects, and a single group-by control switches what the cost-over-time and ranking charts break the usage down by:

| Group by    | What each series is                                                               |
| ----------- | --------------------------------------------------------------------------------- |
| **Model**   | A canonical model, collapsed across providers (one line per model, not per route) |
| **Project** | One project in the organization — see which team or workload drives the bill      |
| **API key** | One API key, by its description — handy when traffic runs through services        |

Every view keeps the **Cost / Requests / Tokens** tabs and respects the shared date-range picker, so the whole page reflects the same window.

## Built on the rollups, not the logs

The page reads the same pre-aggregated hourly rollups the rest of the dashboard uses — there's no scan over raw request logs — so it stays fast across any range up to a year. A new `GET /analytics/activity` endpoint returns the daily series with the requested breakdown:

```
GET /analytics/activity?organizationId=<org>&groupBy=project&from=2026-06-20&to=2026-06-26
```

It's restricted to organization **owners and admins on the Enterprise plan**: non-enterprise orgs see an upgrade card, and the gated entries are now marked in the sidebar so members can tell what's enterprise-only before clicking through.

---

**[Organization analytics docs →](https://docs.llmgateway.io/learn/org-analytics)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
