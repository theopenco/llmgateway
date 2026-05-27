---
id: portkey
slug: portkey
title: Migrate from Portkey
description: Switch from Portkey to LLM Gateway. Same OpenAI-compatible API, no virtual keys or special headers, fully open-source self-hosting.
date: 2026-05-26
fromProvider: Portkey
---

Portkey wraps your provider calls in virtual keys, config IDs, and `x-portkey-*` headers. LLM Gateway keeps the OpenAI-compatible interface but drops the extra ceremony: standard Bearer auth, provider keys managed in a dashboard, and the option to self-host the entire platform under AGPLv3. Migration is mostly a base URL change.

## Quick Migration

Both services are OpenAI-compatible, so the core change is the base URL and dropping Portkey's custom headers:

```diff
- const baseURL = "https://api.portkey.ai/v1";
- // plus x-portkey-api-key and x-portkey-virtual-key headers
+ const baseURL = "https://api.llmgateway.io/v1";

- const apiKey = process.env.PORTKEY_API_KEY;
+ const apiKey = process.env.LLM_GATEWAY_API_KEY;  // standard Bearer auth
```

## Why Teams Switch to LLM Gateway

| What You Get                  | Portkey                       | LLM Gateway                           |
| ----------------------------- | ----------------------------- | ------------------------------------- |
| OpenAI-compatible API         | Yes                           | Yes                                   |
| Custom headers / virtual keys | Required for provider routing | Not needed                            |
| Open-source self-hosting      | Gateway/router only (MIT)     | Full platform (AGPLv3)                |
| Automatic provider routing    | Manual config                 | Live scoring, automatic               |
| Response caching              | Simple + semantic             | Built-in, one toggle                  |
| Image & video generation      | Limited                       | Same API as chat                      |
| Pricing                       | Usage/seat-based tiers        | 5% platform fee, or 0% with your keys |

Want a feature-by-feature breakdown? See [LLM Gateway vs Portkey](/compare/portkey).

## Migration Steps

### 1. Get Your LLM Gateway API Key

Sign up at [llmgateway.io/signup](/signup) and create an API key from your dashboard.

### 2. Map Your Models

LLM Gateway supports two model ID formats:

**Root Model IDs** (without provider prefix) — uses smart routing to automatically select the best provider based on uptime, throughput, price, and latency:

```text
gpt-5.2
claude-opus-4-5-20251101
gemini-3-flash-preview
```

**Provider-Prefixed Model IDs** — routes to a specific provider with automatic failover if uptime drops:

```text
openai/gpt-5.2
anthropic/claude-opus-4-5-20251101
google-ai-studio/gemini-3-flash-preview
```

In Portkey, the provider is usually selected by the virtual key or config attached to the request. With LLM Gateway, you select the provider in the model ID itself (or let smart routing choose) — there's no separate virtual key to manage.

