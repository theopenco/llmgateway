---
id: blog-custom-providers
slug: custom-openai-compatible-providers
date: 2025-05-10
title: Custom OpenAI-Compatible Providers Are Now Supported
summary: Bring your own OpenAI-compatible endpoints and route them via LLM Gateway.
categories: ["Announcements"]
image:
  src: "/blog/custom-openai-compatible-providers.png"
  alt: "LLM Gateway"
  width: 2282
  height: 1198
---

You can now register custom OpenAI-compatible providers in LLM Gateway. Perfect for internal deployments or specialized third-party APIs that speak the OpenAI Chat Completions format.

### Configure a Custom Provider

Add a provider in the UI (lowercase name, base URL, and token). Then call models via `{providerName}/{modelName}`:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mycompany/custom-gpt-4",
    "messages": [{"role": "user", "content": "Hello from my custom provider!"}]
  }'
```

Requirements include a lowercase provider name and a valid HTTPS base URL. See details in the docs: [Custom Providers](https://docs.llmgateway.io/features/custom-providers).
