---
id: "75"
slug: "dynamic-routes"
date: "2026-08-07"
title: "Dynamic Routes"
summary: "Define named, versioned routing flows — conditions, A/B splits, and model targets with provider fallback — and invoke them by putting dynamic/<name> in the model field. Build them visually or in JSON, publish immutable versions, and roll back instantly. Available on the Enterprise plan."
image:
  src: "/changelog/dynamic-routes.png"
  alt: "A circuit board with a glowing branching flow diagram on the central chip, representing routing decision graphs"
  width: 1536
  height: 1024
---

Routing logic usually lives in application code: which users get the premium model, what percentage of traffic tries the new one, which requests should be rejected outright. Every change means a deploy, and every experiment leaks model names into your clients. **Dynamic routes** move that logic into the gateway: define a named routing flow once, then invoke it by putting `dynamic/<name>` in the `model` field of any OpenAI-compatible request.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "x-user-tier: paid" \
  -d '{
    "model": "dynamic/support",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Route Requests On What You Already Send

A route is a small decision graph evaluated on every request:

| Node type     | What it does                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `conditional` | If/else branching on request headers, body fields (dot-paths), or request metadata — ops: `eq`, `neq`, `in`, `contains`, `gt`, `lt`, `exists` |
| `percentage`  | Weighted traffic splits for A/B tests and gradual rollouts — deterministic per session, so a conversation never flip-flops mid-experiment     |
| `model`       | The target model, with an optional ordered provider allowlist that doubles as the fallback order                                              |
| `end`         | Explicitly reject the request with a `400`                                                                                                    |

Once a route resolves to a model, the request goes through the same smart routing as any other: weighted provider scoring, sticky sessions, and automatic cross-provider fallback all apply.

## Build Visually Or In JSON

The **Dynamic Routes** page in your project settings has two editors over the same graph: a drag-and-drop canvas with node inspectors, and a raw JSON view. Both validate against the full schema — unknown models, unwired branches, cycles, and invalid conditions are caught before you can save, so an invalid graph can never serve traffic.

## Versioned, With Instant Rollback

Edits go to a draft; publishing snapshots the draft as an immutable version and re-validates it against the live model catalog. Rolling back is one click — the route pointer moves to a previous version with no data migration. Every request's routing metadata records the route name, version, and the node path it took, so you can see exactly why a request landed on a model.

Routes are cached in the gateway with a stale fallback, so requests keep routing even if the database is briefly unavailable.

Available on the **Enterprise plan**.

---

**[Dynamic routes docs →](https://docs.llmgateway.io/features/dynamic-routes)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
