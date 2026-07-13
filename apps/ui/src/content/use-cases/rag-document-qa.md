---
id: use-case-rag-document-qa
slug: rag-document-qa
date: 2026-06-02
title: RAG & document Q&A
metaTitle: "LLM Gateway for RAG & Document Q&A"
description: "Build retrieval-augmented apps with cheap embeddings and strong generation across providers. One OpenAI-compatible API for embeddings and chat, with caching, fallback, and cost analytics."
headline: "Mix the cheapest embeddings with the best generation models — behind one API, with caching and fallback."
summary: "Run RAG and document Q&A on the best model for each job: affordable embeddings, long-context generation, all through one endpoint with cost tracking."
benefits:
  - title: Embeddings and chat, one API
    description: "Generate embeddings and answers through the same OpenAI-compatible endpoint and key. No separate integrations for each stage of the pipeline."
  - title: Long-context generation on demand
    description: "When a query pulls in a lot of retrieved context, route to a long-context model like Gemini 3.1 Pro without changing your code."
  - title: Cache the context you resend
    description: "Prompt caching cuts the cost of the system prompt and retrieved passages that repeat across a conversation or a batch of questions."
  - title: Cost analytics per pipeline
    description: "See exactly what embedding and generation cost per query, so you can tune chunking, retrieval and model choice against real numbers."
faqs:
  - question: Can I generate embeddings and answers through one API?
    answer: "Yes. LLM Gateway exposes embeddings and chat completions through the same OpenAI-compatible endpoint and key, so your retrieval and generation stages share one integration instead of two separate provider SDKs."
  - question: How do I handle queries with a lot of retrieved context?
    answer: "Route those requests to a long-context model. Because switching models is a one-line change to the model string, you can send short queries to a fast, cheap model and long-context queries to a model like Gemini 3.1 Pro without restructuring your app."
  - question: Does caching help RAG cost?
    answer: "Often, yes. RAG prompts resend the same system instructions and frequently the same retrieved passages. Prompt caching avoids paying full price for those repeated tokens, which adds up across high query volumes."
  - question: Can I switch embedding or generation providers later?
    answer: "Yes. The gateway abstracts the provider behind a stable API, so you can move between embedding or generation models — to chase quality or price — without rewriting your pipeline."
---

## RAG is a pipeline, and each stage wants a different model

A retrieval-augmented app does at least two model-bound jobs: **embed** content and queries, then **generate** an answer from the retrieved context. The economics of those jobs are opposite — embeddings should be cheap and run at scale, while generation should be smart and sometimes long-context. Wiring up a separate provider for each stage is how RAG codebases get messy.

LLM Gateway collapses that into one OpenAI-compatible API: embeddings and chat, every provider, one key.

## One integration for embed and generate

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

// 1. Embed the query with an affordable embeddings model
const embedding = await client.embeddings.create({
  model: "openai/text-embedding-3-large",
  input: userQuery,
});

// 2. Generate the answer with a strong model, given retrieved context
const answer = await client.chat.completions.create({
  model: "google-ai-studio/gemini-3.1-pro-preview", // long-context when retrieval is large
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${retrievedContext}\n\nQuestion: ${userQuery}` },
  ],
});
```

Both stages, one endpoint, one key — and you can change either model independently as better or cheaper options appear.

## Match the model to the query

Short, simple questions don't need a flagship model or a huge context window. Long, citation-heavy questions do. Routing per request lets you keep the cheap path cheap and reserve long-context generation for the queries that actually need it.

## Stop paying twice for the same context

RAG prompts are repetitive by design: the same system instructions, and often the same top passages, across a conversation or a batch run. Prompt caching means those repeated tokens don't cost full price every time — a real saving at scale.

## Tune against real numbers

Because every embedding and generation call is logged with tokens and dollar cost, you can measure the actual price of a change to your chunk size, retrieval depth or model choice — instead of guessing.
