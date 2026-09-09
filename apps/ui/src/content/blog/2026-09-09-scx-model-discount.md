---
id: "blog-scx-model-discount"
slug: "scx-model-discount"
date: "2026-09-09"
title: "SCX Model Discount: 20% Off for 15 Days"
summary: "The SCX model discount brings 20% off seven selected models on LLM Gateway for 15 days, starting when the Runware promotion ends on September 9. See the eligible models and how to route requests through SCX."
categories: ["Announcements"]
faqs:
  - question: "When does the SCX model discount start and end?"
    answer: "The promotion starts September 9, 2026 at 23:59:59 UTC, exactly when the Runware promotion ends. It runs for 15 days and ends September 24, 2026 at 23:59:59 UTC."
  - question: "Does the 20% discount apply to every SCX model?"
    answer: "No. The offer covers the seven models listed in this announcement when served through SCX during the promotion. Other models and requests served by other providers are outside this offer."
  - question: "How do I choose SCX for a request?"
    answer: "With a pay-as-you-go API key, use the scx-ai-gp provider prefix followed by the model ID, such as scx-ai-gp/glm-5.3. The linked model pages show the SCX deployment and its current pricing."
image:
  src: "/blog/scx-model-discount.png"
  alt: "A glowing discount tag on a circuit board connected to seven AI model chips and a calendar"
  width: 1536
  height: 1024
---

Every coding session, model comparison, and agent run adds to your inference bill. The **SCX model discount** gives you room to run more: **20% off seven selected models** through **LLM Gateway** for 15 days.

The offer begins **September 9, 2026 at 23:59:59 UTC**, exactly when the Runware promotion ends, and finishes **September 24, 2026 at 23:59:59 UTC**.

## Get the SCX model discount on these seven models

This offer covers the following SCX deployments. Each link takes you to the model's live pricing and API details.

- [GLM 5.3](/models/glm-5.3/scx-ai-gp)
- [GLM 5.3 Flash](/models/glm-5.3-flash/scx-ai-gp)
- [GLM 5.2](/models/glm-5.2/scx-ai-gp)
- [GLM 5.2 Turbo](/models/glm-5.2-fast/scx-ai-gp)
- [Qwen 3.8 Max](/models/qwen3.8-max/scx-ai-gp)
- [Kimi K2.7 Code](/models/kimi-k2.7-code/scx-ai-gp)
- [Kimi K3](/models/kimi-k3/scx-ai-gp)

Use the promotion to compare models on your own prompts or run an existing workflow at a lower cost. Browse the [SCX provider page](/providers/scx-ai-gp) for current availability and rates.

## Route your requests through SCX

With a pay-as-you-go LLM Gateway API key, choose SCX by adding `scx-ai-gp/` before the model ID. Your endpoint and API key stay the same:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "scx-ai-gp/glm-5.3",
    "messages": [{ "role": "user", "content": "Review this function for edge cases." }]
  }'
```

The offer applies to eligible usage **served by SCX during the promotion**. If a request falls back to another provider, that provider's rates apply. To require SCX without fallback, add the `X-No-Fallback: true` header. See the [routing guide](https://docs.llmgateway.io/features/routing#provider-specific-routing) for details.

## Put the discount to work

- **[Create your LLM Gateway account](https://llmgateway.io/signup)** and get an API key.
- **[Choose an SCX model](/providers/scx-ai-gp)** for your next run.
- **[See how cache-aware routing works](/blog/cache-aware-llm-routing)** to understand how the gateway compares provider costs.
