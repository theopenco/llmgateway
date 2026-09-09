---
id: mcp
slug: mcp
title: MCP Server Integration
description: Use LLM Gateway's built-in MCP server to give Claude Code, Codex, Cursor, or any MCP client access to 200+ models — chat, image generation, and model discovery as tools.
date: 2026-07-03
---

LLM Gateway ships a hosted [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server at `https://api.llmgateway.io/mcp`. Connect it to Claude Code, Codex, Cursor, or any MCP-compatible client and your AI assistant gets tools to call **any model in our catalog** — get a second opinion from another model, generate images mid-session, or inspect your usage and costs without leaving your editor.

> **Using DevPass?** This integration also works with a [DevPass](https://devpass.llmgateway.io) plan key. Use canonical model IDs without a provider prefix (`model-id` instead of `provider/model-id`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## What you get

The MCP server exposes eight tools:

- **`get-account`** — inspect your connected account, project, access scope, and key spending limits
- **`get-usage`** — get request/token totals, costs, trends, and your most-used provider, model, and coding app
- **`get-usage-breakdown`** — rank providers, models, apps, or API keys by requests, cost, or tokens
- **`chat`** — send messages to any supported LLM (`model`, `messages`, optional `temperature` / `max_tokens`)
- **`generate-image`** — text-to-image with models like Qwen Image (`prompt`, optional `model`, `size`, `n`)
- **`generate-nano-banana`** — image generation with Gemini 3 Pro Image Preview, with optional save-to-disk
- **`list-models`** / **`list-image-models`** — browse available models with capabilities and pricing

Analytics cover the connected project: owners/admins see project totals, while developers see their own keys in that project. These tools are read-only and have no model charges. They use hourly statistics, so recent usage may lag; results flag incomplete historical app data. Costs distinguish gateway credits from BYOK provider costs and are not invoice totals.

## Setup

You'll need an API key from the [LLM Gateway dashboard](/dashboard) (**API Keys** section).

### Claude Code

```bash
claude mcp add --transport http --scope user llmgateway https://api.llmgateway.io/mcp \
  --header "Authorization: Bearer your-api-key-here"
```

Or add it manually to `~/.claude.json` (user scope) or `.mcp.json` in your project root:

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

### Codex CLI

```bash
export LLM_GATEWAY_API_KEY="your-api-key-here"
codex mcp add llmgateway --url https://api.llmgateway.io/mcp \
  --bearer-token-env-var LLM_GATEWAY_API_KEY
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.llmgateway]
url = "https://api.llmgateway.io/mcp"
bearer_token_env_var = "LLM_GATEWAY_API_KEY"
```

### Cursor

Add to `~/.cursor/mcp.json`:

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

Any other MCP client works the same way: streamable HTTP transport, `https://api.llmgateway.io/mcp`, bearer auth.

## Try it

Once connected, ask your assistant things like:

- "What did I spend this month, and which model do I use most?"
- "Generate an image of a futuristic city with the generate-image tool"
- "Rank my coding apps by cost over the last 30 days"

Generation calls use the same billing and analytics as your API traffic and appear in your [dashboard](/dashboard). Account, usage, and model-discovery tools do not generate billable model requests.

## Why use it

- **Cross-model workflows** — your coding agent can consult a different model without you switching tools
- **Image generation anywhere** — any MCP client becomes an image studio
- **One key, one bill** — MCP traffic and API traffic share credits, caching, and analytics

For the full tool parameter reference, see the [MCP docs](https://docs.llmgateway.io/developers/mcp).

[Get started for free](/signup) — no credit card required.
