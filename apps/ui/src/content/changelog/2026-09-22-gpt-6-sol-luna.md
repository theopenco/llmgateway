---
id: "102"
slug: "gpt-6-sol-luna"
date: "2026-09-22"
title: "GPT-6 Sol & Luna at Half the Price"
summary: "OpenAI's GPT-6 Sol and GPT-6 Luna are live on the gateway at $2 / $10 and $0.10 / $0.50 per 1M tokens — half the GPT-5.6 rates — with cache reads at 10% of input, a 1.05M-token context window, and reasoning from none to max."
image:
  src: "/changelog/gpt-6-sol-luna.png"
  alt: "A glowing golden sun and a silver crescent moon on a circuit-board chip, surrounded by a halved coin stack with a price tag, a terminal window, a down arrow, and chat bubbles"
  width: 1536
  height: 1024
---

The GPT-6 family launched with Astra at $10 / $50 per 1M tokens, a price that keeps it out of most high-volume pipelines. OpenAI's two new siblings close that gap: **GPT-6 Sol** and **GPT-6 Luna** are live on LLM Gateway today at half the GPT-5.6 rates, with the same 1.05M-token context window, 128K output ceiling, and `pro` reasoning mode.

## Pricing

| Model        | Input / 1M | Cached input / 1M | Cache write / 1M | Output / 1M |
| ------------ | ---------- | ----------------- | ---------------- | ----------- |
| `gpt-6-sol`  | $2.00      | $0.20             | $2.50            | $10.00      |
| `gpt-6-luna` | $0.10      | $0.01             | $0.125           | $0.50       |

Everything derived from the base rate follows the GPT-5.6 rules:

- **Cache reads** bill at 10% of input and **cache writes** at 1.25x, with a single 30-minute TTL. Explicit caching via `prompt_cache_options` and `prompt_cache_breakpoint` is forwarded on both models.
- **Long context**: a prompt above 272K input tokens bills the whole request at 2x on the input side and 1.5x on output — Sol at $4 / $15, Luna at $0.20 / $0.75.
- **Flex** halves the bill (Sol $1 / $5, Luna $0.05 / $0.25) and **Priority** doubles it (Sol $4 / $20, Luna $0.20 / $1.00). Pass `service_tier` to pick one.
- **Web search** costs $0.01 per call plus the search content tokens at model rates.

## How they compare

| Model                                | Input / 1M | Cached input / 1M | Output / 1M |
| ------------------------------------ | ---------- | ----------------- | ----------- |
| `gpt-6-astra`                        | $10.00     | $1.00             | $50.00      |
| `gpt-5.6-sol` (promo through Nov 21) | $4.00      | $0.40             | $20.00      |
| **`gpt-6-sol`**                      | **$2.00**  | **$0.20**         | **$10.00**  |
| `gpt-5.6-luna`                       | $0.20      | $0.02             | $1.20       |
| **`gpt-6-luna`**                     | **$0.10**  | **$0.01**         | **$0.50**   |

Sol costs half of GPT-5.6 Sol's promotional rate and a fifth of GPT-6 Astra. Luna is half of GPT-5.6 Luna on input and 58% cheaper on output, a 1M-context reasoning model at GPT-4.1 nano input rates.

For a session that reads 1M input tokens, 800K of them from cache, and writes 100K output tokens:

| Model          | Session cost |
| -------------- | ------------ |
| `gpt-6-astra`  | $7.80        |
| `gpt-5.6-sol`  | $3.12        |
| `gpt-6-sol`    | $1.56        |
| `gpt-5.6-luna` | $0.176       |
| `gpt-6-luna`   | $0.078       |

## What else changed

- **Reasoning** accepts `none`, `low`, `medium` (the default), `high`, `xhigh`, and `max`, and both models take `reasoning.mode: "pro"` on top of the effort.
- **Knowledge cutoff** moves to April 20, 2026 on Sol and May 18, 2026 on Luna.
- **Tool calls with reasoning on** work from `/v1/chat/completions`. OpenAI's own Chat Completions endpoint only allows function calling on these models with reasoning off; the gateway forwards them to the Responses API, so nothing changes in your request.
- The models accept `max_tokens`, `verbosity`, `tools`, `tool_choice`, and `response_format`. Sampling parameters such as `temperature` are stripped before forwarding, so a request that sets them still succeeds.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{
		"model": "openai/gpt-6-sol",
		"reasoning_effort": "high",
		"messages": [{ "role": "user", "content": "Refactor this module to remove the circular import." }]
	}'
```

Swap in `openai/gpt-6-luna` for classification, extraction, and other high-volume work. Both models route through OpenAI directly for now; Azure and Bedrock mappings follow once we have verified them end to end.

---

**[Service tiers docs →](https://docs.llmgateway.io/features/service-tiers)** | **[GPT-6 Sol on the models page →](https://llmgateway.io/models/gpt-6-sol)**
