---
id: "91"
slug: "mcp-usage-analytics"
date: "2026-09-05"
title: "Usage Analytics in the MCP Server"
summary: "The LLM Gateway MCP server gains get-account, get-usage, and get-usage-breakdown, so Claude Code, Codex, Cursor, or any MCP client can check spending limits, request and token totals, costs, trends, and your most-used providers, models, coding apps, and API keys without opening the dashboard."
image:
  src: "/changelog/mcp-usage-analytics.png"
  alt: "A glowing bar chart with a plug connector docked into it on a circuit board, surrounded by pie charts, coins, and terminal windows"
  width: 1536
  height: 1024
---

An MCP client connected to the gateway could already call any model, but the moment you wanted to know what that session cost, or which model your team leans on, you had to leave the terminal and open the dashboard. **Usage analytics** now live in the MCP server itself: three read-only tools answer those questions in the same conversation, from the same API key.

## Three Read-Only Tools

| Tool                  | What it returns                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get-account`         | The connected user, organization, project, role, analytics scope, and API key spending limits. Owners and admins also see the organization's credit balance.             |
| `get-usage`           | Request, token, error, cache-hit, and cost totals, a daily or hourly series, and the most-used provider, model, and coding app for a date range (default: last 30 days). |
| `get-usage-breakdown` | A ranked table of providers, models, coding apps, or API keys, sorted by requests, cost, or tokens, with pagination.                                                     |

Ask your assistant which app burned the most credits this month and it calls:

```json
{
  "group_by": "app",
  "sort_by": "cost",
  "from": "2026-08-01",
  "to": "2026-08-31",
  "limit": 10
}
```

Each row carries the ID, display name, requests, tokens, and costs. `costUsd` is inference cost, split into `creditsCostUsd` (gateway credits) and `byokCostUsd` (your own provider keys), with storage billed separately as `dataStorageCostUsd`. Numbers come from the hourly aggregation tables, so they survive request-retention cleanup and may lag the latest requests by a few minutes.

## Scoped to the Key You Connect With

Analytics never reach past the connected project. Owners and admins see that project's usage across all of its keys; developers see only the keys they created. There are no scope overrides, so a key for one project cannot inspect another. The tools are read-only, incur no model charges, and keep working when a key or member hits a spending limit, while generation tools still enforce those limits.

App rankings use each request's recorded source, including recognized coding clients and `x-source` values, and MCP generation calls now forward the client's attribution headers. Set `x-source` on the connection if your client does not identify itself.

## Connect in One Command

```bash
claude mcp add --transport http --scope user llmgateway https://api.llmgateway.io/mcp \
  --header "Authorization: Bearer $LLM_GATEWAY_API_KEY"
```

Authenticated MCP forwarding requires HTTPS gateway and API URLs and rejects redirects, including for self-hosted overrides.

---

**[MCP docs →](https://docs.llmgateway.io/developers/mcp)** | **[Set up MCP →](https://llmgateway.io/mcp)**
