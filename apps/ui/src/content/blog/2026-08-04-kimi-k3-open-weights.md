---
id: "blog-kimi-k3-open-weights"
slug: "kimi-k3-open-weights"
date: "2026-08-04"
title: "Kimi K3 Open Weights Are Out: What You Can Actually Do"
summary: "Moonshot released the Kimi K3 open weights on July 26, 2026 — 2.8T parameters, the largest open-weight model ever shipped. What's in the release, what it takes to run Kimi K3 locally, the license caveat, and the hosted routes that don't need a GPU cluster."
categories: ["Guides"]
model: kimi-k3
faqs:
  - question: "Are the Kimi K3 weights really open?"
    answer: 'The full 2.8T-parameter weights are downloadable from Hugging Face, so it''s an open-weight release in the practical sense. The license is a custom "Kimi K3 License", not MIT or Apache — read the LICENSE file in the repository before any commercial self-hosting decision.'
  - question: "Can I run Kimi K3 on my own hardware?"
    answer: "Only at cluster scale. At MXFP4 the weights alone are roughly 1.4 TB, so plan for a multi-node GPU deployment on vLLM or SGLang. For everyone else, the hosted route through an API is the realistic option."
  - question: "What does Kimi K3 cost through an API?"
    answer: "Through LLM Gateway, Kimi K3 runs at $3 per million input tokens, $0.30 per million cached input tokens, and $15 per million output tokens — the same rates Moonshot publishes. On DevPass it's a premium-tier model covered by the weekly premium allowance."
  - question: "Why release the weights at all?"
    answer: "Open weights widen the hosting market, make the model auditable, and give large customers the escape hatch they increasingly demand. Moonshot follows a pattern that GLM, DeepSeek, and MiniMax established: hosted-first economics, open-weight trust."
image:
  src: "/blog/kimi-k3-open-weights.png"
  alt: "Kimi K3 open weights release — a massive glowing model chip being unlocked on a circuit board"
  width: 1536
  height: 1024
---

Moonshot promised the Kimi K3 open weights "by July 27, 2026" and beat its own deadline: the weights landed on Hugging Face on the evening of July 26 (US time), under [moonshotai/Kimi-K3](https://huggingface.co/moonshotai/Kimi-K3). At 2.8 trillion parameters, it's the largest open-weight release in history — the frontier-class model from [our Kimi K3 breakdown](/blog/kimi-k3) is now something you can download.

"Can download" and "can run" are different claims, though, and most of the day-one commentary blurred them. Here's what's actually in the release, what running it yourself takes, the license caveat nobody should skip, and the routes that get you Kimi K3 today without touching a GPU.

## What's in the release

The Hugging Face repository contains the full model weights, configuration, deployment instructions, and a LICENSE file. The load-bearing specs:

| Spec             | Kimi K3                                                       |
| ---------------- | ------------------------------------------------------------- |
| Total parameters | 2.8T (MoE)                                                    |
| Active per token | 104B (16 of 896 experts)                                      |
| Context window   | 1,048,576 tokens                                              |
| Quantization     | MXFP4 weights / MXFP8 activations, quantization-aware trained |
| Inference stacks | vLLM, SGLang, TokenSpeed                                      |

The MXFP4/MXFP8 story is the interesting part: K3 was trained quantization-aware, so the 4-bit weights are the intended deployment format, not an aftermarket compression with the usual quality haircut.

## The license: read it before you build on it

Press coverage before the drop widely predicted a Modified MIT license, matching Moonshot's earlier releases. That's not what shipped. The weights are released under a custom **Kimi K3 License** — its own document, in the repository's LICENSE file.

We're deliberately not summarizing its terms here: if you're planning commercial self-hosting, read the actual file and run it past whoever reviews licenses for you. The one-sentence takeaway is just that "open weights" is not "MIT", and any architecture decision that assumes otherwise should wait until legal has read the same file you did.

## What running Kimi K3 locally actually takes

The arithmetic is unforgiving. At MXFP4 — roughly half a byte per parameter — 2.8T parameters put the weights alone on the order of **1.4 TB**, before KV cache for that 1M-token context. This is not an 80GB-GPU project; it's a multi-node deployment with fast interconnect, orchestrated by vLLM or SGLang across the cluster.

The sparse activation (104B active parameters per token) keeps _compute_ per token in the range of much smaller dense models — that's why hosted Kimi K3 is priced like a mid-size frontier model rather than a 2.8T one. But sparsity doesn't shrink the memory footprint: every expert has to be resident somewhere.

So "run it locally" honestly means one of:

- **You operate GPU clusters already.** Then the release is genuinely useful: weights in your boundary, your own fine-tuning and distillation experiments, no per-token bills.
- **You rent the deployment.** Serverless GPU platforms and inference providers stood up hosted K3 within days of the drop — you get the open-weight assurances without owning the metal.
- **You wanted the weights as an escape hatch.** Also legitimate: many teams route to the hosted model and value the weights as insurance against pricing or availability changes. That insurance now exists.

## The hosted route: one endpoint, several providers

Multiple providers serve Kimi K3 through **LLM Gateway** today — the open-weight release means the hosting market for it keeps widening, and the gateway routes across it. One request, automatic failover, no cluster:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimi-k3",
    "stream": true,
    "messages": [{"role": "user", "content": "Summarize the Kimi K3 release in three bullets."}]
  }'
```

Pricing through the gateway matches Moonshot's rates: **$3 per million input tokens, $0.30 cached input, $15 output**. Check the [Kimi K3 model page](https://llmgateway.io/models/kimi-k3) for the live provider list, uptime, and per-provider details, or see which models developers actually run in production on the [rankings page](https://llmgateway.io/rankings).

On [DevPass](https://devpass.llmgateway.io), Kimi K3 is a premium-tier model — available on every plan's weekly premium allowance, with the full API walkthrough in our [Kimi K3 API guide](/blog/kimi-k3-api) and the coding-agent setup in the [Claude Code guide](/blog/kimi-k3-claude-code).

## What the release changes

The precedent matters more than the download count. K3 at 2.8T proves frontier-scale MoE models can ship as open weights with quantization-aware 4-bit deployment as the intended path — and it resets expectations for [the open-weight wave](/blog/best-open-source-llms) behind it. For most teams, the practical consequence isn't self-hosting; it's leverage. Hosted pricing for open-weight models faces competition that closed models never do.

<BlogCta variant="gateway" location="bottom" />
