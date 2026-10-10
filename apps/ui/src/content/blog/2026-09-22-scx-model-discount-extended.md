---
id: "blog-scx-model-discount-extended"
slug: "scx-model-discount-extended"
date: "2026-09-22"
title: "SCX Model Discount Extended Through October 9"
summary: "The SCX model discount was due to end on September 24. It now runs 15 more days: 20% off the same seven models on LLM Gateway until October 9, 2026. Nothing changes in how you route requests."
categories: ["Announcements"]
faqs:
  - question: "When does the extended SCX model discount end?"
    answer: "The discount now ends October 9, 2026 at 23:59:59 UTC, 15 days after the original September 24 end date. List prices apply after that."
  - question: "Does the extension change the discount or the eligible models?"
    answer: "No. The same 20% discount applies to the same seven models when they are served through SCX. Requests served by other providers are billed at that provider's rates."
  - question: "Do I need to change anything to keep the discount?"
    answer: "No. Keep routing requests with the scx-ai-gp provider prefix, such as scx-ai-gp/glm-5.3, and the discounted price applies automatically until the new end date."
image:
  src: "/blog/scx-model-discount-extended.png"
  alt: "A glowing discount tag and a calendar fanning out extra pages on a circuit board connected to seven AI model chips"
  width: 1536
  height: 1024
---

Two weeks is a short window to move a workload onto a new provider. The **SCX model discount** was scheduled to end on **September 24, 2026**. We are extending it by 15 days: **20% off seven selected models** through **LLM Gateway** now runs until **October 9, 2026 at 23:59:59 UTC**.

Everything else stays the same. Same discount, same seven models, same way to route requests.

## What the SCX model discount extension covers

The offer still covers these seven SCX deployments. Each link opens the model's live pricing and API details.

- [GLM 5.3](/models/glm-5.3/scx-ai-gp)
- [GLM 5.3 Flash](/models/glm-5.3-flash/scx-ai-gp)
- [GLM 5.2](/models/glm-5.2/scx-ai-gp)
- [GLM 5.2 Turbo](/models/glm-5.2-fast/scx-ai-gp)
- [Qwen 3.8 Max](/models/qwen3.8-max/scx-ai-gp)
- [Kimi K2.7 Code](/models/kimi-k2.7-code/scx-ai-gp)
- [Kimi K3](/models/kimi-k3/scx-ai-gp)

The discounted price shows on each model page while the promotion runs. If you are already sending traffic to SCX, you keep the discount without changing anything. If you started an evaluation this month, the extension gives you a full 30 days at the reduced rate. Browse the [SCX provider page](/providers/scx-ai-gp) for current availability and rates.

## Route your requests through SCX

With a pay-as-you-go LLM Gateway API key, choose SCX by adding `scx-ai-gp/` before the model ID. Your endpoint and API key stay the same:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "scx-ai-gp/kimi-k3",
    "messages": [{ "role": "user", "content": "Summarize the open issues in this repository." }]
  }'
```

The discount applies to eligible usage **served by SCX during the promotion**. If a request falls back to another provider, that provider's rates apply. To require SCX without fallback, add the `X-No-Fallback: true` header. See the [routing guide](https://docs.llmgateway.io/features/routing#provider-specific-routing) for details.

## Make the most of the extra 15 days

- **[Create your LLM Gateway account](https://llmgateway.io/signup)** and get an API key.
- **[Pick an SCX model](/providers/scx-ai-gp)** and pin it with the `scx-ai-gp/` prefix.
- **[Read the original announcement](/blog/scx-model-discount)** for the full terms of the offer.
