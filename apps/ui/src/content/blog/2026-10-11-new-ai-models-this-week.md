---
id: "blog-new-ai-models-this-week-2026-10-11"
slug: "new-ai-models-this-week-2026-10-11"
date: "2026-10-11"
title: "New AI Models This Week: Haiku 5.5, Mistral Large 4, Nano Banana 2.1"
summary: "The new AI models released between September 28 and October 11, 2026 and already live on LLM Gateway: Claude Haiku 5.5 and Sonnet 5.5, GPT-6.1 Sol, Mistral Large 4, Gemini Nano Banana 2.1, Hy Image 3.5 Preview, Ling 3.1 Flash and Grok Imagine Video 1.5 Lite, with prices, context windows and the model ID to call."
categories: ["Announcements", "Guides"]
faqs:
  - question: "Which new AI models were released this week?"
    answer: "Between October 2 and October 8, 2026: Ling 3.1 Flash (InclusionAI, free), Hy Image 3.5 Preview (Tencent), Mistral Large 4, Gemini Nano Banana 2.1 (Google), Claude Haiku 5.5 (Anthropic) and Grok Imagine Video 1.5 Lite (xAI). The week before brought Claude Sonnet 5.5 and GPT-6.1 Sol."
  - question: "How much does Claude Haiku 5.5 cost?"
    answer: "$0.10 per million input tokens and $0.50 per million output tokens on LLM Gateway, with cached input at $0.01 per million. It has a 1M-token context window and supports tools, vision and adaptive thinking."
  - question: "How do I use a new model on LLM Gateway?"
    answer: "Set the model field of your request to the ID in the table, for example claude-haiku-5-5 or mistral-large-4, and send it to https://api.llmgateway.io/v1/chat/completions with your LLM Gateway API key. New models are added to the catalog as providers publish them, usually on release day."
image:
  src: "/blog/new-ai-models-this-week-2026-10-11.png"
  alt: "A glowing calendar page with a sparkle on the central chip of a dark circuit board, surrounded by rocket, film clapperboard, paintbrush, chat bubble, brain, price tag, stopwatch and star icons, representing the new AI models released this week"
  width: 1536
  height: 1024
---

