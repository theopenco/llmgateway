---
id: "blog-perplexity-search-api"
slug: "perplexity-search-api"
date: "2026-09-28"
title: "Perplexity Search API on LLM Gateway"
summary: "Use the Perplexity Search API through LLM Gateway to get ranked web results with extracted page content for agents and retrieval pipelines, billed per search with the same key you use for every model."
categories: ["Announcements", "Product"]
faqs:
  - question: "What is the difference between the Perplexity Search API and Sonar?"
    answer: "Sonar is a chat model that searches the web and writes an answer. The Search API returns the ranked results themselves, with titles, URLs, snippets and dates, and leaves the reasoning to your own model or code."
  - question: "How much does the Perplexity Search API cost on LLM Gateway?"
    answer: "perplexity/perplexity-search costs $5 per 1,000 searches and perplexity/perplexity-search-fast costs $1 per 1,000 searches. There are no token charges, a request with several queries counts as one search, and failed requests are not billed."
  - question: "Do I need to change my Perplexity Search code?"
    answer: "No. The /v1/search endpoint accepts the same request body and returns the same response shape as Perplexity's Search API. Point your client at https://api.llmgateway.io/v1/search and use your LLM Gateway API key."
image:
  src: "/blog/perplexity-search-api.png"
  alt: "A glowing magnifying glass on a circuit-board chip sends a fan of web result cards from a globe to a small robot agent, representing the Perplexity Search API on LLM Gateway"
  width: 1536
  height: 1024
---

An agent that answers questions about current events needs fresh web results,
and most of the time it needs the results themselves, not another model's
summary of them. Until now, the only way to reach Perplexity through **LLM
Gateway** was Sonar, which searches and then writes prose. The **Perplexity
Search API** is now available at `/v1/search`: ranked web results with extracted
page content, on the same key, bill and logs as every model you already call.

## Raw search results or a search-grounded answer

Both approaches exist on the gateway, and they solve different problems.

| You want                                              | Use                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| A model to search and answer in one call              | [Native web search](https://docs.llmgateway.io/features/web-search)     |
| Results to rank, filter, cache or cite yourself       | [Search API](https://docs.llmgateway.io/features/search) (`/v1/search`) |
| Search as a tool for any model, including open models | Search API, called from your tool handler                               |
| Full control over which pages reach the prompt        | Search API                                                              |

Native web search is the shortest path to an answer, but the model decides what
to search and what to keep. The Search API hands that decision back to you: you
get the URLs and snippets, and you choose what goes into the context window.

## Call the Perplexity Search API

The endpoint mirrors Perplexity's request and response, so existing Perplexity
Search code only needs a new base URL and key.

```bash
curl https://api.llmgateway.io/v1/search \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest developments in open-source LLMs",
    "max_results": 5,
    "search_recency_filter": "week",
    "search_domain_filter": ["arxiv.org", "huggingface.co"]
  }'
```

```json
{
  "id": "9ed15dce-a498-40b2-8bc9-7f13f35901cd",
  "model": "perplexity/perplexity-search",
  "results": [
    {
      "title": "…",
      "url": "https://…",
      "snippet": "…",
      "date": "2026-09-25",
      "last_updated": "2026-09-27"
    }
  ],
  "server_time": null
}
```

Every Perplexity filter is forwarded unchanged: country, language, domain
allow and deny lists, recency, publication and last-updated date ranges, and
per-result or total token budgets for extracted content. Pass `query` as an
array of up to five related queries to run them in a single request.

## Give any model a search tool

Because the results are plain JSON, the Search API works as a tool for any
model on the gateway. The handler below runs a search and returns compact
results for the model to read and cite.

```ts
async function searchWeb(query: string) {
  const res = await fetch("https://api.llmgateway.io/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LLM_GATEWAY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_type: "fast",
      max_results: 5,
    }),
  });
  const { results } = await res.json();
  return results.map((r: { title: string; url: string; snippet: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
  }));
}
```

Register `searchWeb` as a function tool in the `tools` array of a
`/v1/chat/completions` request and return its output as the tool result. The
search call and the model call both land in the same activity log, so you can
see what each answer was built from.

## Pricing: two models, billed per search

`model` is optional. Leave it out and Perplexity's `search_type` selects the
model; set it explicitly to pin one.

| `search_type`      | Model                               | Price                 |
| ------------------ | ----------------------------------- | --------------------- |
| `web` (or omitted) | `perplexity/perplexity-search`      | $5 per 1,000 searches |
| `fast`             | `perplexity/perplexity-search-fast` | $1 per 1,000 searches |

Billing follows Perplexity's own rules:

- **No token charges**, however much page content a search returns.
- **One charge per request**, even when `query` holds several queries.
- **Failed requests are free.** An upstream error is logged with a cost of zero.

Search requests count toward the same credits, spend limits, IAM rules and data
retention settings as the rest of your traffic. Perplexity's `people` search
type is not supported yet and returns a `400`.

## Get started

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Read the Search API docs](https://docs.llmgateway.io/features/search)**
- **[Compare with native web search](https://docs.llmgateway.io/features/web-search)**
