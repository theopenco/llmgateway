---
id: "112"
slug: "perplexity-search-api"
date: "2026-09-28"
title: "Perplexity Search API"
summary: "Call Perplexity's standalone Search API through LLM Gateway at /v1/search. It returns ranked web results with extracted page snippets instead of a model-written answer, billed per request, with failed requests free."
tags: ["llmgateway"]
image:
  src: "/changelog/perplexity-search-api.png"
  alt: "A glowing magnifying glass on a circuit-board chip surrounded by globe, document and list icons, representing the Perplexity Search API on LLM Gateway"
  width: 1536
  height: 1024
---

Agents and retrieval pipelines often need the raw search results, not a model's
summary of them, and until now the only Perplexity product on the gateway was
Sonar, which always answers in prose. The **Perplexity Search API** is now
available at `/v1/search`, returning ranked web results with extracted page
content that you feed into your own prompts and tools.

## A drop-in for Perplexity Search

The request and response match Perplexity's Search API, so existing code only
needs the LLM Gateway base URL and API key. Every field except `model` is
forwarded to Perplexity unchanged, including domain, language, country, recency
and date filters.

```bash
curl https://api.llmgateway.io/v1/search \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest developments in open-source LLMs",
    "max_results": 5,
    "search_recency_filter": "week"
  }'
```

Each result carries a `title`, `url`, `snippet`, and publication and last-updated
dates. Pass `query` as an array of up to five related queries to search them
independently in one request.

## Two models, billed per search

`model` is optional. When you leave it out, Perplexity's `search_type` picks the
model:

| `search_type`      | Model                               | Price                 |
| ------------------ | ----------------------------------- | --------------------- |
| `web` (or omitted) | `perplexity/perplexity-search`      | $5 per 1,000 searches |
| `fast`             | `perplexity/perplexity-search-fast` | $1 per 1,000 searches |

- **No token charges.** Search is billed per successful request, however much page content comes back.
- **Multi-query requests bill once**, matching Perplexity's own billing.
- **Failed requests are free.** Upstream errors are logged at no cost.
- **`search_type: "people"` is not supported yet** and is rejected with a `400`.

Requests appear in your activity log and usage analytics like any other
endpoint, and respect provider keys, IAM rules and data retention settings.

---

**[Search API docs →](https://docs.llmgateway.io/features/search)** | **[Perplexity Search model →](https://llmgateway.io/models/perplexity-search)**
