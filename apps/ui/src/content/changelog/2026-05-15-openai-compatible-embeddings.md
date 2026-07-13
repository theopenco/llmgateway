---
id: "47"
slug: "openai-compatible-embeddings"
date: "2026-05-15"
title: "OpenAI-Compatible Embeddings"
summary: "Turn text into vectors for semantic search, clustering, and RAG — through the same gateway you already use for chat."
image:
  src: "/changelog/embeddings-support.png"
  alt: "LLM Gateway now supports OpenAI-compatible embeddings"
  width: 3600
  height: 1890
---

LLM Gateway now exposes an OpenAI-compatible **`/v1/embeddings`** endpoint. Same base URL, same API key, same SDK — point your existing OpenAI client at the gateway and `embeddings.create()` just works.

```bash
curl -X POST "https://api.llmgateway.io/v1/embeddings" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "The quick brown fox jumps over the lazy dog."
  }'
```

- Drop-in replacement for `openai.embeddings` — no code changes if you're already on the OpenAI SDK
- Use it for semantic search, clustering, recommendations, and RAG pipelines
- Billed on input tokens only — no output tokens, no surprises
- Full usage and cost tracking in your dashboard, alongside your chat traffic

**[Browse embedding models →](https://llmgateway.io/models?filters=1&embedding=true)** | **[Read the docs →](https://docs.llmgateway.io/features/embeddings)**
