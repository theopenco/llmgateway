---
id: "113"
slug: "enterprise-data-and-prompt-controls"
date: "2026-10-04"
title: "Prompts, Semantic Caching, Data Residency and Data Streams"
summary: "Version prompts in LLM Gateway and call them by name, reuse cached answers for prompts that mean the same thing, keep inference on endpoints verified to run in the US or the EU, and forward audit and request log metadata to your own HTTPS endpoint. Prompt management is on every plan; the rest is on Enterprise."
tags: ["llmgateway"]
image:
  src: "/changelog/enterprise-data-and-prompt-controls.png"
  alt: "A glowing shield around an EU-flag orb on a circuit-board chip, surrounded by versioned documents, a database with a lightning bolt, a globe and a radio tower, representing prompt management, semantic caching, data residency and data streams on LLM Gateway"
  width: 1536
  height: 1024
---

Teams running LLM traffic in production kept asking for the same controls: change a prompt without redeploying, stop paying twice for the same question, keep inference inside a jurisdiction, and get every audit event into the security tools they already use. This release ships all four: **prompt management**, **semantic caching**, **data residency** and **data streams**.

## Prompt management

Store prompts on the new **Prompts** page of a project. Each save creates an immutable version, and labels such as `production` and `staging` point at versions. Deploying moves `production`; rolling back points it at an earlier version. Write `{{variable}}` placeholders, then call the prompt instead of sending messages from your code:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": {
      "id": "support-reply",
      "label": "staging",
      "variables": { "product": "Acme Cloud", "question": "How do I rotate my key?" }
    }
  }'
```

- Prompts without variables can also be called through `model` from any OpenAI-compatible client: `@prompt/support-reply`, `@prompt/support-reply@staging` or `@prompt/support-reply@3`. The version's default model is used.
- `/v1/responses` accepts the same `prompt` object, in the shape OpenAI's SDKs already use.
- The rendered messages go before any `messages` you send. The prompt's model and parameters apply only to fields you leave unset.
- Responses carry `x-llmgateway-prompt-id`, `x-llmgateway-prompt-version` and `x-llmgateway-prompt-label`, and request logs record the same values so you can compare versions.
- A missing variable returns `400`; an unknown prompt or label returns `404`.

Available on **every plan**.

## Semantic caching

Request caching only replays byte-identical requests. With **semantic caching**, a reworded prompt that means the same thing, such as "How can I reset the password for my account?" after "How do I reset my password?", is served from cache. In project **Preferences**, with request caching on, pick a mode and a similarity threshold between 0.90 and 0.999:

| Mode   | Behavior                                                                        |
| ------ | ------------------------------------------------------------------------------- |
| Off    | Only byte-identical requests are served from cache                              |
| Shadow | Matches are recorded on the request log, but every request goes to the provider |
| On     | A matching prompt is served the cached response                                 |

- Only the final user message may differ. The model, parameters, system prompt and every earlier message must match exactly.
- Numbers, codes such as `EUR→USD`, negations, opposites such as buy and sell, names, and the order of shared words must match too, so "sell Tesla" never replays "buy Tesla" and "convert 100 EUR to USD" never replays the reverse.
- Hits return `x-llmgateway-cache-match: semantic` and the similarity score, and are billed as cached requests. Every match, served or not, is recorded on the request log so you can tune the threshold.
- Requests with tools or non-text content and final messages under 16 characters are skipped.
- It is skipped under an active compliance policy, because the embedding call would send prompt text to a provider the policy does not vet.

**Start in Shadow mode.** An embedding cannot tell every pair of prompts apart, so review the logged matches before switching to On.

Available on the **Enterprise plan**.

## Data residency

Choose **United States** or **European Union (EU/EEA)** under **Data Residency** on the Compliance page, or send one header per request:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "x-llmgateway-data-residency: eu" \
  -H "Content-Type: application/json" \
  -d '{ "model": "alibaba/qwen-plus:eu-frankfurt", "messages": [{ "role": "user", "content": "Hello" }] }'
```

Requests then route only to endpoints whose inference is verified, against the provider's own documentation, to run in that jurisdiction. A provider's headquarters never counts, and anything unverified is blocked. A request with no qualifying endpoint is rejected with `403` before any data is sent. The header can add a restriction but never lift one your organization set, and it applies on every gateway endpoint. The [data residency docs](https://docs.llmgateway.io/features/data-residency) list the endpoints that qualify.

**Residency covers the model call.** The gateway, request logs and caches run in the US, so `us` residency is end to end today. `eu` keeps the model call in the EU/EEA, but prompts still pass through and are stored in the US.

The organization policy is available on the **Enterprise plan**.

## Data streams: SIEM forwarding and log export

The new **Data Streams** page sends your logs as signed HTTPS requests to an endpoint you run:

| Stream          | What it sends                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------- |
| SIEM forwarding | Audit logs: every admin action in the organization                                             |
| Log export      | Request log metadata: model, provider, tokens, cost, latency and finish reason of each request |

- Each batch is a `POST` signed with `X-LLMGateway-Signature`, the same scheme as platform webhooks, with an optional bearer token.
- Events arrive in order and are retried until accepted. Delivery is at least once, so deduplicate on the event `id`.
- Events carry metadata only. Prompts, completions and tool calls are never exported. Signing secrets and tokens are encrypted and never shown again.
- Failed deliveries back off for up to an hour. A stream that keeps failing pauses itself and notifies owners and admins; resuming continues from where it stopped.
- **Replay** re-sends any window of the last 30 days, and **Send test event** checks the connection.

Available on the **Enterprise plan** and enabled per organization: contact us to turn it on. Organization owners and admins manage streams.

---

**[Read the docs →](https://docs.llmgateway.io/features/data-streams)** | **[Talk to us about Enterprise →](https://llmgateway.io/enterprise)**
