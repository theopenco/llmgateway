---
id: "38"
slug: "reasoning-max-tokens"
date: "2026-01-30"
title: "Unified Reasoning Configuration"
summary: "New unified reasoning object for precise control over reasoning models. Specify exact token budgets with max_tokens or use effort levels — all in one consistent API."
image:
  src: "/changelog/reasoning-max-tokens.jpg"
  alt: "Unified reasoning configuration"
  width: 1376
  height: 768
---

## Unified Reasoning Configuration

We've added a new `reasoning` configuration object that gives you flexible control over reasoning-capable models. You can now specify reasoning behavior in a consistent, unified way.

### Option 1: Reasoning Effort

Use `reasoning.effort` to control reasoning intensity:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Explain quantum entanglement"}],
    "reasoning": {
      "effort": "high"
    }
  }'
```

Supported effort levels: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`

### Option 2: Exact Token Budget

Use `reasoning.max_tokens` for precise control over reasoning token allocation:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Explain quantum entanglement"}],
    "reasoning": {
      "max_tokens": 8000
    }
  }'
```

When `max_tokens` is specified, it takes precedence over `effort`.

---

## Supported Models

The `reasoning.max_tokens` parameter works with:

- **Anthropic Claude** — Claude 3.7 Sonnet, Claude Sonnet 4, Claude Opus 4, Claude Opus 4.5
- **Google Gemini** — Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 3 Pro Preview

---

## Auto-Routing Support

When using auto-routing (e.g., `claude-sonnet-4` without provider prefix) or root models with `reasoning.max_tokens`, the gateway automatically routes only to providers that support explicit reasoning token budgets.

---

## Provider Constraints

- **Anthropic**: Budget must be between 1,024 and 128,000 tokens (values are automatically clamped)
- **Google**: No specific constraints

**[Read the docs](https://docs.llmgateway.io/features/reasoning#specifying-reasoning-token-budget)** for more details.
