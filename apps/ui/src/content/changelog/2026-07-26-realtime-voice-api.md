---
id: "70"
slug: "realtime-voice-api"
date: "2026-07-26"
title: "Realtime Voice API"
summary: "Speech-to-speech conversations now run through LLM Gateway over the OpenAI-compatible /v1/realtime WebSocket endpoint — with ephemeral client secrets for browsers, per-token audio billing in your activity feed, and a voice call surface in Lounge."
image:
  src: "/changelog/realtime-voice-api.png"
  alt: "A glowing microphone on a circuit-board chip surrounded by sound waves and audio icons, representing the LLM Gateway realtime voice API"
  width: 1536
  height: 1024
---

Voice was the one thing you still had to route around the gateway. Realtime models speak a WebSocket event protocol instead of HTTP request/response, so every voice feature meant a second integration: provider keys in your app, no cost tracking, no usage limits, no fallback. **The realtime API** closes that gap — point any OpenAI realtime client at `wss://api.llmgateway.io/v1/realtime` and keep your existing event handling.

## A drop-in WebSocket endpoint

Authenticate with your LLM Gateway API key in the `Authorization` header, exactly like the rest of the API:

```javascript
import WebSocket from "ws";

const ws = new WebSocket(
  "wss://api.llmgateway.io/v1/realtime?model=gpt-realtime",
  { headers: { Authorization: `Bearer ${process.env.LLM_GATEWAY_API_KEY}` } },
);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: "You are a friendly assistant.",
        audio: { output: { voice: "marin" } },
      },
    }),
  );
});
```

The session speaks the standard event protocol — `session.update`, `input_audio_buffer.append`, `response.create` on the way in; `session.created`, `response.output_audio.delta`, `response.done` on the way out. Server-side voice activity detection, input audio transcription, and function calling all work as they do upstream. The model is locked at connection time, so a `session.update` that tries to swap `session.model` is rejected with a `model_locked` event rather than silently repricing the call. Browse the available realtime models and their per-token audio rates on the [models page](https://llmgateway.io/models).

## Browsers get ephemeral secrets, not your API key

Mint a short-lived client secret from your backend and hand that to the browser:

```bash
curl -X POST "https://api.llmgateway.io/v1/realtime/client_secrets" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "expires_after": { "anchor": "created_at", "seconds": 120 },
    "session": { "type": "realtime", "model": "gpt-realtime" }
  }'
```

The response carries an `ek_...` secret the browser passes through the standard `openai-insecure-api-key` WebSocket subprotocol. Secrets live 10–300 seconds (60 by default), are minted for exactly one model, and can pin the input transcription model too. Every auth, credit, and model-access check runs at mint time and again at connect time. Credentials are never accepted as query parameters — a URL carrying `token`, `api_key`, or `client_secret` is rejected with `400` before the socket opens.

## Audio billing that reconciles

Every response is metered when it completes, with text, cached, and audio tokens priced separately at the model's listed rates — no estimating from wall-clock time. Input audio transcription is billed against its own model, as its own line item, and the transcription model is pinned for the session on first use so a mid-call swap can't reprice work already committed. It all lands in your [activity feed](https://llmgateway.io/dashboard) and analytics next to your regular requests, now with audio input and output cost broken out.

Because billing happens per response, the gateway's authorization gates run per response too: credits, API key status, usage limits, and IAM rules are checked before each generation — whether you triggered it with `response.create` or the model's own voice activity detection did. A blocked generation arrives as an `error` event on the session instead of running your balance negative.

Sessions carry safety limits by default, and are closed gracefully once in-flight responses are billed:

| Limit                           | Default |
| ------------------------------- | ------- |
| Maximum session duration        | 1 hour  |
| Maximum spend per session       | $10     |
| Concurrent sessions per org     | 20      |
| Concurrent sessions per API key | 10      |

## Talk to a model right now

Lounge ships a **Voice Calls** page at [lounge.llmgateway.io/realtime](https://lounge.llmgateway.io/realtime): pick a model and a voice, hit **Start call**, and talk. The live transcript builds as you speak, a voice activity indicator shows who has the floor, and every call is saved to your history with its duration, model, voice, and token usage so you can reopen the transcript later.

Realtime runs on pay-as-you-go organizations — your credits, or your own provider key when the project uses [provider keys](https://docs.llmgateway.io/learn/provider-keys). WebSocket is the only transport for now; WebRTC, SIP, image input, and hosted tools are not supported yet.

---

**[Realtime API docs →](https://docs.llmgateway.io/features/realtime)** | **[Try Voice Calls →](https://lounge.llmgateway.io/realtime)**
