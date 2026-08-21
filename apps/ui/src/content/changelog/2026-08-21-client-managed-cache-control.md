---
id: "79"
slug: "client-managed-cache-control"
date: "2026-08-21"
title: "Client-Managed Prompt Caching"
summary: "Provider cache writes is now a three-way setting. The new Client-managed mode forwards the cache markers your client sends and never adds any of its own, so one API key can serve a coding agent that manages its own caching alongside traffic that should not pay the cache-write premium."
image:
  src: "/changelog/client-managed-cache-control.png"
  alt: "The Provider Cache Writes setting in project preferences, showing the Automatic, Client-managed, and Disabled options"
  width: 1669
  height: 389
---

Anthropic's prompt caching is opt-in: nothing is cached unless the request carries a `cache_control` marker. The gateway has always added those markers for you on long prompts, which is the right default — until one API key serves two different kinds of traffic. Turning the setting off to stop paying the cache-write premium on your own sporadic requests also stripped the markers Claude Code, Cursor and Cline set for themselves, and those tools depend on caching to stay affordable.

**Provider cache writes is now a three-way setting**, and the new middle option hands the decision to each request.

## Three Modes

| Mode                    | Markers your client sends | Markers the gateway adds |
| ----------------------- | ------------------------- | ------------------------ |
| **Automatic** (default) | Forwarded                 | Added on long prompts    |
| **Client-managed**      | Forwarded                 | Never added              |
| **Disabled**            | Stripped                  | Never added              |

In **Client-managed** mode a request writes to the provider cache only if it asked to. A coding agent that sets its own breakpoints keeps every cache hit; a request that sends no markers is never charged for a cache write it did not want. Cache writes cost 1.25× the input price for a 5-minute entry and 2× for an hour; reads cost 0.1×, so the difference compounds fast across a long agentic session.

Markers are forwarded on `system` blocks, message text, tool definitions and `tool_result` blocks — the placements an agentic client actually uses. Tools sit at the base of Anthropic's cache hierarchy, so a breakpoint on the last tool definition covers the largest reusable prefix you have.

## Where To Set It

**Project Settings → Caching → Provider Cache Writes** in the dashboard, or **Settings → Provider cache writes** on DevPass. Changes take up to 5 minutes to reach the gateway.

Projects using a master key can set it through the API:

```bash
curl -X PATCH https://internal.llmgateway.io/v1/master/projects/proj_... \
  -H "Authorization: Bearer $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "providerCacheControlMode": "passthrough" }'
```

Existing projects keep their current behaviour: the setting migrates to **Automatic** if cache writes were on, and to **Disabled** if they were off. Nothing moves to Client-managed on its own.

The mode covers every provider with explicit cache markers — `cache_control` on Anthropic, Vertex Anthropic and Alibaba, `cachePoint` on AWS Bedrock, and `prompt_cache_breakpoint` on OpenAI models with explicit prompt caching. On those OpenAI models, Client-managed also pins `prompt_cache_options` to explicit mode, so implicit caching cannot write a cache the request never asked for.

---

**[Provider cache control docs →](https://docs.llmgateway.io/features/caching/provider-cache-control)** | **[Open project settings →](https://llmgateway.io/dashboard)**
