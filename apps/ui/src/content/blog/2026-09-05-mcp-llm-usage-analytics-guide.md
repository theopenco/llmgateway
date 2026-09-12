---
id: "blog-mcp-llm-usage-analytics-guide"
slug: "mcp-llm-usage-analytics-guide"
date: "2026-09-05"
title: "Check LLM Usage and Costs From Your Coding Agent"
summary: "A step-by-step guide to LLM usage and cost tracking without leaving the terminal: connect the LLM Gateway MCP server to Claude Code, Codex, or Cursor, then ask for spend, token totals, cache hits, and rankings by model, provider, app, or API key. The tools are read-only and free to call."
categories: ["Guides"]
faqs:
  - question: "How do I see my LLM API costs inside Claude Code?"
    answer: "Add the LLM Gateway MCP server with claude mcp add --transport http llmgateway https://api.llmgateway.io/mcp and an Authorization header carrying your API key. Then ask a question like 'what did I spend on models this week' and Claude Code calls the get-usage tool, which returns costs, tokens, requests, and your most-used model."
  - question: "Are the MCP usage tools free to call?"
    answer: "Yes. get-account, get-usage, and get-usage-breakdown are read-only, incur no model charges, and keep working when a key or member has reached a spending limit. Only generation tools such as chat and generate-image are billed."
  - question: "Can a developer see the whole organization's usage through MCP?"
    answer: "No. Analytics are scoped to the project the API key belongs to. Owners and admins see that project's usage across all of its keys; developers see only the keys they created. There are no scope overrides, so a key never reveals another project or organization."
  - question: "Why do MCP usage numbers lag behind my latest requests?"
    answer: "Statistics come from hourly aggregation tables rather than raw request logs, which is what lets them survive request-retention cleanup. Each response includes an updatedAt timestamp for the last aggregation in the period you asked about."
image:
  src: "/blog/mcp-llm-usage-analytics-guide.png"
  alt: "A glowing bar chart with a plug connector docked into it and a coin meter on a circuit board, surrounded by terminal windows, pie charts, and chat bubbles"
  width: 1536
  height: 1024
---

You are three hours into an agent session and want to know one thing: what has this cost so far, and which model is doing the damage? Until now that meant tabbing out to the dashboard. With the LLM Gateway MCP server's new analytics tools, **LLM usage and costs** are one question away in the same terminal, and the answer comes from the same numbers the dashboard shows.

This guide connects the MCP server to Claude Code, Codex, or Cursor and walks through the questions it can answer.

## Step 1: Create an API key

Open the **API Keys** section of the [dashboard](https://llmgateway.io/dashboard) and create a key for the project you want to inspect. Analytics are scoped to that project, so use one key per project you care about. A [DevPass](https://devpass.llmgateway.io) plan key works too.

## Step 2: Connect your client

**Claude Code**

```bash
claude mcp add --transport http --scope user llmgateway https://api.llmgateway.io/mcp \
  --header "Authorization: Bearer $LLM_GATEWAY_API_KEY"
```

**Codex CLI**

```bash
codex mcp add llmgateway --url https://api.llmgateway.io/mcp \
  --bearer-token-env-var LLM_GATEWAY_API_KEY
```

**Cursor** (`~/.cursor/mcp.json`, v0.48.0 or later)

```json
{
  "mcpServers": {
    "llmgateway": {
      "url": "https://api.llmgateway.io/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key-here"
      }
    }
  }
}
```

Run `/mcp` in Claude Code or Codex to confirm the `llmgateway` server is connected. Any other client that speaks Streamable HTTP MCP works the same way; the [MCP docs](https://docs.llmgateway.io/developers/mcp) cover the generic configuration.

## Step 3: Ask

Three tools back the analytics, and your assistant picks the right one from a plain question:

| Question                                                    | Tool                  |
| ----------------------------------------------------------- | --------------------- |
| "What are my spending limits?" / "How much credit is left?" | `get-account`         |
| "What did we spend on models in August?"                    | `get-usage`           |
| "Which apps burned the most credits this month?"            | `get-usage-breakdown` |

`get-usage` takes an optional `from` and `to` (UTC dates, inclusive, default the last 30 days, at most 366 days) and a `granularity` of `day` or `hour` (hourly at most 31 days). `get-usage-breakdown` takes `group_by` of `provider`, `model`, `app`, or `api_key`, sorts by `requests`, `cost`, or `tokens`, and pages with `limit` and `offset`:

```json
{
  "group_by": "model",
  "sort_by": "cost",
  "from": "2026-08-01",
  "to": "2026-08-31",
  "limit": 5
}
```

## Step 4: Read the numbers

Every `get-usage` response carries `totals` (requests, errors, cache hits, input, output, and total tokens, and costs), a `series` of only the buckets that had activity, and `mostUsedProvider`, `mostUsedModel`, and `mostUsedApp` by request count. Breakdown rows carry the ID, display name, requests, tokens, and the same cost fields.

| Field                | Meaning                                   |
| -------------------- | ----------------------------------------- |
| `costUsd`            | Inference usage cost for the period       |
| `creditsCostUsd`     | The part paid with gateway credits        |
| `byokCostUsd`        | The part served on your own provider keys |
| `dataStorageCostUsd` | Storage, billed separately                |
| `updatedAt`          | Last hourly aggregation in the period     |

These are usage statistics, not invoice totals: they come from hourly aggregates, survive request-retention cleanup, and may lag the newest requests by a few minutes.

## Step 5: Attribute usage to apps

App rankings rely on each request's recorded source. Recognized coding clients are attributed automatically, known aliases are merged before ranking, and anything with no recorded source shows up as `unknown`. If your client does not identify itself, set an `x-source` header on the MCP connection; generation calls made through MCP forward the client's attribution headers unchanged.

Per-key app statistics start when per-key source aggregation was enabled, so older periods may report `coverage.complete: false`. That means the ranking covers part of the period, which is different from an `unknown` source.

## What the tools will not do

- Reach outside the connected project. Owners and admins see the project across all of its keys; developers see only the keys they created. No scope parameters exist.
- Return credentials. `get-account` reports the user, organization, project, role, scope, and spending limits, and owners and admins also see the credit balance, but never a key.
- Fabricate a zero-usage report. An unreachable backend produces a tool error.
- Stop at a spending limit. Analytics stay available when generation tools are blocked, and calling them is free.

## Getting started

- **[Create an API key](https://llmgateway.io/signup)** and connect your client with the snippet above
- **[MCP docs](https://docs.llmgateway.io/developers/mcp)** list every tool, parameter, and client configuration
- **[Compare usage across periods](/changelog/dashboard-usage-comparison)** in the dashboard when you need the chart instead of the number

<BlogCta variant="gateway" location="bottom" />
