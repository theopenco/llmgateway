---
id: "blog-github-copilot-long-context-pricing"
slug: "github-copilot-long-context-pricing"
date: "2026-10-28"
title: "GitHub Copilot Long-Context Pricing: What You Pay and Where It Hides"
summary: "GitHub Copilot charges a higher rate once a prompt crosses 272K tokens on most GPT models, 200K on Grok and GPT-5.6 Luna, and 100K on Claude Haiku 5.5. We checked every tier against the providers' own prices. The rates match, one threshold sits lower than OpenAI's, and the model picker hides the price jump. Here is where it sits, what it costs, and how to stay under it."
categories: ["Guides"]
faqs:
  - question: "Does GitHub Copilot charge more for long context?"
    answer: "Yes, on some models. GPT-5.6, GPT-6 and GPT-6.1 models cost about twice as much per input token above 272K input tokens (200K for GPT-5.6 Luna), Grok 4.5 to 4.7 double above 200K, and Claude Haiku 5.5 costs five times as much above 100K. The long-context rates match the providers' own list prices, so Copilot passes them through rather than adding a markup. One threshold differs: Copilot switches GPT-5.6 Luna at 200K, where OpenAI uses 272K."
  - question: "Does picking the 1M context window in Copilot cost more?"
    answer: "Not by itself. The rate depends on how many input tokens the request actually sends. A Copilot team member confirmed that selecting the 1M window does not apply long-context pricing to prompts under the default size. The catch is that 1M mode compacts history less often, so sessions cross the threshold sooner, and every request above it is billed at the long-context rate until you compact."
  - question: "Which Copilot models have no long-context tier?"
    answer: "Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1 and the other Claude models apart from Haiku 5.5 have one flat price across their full context window on Copilot. GPT-5.3-Codex, GPT-5.4 nano, Gemini, Kimi K3 and MAI-Code-1.1-Flash have no long-context tier either."
  - question: "How do I avoid the long-context price jump?"
    answer: "Keep prompts under the threshold by compacting or starting fresh sessions, lean on cached input (10% of the input rate or less on the tiered GPT models), and send very large contexts to a model with flat pricing. On LLM Gateway every request log shows the pricing tier it was billed at, and hard budgets per API key stop a runaway session."
image:
  src: "/blog/github-copilot-long-context-pricing.png"
  alt: "A glowing price meter on a circuit-board chip whose bars step up sharply at a threshold, with a magnifying glass lifting a folded panel to reveal the higher long-context price"
  width: 1536
  height: 1024
---

A developer sends a 270K-token prompt to GPT-5.6 Sol in Copilot and pays $1.18. The next turn adds 5K tokens of file context and the same request costs $2.35. Nothing about the task changed. The prompt crossed 272K input tokens, and **GitHub Copilot long-context pricing** kicked in.

That looks like a trick to squeeze more AI Credits out of customers. We checked GitHub's [models and pricing page](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) against the providers' own price lists, the same ones **LLM Gateway** bills at. The short answer: the tiers are real, the cliff is steep, and with one exception Copilot is not the one setting it. What Copilot does control is how visible the cliff is, and today it is easy to miss.

## Which Copilot models have long-context pricing

Since June 1, 2026, Copilot bills chat, agents, CLI and code review in AI Credits (1 credit = $0.01) at per-token rates. Some models have two rows on the [pricing page](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), a default tier and a long-context tier, split by a threshold in input tokens. This is a snapshot as of October 28, 2026; check GitHub's page for current rates. Prices are per 1M tokens:

| Model on Copilot   | Threshold | Default input / output | Long-context input / output |
| ------------------ | --------- | ---------------------- | --------------------------- |
| GPT-5.6 Sol        | 272K      | $4.00 / $20.00         | $8.00 / $30.00              |
| GPT-5.6 Terra      | 272K      | $2.00 / $12.00         | $4.00 / $18.00              |
| GPT-5.6 Luna       | 200K      | $0.20 / $1.20          | $0.40 / $1.80               |
| GPT-6 Astra        | 272K      | $10.00 / $50.00        | $20.00 / $75.00             |
| GPT-6 Luna         | 272K      | $0.10 / $0.50          | $0.20 / $0.75               |
| GPT-6 Sol          | 272K      | $2.00 / $10.00         | $4.00 / $15.00              |
| GPT-6.1 Sol        | 272K      | $2.00 / $10.00         | $4.00 / $15.00              |
| GPT-6.1 Terra      | 272K      | $1.00 / $5.00          | $2.00 / $7.50               |
| Grok 4.5, 4.6, 4.7 | 200K      | $2.00 / $6.00          | $4.00 / $12.00              |
| Claude Haiku 5.5   | 100K      | $0.10 / $0.50          | $0.50 / $2.50               |