Eight new AI models landed in the **LLM Gateway** catalog in the last two weeks, from a $0.10-per-million-token Claude to a 1.05-trillion-parameter open-weight Mistral. Each one is callable today with the same request you already send; only the `model` string changes. Prices are per million tokens unless noted, as listed on each [model page](https://llmgateway.io/models) on October 11, 2026.

## New AI models at a glance

| Released | Model                                                                                   | Family      | Input / output price                          | Context | Notes                                                   |
| -------- | --------------------------------------------------------------------------------------- | ----------- | --------------------------------------------- | ------- | ------------------------------------------------------- |
| Oct 8    | [Grok Imagine Video 1.5 Lite](https://llmgateway.io/models/grok-imagine-video-1-5-lite) | xAI         | $0.02/s (480p), $0.03/s (720p)                | —       | Text- or image-to-video                                 |
| Oct 7    | [Claude Haiku 5.5](https://llmgateway.io/models/claude-haiku-5-5)                       | Anthropic   | $0.10 / $0.50                                 | 1M      | Tools, vision, adaptive thinking                        |
| Oct 6    | [Mistral Large 4](https://llmgateway.io/models/mistral-large-4)                         | Mistral     | $1.36 / $4.18                                 | 1M      | Open-weight MoE, 49B active / 1.05T total, vision       |
| Oct 6    | [Gemini Nano Banana 2.1](https://llmgateway.io/models/gemini-nano-banana-2.1)           | Google      | $1.50 / $7.50, $30 per 1M image output tokens | 131K    | Image generation and editing, 1K–4K output              |
| Oct 5    | [Hy Image 3.5 Preview](https://llmgateway.io/models/hy-image-v3.5-preview)              | Tencent     | $1.60 per 1M image output tokens              | 100K    | Image generation and editing, up to 20 reference images |
| Oct 2    | [Ling 3.1 Flash](https://llmgateway.io/models/ling-3.1-flash)                           | InclusionAI | Free (Novita); $0.06 / $0.18 on DeepInfra     | 262K    | Hybrid reasoning MoE, 560B total / 25B active, tools    |
| Sep 29   | [GPT-6.1 Sol](https://llmgateway.io/models/gpt-6.1-sol)                                 | OpenAI      | $2.00 / $10.00                                | 1.05M   | Coding, computer use, reasoning                         |
| Sep 28   | [Claude Sonnet 5.5](https://llmgateway.io/models/claude-sonnet-5-5)                     | Anthropic   | $2.00 / $10.00                                | 1M      | Adaptive thinking, vision, tools                        |

## Claude Haiku 5.5: a 1M-context model at $0.10 per million input tokens

Anthropic positions Haiku 5.5 as its fastest model for high-volume, latency-sensitive work: classification, routing, extraction and subagent tasks. It keeps the adaptive thinking and vision capabilities of Sonnet 5.5 at a twentieth of the price, with cached input at $0.01 per million tokens and a 128K output limit. On LLM Gateway it is served by Anthropic and AWS Bedrock, so a bare `claude-haiku-5-5` request fails over between them.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-haiku-5-5",
    "messages": [{"role": "user", "content": "Label this support ticket: billing, bug, or feature request."}]
  }'
```

If you run a router-and-worker pattern, Haiku 5.5 as the router and Sonnet 5.5 or GPT-6.1 Sol as the worker is the obvious pairing this week.

## Mistral Large 4: an open-weight flagship with a 1M context

Mistral Large 4 is a granular mixture-of-experts model with 49B active and 1.05T total parameters plus a 1.6B vision encoder, and the weights are open. At $1.36 input / $4.18 output it sits between Haiku and Sonnet on price while matching their 1M-token context. Cached input is $0.14. It supports tool calling, so it drops into agent loops as a cheaper alternative to the closed flagships. Model ID: `mistral-large-4`.

## Gemini Nano Banana 2.1 and Hy Image 3.5: two image models in one week

Google's **Nano Banana 2.1** succeeds Nano Banana 2 with sharper 1K to 4K output, better text rendering, multi-turn character consistency and search grounding. Text in and out is priced like a Flash-tier model ($1.50 / $7.50) and image output at $30 per million image tokens.

Tencent's **Hy Image 3.5 Preview** is a unified generation-and-editing model on the Hy Image 3.0 MoE base. It accepts up to 20 reference images, outputs up to 4K and renders Chinese and English text well. Image output is $1.60 per million image tokens.

Both are available through `/v1/images` and the [Lounge](https://lounge.llmgateway.io) image studio.

## GPT-6.1 Sol and Claude Sonnet 5.5: the new mid-tier pair

The two releases from the week before this one are priced identically, $2.00 input / $10.00 output, with cached input at $0.10, and both offer a 1M-class context (1.05M for Sol) and 128K output. OpenAI describes Sol as near-Astra performance at lower cost for complex coding, computer use and professional work; Anthropic describes Sonnet 5.5 as its best combination of speed and intelligence. If you are choosing between them for a coding agent, run both through the same prompts on the [compare view](https://llmgateway.io/models/compare) before committing; usage share across LLM Gateway customers is on the [rankings page](https://llmgateway.io/rankings).

## Free this week: Ling 3.1 Flash

InclusionAI's Ling 3.1 Flash is a hybrid-reasoning MoE (560B total, 25B active) with tool calling and a 262K context, and it is free on LLM Gateway via Novita (DeepInfra also serves it at $0.06 / $0.18 if you want a paid fallback). It is a good default for evals and CI jobs where you want a capable model at no cost. Model ID: `ling-3.1-flash`.

## Video: Grok Imagine Video 1.5 Lite

xAI's lightweight video model generates clips from a text prompt or an input image at $0.02 per second (480p) or $0.03 per second (720p), plus $0.01 per input image, from us-east-1 and us-west-2. Call it through `/v1/videos`.

## Keep up with new AI models

- **[Try LLM Gateway free](https://llmgateway.io/signup)** and call any model above with one API key.
- The full release history, by month, is on the [AI model timeline](https://llmgateway.io/timeline).
- Not sure which to pick? Read [how to choose the right LLM](/blog/how-to-choose-the-right-llm).
