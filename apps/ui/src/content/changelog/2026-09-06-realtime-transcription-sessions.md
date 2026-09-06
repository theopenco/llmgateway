---
id: "89"
slug: "realtime-transcription-sessions"
date: "2026-09-06"
title: "Realtime Transcription Sessions"
summary: "The /v1/realtime WebSocket now opens transcription-only sessions: live speech-to-text with no speech model in the loop, billed per minute or per token against the transcription model alone. Lounge gets a Transcribe mode on the same page."
image:
  src: "/changelog/realtime-transcription-sessions.png"
  alt: "A glowing waveform turning into lines of text on a central chip, representing live speech-to-text transcription sessions on LLM Gateway"
  width: 1536
  height: 1024
---

Live captions, agent assist, and voice notes all need the same thing: audio in, text out, as it is spoken. Until now the gateway offered either `/v1/audio/transcriptions`, which wants a finished file, or a full speech-to-speech realtime session — which meant paying for a speech model that never says a word. **Transcription sessions** close that gap: the same `/v1/realtime` endpoint, the same event protocol, with the transcription model as the session's only model.

## One endpoint, transcription only

The model is pinned at connection time, so it goes in the URL next to `intent=transcription`:

```
wss://api.llmgateway.io/v1/realtime?intent=transcription&model=gpt-live-transcribe
```

The gateway applies the transcription model upstream itself as soon as the session is created, so audio committed by a client that never sends a `session.update` is still transcribed on the model you are billed for. Configure the rest yourself, then stream audio with `input_audio_buffer.append`:

```json
{
  "type": "session.update",
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": {
          "model": "gpt-live-transcribe",
          "delay": "low",
          "languages": ["en"]
        },
        "turn_detection": null
      }
    }
  }
}
```

Transcripts arrive as `conversation.item.input_audio_transcription.delta` and `.completed`, exactly as they do inside a speech-to-speech session. `delay`, `keywords`, `languages`, `prompt`, `turn_detection`, and `noise_reduction` pass straight through to the provider. Any realtime transcription model on the [models page](https://llmgateway.io/models) can open a session.

The session is locked to the model it was opened with:

| Situation                                              | Result                           |
| ------------------------------------------------------ | -------------------------------- |
| `session.update` naming another transcription model    | `transcription_model_locked`     |
| `session.update` disabling transcription               | `transcription_model_required`   |
| `response.create` on a transcription session           | `response_not_supported`         |
| `turn_detection` on a model that segments continuously | Rejected — commit turns yourself |

Streaming models transcribe the buffer as it arrives rather than waiting for a turn, so they take `turn_detection: null` and you close each turn with `input_audio_buffer.commit`.

## Browsers mint a transcription secret

Client secrets take a session type. Mint one from your backend and hand it to the browser, which connects with the usual `openai-insecure-api-key` subprotocol:

```bash
curl -X POST "https://api.llmgateway.io/v1/realtime/client_secrets" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session": {
      "type": "transcription",
      "audio": { "input": { "transcription": { "model": "gpt-live-transcribe" } } }
    }
  }'
```

`intent` and `model` become optional on the socket URL — but if you send them, they must match what the secret was minted for.

## Billed for transcription, and nothing else

Every completed transcription is billed before its transcript is forwarded, at the model's listed rate: per token, or per minute of audio for models their provider meters that way. The models page shows which. Credits, API key status, usage limits, IAM rules, and provider rate limits are checked per turn — a session that stops clearing them is closed after the current turn finishes billing, never mid-transcript.

Because streaming models produce text before you commit anything, the gateway commits live audio on disconnect and ahead of an `input_audio_buffer.clear`. Transcript you already received is billed like any other turn instead of vanishing with the buffer.

## Transcribe in Lounge

[lounge.llmgateway.io/realtime](https://lounge.llmgateway.io/realtime) now has two modes. Switch to **Transcribe**, pick a transcription model, and talk: the transcript builds live, **Copy transcript** takes it with you, and the header tells you whether the model bills per minute or per token before you start. Turn detection is a choice between server VAD and a manual **Commit turn** button.

---

**[Transcription sessions docs →](https://docs.llmgateway.io/features/realtime#transcription-sessions)** | **[Try it in Lounge →](https://lounge.llmgateway.io/realtime?mode=transcribe)**