For more on routing behavior, see the [routing documentation](https://docs.llmgateway.io/features/routing).

### 3. Update Your Code

#### Python with OpenAI SDK

```python
from openai import OpenAI

# Before (Portkey via OpenAI SDK)
from portkey_ai import createHeaders

client = OpenAI(
    base_url="https://api.portkey.ai/v1",
    api_key="dummy",
    default_headers=createHeaders(
        api_key=os.environ["PORTKEY_API_KEY"],
        virtual_key=os.environ["PORTKEY_VIRTUAL_KEY"],
    ),
)

# After (LLM Gateway) - no custom headers, no virtual key
client = OpenAI(
    base_url="https://api.llmgateway.io/v1",
    api_key=os.environ["LLM_GATEWAY_API_KEY"],
)

response = client.chat.completions.create(
    model="gpt-5.2",  # or "openai/gpt-5.2" to target a specific provider
    messages=[{"role": "user", "content": "Hello!"}],
)
```

#### Python with the Portkey SDK

If you use the native `portkey-ai` client, swap to the OpenAI SDK pointed at LLM Gateway:

```python
# Before (native Portkey SDK)
from portkey_ai import Portkey

portkey = Portkey(
    api_key=os.environ["PORTKEY_API_KEY"],
    virtual_key=os.environ["PORTKEY_VIRTUAL_KEY"],
)

response = portkey.chat.completions.create(
    model="gpt-5.2",
    messages=[{"role": "user", "content": "Hello!"}],
)

# After (LLM Gateway via the standard OpenAI SDK)
from openai import OpenAI

client = OpenAI(
    base_url="https://api.llmgateway.io/v1",
    api_key=os.environ["LLM_GATEWAY_API_KEY"],
)

response = client.chat.completions.create(
    model="gpt-5.2",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

#### TypeScript/JavaScript

```typescript
import OpenAI from "openai";

// Before (Portkey via OpenAI SDK)
import { createHeaders } from "portkey-ai";

const client = new OpenAI({
  baseURL: "https://api.portkey.ai/v1",
  apiKey: "dummy",
  defaultHeaders: createHeaders({
    apiKey: process.env.PORTKEY_API_KEY,
    virtualKey: process.env.PORTKEY_VIRTUAL_KEY,
  }),
});

// After (LLM Gateway) - standard Bearer auth, no extra headers
const llmgateway = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const completion = await llmgateway.chat.completions.create({
  model: "gpt-5.2", // or "openai/gpt-5.2" to target a specific provider
  messages: [{ role: "user", content: "Hello!" }],
});
```

#### cURL

```bash
# Before (Portkey)
curl https://api.portkey.ai/v1/chat/completions \
  -H "x-portkey-api-key: $PORTKEY_API_KEY" \
  -H "x-portkey-virtual-key: $PORTKEY_VIRTUAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.2",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# After (LLM Gateway) - single Authorization header
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.2",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
# Use "openai/gpt-5.2" to target a specific provider
```

### 4. Replace Virtual Keys and Configs

Portkey routes through virtual keys (one per provider credential) and config objects. LLM Gateway replaces both:

- **Virtual keys → Provider Keys.** Add your provider API keys once in the dashboard under **Settings > Provider Keys**. Bring your own keys and pay a 0% gateway markup, or use LLM Gateway's default keys.
- **Configs → model IDs + routing.** Provider selection, fallbacks, and load balancing are handled by the model ID and built-in smart routing — there's no separate config object to maintain.

## Streaming Support

Streaming works identically:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.llmgateway.io/v1",
    api_key=os.environ["LLM_GATEWAY_API_KEY"],
)

stream = client.chat.completions.create(
    model="openai/gpt-5.2",
    messages=[{"role": "user", "content": "Write a story"}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

## Function/Tool Calling

Tool calling carries over unchanged — it's standard OpenAI-format `tools`:

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the weather for a location",
        "parameters": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    },
}]

response = client.chat.completions.create(
    model="openai/gpt-5.2",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=tools,
)
```

## What Changes After Migration

- **No more virtual keys or `x-portkey-*` headers** — standard Bearer auth and provider keys in a dashboard
- **Automatic routing** — providers scored on live uptime, throughput, price, and latency instead of static configs
- **Caching is one toggle** — no semantic-cache setup required to get repeat-request savings
- **Generative media included** — image and video models through the same API and billing
- **Fully open source** — self-host the entire platform, not just the router

## Self-Hosting LLM Gateway

Prefer to run it yourself? Unlike Portkey, where only the gateway is open source, the entire LLM Gateway platform is available under AGPLv3:

```bash
git clone https://github.com/theopenco/llmgateway
cd llmgateway
pnpm install
pnpm setup
pnpm dev
```

See the [self-hosting guide](/blog/how-to-self-host-llm-gateway) for production deployment with a single Docker image.

## Full Comparison

Want a detailed breakdown of all features? Check out our [LLM Gateway vs Portkey comparison page](/compare/portkey).

## Need Help?

- Browse available models at [llmgateway.io/models](/models)
- Read the [API documentation](https://docs.llmgateway.io)
- Contact support at contact@llmgateway.io
