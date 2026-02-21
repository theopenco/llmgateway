---
id: "39"
slug: "retry-fallback"
date: "2026-02-12"
title: "Automatic Retry & Fallback with Full Routing Transparency"
summary: "When a provider fails, LLMGateway now automatically retries your request on another provider. Every attempt is logged with full routing visibility, so you always know what happened."
image:
  src: "/changelog/retry-fallback.jpg"
  alt: "Automatic retry and fallback routing"
  width: 640
  height: 349
---

## Automatic Retry & Fallback

LLMGateway now automatically retries failed requests on alternate providers. If your request hits a 500 error, timeout, or connection failure on the first provider, the gateway seamlessly retries on the next best provider — all within the same API call.

### How It Works

1. Your request is routed to the best available provider using our smart routing algorithm
2. If that provider fails (5xx, timeout, network error), the gateway automatically selects the next best provider
3. The retry happens transparently — your application receives the successful response as if nothing went wrong
4. Up to 2 retries are attempted before returning an error

### Full Routing Transparency

Every provider attempt is now tracked in the `routing` array on both the API response metadata and in your activity logs:

```json
{
  "metadata": {
    "routing": [
      {
        "provider": "openai",
        "model": "gpt-4o",
        "status_code": 500,
        "error_type": "server_error",
        "succeeded": false
      },
      {
        "provider": "azure",
        "model": "gpt-4o",
        "status_code": 200,
        "error_type": "none",
        "succeeded": true
      }
    ]
  }
}
```

### Retried Log Linking

Failed attempts that were retried are clearly marked in your activity logs:

- A **"Retried"** badge appears on failed logs that were successfully retried
- Each retried log links directly to the successful log that replaced it
- You can click through from a failed log to see the successful response

This means you'll never mistake a retried failure for an actual unrecovered error.

### Uptime-Aware Routing

Failed attempts still count against the provider's uptime score. If a provider keeps failing:

- Its uptime score drops in real-time
- The exponential penalty kicks in below 95% uptime
- Future requests are automatically routed away from it
- Your application stays reliable without any code changes

---

## Controlling Fallback Behavior

### Disable Fallback

Use the `X-No-Fallback: true` header to disable automatic retries:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-No-Fallback: true" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### When Fallback Is Disabled

Retries are automatically disabled when:

- You set the `X-No-Fallback: true` header
- You request a specific provider (e.g., `openai/gpt-4o`)
- The error is a client error (4xx) rather than a server error

**[Read the routing docs](https://docs.llmgateway.io/features/routing)** for the full details on how routing and fallback work together.
