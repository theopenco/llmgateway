---
id: mcp
slug: mcp
title: MCP Server Integration
description: Use LLM Gateway's built-in MCP server to give Claude Code, Codex, Cursor, or any MCP client access to 280+ models — chat, image generation, and model discovery as tools.
date: 2026-07-03
---

LLM Gateway ships a hosted [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server at `https://api.llmgateway.io/mcp`. Connect it to Claude Code, Codex, Cursor, or any MCP-compatible client and your AI assistant gets tools to call **any model in our catalog** — ask GPT-5 for a second opinion from inside Claude Code, generate images mid-session, or look up model pricing without leaving your editor.

## What you get

The MCP server exposes four tools:

- **`chat`** — send messages to any supported LLM (`model`, `messages`, optional `temperature` / `max_tokens`)
- **`generate-image`** — text-to-image with models like Qwen Image (`prompt`, optional `model`, `size`, `n`)
- **`generate-nano-banana`** — image generation with Gemini 3 Pro Image Preview, with optional save-to-disk
- **`list-models`** / **`list-image-models`** — browse available models with capabilities and pricing

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

- "Use the chat tool to ask GPT-5 about TypeScript best practices"
- "Generate an image of a futuristic city with the generate-image tool"
- "List all available Anthropic models with pricing"

Every tool call is a normal LLM Gateway request — it shows up in your [dashboard](/dashboard) with cost and token counts, hits the cache when repeated, and uses the same credits as your API traffic.

## Why use it

- **Cross-model workflows** — your coding agent can consult a different model without you switching tools
- **Image generation anywhere** — any MCP client becomes an image studio
- **One key, one bill** — MCP traffic and API traffic share credits, caching, and analytics

For the full tool parameter reference, see the [MCP docs](https://docs.llmgateway.io/guides/mcp).

[Get started for free](/signup) — no credit card required.
