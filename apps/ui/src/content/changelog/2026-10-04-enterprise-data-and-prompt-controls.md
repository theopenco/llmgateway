---
id: "113"
slug: "enterprise-data-and-prompt-controls"
date: "2026-10-04"
title: "Prompts, Semantic Caching, EU Residency and Data Streams"
summary: "Version prompts in LLM Gateway and call them by name, reuse cached answers for prompts that mean the same thing, keep requests inside the EU, and stream audit and request logs to Splunk, Datadog, S3 or a webhook. Prompt management is on every plan; the rest is on Enterprise."
tags: ["llmgateway"]
image:
  src: "/changelog/enterprise-data-and-prompt-controls.png"
  alt: "A glowing shield around an EU-flag orb on a circuit-board chip, surrounded by versioned documents, a database with a lightning bolt, a globe and a radio tower, representing prompt management, semantic caching, EU residency and data streams on LLM Gateway"
  width: 1536
  height: 1024
---

Teams running LLM traffic in production kept asking for the same controls: change a prompt without redeploying, stop paying twice for the same question, prove that requests stay in the EU, and get every audit event into the security tools they already use. This release ships all four: **prompt management**, **semantic caching**, **EU data residency** and **data streams**.

## Prompt management

Store prompts on the new **Prompts** page of a project. Each save creates an immutable version, and one version is live in production. Write `{{variable}}` placeholders, then call the prompt by name instead of sending messages from your code:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": {
      "id": "support-reply",
      "variables": { "product": "Acme Cloud", "question": "How do I rotate my key?" }
    }
  }'
```

- The rendered messages go before any `messages` you send. The prompt's model and parameters apply only to fields you leave unset.
- Pin a version with `prompt.version`, or deploy any version from the dashboard to roll forward or back.
- Responses carry `x-llmgateway-prompt-id` and `x-llmgateway-prompt-version`.
- A missing variable returns `400`; an unknown prompt returns `404`.

Available on **every plan**.

## Semantic caching

Request caching only replays byte-identical requests. With **semantic caching** on, a reworded prompt that means the same thing, such as "How can I reset the password for my account?" after "How do I reset my account password?", is served from cache. Turn it on in project **Preferences** and pick a similarity threshold between 0.80 and 0.999.

- Matches only reuse responses produced with the same model, provider and request parameters.
- Hits return `x-llmgateway-cache-match: semantic` and the similarity score, and are billed as cached requests.
- Applies to non-streaming, text-only requests without tools. It is skipped under an active compliance policy, because the embedding call would send prompts to a provider the policy does not vet.

Available on the **Enterprise plan**.

## EU data residency

Choose **European Union (EU/EEA)** under **Data Residency** on the Compliance page, or send one header per request:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "x-llmgateway-data-residency: eu" \
  -H "Content-Type: application/json" \
  -d '{ "model": "auto", "messages": [{ "role": "user", "content": "Hello" }] }'
```

Requests then route only to providers headquartered in the EU or EEA, or to a provider's EU regional endpoint pinned with `:region` (for example `alibaba/qwen-plus:eu-frankfurt`). A request with no qualifying provider is rejected with `403` before any data is sent. The header can add a restriction but never lift one your organization set.

The organization policy is available on the **Enterprise plan**.

## Data streams: SIEM forwarding and log export

The new **Data Streams** page sends your logs where your teams already work:

| Source       | What it sends                                                                |
| ------------ | ---------------------------------------------------------------------------- |
| Audit logs   | Every admin action in the organization                                       |
| Request logs | One event per request: model, provider, tokens, cost, latency, finish reason |

| Destination                | Delivery                             |
| -------------------------- | ------------------------------------ |
| Splunk HEC                 | One HEC event per log                |
| Datadog Logs               | Logs intake API                      |
| Amazon S3 or S3-compatible | One NDJSON object per batch          |
| HTTPS webhook              | Signed with `X-LLMGateway-Signature` |

- Events arrive in order and are retried until accepted. Delivery is at least once, so deduplicate on the event `id`.
- **Replay** re-sends any window of the last 30 days, and **Send test event** checks the connection.
- Prompts and completions stay out of request-log events unless you opt in. Credentials are encrypted and never shown again.

Available on the **Enterprise plan** for organization owners and admins.

---

**[Read the docs →](https://docs.llmgateway.io/features/data-streams)** | **[Talk to us about Enterprise →](https://llmgateway.io/enterprise)**
