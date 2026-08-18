---
id: "blog-github-copilot-provider"
slug: "github-copilot-provider"
date: "2026-08-18"
title: "Use the GitHub Copilot API Through One Gateway"
summary: "LLM Gateway now ships a GitHub Copilot provider: connect a Copilot subscription with an OAuth device login and route Copilot's OpenAI-compatible API through the gateway — with routing, usage limits, audit logs, and cost attribution on top. Bring your own Copilot account; no gateway credits involved."
categories: ["Announcements", "Integrations"]
faqs:
  - question: "Can I use my GitHub Copilot subscription through an API?"
    answer: "Yes. GitHub Copilot exposes an OpenAI-compatible API for chat completions and embeddings, billed against your subscription's premium-request allowance. LLM Gateway's github-copilot provider connects your account via GitHub's OAuth device flow and routes requests through it, so any OpenAI-compatible client can use your Copilot subscription."
  - question: "How does LLM Gateway authenticate with GitHub Copilot?"
    answer: "You sign in once with GitHub's device flow from the dashboard. The gateway stores the resulting OAuth token encrypted at rest and exchanges it on each request for the short-lived Copilot API bearer token, cached until shortly before expiry. Individual, Business, and Enterprise plans are routed to their matching Copilot API hosts."
  - question: "Does routing Copilot requests cost LLM Gateway credits?"
    answer: "No. The provider is bring-your-own-key only: requests bill against your Copilot subscription's premium requests, and the catalog mappings carry $0 token prices. You can still cap usage with the key's max-spend fuse and per-organization rate limits."
  - question: "Which models can I call through the Copilot API?"
    answer: "GitHub gates API model availability by Copilot plan, and the API often exposes fewer models than Copilot Chat's picker. Browse the current github-copilot mappings on the models page, and use the provider key's allowed-models restriction to pin the ones your plan serves."
image:
  src: "/blog/github-copilot-provider.png"
  alt: "Glossy circuit board with a glowing gateway chip connecting a Copilot-style goggles icon to chat, key, and chart icons"
  width: 1536
  height: 1024
---

Your organization already pays for GitHub Copilot seats. But the moment a team wants that allowance somewhere other than an IDE — an internal tool, an agent built on the [Copilot SDK](https://github.blog/news-insights/company-news/build-an-agent-into-any-app-with-the-github-copilot-sdk/), a script that needs a quick completion — there is no dashboard where you can hand out a key, set a limit, and see what it cost. And since GitHub retired GitHub Models on July 30, 2026, the Copilot subscription is the API-shaped thing your organization still has.

**LLM Gateway** now ships a `github-copilot` provider that puts the **GitHub Copilot API** behind the same gateway as your other 40+ providers: OAuth device login from the dashboard, chat completions and embeddings over the OpenAI-compatible surface, and the gateway's routing, usage limits, audit logs, and per-request attribution on top. It works the way LiteLLM users know from its `github_copilot` provider — but managed per organization, with keys encrypted at rest.

## Connect a Copilot subscription in one sign-in

Copilot's API does not use API keys. The credential is a GitHub OAuth token, which the Copilot API only accepts after exchanging it for a short-lived bearer token. The gateway now handles that whole chain:

1. In **Provider Keys**, add **GitHub Copilot** and click **Sign in** — the dialog shows a one-time code for [github.com/login/device](https://github.com/login/device).
2. Approve the authorization on GitHub; the OAuth token fills in automatically and is validated with a live Copilot completion before it is saved, encrypted.
3. Pick your plan — Individual, Business, or Enterprise — so requests go to the matching Copilot API host (`api.githubcopilot.com`, `api.business.githubcopilot.com`, or `api.enterprise.githubcopilot.com`).

On every request the gateway mints the short-lived Copilot token from the stored credential, caches it until shortly before expiry, and sends the integration headers the Copilot API expects. Then it is a normal model call:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "github-copilot/gpt-4o",
    "messages": [{ "role": "user", "content": "Explain this stack trace" }]
  }'
```

Embeddings work the same way through `/v1/embeddings` with `github-copilot/text-embedding-3-small`.

## Subscription-billed, gateway-governed

The provider is bring-your-own-key only. Requests draw on your Copilot plan's premium-request allowance, not on gateway credits — the catalog mappings carry $0 token prices because GitHub bills the seat, not the token. What the gateway adds is the governance Copilot's own settings page does not have:

- **Per-key controls** — restrict a key to specific models (GitHub feature-flags API model availability per plan, so pin the ones your plan actually serves), and set a max-spend fuse that disables the key automatically.
- **Audit and attribution** — every request is logged with its project, API key, and source, alongside the rest of your traffic.
- **Fallback** — if a Copilot model is unavailable, routing falls back to the same model on another configured provider instead of failing the request.

Model availability through the Copilot API depends on plan and rollout stage, and GitHub exposes fewer models there than in Copilot Chat's picker — the catalog starts with the API-stable set, and the current list is always at [llmgateway.io/models](https://llmgateway.io/models?provider=github-copilot).

## It composes with the Copilot SDK, both ways

This provider is one direction of a loop. The other direction shipped earlier: GitHub's Copilot SDK and CLI accept any OpenAI-compatible endpoint as a [BYOK provider](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/byok), so an agent built on the Copilot SDK can point at `https://api.llmgateway.io/v1` and use any tool-calling model in the catalog — see the [GitHub Copilot app guide](https://docs.llmgateway.io/guides/github-copilot).

Put together: your Copilot-SDK agent runs against the gateway, the gateway routes some of that traffic back to your Copilot subscription, and everything — Copilot, Anthropic, Google, your own vLLM box — shows up in one usage dashboard with one set of limits.

For the cost math on Copilot's plans versus per-token billing, see [Azure AI Foundry vs GitHub Copilot](/blog/azure-ai-foundry-vs-github-copilot).

## Get started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — no credit card required
- **[GitHub Copilot integration docs](https://docs.llmgateway.io/integrations/github-copilot)** — device login, plans, self-host env vars
- **[Azure AI Foundry vs GitHub Copilot](/blog/azure-ai-foundry-vs-github-copilot)** — what the Microsoft stack costs in 2026
