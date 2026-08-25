---
id: "71"
slug: "runware-launch-discount"
date: "2026-07-27"
title: "Runware Launch: 30% Off Open-Source Models"
summary: "We partnered with Runware.ai to serve six open-source flagships — gpt-oss-120b, Gemma 4, DeepSeek V4 Pro and Flash, Kimi K2.6, and GLM 5.2 — at 30% off. The discount applies automatically to everything routed through Runware until September 9."
image:
  src: "/changelog/runware-launch-discount.png"
  alt: "LLM Gateway and Runware logos beside a large 30% and a one-month calendar, announcing the launch discount"
  width: 1536
  height: 1024
---

> **Update (August 25):** the promo has been extended by two weeks — the discount now runs until **September 9, 2026**.

Open-source flagships now carry serious production workloads, which makes the per-token price of serving them the number that matters. We partnered with **[Runware.ai](https://llmgateway.io/providers/runware)** to bring their fast, OpenAI-compatible inference for open models to the gateway — and to launch it, **every Runware model is 30% off**.

## Six Models, 30% Off Until September 9

| Model                                                                       | Context | Input $/M | Output $/M |
| --------------------------------------------------------------------------- | ------- | --------- | ---------- |
| [gpt-oss-120b](https://llmgateway.io/models/gpt-oss-120b/runware)           | 131K    | $0.032    | $0.14      |
| [Gemma 4 31B IT](https://llmgateway.io/models/gemma-4-31b-it/runware)       | 262K    | $0.102    | $0.297     |
| [DeepSeek V4 Pro](https://llmgateway.io/models/deepseek-v4-pro/runware)     | 1M      | $0.961    | $1.922     |
| [DeepSeek V4 Flash](https://llmgateway.io/models/deepseek-v4-flash/runware) | 1M      | $0.076    | $0.153     |
| [Kimi K2.6](https://llmgateway.io/models/kimi-k2.6/runware)                 | 262K    | $0.60     | $3.05      |
| [GLM 5.2](https://llmgateway.io/models/glm-5.2/runware)                     | 1M      | $0.80     | $2.55      |

Those are the list prices — the 30% comes off on top at billing time. gpt-oss-120b, already one of the cheapest ways to run a 120B model, lands at about **$0.022/M input** during the promo.

## How the Discount Works

Nothing to configure: the discount applies automatically to any usage billed through Runware, whether the router picked it for you or you pinned it yourself:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "model": "runware/glm-5.2",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'
```

- Discounted pricing shows directly on the model pages while the promo runs.
- Automatic fallback keeps working as usual — only requests actually served by Runware get the discount.
- The promo ends **September 9, 2026**; list prices apply after that.

Runware serves these models through the same unified API as every other provider, with streaming support and no training on your API traffic.

---

**[Runware on LLM Gateway →](https://llmgateway.io/providers/runware)** | **[Browse all models →](https://llmgateway.io/models)**
