---
id: vercel-ai-gateway
slug: vercel-ai-gateway
title: Migrate from Vercel AI Gateway
description: Guide to migrate from Vercel AI Gateway to LLM Gateway for more control and flexibility
date: 2026-01-20
fromProvider: Vercel AI Gateway
---

Vercel AI Gateway provides a unified interface for AI providers within the Vercel ecosystem. LLM Gateway offers similar functionality with additional features like response caching, detailed analytics, and self-hosting options.

## Quick Migration

Replace your Vercel AI SDK provider imports with the LLM Gateway provider:

```diff
- import { openai } from "@ai-sdk/openai";
- import { anthropic } from "@ai-sdk/anthropic";
+ import { generateText } from "ai";
+ import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

+ const llmgateway = createLLMGateway({
+   apiKey: process.env.LLM_GATEWAY_API_KEY
+ });

const { text } = await generateText({
-   model: openai("gpt-5.2"),
+   model: llmgateway("gpt-5.2"),
  prompt: "Hello!"
});
```

## Why Migrate to LLM Gateway?

| Feature                  | Vercel AI Gateway     | LLM Gateway            |
| ------------------------ | --------------------- | ---------------------- |
| AI SDK integration       | Native                | Native + OpenAI compat |
| Response caching         | No                    | Yes                    |
| Detailed cost analytics  | Limited               | Comprehensive          |
| Provider key management  | Per-provider env vars | Centralized (Pro)      |
| Self-hosting             | No                    | Yes (AGPLv3)           |
| Rate limiting            | Platform-level        | Customizable           |
| Anthropic-compatible API | No                    | Yes (/v1/messages)     |
| Smart routing            | No                    | Yes (auto failover)    |

## Migration Steps

### 1. Get Your LLM Gateway API Key

Sign up at [llmgateway.io/signup](/signup) and create an API key from your dashboard.

### 2. Install the LLM Gateway AI SDK Provider

Install the native LLM Gateway provider for the Vercel AI SDK:

```bash
pnpm add @llmgateway/ai-sdk-provider
```

This package provides full compatibility with the Vercel AI SDK and supports all LLM Gateway features.

### 3. Update Your Code

#### Basic Text Generation

```typescript
// Before (Vercel AI Gateway with native providers)
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const { text: openaiText } = await generateText({
  model: openai("gpt-4o"),
  prompt: "Hello!",
});

const { text: claudeText } = await generateText({
  model: anthropic("claude-3-5-sonnet-20241022"),
  prompt: "Hello!",
});

// After (LLM Gateway - single provider for all models)
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const { text: openaiText } = await generateText({
  model: llmgateway("openai/gpt-4o"),
  prompt: "Hello!",
});

const { text: claudeText } = await generateText({
  model: llmgateway("anthropic/claude-3-5-sonnet-20241022"),
  prompt: "Hello!",
});
```

#### Streaming Responses

```typescript
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { streamText } from "ai";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const { textStream } = await streamText({
  model: llmgateway("anthropic/claude-3-5-sonnet-20241022"),
  prompt: "Write a poem about coding",
});

for await (const text of textStream) {
  process.stdout.write(text);
}
```

#### Using in Next.js API Routes

```typescript
// app/api/chat/route.ts
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { streamText } from "ai";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: llmgateway("openai/gpt-4o"),
    messages,
  });

  return result.toDataStreamResponse();
}
```

#### Alternative: Using OpenAI SDK Adapter

If you prefer not to install a new package, you can use `@ai-sdk/openai` with a custom base URL:

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const llmgateway = createOpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const { text } = await generateText({
  model: llmgateway("openai/gpt-4o"),
  prompt: "Hello!",
});
```

### 4. Update Environment Variables

```bash
# Remove individual provider keys (optional - can keep as backup)
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...

# Add LLM Gateway key
export LLM_GATEWAY_API_KEY=llmgtwy_your_key_here
```

## Model Name Format

LLM Gateway supports two model ID formats:

**Root Model IDs** (without provider prefix) - Uses smart routing to automatically select the best provider based on uptime, throughput, price, and latency:

```
gpt-4o
claude-3-5-sonnet-20241022
gemini-1.5-pro
```

**Provider-Prefixed Model IDs** - Routes to a specific provider with automatic failover if uptime drops below 90%:

```
openai/gpt-4o
anthropic/claude-3-5-sonnet-20241022
google-ai-studio/gemini-1.5-pro
```

For more details on routing behavior, see the [routing documentation](https://docs.llmgateway.io/features/routing).

### Model Mapping Examples

| Vercel AI SDK                             | LLM Gateway                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `openai("gpt-4o")`                        | `llmgateway("gpt-4o")` or `llmgateway("openai/gpt-4o")`                                            |
| `anthropic("claude-3-5-sonnet-20241022")` | `llmgateway("claude-3-5-sonnet-20241022")` or `llmgateway("anthropic/claude-3-5-sonnet-20241022")` |
| `google("gemini-1.5-pro")`                | `llmgateway("gemini-1.5-pro")` or `llmgateway("google-ai-studio/gemini-1.5-pro")`                  |

Check the [models page](/models) for the full list of available models.

## Tool Calling

LLM Gateway supports tool calling through the AI SDK:

```typescript
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { generateText, tool } from "ai";
import { z } from "zod";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const { text, toolResults } = await generateText({
  model: llmgateway("openai/gpt-4o"),
  tools: {
    weather: tool({
      description: "Get the weather for a location",
      parameters: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => {
        return { temperature: 72, condition: "sunny" };
      },
    }),
  },
  prompt: "What's the weather in San Francisco?",
});
```

## Benefits After Migration

- **Unified API Key**: One API key for all providers instead of managing multiple
- **Response Caching**: Automatic caching reduces costs for repeated requests
- **Cost Analytics**: Track spending per model, per request, with detailed breakdowns
- **Smart Routing**: Automatic provider selection and failover for reliability
- **Self-Hosting**: Deploy on your own infrastructure for complete control
- **No Vendor Lock-in**: OpenAI-compatible API works with any client

## Self-Hosting LLM Gateway

If you prefer self-hosting, LLM Gateway is available under AGPLv3:

```bash
git clone https://github.com/llmgateway/llmgateway
cd llmgateway
pnpm install
pnpm setup
pnpm dev
```

This gives you the same managed experience with full control over your infrastructure.

## Need Help?

- Browse available models at [llmgateway.io/models](/models)
- Read the [API documentation](https://docs.llmgateway.io)
- Contact support at contact@llmgateway.io
