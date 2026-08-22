---
id: "81"
slug: "provider-key-descriptions-new-models"
date: "2026-08-22"
title: "Provider Key Descriptions, Grok 4.6 & More"
summary: "Provider keys now take a description that follows them through key lists and request drilldowns, the master API returns each key's creator and project by name, and the catalogue picks up Grok 4.6 on AWS Bedrock and Vertex AI plus GLM-5.2 Turbo and an Australian region on SCX.ai."
image:
  src: "/changelog/provider-key-descriptions-new-models.png"
  alt: "Product roundup: labeled provider keys on a circuit board beside new model chips for Grok 4.6 and GLM-5.2 Turbo"
  width: 1536
  height: 1024
---

If your organization brings its own provider keys, you probably hold more than one per provider — a production and a staging account, separate billing, a key per team. Until now the dashboard told them apart by masked token alone. **Provider key descriptions** fix that: name a key when you add it (or edit the name later), and the label follows the key through the provider keys list and into each request's routing and error details — so when a request fails, you see which credential it used, not just `sk-...abcd`.

## Master Keys: Creator and Project by Name

Master key responses got the same treatment. `GET /v1/master/keys` and single-key reads now return `createdByEmail` and `projectName` alongside the existing IDs:

```json
{
  "id": "ak_...",
  "description": "Customer ACME — production key",
  "projectId": "proj_...",
  "projectName": "Customer ACME",
  "createdBy": "usr_...",
  "createdByEmail": "member@example.com"
}
```

One call renders a complete key list in your own product — no per-ID lookups to show who created a key or where it lives.

## Grok 4.6 on Bedrock and Vertex

xAI's Grok 4.6 — 500K context — now also routes through **AWS Bedrock** ($2.20/M input, $6.60/M output, $0.55/M cached input) and **Vertex AI**'s global endpoint. Both mappings were verified live across the full capability matrix: vision, tools, JSON schema output, and every documented reasoning effort up to `xhigh`. Same model string, two more deployments for smart routing and automatic fallback to land on.

## GLM-5.2 Turbo and an Australian Region

**GLM-5.2 Turbo** joins the catalogue on [SCX.ai](https://llmgateway.io/providers/scx-ai)'s fast deployment: a 1M-token context window at $1.99/M input and $6.16/M output, with streaming, reasoning, tool use, and JSON output. The standard GLM-5.2 mapping on SCX.ai also gains an `au` region, so Australian workloads can pin inference in-country.

Current pricing and capabilities for everything above live on the [models page](https://llmgateway.io/models).

---

**[Master keys docs →](https://docs.llmgateway.io/features/master-keys)** | **[Browse the models →](https://llmgateway.io/models)**
