---
id: "blog-best-open-source-llms"
slug: "best-open-source-llms"
date: "2026-07-19"
title: "9 Best Open-Source LLMs in 2026 (Compared)"
summary: "The best open-source LLMs in 2026, ranked — Kimi K3 (weights expected by July 27), GLM-5.2, DeepSeek V4 Pro, MiniMax M3 and more, compared on license, context window, and real per-token price. All of them run through one API with LLM Gateway."
categories: ["Guides"]
image:
  src: "/blog/best-open-source-llms.png"
  alt: "A podium of glowing processor chips of different sizes on a circuit board, representing the best open-source LLMs of 2026 ranked"
  width: 1536
  height: 1024
---

Open-source LLMs stopped being the budget option in 2026. Kimi K3 sits level with Claude Opus 4.8 on the Artificial Analysis Intelligence Index (its hosted API is live; the weights themselves are expected by July 27), GLM-5.2 held the top open-model spot before it, and the field behind them is deep enough that the hard part is choosing.

This ranking covers the nine best open-weight models right now — on license, context window, hardware reality, and the per-token price you actually pay. Every one of them is available through **LLM Gateway** with one key, at each provider's published rate, so you can A/B any two of them by changing one word in a request.

## 1. Kimi K3 — the open frontier

**Moonshot AI · 2.8T params · 1M context · $3.00 / $15.00 per M**

The largest open-weight model ever announced — with one caveat: the weights are not downloadable yet. Moonshot expects to release them by July 27, 2026, and the license is still unannounced; the hosted API has been live since July 16. Ranks 4th of 189 models on the Artificial Analysis Intelligence Index — tied with Claude Opus 4.8 and GPT-5.5 — and took first place in Arena's blind Frontend Code testing. Always-on reasoning, vision, tools, and output configurable up to 1M tokens. The open model to beat, priced accordingly. [Full breakdown here](/blog/kimi-k3).

**Best for:** teams that want closed-frontier quality with open-weight freedom.

## 2. GLM-5.2 — the value flagship

**Z.ai · 744B params · 1M context · $1.40 / $4.40 per M**

MIT-licensed, weights on Hugging Face, and the top-ranked open model until K3 arrived. A real 1M-token context, strong agentic-coding results, and built-in web search support — with output at under a third of K3's rate and input at about half. Also the largest model on this list that fits a single 8-GPU node (or one 512 GB Mac Studio) at INT4.

**Best for:** the best capability-per-dollar in the open field.

## 3. DeepSeek V4 Pro — frontier scale at commodity prices

**DeepSeek · 1.6T params (49B active) · 1M context · $0.435 / $0.87 per M**

MIT-licensed MoE with an aggressive sparse design: 1.6T total parameters, 49B active. The result is a 1M-context frontier-class model priced under a dollar per million output tokens — an order of magnitude below K3. Reasoning, tools, JSON output; no vision.

**Best for:** high-volume production workloads where unit cost decides.

## 4. Kimi K2.6 — last generation's champion, now cheap

**Moonshot AI · 262K context · $0.95 / $4.00 per M**

Before K3, Kimi K2.6 topped the open-weight rankings on the Artificial Analysis Intelligence Index. It is still a heavyweight — vision included — and its price dropped into value territory the day its successor shipped.

**Best for:** near-frontier quality with a smaller bill and a proven track record.

## 5. MiniMax M3 — the multimodal one

**MiniMax · 512K context · $0.60 / $2.40 per M**

Open weights, native multimodal understanding (text and images in one model), and MiniMax's sparse-attention design for efficient long-context inference. Posted 59.0% on SWE-Bench Pro at launch — above GPT-5.5 and Gemini 3.1 Pro on that benchmark.

**Best for:** agents that need to read screenshots, diagrams, and UI alongside code.

## 6. Nemotron 3 Ultra 550B — the enterprise workhorse

**NVIDIA · 550B params (55B active) · 262K context · $0.50 / $2.50 per M**

NVIDIA's open-weight flagship, tuned hard for agentic and enterprise workloads, with vision support and weights on Hugging Face. Backed by the deepest deployment tooling in the industry if you ever take it on-prem.

**Best for:** enterprises standardizing on NVIDIA's stack end to end.

## 7. Qwen3.6-35B-A3B — the local hero

**Alibaba · 35B params (3B active) · 262K context · $0.25 / $1.49 per M**

Apache 2.0, multimodal, and genuinely runnable on a 24 GB consumer GPU — 3B active parameters make it fast on modest hardware while it punches far above its size on agentic coding. The model to reach for when "open source" means "runs on my machine."

**Best for:** local development, edge deployment, and hobbyist hardware.

## 8. gpt-oss-120b — OpenAI's open one

**OpenAI · 120B params · 131K context · $0.15 / $0.75 per M**

