---
id: blog-custom-providers
slug: custom-openai-compatible-providers
date: 2025-05-10
title: Custom OpenAI-Compatible Providers Are Now Supported
summary: Connect your internal LLM deployments or any OpenAI-compatible API to LLM Gateway—and get the same analytics, caching, and routing.
categories: ["Announcements"]
image:
  src: "/blog/custom-openai-compatible-providers.png"
  alt: "LLM Gateway"
  width: 2282
  height: 1198
---

Running your own LLM? Have a specialized third-party API? You can now add any OpenAI-compatible endpoint to LLM Gateway and route traffic through it—with full analytics, caching, and cost tracking.

## Why This Matters

Many teams run internal LLM deployments (vLLM, TGI, Ollama) or use specialized providers that aren't in our default catalog. Now you can:

- **Track internal model usage** alongside external providers
- **Apply the same routing rules** to all your models
- **Get cost analytics** even for self-hosted models
- **Use one API** for everything—internal and external

## How to Add a Custom Provider

1. Go to **Settings → Provider Keys** in your dashboard
2. Click **Add Custom Provider**
3. Enter a lowercase name (e.g., `mycompany`), your base URL, and API token

Then call your models using the `{providerName}/{modelName}` format:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mycompany/custom-gpt-4",
    "messages": [{"role": "user", "content": "Hello from my custom provider!"}]
  }'
```

Your custom provider appears in your analytics dashboard alongside OpenAI, Anthropic, and others—giving you a unified view of all your LLM usage.

For setup details and troubleshooting, see the [Custom Providers documentation](https://docs.llmgateway.io/features/custom-providers).
