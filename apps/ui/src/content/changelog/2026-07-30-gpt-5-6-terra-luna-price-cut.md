---
id: "72"
slug: "gpt-5-6-terra-luna-price-cut"
date: "2026-07-30"
title: "GPT-5.6 Terra & Luna Price Cuts"
summary: "OpenAI cut GPT-5.6 Terra to $2.00/$12.00 and Luna to $0.20/$1.20 per 1M tokens — Terra is 20% cheaper, Luna 80%. The new rates are live on LLM Gateway and apply automatically to every request, including cached input, cache writes, and long-context pricing."
image:
  src: "/changelog/gpt-5-6-terra-luna-price-cut.png"
  alt: "Glowing price-cut arrow and coins beside earth and moon icons on a circuit board, announcing GPT-5.6 Terra and Luna price cuts"
  width: 1536
  height: 1024
---

Three weeks after the GPT-5.6 launch, OpenAI [moved the price-performance frontier](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/): **GPT-5.6 Terra** is now 20% cheaper and **GPT-5.6 Luna** 80% cheaper. The new rates are already live on LLM Gateway and apply to every request automatically.

## New Rates

| Model                                                         | Input / 1M          | Cached input / 1M   | Output / 1M           |
| ------------------------------------------------------------- | ------------------- | ------------------- | --------------------- |
| [`gpt-5.6-terra`](https://llmgateway.io/models/gpt-5.6-terra) | ~~$2.50~~ **$2.00** | ~~$0.25~~ **$0.20** | ~~$15.00~~ **$12.00** |
| [`gpt-5.6-luna`](https://llmgateway.io/models/gpt-5.6-luna)   | ~~$1.00~~ **$0.20** | ~~$0.10~~ **$0.02** | ~~$6.00~~ **$1.20**   |

Everything derived from the base rate drops with it:

- **Cache writes** stay at 1.25x the input rate, so Terra writes at $2.50/M and Luna at $0.25/M.
- **Long context** (over 272K input tokens) stays at 2x input / 1.5x output on the new bases.
- **Flex** still halves the bill — Luna on flex now runs at $0.10/M input and $0.60/M output — and **Priority** stays at 2x.

`gpt-5.6-sol` pricing is unchanged at $5.00/$30.00.

## Nothing to Change on Your End

The lower rates apply automatically wherever these models are billed — direct requests, Auto Route picks, and fallback traffic alike. If you route by cost, the router already sees the new prices. Capabilities are untouched: the same 1.05M-token context window, reasoning, vision, tool calling, and web search as at launch.

---

**[Browse the models →](https://llmgateway.io/models)** | **[OpenAI's announcement →](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/)**