Apache 2.0 and sized to fit a single 80 GB GPU. Not the newest entry on this list, but the combination of pedigree, permissive license, single-GPU deployment, and rock-bottom hosted pricing keeps it in the rotation.

**Best for:** cheap reasoning at scale and single-GPU self-hosting.

## 9. Llama 4 Maverick — the ecosystem incumbent

**Meta · 1M context · $0.27 / $0.85 per M**

Meta's open-weight line no longer leads benchmarks, but no model family matches its ecosystem: fine-tunes, guardrails, tooling, and institutional familiarity. Vision support and a 1M context at bargain pricing keep it a safe default.

**Best for:** teams already invested in the Llama toolchain.

## Comparison table

| #   | Model            | Lab      | License        | Context | Input $/M | Output $/M |
| --- | ---------------- | -------- | -------------- | ------- | --------- | ---------- |
| 1   | Kimi K3          | Moonshot | open weights\* | 1M      | $3.00     | $15.00     |
| 2   | GLM-5.2          | Z.ai     | MIT            | 1M      | $1.40     | $4.40      |
| 3   | DeepSeek V4 Pro  | DeepSeek | MIT            | 1M      | $0.435    | $0.87      |
| 4   | Kimi K2.6        | Moonshot | open weights   | 262K    | $0.95     | $4.00      |
| 5   | MiniMax M3       | MiniMax  | open weights   | 512K    | $0.60     | $2.40      |
| 6   | Nemotron 3 Ultra | NVIDIA   | open weights   | 262K    | $0.50     | $2.50      |
| 7   | Qwen3.6-35B-A3B  | Alibaba  | Apache 2.0     | 262K    | $0.25     | $1.49      |
| 8   | gpt-oss-120b     | OpenAI   | Apache 2.0     | 131K    | $0.15     | $0.75      |
| 9   | Llama 4 Maverick | Meta     | Llama license  | 1M      | $0.27     | $0.85      |

\*Weights publish by July 27, 2026; Moonshot has not yet announced the license. Prices are each provider's published rate through LLM Gateway; the live list is on the [models page](https://llmgateway.io/models).

## How to choose

- **Maximum capability:** Kimi K3, with GLM-5.2 as the value alternative
- **Production volume:** DeepSeek V4 Pro or gpt-oss-120b — pennies per million
- **Multimodal agents:** MiniMax M3, or Qwen3.6-35B-A3B at the small end
- **Self-hosting:** match the model to your hardware — Qwen3.6-35B-A3B for a workstation, gpt-oss-120b for a single 80 GB GPU, GLM-5.2 for a full node
- **Coding agents:** K3 for the hard problems, GLM-5.2 or DeepSeek V4 Pro for the loop — [setup guide](/blog/kimi-k3-claude-code)

## One API for all nine

Every model in this list is a `model` string on the same endpoint:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5.2",
    "messages": [{"role": "user", "content": "Review this diff for race conditions."}]
  }'
```

Two ways to pay. **Pay-as-you-go**: top up from $10, pay the published per-token rates plus a 5% platform fee at top-up — right for shipping products. **[DevPass](https://devpass.llmgateway.io)**: flat $29/$79/$179 a month for coding agents, with roughly 3× your subscription price in model usage at provider rates. On DevPass, every model on this list except Kimi K3 is standard-tier with no weekly cap; K3 crosses the premium price threshold and draws from a weekly premium allowance.

## Frequently Asked Questions

### What is the best open-source LLM in 2026?

Kimi K3, by benchmark standing: 4th of 189 models on the Artificial Analysis Intelligence Index, level with Claude Opus 4.8 — though its weights are expected by July 27 and it is API-only until then. If price matters, GLM-5.2 delivers most of that capability with output at under a third of K3's price.

### What is the best small open-source LLM?

Qwen3.6-35B-A3B — Apache 2.0, multimodal, 3B active parameters, and it runs on a 24 GB consumer GPU while holding its own on agentic coding benchmarks.

### Are these models open source or open weight?

Open weight: the trained weights are downloadable and self-hostable under permissive licenses (mostly MIT or Apache 2.0), but training data and code are generally not released. GLM-5.2, DeepSeek V4 Pro, Qwen3.6-35B-A3B, and gpt-oss-120b use standard OSI licenses; Llama uses Meta's community license. Kimi K3 is the exception for now: its weights are expected by July 27, 2026 and are unlicensed until Moonshot announces terms — today it is usable only through hosted APIs.

### What is the cheapest way to use open-source LLMs?

Through a gateway at provider list prices. LLM Gateway adds no per-token markup — pay-as-you-go credits carry a 5% platform fee at top-up, and DevPass turns heavy coding-agent usage into a flat monthly rate.

## Getting started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — all nine models, one key
- **[Get DevPass](https://devpass.llmgateway.io)** — flat-rate open models in your coding agent from $29/mo
- Deep dive on the leader: [Kimi K3 and China's Open-Weight Model Wave](/blog/kimi-k3)