Cached input and cache writes double on the same boundary, and quintuple on Haiku 5.5.

Many other models on the page have a single rate, including Claude Opus 5.5 ($4 / $20), Claude Sonnet 5.5 ($2 / $10), Claude Fable 5.1 ($10 / $50), GPT-5.3-Codex, Gemini 4 Argon and Kimi K3.

## Is it a Copilot markup? We checked every tier

Mostly no. We compared each row with the list prices OpenAI, xAI and Anthropic publish, which are the rates LLM Gateway passes through:

- **OpenAI.** GPT-5.6 Sol is $4 / $20 up to 272K and $8 / $30 above it at OpenAI's current promotional rates, and OpenAI prices the full request at the higher rate once input passes 272K. The same rates and threshold hold for GPT-5.6 Terra, GPT-6 Astra, Sol and Luna, and GPT-6.1 Sol and Terra.
- **xAI.** Grok 4.5 through 4.7 double above 200K on xAI's own API.
- **Anthropic.** Claude Haiku 5.5 jumps from $0.10 / $0.50 to $0.50 / $2.50 above 100K at Anthropic.

The models Copilot prices flat are flat at the provider too. If Copilot were inventing tiers to raise bills, Claude Opus 5.5 and Sonnet 5.5, two popular coding models, would be an obvious place to put one. They have none.

One threshold is lower on Copilot than at the provider. Copilot moves GPT-5.6 Luna to its long-context rate above 200K input tokens, while OpenAI's [GPT-5.6 Luna page](https://developers.openai.com/api/docs/models/gpt-5.6-luna) puts that line at 272K. The rates on both sides of the line are the same, but a 250K-token Luna prompt with 5K of output costs $0.109 on Copilot and $0.056 at OpenAI's list price.

