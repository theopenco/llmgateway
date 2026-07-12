---
id: github-copilot
slug: github-copilot
title: Migrate from GitHub Copilot
description: Move your chat and agentic coding workloads off Copilot's usage-based AI Credits. Any coding agent, 200+ models, zero token markup, hard budget caps.
date: 2026-07-12
fromProvider: GitHub Copilot
---

On June 1, 2026, GitHub Copilot replaced its flat-fee model with usage-based AI Credits: seat prices didn't change — individual plans run $10 (Pro), $39 (Pro+), and $100 (Max), while organizations pay $19 (Business) or $39 (Enterprise) per user per month — but Copilot Chat, agent mode, code review, and CLI now bill by tokens consumed, with no spending ceiling unless you manually configure one. Teams running agentic workflows have reported projected jumps from $50 to $3,000 per month.

LLM Gateway gives you the same workflows — chat, agents, code review — through any coding tool you choose, with provider token rates passed through at zero markup, prompt caching, and hard budget caps per organization, project, and API key.

## What Changed in Copilot Billing

|                                    | Before June 2026                          | After June 2026                             |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Base seat                          | $10–$100 (individual), $19–$39/user (org) | Unchanged                                   |
| Inline completions                 | Flat-fee                                  | Still flat-fee                              |
| Chat, agent mode, code review, CLI | Premium Request Units within plan         | Metered AI Credits (1 credit = $0.01)       |
| Spending ceiling                   | The subscription price                    | None by default — manual budget only        |
| Included credits                   | —                                         | $15 (Pro), $70 (Pro+), $200 (Max) per month |

A single chat session on a premium model costs roughly $0.21; at 20 sessions a day across 20 working days, that's about $84 per month per developer — on top of the seat, and an estimate that varies with the model and token volume. Heavy users report $150–$250 per month in overages.

Estimate your own team's exposure with the [Copilot cost calculator](/copilot-cost-calculator).

## Map Your Copilot Workflow

Copilot is an IDE product, not an API, so migration means pointing each workflow at a gateway-backed tool:

| Copilot feature            | Gateway-backed replacement                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Copilot Chat               | Any chat-capable agent (DevPass Code, Claude Code, Cline, Continue) with any of 200+ models           |
| Agent mode                 | DevPass Code, Claude Code, Cline, or Aider routed through LLM Gateway                                 |
| Inline completions         | Continue or Cline autocomplete — or keep a Copilot seat just for completions (they're still flat-fee) |
| PR summaries & code review | Your CI calling the gateway's OpenAI-compatible API with any model                                    |
| Copilot CLI                | Codex CLI, DevPass Code, or Claude Code in the terminal                                               |

## Migration Steps

### 1. Get Your LLM Gateway API Key

Sign up at [llmgateway.io/signup](/signup) and create an API key from your dashboard. Pay-as-you-go usage has no token markup — just a flat 5% platform fee on credits, or 0% when you bring your own provider keys. For predictable per-developer pricing, [DevPass](https://devpass.llmgateway.io) plans start at $29/month.

### 2. Pick Your Coding Agent

Each of these takes minutes to set up and works with every model on the gateway:

- **[DevPass Code](/guides/devpass-code)** — open-source terminal agent built for LLM Gateway. One browser login, no API keys to juggle.
- **[Claude Code](/guides/claude-code)** — three environment variables point it at the gateway, and it can run GPT-5, Gemini, or any other model:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=llmgtwy_your_api_key_here
export ANTHROPIC_MODEL=gpt-5  # optional: any model from the catalog

claude
```

- **[Cline](/guides/cline)** — VS Code agent with autocomplete, configured with an OpenAI-compatible endpoint.
- **[Continue](/guides/continue)** — open-source assistant with IDE extensions and a CLI.
- **[Codex CLI](/guides/codex-cli)** — OpenAI's terminal agent, pointed at the gateway.

### 3. Replace CI Code Review

Copilot code review now consumes AI Credits, and it can also consume GitHub Actions minutes when reviews run for unlicensed users. The gateway's API is OpenAI-compatible, so your CI can review diffs with any model:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-5-20251101",
    "messages": [{"role": "user", "content": "Review this diff for bugs:\n..."}]
  }'
```

### 4. Set Budgets Before You Roll Out

This is where the gateway goes further than Copilot's off-by-default spending budgets. In the dashboard, set spend limits per organization, per project, and per API key — hard caps, not alerts. Give each team its own project so a runaway agent burns through one budget, not the company's.

### 5. Watch Caching Cut Your Bill

Prompt caching is automatic. Agentic coding tools resend large context (system prompts, file trees, repo maps) on nearly every request — exactly the traffic caching absorbs. Cost, latency, and cache-hit analytics are broken down per request in the dashboard.

## The Hybrid Setup

Many teams don't drop Copilot entirely — completions are still the best part of the product and still flat-fee:

1. Keep Copilot Free (2,000 completions/month) or a $10 Pro seat for inline completions.
2. Route all chat and agentic work through LLM Gateway with the agent of your choice.
3. Cap total spend with project budgets, or put developers on a flat DevPass plan.

You keep the autocomplete experience and swap the unbounded metered part for pass-through token prices with a ceiling you set.

## Full Comparison

See the detailed breakdown on the [LLM Gateway vs GitHub Copilot comparison page](/compare/github-copilot), or the [best GitHub Copilot alternatives in 2026](/blog/github-copilot-alternatives) if you're still weighing options.

## Need Help?

- Estimate your exposure: [Copilot cost calculator](/copilot-cost-calculator)
- Browse available models at [llmgateway.io/models](/models)
- Read the [API documentation](https://docs.llmgateway.io)
- Contact support at contact@llmgateway.io