There was one real overcharge. Copilot listed and billed a long-context rate for Claude Sonnet 4.6, 600 credits input and 2,250 output per 1M tokens instead of 300 and 1,500. Anthropic does not charge extra for long context on Sonnet 4.6. A VS Code team member [confirmed the prices were set incorrectly](https://github.com/microsoft/vscode/issues/320027), and that GitHub corrected them and refunded affected users. Today's pricing page lists Sonnet 4.6 at a flat $3 / $15.

Apart from that threshold, the only rate that differs from our catalog is Grok 4.5 cached input: Copilot bills $0.50 per 1M, the same as Grok 4.6 and 4.7, while our catalog lists $0.30. xAI's Grok 4.5 page shows both figures across its regional clusters.

## The 1M context setting, and where the price hides

In VS Code and Copilot CLI you can pick the default context window or the extended 1M window on supported models. That setting does not change the price per token. GitHub's [supported models page](https://docs.github.com/en/copilot/reference/ai-models/supported-models#models-with-extended-capabilities) says a larger window "will impact AI credits consumption" because more tokens are sent, and recommends the default window unless a task needs more.

The model picker makes it look like the setting picks the price. Select Claude Haiku 5.5 with the 100K context size and the pricing details read 10 credits input, 50 output, 1 cache read and 12.5 cache write per 1M tokens. Switch to 1M and they read 50, 250, 5 and 62.5. Those are Anthropic's own two tiers, and the setting does not move every request onto the second one. Asked exactly this in [microsoft/vscode#319976](https://github.com/microsoft/vscode/issues/319976), a Copilot team member answered: "The cost is decided by the request input prompt size, so if you have selected the long context option, but do not exceed the default size, the long context pricing is not applied."

The same thread has the catch worth knowing. Going over the default "switches the **whole** conversation over to the long context pricing", with no split between the tokens below and above the line. And in 1M mode, Copilot triggers automatic compaction less often, so conversation history fills the prompt and pushes it over the threshold more often. Every turn after that is billed at the long-context rate until the prompt shrinks again, through automatic compaction or `/compact`.

None of this is obvious from the picker. "Pricing details" is collapsed by default, and the cost badge next to it reads "Low cost" for Haiku 5.5 at both 100K and 1M, even though the rates inside go up five times. Nothing in the chat tells you when a session has crossed the threshold; the request for a short-context versus long-context marker in the usage meter, [microsoft/vscode#320027](https://github.com/microsoft/vscode/issues/320027), is still open. A developer who picks 1M once and keeps working can pay the long-context rate on every turn with nothing in the UI flagging that the tier changed.

## The price cliff in real numbers

The tier applies to the whole request, not just the tokens above the threshold. That turns a small increase in context into a large jump in cost:

| Request                          | Input | Output | Cost   | AI Credits |
| -------------------------------- | ----- | ------ | ------ | ---------- |
| GPT-5.6 Sol, under the threshold | 270K  | 5K     | $1.18  | 118        |
| GPT-5.6 Sol, over the threshold  | 275K  | 5K     | $2.35  | 235        |
| Grok 4.6, under                  | 199K  | 4K     | $0.42  | 42         |
| Grok 4.6, over                   | 201K  | 4K     | $0.85  | 85         |
| Claude Haiku 5.5, under          | 99K   | 2K     | $0.011 | 1.1        |
| Claude Haiku 5.5, over           | 101K  | 2K     | $0.056 | 5.6        |

Two percent more input on GPT-5.6 Sol doubles the bill. On Haiku 5.5, a cheap model teams often use for subagents and routing, 2K extra tokens make the request five times as expensive. An agent that re-sends a 300K context on every turn pays the higher rate on every turn.

For comparison, the same 275K-token request on Claude Opus 5.5, with flat pricing across 1M tokens, costs $1.20.

## How to stay under the long-context threshold

The cliff comes from the providers, so it follows you to any tool that bills at their rates. What you can control is how often you hit it:

- **Compact or restart long sessions.** Most coding agents can summarize history. Doing it before 272K (200K on Grok and GPT-5.6 Luna, 100K on Haiku 5.5) keeps every turn on the default tier.
- **Lean on cached input.** On the tiered GPT models, cached input costs 10% of the input rate or less, on either side of the threshold. A stable system prompt and file context that hit the cache cost far less than fresh tokens.
- **Send huge contexts to flat-priced models.** For a 500K-token codebase review, Claude Opus 5.5 or Sonnet 5.5 cost the same per token at 500K as at 5K.
- **Watch the tier on every request.** You cannot fix a cliff you cannot see.

## How LLM Gateway shows the tier you were billed at

LLM Gateway bills the same provider tiers at cost, so we will not pretend the cliff disappears. The difference is what you can see and stop:

- **The tier on every request.** The request log in the dashboard shows the model, provider, cost and the pricing tier the request was billed at, such as "Up to 272K" or "Over 272K".
- **Tiers on every model page.** The [models catalog](/models) lists each provider's thresholds and both sets of rates before you send a token.
- **Hard budgets.** Set limits per organization, project and API key, so an agent session that keeps re-sending 300K tokens stops at the cap instead of billing past it.
- **No seat, no markup.** Provider rates pass through at cost. A 5% fee applies when you buy credits, and 0% when you bring your own provider keys.
- **Any coding tool.** Point Claude Code, Cline, Continue or Aider at LLM Gateway and switch to a flat-priced model when a context gets large.

Copilot is still a strong product, and its inline completions are not billed in AI Credits on paid plans. If chat and agents are where your spend goes, see the full [LLM Gateway vs GitHub Copilot comparison](/compare/github-copilot) or estimate your bill with the [Copilot cost calculator](/copilot-cost-calculator).

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Compare LLM Gateway and GitHub Copilot](/compare/github-copilot)**
- **[Read: the best GitHub Copilot alternatives in 2026](/blog/github-copilot-alternatives)**
